import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMaskingContext, setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import {
  asRunId, EvidenceEntrySchema, RunsEvidenceInputSchema, RunsEvidenceResultSchema, maskedMarker,
} from '@vostride/agent-qa-schema'
import type {
  EvidenceDocument, EvidenceEntry, EvidenceKind, RunDetailRows, RunDetailStep, RunDetailSubAction,
  RunsEvidenceInput,
} from '@vostride/agent-qa-schema'
import { runsEvidenceSpec } from '../ops/runs-evidence.js'
import { sniffEvidenceContentType } from '../ops/runs-artifact.js'
import { FunctionNotBoundError, type FunctionDeps } from '../spec.js'
import { RunNotFoundError } from '../ops/runs-get.js'

const runId = asRunId('run-423-evidence-read')
const kinds = ['console', 'network', 'a11y', 'aria', 'variables'] as const
const documents: Record<EvidenceKind, EvidenceDocument> = {
  console: { schemaVersion: 1, kind: 'console', records: [{ level: 'error', text: 'recorded console', timestamp: 2 }] },
  network: { schemaVersion: 1, kind: 'network', records: [{ url: 'https://example.test/api', method: 'GET', status: 403, requestHeaders: {}, responseHeaders: {}, startTime: 1, endTime: 2, body: 'recorded response' }] },
  a11y: { schemaVersion: 1, kind: 'a11y', records: [{ ruleId: 'label', impact: 'serious', description: 'recorded violation', help: 'label input', helpUrl: 'https://example.test/rule', nodes: [{ html: '<input>', target: ['#field'] }] }] },
  aria: { schemaVersion: 1, kind: 'aria', tree: 'button "recorded before tree"' },
  variables: { schemaVersion: 1, kind: 'variables', records: { captured: { value: 'recorded value', source: 'capture' } } },
}
const counts = {
  console: { total: 1, errors: 1, warnings: 0 }, network: { total: 1, failed: 1, errored: 0 },
  a11y: { minor: 0, moderate: 0, serious: 1, critical: 0 }, variables: { count: 1 },
}
function bytesOf(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)) }
function entryFor(kind: EvidenceKind, bytes: Uint8Array): EvidenceEntry {
  if (kind === 'variables') return { kind, state: 'present', counts: counts.variables }
  const sha = createHash('sha256').update(bytes).digest('hex')
  const ref = { id: `${kind === 'aria' ? 'aria-state' : `${kind}-evidence`}:${sha}`, sha }
  return EvidenceEntrySchema.parse({ kind, state: 'present', ref, ...(kind === 'aria' ? {} : { counts: counts[kind] }) })
}
function fixture(kind: EvidenceKind, document: unknown = documents[kind]) {
  const bytes = bytesOf(document)
  const entry = entryFor(kind, bytes)
  const evidence = {
    console: { kind: 'console', state: 'absent', reason: 'empty' },
    network: { kind: 'network', state: 'absent', reason: 'not-captured' },
    a11y: { kind: 'a11y', state: 'absent', reason: 'unsupported' },
    variables: { kind: 'variables', state: 'absent', reason: 'failed' },
    ...(kind === 'aria' ? {} : { [kind]: entry }),
  } as RunDetailStep['evidence']
  const step: RunDetailStep = {
    testIndex: 2, stepIndex: 3, cacheStatus: 'miss', verifierVerdict: { pass: true, reasoning: 'done' },
    selfHealOccurred: false, briefDigest: 'brief', evidence,
    ...(kind === 'variables' ? { variableSnapshot: documents.variables.kind === 'variables' ? documents.variables.records : {} } : {}),
  }
  const child: RunDetailSubAction = {
    testIndex: 2, stepIndex: 3, subActionIndex: 4, plan: 'recorded', plannedAction: { type: 'navigate', to: 'url', url: 'https://example.test' },
    result: { success: true }, screenStateHash: 'before',
    ...(kind === 'aria' ? { ariaEvidence: entry as RunDetailSubAction['ariaEvidence'], artifactRefs: 'ref' in entry ? [entry.ref] : [] } : {}),
  }
  const rows: RunDetailRows = { runId, members: [{ testIndex: 2, attempts: 1 }], steps: [step], subActions: [child] }
  const readBlob = vi.fn(async () => ({ status: 'found' as const, bytes }))
  const forbidden = vi.fn(() => { throw new Error('No handoff, configuration or mutation is permitted') })
  const deps = {
    runDetail: { read: vi.fn(async () => rows) }, evidenceBlobs: { read: readBlob },
    runs: { get: forbidden }, config: { getMasked: forbidden },
  } as unknown as FunctionDeps
  const address: RunsEvidenceInput = { runId, testIndex: 2, stepIndex: 3, kind, ...(kind === 'aria' ? { subActionIndex: 4 } : {}) }
  return { bytes, entry, step, child, rows, deps, readBlob, forbidden, address,
    read: () => runsEvidenceSpec.invoke(address, deps) }
}

beforeEach(() => setActiveMaskingContextResolver(() => createMaskingContext()))
afterEach(() => setActiveMaskingContextResolver(() => undefined))

describe('EVIDENCE-ALL-KINDS', () => {
  it.each(kinds)('%s present returns its validated recorded document', async kind => {
    const f = fixture(kind)
    const before = JSON.stringify(f.rows)
    expect(await f.read()).toEqual({ address: f.address, outcome: 'ready', evidence: f.entry, document: documents[kind] })
    expect(RunsEvidenceResultSchema.safeParse(await f.read()).success).toBe(true)
    if (kind === 'variables') expect(f.readBlob).not.toHaveBeenCalled()
    else expect(f.readBlob).toHaveBeenCalledWith(runId, 'ref' in f.entry ? f.entry.ref.sha : '')
    expect(f.forbidden).not.toHaveBeenCalled()
    expect(JSON.stringify(f.rows)).toBe(before)
  })
  it.each(kinds)('%s absent preserves capture-time reason without reading bytes', async kind => {
    const f = fixture(kind)
    const absent = { kind, state: 'absent' as const, reason: 'failed' as const }
    if (kind === 'aria') f.child.ariaEvidence = { ...absent, kind }
    else f.step.evidence = { ...f.step.evidence!, [kind]: absent }
    expect(await f.read()).toEqual({ address: f.address, outcome: 'absent', evidence: absent })
    expect(f.readBlob).not.toHaveBeenCalled()
  })
  it.each(kinds)('%s historical absence does not backfill a cleartext handoff', async kind => {
    const f = fixture(kind)
    delete f.step.evidence
    delete f.step.variableSnapshot
    delete f.child.ariaEvidence
    expect(await f.read()).toEqual({ address: f.address, outcome: 'absent', evidence: { kind, state: 'absent', reason: 'unavailable' } })
    expect(f.readBlob).not.toHaveBeenCalled()
    expect(f.forbidden).not.toHaveBeenCalled()
  })
})

it('EVID-MISSING-BLOB returns unavailable plus evidenceIncomplete without mutating capture', async () => {
  const f = fixture('console')
  f.deps.evidenceBlobs!.read = async () => ({ status: 'blob_absent' })
  expect(await f.read()).toEqual({ address: f.address, outcome: 'absent', evidence: { kind: 'console', state: 'absent', reason: 'unavailable', evidenceIncomplete: true } })
  expect(f.step.evidence?.console).toEqual(f.entry)
})

it.each(['kind', 'schemaVersion', 'records', 'unknown-field', 'json', 'utf8'])(
  'EVID-BAD-BLOB %s is a typed read error preserving runtime capture', async fault => {
    const bad = { ...(fault === 'kind' ? documents.network : documents.console),
      ...(fault === 'schemaVersion' ? { schemaVersion: 2 } : {}),
      ...(fault === 'records' ? { records: 'bad' } : {}), ...(fault === 'unknown-field' ? { secret: 'synthetic' } : {}) }
    const f = fixture('console', bad)
    if (fault === 'json' || fault === 'utf8') {
      const bytes = fault === 'json' ? new TextEncoder().encode('{') : new Uint8Array([
        ...new TextEncoder().encode('{"schemaVersion":1,"kind":"console","records":[{"level":"error","text":"'),
        0xff,
        ...new TextEncoder().encode('","timestamp":1}]}'),
      ])
      f.step.evidence = { ...f.step.evidence!, console: entryFor('console', bytes) as NonNullable<RunDetailStep['evidence']>['console'] }
      f.deps.evidenceBlobs!.read = async () => ({ status: 'found', bytes })
    }
    const capture = f.step.evidence!.console
    expect(await f.read()).toEqual({ address: f.address, outcome: 'read-error', code: 'invalid-document', capture })
    expect(f.step.evidence!.console).toEqual(capture)
  },
)
it('EVIDENCE-SHA-MISMATCH hashes exact bytes before JSON parsing or masking', async () => {
  const f = fixture('console')
  f.deps.evidenceBlobs!.read = async () => ({ status: 'found', bytes: bytesOf(documents.aria) })
  expect(await f.read()).toEqual({ address: f.address, outcome: 'read-error', code: 'sha-mismatch', capture: f.entry })
})

describe('EVID-ADDRESS-REFUSAL', () => {
  it('rejects noncanonical paths, fractional/negative indexes, extra SHA and child-addressed console', () => {
    const f = fixture('console')
    for (const patch of [{ runId: '../run' }, { runId: 'run/name' }, { testIndex: -1 }, { stepIndex: 0.5 }, { subActionIndex: 2 }, { sha: 'a'.repeat(64) }, { kind: 'other' }]) {
      expect(RunsEvidenceInputSchema.safeParse({ ...f.address, ...patch }).success).toBe(false)
    }
  })
  it('refuses a different run returned by the port before any blob access', async () => {
    const f = fixture('console')
    f.rows.runId = 'other-run'
    expect(await f.read()).toMatchObject({ outcome: 'read-error', code: 'ref-not-owned' })
    expect(f.readBlob).not.toHaveBeenCalled()
  })
  it.each(['member', 'step', 'child', 'duplicate'])('%s never falls back to a nearby row', async missing => {
    const f = fixture('aria')
    if (missing === 'member') f.address.testIndex = 1
    if (missing === 'step') f.address.stepIndex = 1
    if (missing === 'child') f.address.subActionIndex = 1
    if (missing === 'duplicate') f.rows.subActions = [f.child, { ...f.child }]
    expect(await f.read()).toMatchObject({ outcome: 'read-error', code: missing === 'duplicate' ? 'ambiguous-address' : 'address-not-found' })
    expect(f.readBlob).not.toHaveBeenCalled()
  })
  it('refuses malformed/cross-kind refs on the addressed row', async () => {
    const f = fixture('console')
    f.step.evidence = { ...f.step.evidence!, console: { ...f.entry, ref: { id: 'aria-state:bad', sha: 'bad' } } } as RunDetailStep['evidence']
    expect(await f.read()).toMatchObject({ outcome: 'read-error', code: 'invalid-entry' })
    expect(f.readBlob).not.toHaveBeenCalled()
  })
  it('requires ARIA ref ownership in the selected child artifactRefs', async () => {
    const f = fixture('aria')
    f.child.artifactRefs = []
    expect(await f.read()).toEqual({ address: f.address, outcome: 'read-error', code: 'ref-not-owned', capture: f.entry })
    expect(f.readBlob).not.toHaveBeenCalled()
  })
})

it('ARIA-SELECTION selects the exact child and reports no selection as not-captured', async () => {
  const f = fixture('aria')
  f.rows.subActions = [{ ...f.child, subActionIndex: 0, ariaEvidence: { kind: 'aria', state: 'absent', reason: 'failed' } }, f.child]
  expect(await f.read()).toMatchObject({ outcome: 'ready', document: documents.aria })
  delete f.address.subActionIndex
  expect(await f.read()).toMatchObject({ outcome: 'absent', evidence: { kind: 'aria', state: 'absent', reason: 'not-captured' } })
  f.rows.subActions = []
  expect(await f.read()).toMatchObject({ outcome: 'absent', evidence: { reason: 'not-captured' } })
})
it('VARIABLES-INLINE preserves source and prototype names and rejects a missing snapshot', async () => {
  const f = fixture('variables')
  f.step.variableSnapshot = JSON.parse('{"__proto__":{"value":"[secret]","source":"hook"}}')
  expect(await f.read()).toMatchObject({ outcome: 'ready', document: { records: f.step.variableSnapshot } })
  delete f.step.variableSnapshot
  expect(await f.read()).toMatchObject({ outcome: 'read-error', code: 'snapshot-missing', capture: f.entry })
  expect(f.readBlob).not.toHaveBeenCalled()
})
it('EVIDENCE-MASK masks free-text keys and values with the live context while preserving bytes', async () => {
  const masking = createMaskingContext()
  masking.register('synthetic-sensitive')
  setActiveMaskingContextResolver(() => masking)
  const f = fixture('console', { ...documents.console, records: [{ level: 'error', text: 'synthetic-sensitive operator@example.test', timestamp: 1 }] })
  const before = Array.from(f.bytes)
  const result = await f.read()
  expect(result).toMatchObject({ outcome: 'ready', document: { records: [{ text: masking.mask('synthetic-sensitive operator@example.test') }] } })
  expect(JSON.stringify(result)).not.toContain('synthetic-sensitive')
  expect(f.bytes).toEqual(new Uint8Array(before))
  const variables = fixture('variables')
  variables.step.variableSnapshot = { 'synthetic-sensitive': { value: 'synthetic-sensitive', source: 'capture' } }
  expect(await variables.read()).toMatchObject({ outcome: 'ready', document: { records: { [masking.mask('synthetic-sensitive')]: { value: masking.mask('synthetic-sensitive'), source: 'capture' } } } })
})
it('EVIDENCE-MASK-NO-CONTEXT fails closed for document prose', async () => {
  setActiveMaskingContextResolver(() => undefined)
  expect(await fixture('aria').read()).toMatchObject({ outcome: 'ready', document: { tree: maskedMarker('secret') } })
})
it('EVIDENCE-PORTS reports missing bindings, missing runs and storage errors distinctly', async () => {
  const f = fixture('console')
  await expect(runsEvidenceSpec.invoke(f.address, {} as FunctionDeps)).rejects.toBeInstanceOf(FunctionNotBoundError)
  await expect(runsEvidenceSpec.invoke(f.address, { runDetail: f.deps.runDetail } as FunctionDeps)).rejects.toBeInstanceOf(FunctionNotBoundError)
  f.deps.runDetail!.read = async () => undefined
  await expect(f.read()).rejects.toBeInstanceOf(RunNotFoundError)
  f.deps.runDetail!.read = async () => f.rows
  f.deps.evidenceBlobs!.read = async () => { throw new Error('synthetic private storage path') }
  expect(await f.read()).toEqual({ address: f.address, outcome: 'read-error', code: 'storage-read-failed', capture: f.entry })
})
it('EVIDENCE-CONTRACT rejects crossed documents, extra fields and false ready states', async () => {
  const f = fixture('console')
  const valid = { address: f.address, outcome: 'ready', evidence: f.entry, document: documents.console }
  expect(RunsEvidenceResultSchema.safeParse(valid).success).toBe(true)
  for (const value of [{ ...valid, document: documents.aria }, { ...valid, leaked: true }, { ...valid, evidence: { kind: 'console', state: 'absent', reason: 'empty' } }]) {
    expect(RunsEvidenceResultSchema.safeParse(value).success).toBe(false)
  }
  expect(runsEvidenceSpec.requiredScopes).toEqual(['read'])
  expect(runsEvidenceSpec.resultKind).toBe('unary')
  expect(runsEvidenceSpec.risk.readOnly).toBe(true)
  expect(sniffEvidenceContentType(f.bytes)).toBe('application/octet-stream')
})
