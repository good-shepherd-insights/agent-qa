import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildGoldenTrajectoryPlan, buildSeedingPlan, committedFileText, deriveCensus, extractRunCassettes, renderCensusMarkdown } from '@vostride/agent-qa-eval'
import { FsEvidenceArtifactStore, HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import * as safety from '@vostride/agent-qa-safety'
import type { GuardrailAuditRow } from '@vostride/agent-qa-safety'
import type { MarkReceipt } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { freezeGoldenTrajectory } from '../golden-composition.js'
import { commitCensus } from '../census-committing.js'
import { FsRunArtifactSource } from '../artifact-source.js'
import { readActiveCommittedCorpus, readCommittedCorpus } from '../committed-corpus-source.js'
import { FsMarkLedger } from '../mark-ledger.js'
import { readGatePostureFor } from '../gate-posture-composition.js'
import { selectGateSet } from '@vostride/agent-qa-eval'
import { committedCassettePath, committedCorpusPath, committedLabelPath, committedCensusPath } from '../committed-root-store.js'
import { seedCommittedCorpus } from '../seeding-composition.js'
import { LOCAL_FIXTURE_BLOB_BYTES, makeLocalV2Handoff } from './fixtures/local-handoff-fixture.js'

describe('freezeGoldenTrajectory', () => {
  let root: string
  let committedRoot: string
  let handoff: ReturnType<typeof makeLocalV2Handoff>
  let mark: MarkReceipt
  let rows: GuardrailAuditRow[]
  const product = 'default'
  const freeze = () => freezeGoldenTrajectory({
    agentQaRoot: root, committedRoot, product, handoff, mark,
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit(row) { rows.push(row) } },
  })
  const extract = () => extractRunCassettes({ handoff, artifacts: new FsRunArtifactSource({ root, runId: handoff.runId }) }).cassettes
  const paths = (id: string) => [committedCassettePath(product, id), committedLabelPath(product, id), committedCorpusPath(product, id)]
    .map(path => join(committedRoot, path))
  const hashes = (files: string[]) => files.map(file => createHash('sha256').update(readFileSync(file)).digest('hex'))

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gold-freeze-'))
    committedRoot = join(root, 'committed')
    handoff = makeLocalV2Handoff()
    handoff.runId = 'gold-freeze-run' as typeof handoff.runId
    for (const step of handoff.tests[0]!.steps) {
      for (const sub of step.subActions) sub.stateBefore = { ...sub.stateBefore, timestamp: 1_725_000_000 }
    }
    const dir = join(root, RUNS_SUBDIR, slugBranch(handoff.runId))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, HANDOFF_FILE), JSON.stringify(handoff))
    new FsEvidenceArtifactStore({ root, runId: handoff.runId }).persistDecisionScreenshot(LOCAL_FIXTURE_BLOB_BYTES)
    mark = {
      schemaVersion: 1, markId: 'mark_0123456789ab', runId: handoff.runId as MarkReceipt['runId'],
      runSlug: slugBranch(handoff.runId), testIndex: 0, stepIndex: 0, kind: 'false-fail',
      origin: 'user', ordinal: 1, markedAt: 0, gold: [], evidence: { confirmed: 0, overturned: 0 },
      disposition: { kind: 'confirmed-bug', confirmedRecords: 0 },
    }
    rows = []
  })
  afterEach(() => { vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }) })

  it('writes one private gold case with three audited parts, commits census, and repeats without a write', () => {
    const checkpoint = vi.spyOn(safety, 'assertCommittedEgressSafe')
    const first = freeze()
    expect(first.kind).toBe('frozen')
    if (first.kind !== 'frozen') throw new Error(JSON.stringify(first))
    expect(first.cases).toHaveLength(1)
    expect(first.census).toBe('committed')
    const id = first.cases[0]!.cassetteId
    const files = paths(id)
    expect(JSON.parse(readFileSync(files[2]!, 'utf8'))).toMatchObject({ split: 'held-out', heldOutVisibility: 'private' })
    expect(JSON.parse(readFileSync(files[1]!, 'utf8')).label).toMatchObject({ tier: 'gold', sourceChannel: 'user-mark' })
    expect(checkpoint).toHaveBeenCalledWith(expect.arrayContaining(['cassette', 'label', 'corpus'].map(part => ({ label: part + ':' + id, text: expect.any(String) }))), expect.objectContaining({ channel: 'eval-seeding' }))
    expect(rows).toEqual([])
    const read = readCommittedCorpus(committedRoot)
    expect(read.snapshot.entries).toHaveLength(1)
    const census = deriveCensus({ snapshot: read.snapshot, schemaVersionsSeen: read.schemaVersionsSeen })
    const committed = JSON.parse(readFileSync(join(committedRoot, committedCensusPath(census.corpusDigest, 'census.json')), 'utf8'))
    expect(committed.products.default.markedGold['user-mark']).toBe(1)
    const before = hashes(files)
    const times = files.map(file => statSync(file).mtimeMs)
    expect(freeze()).toEqual({ ...first, census: 'unchanged' })
    expect(hashes(files)).toEqual(before)
    expect(files.map(file => statSync(file).mtimeMs)).toEqual(times)
  })

  it('preserves every natural case byte when the leaf was already seeded', () => {
    const cassettes = extract()
    const plan = buildSeedingPlan({ handoff, cassettes, partition: { saltHex: 'a'.repeat(64), heldOutFraction: 0.000001, privateFraction: 0.5 } })
    expect(plan.cases).toHaveLength(1)
    expect(plan.cases[0]!.corpusEntry.split).toBe('natural')
    expect(seedCommittedCorpus({ plan, cassettes, committedRoot, seedingOutputBaseDir: join(root, 'seed') }).refusals).toEqual([])
    const files = paths(plan.cases[0]!.cassetteId)
    const before = hashes(files)
    const commitUnmarked = () => {
      const read = readCommittedCorpus(committedRoot)
      const census = deriveCensus({ snapshot: read.snapshot, schemaVersionsSeen: read.schemaVersionsSeen })
      expect(census.products.default!.markedGold).toBeUndefined()
      return commitCensus({ census, markdown: renderCensusMarkdown(census), committedRoot, censusOutputBaseDir: join(root, 'census') })
    }
    expect(commitUnmarked().kind).toBe('committed')
    expect(commitUnmarked()).toMatchObject({ kind: 'committed', json: 'unchanged', markdown: 'unchanged' })
    expect(freeze().kind).toBe('frozen')
    expect(hashes(files)).toEqual(before)
    expect(readCommittedCorpus(committedRoot).snapshot.entries).toHaveLength(2)
  })

  it('freezes the captured Luhn-valid screen timestamp without changing cassette bytes or receipt hashes', () => {
    // Actual 419 (4a) failure: 2026-09-08T16:12:38.737Z, audit fingerprint 11103290ebca9211.
    const timestamp = 1_788_883_958_737
    expect(safety.scan(String(timestamp), safety.loadGuardrailPolicy(safety.defaultGuardrailPolicyInput)).result.action).toBe('block')
    handoff.tests[0]!.steps[0]!.subActions[0]!.stateBefore.timestamp = timestamp
    const cassettes = extract()
    const plan = buildGoldenTrajectoryPlan({ handoff, cassettes, mark, product })
    const expected = committedFileText(plan.goldCassettes[0]!.cassette)
    const result = freeze()
    expect(result.kind).toBe('frozen')
    expect(rows).toEqual([])
    expect(readFileSync(paths(plan.cases[0]!.cassetteId)[0]!, 'utf8')).toBe(expected)
    expect(handoff.tests[0]!.steps[0]!.subActions[0]!.stateBefore.timestamp).toBe(timestamp)
  })

  it.each([
    ['captured timestamp as user text', '1788883958737'],
    ['captured timestamp as numeric content', 1_788_883_958_737],
    ['PAN as user text', '4111111111111111'],
    ['PAN as numeric content', 4_111_111_111_111_111],
  ] as const)('still refuses %s outside machine screen timestamp metadata', (_name, value) => {
    const state = handoff.tests[0]!.steps[0]!.subActions[0]!.stateBefore
    state.timestamp = 1_788_883_958_737
    if (typeof value === 'string') state.tree = value
    else state.metadata = Object.assign({}, state.metadata, { timestamp: value })
    expect(freeze().kind).toBe('refused')
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({
      detector: 'creditCard', action: 'block',
      redactedFingerprint: createHash('sha256').update(String(value)).digest('hex').slice(0, 16),
    })]))
    expect(readCommittedCorpus(committedRoot).snapshot.entries).toHaveLength(0)
  })

  it('false-pass writes both independent gold channels', () => {
    mark.kind = 'false-pass'
    const result = freeze()
    expect(result.kind).toBe('frozen')
    if (result.kind !== 'frozen') throw new Error(JSON.stringify(result))
    expect(result.cases.map(item => item.channel).sort()).toEqual(['overturned-verdict', 'user-mark'])
    expect(readCommittedCorpus(committedRoot).snapshot.entries).toHaveLength(2)
  })
  it('retires every previous decision/channel and a subsequent no-gold generation before gate counts', async () => {
    const step = handoff.tests[0]!.steps[0]!
    step.subActions.push({ ...step.subActions[0]! })
    mark.kind = 'false-pass'
    const first = freeze()
    if (first.kind !== 'frozen') throw new Error(JSON.stringify(first))
    expect(first.cases).toHaveLength(4)
    const ledger = new FsMarkLedger({ root, runId: handoff.runId })
    await ledger.append({ ...mark, gold: first.cases })
    const history = hashes(first.cases.flatMap(item => paths(item.cassetteId)))
    mark = { ...mark, kind: 'confirmed-bug', ordinal: 2, markId: 'mark_1123456789ab', supersedes: mark.markId }
    const second = freezeGoldenTrajectory({ agentQaRoot: root, committedRoot, product, handoff, mark, priorGold: first.cases })
    if (second.kind !== 'frozen') throw new Error(JSON.stringify(second))
    await ledger.append({ ...mark, gold: second.cases })
    const active = () => readActiveCommittedCorpus(committedRoot, root)
    const posture = () => readGatePostureFor({ committedRoot, agentQaRoot: root,
      scope: { tier: 'product', key: product }, minimumGateSet: 1,
      judge: { plannerModelId: 'fixture-planner' }, canary: { kind: 'not-provided' } }).posture
    expect(active().snapshot.entries).toHaveLength(2)
    expect(posture().counts.heldOutPrivate).toBe(2)
    expect(readCommittedCorpus(committedRoot).snapshot.entries).toHaveLength(6)
    for (const item of second.cases) {
      const label = active().snapshot.labelsById.get(item.cassetteId)!
      expect(label.supersedes).toBe(first.cases.find(prior => prior.sourceCassetteId === item.sourceCassetteId
        && prior.channel === item.channel)!.cassetteId)
    }
    const selected = selectGateSet({ entries: active().snapshot.entries, product,
      candidate: { runIds: ['unrelated-run'], receiptDigests: ['unrelated-receipt'], capturedAtOrdinals: [999] }, minimumGateSet: 1 })
    expect(selected).toMatchObject({ verdict: 'ok', gateEntries: expect.any(Array) })
    if (selected.verdict === 'ok') expect(selected.gateEntries).toHaveLength(2)
    // Quarantine is receipt-only: no corpus/label/cassette writes for this retirement.
    const allPaths = [...first.cases, ...second.cases].flatMap(item => paths(item.cassetteId))
    const beforeQuarantine = hashes(allPaths)
    await ledger.append({ ...mark, markId: 'mark_2123456789ab', gold: [],
      disposition: { kind: 'quarantined', class: 'flake' } })
    expect(active().snapshot.entries).toHaveLength(0)
    expect(posture().counts.heldOutPrivate).toBe(0)
    expect(hashes(allPaths)).toEqual(beforeQuarantine)
    expect(hashes(first.cases.flatMap(item => paths(item.cassetteId)))).toEqual(history)
  })

  it('refuses a conflicting case before writing any of its other parts', () => {
    const plan = buildGoldenTrajectoryPlan({ handoff, mark, product, cassettes: extract() })
    const files = paths(plan.cases[0]!.cassetteId)
    mkdirSync(join(committedRoot, 'labels', product), { recursive: true })
    // Plant a foreign committed label to exercise the shipped write-once preview.
    mkdirSync(join(files[1]!, '..'), { recursive: true })
    writeFileSync(files[1]!, 'existing foreign bytes')
    expect(freeze()).toMatchObject({ kind: 'refused', refusals: [{ kind: 'write-conflict' }] })
    expect(existsSync(files[0]!)).toBe(false)
    expect(existsSync(files[2]!)).toBe(false)
    expect(readFileSync(files[1]!, 'utf8')).toBe('existing foreign bytes')
  })

  it('refuses secret-bearing evidence without landing its case', () => {
    handoff.tests[0]!.steps[0]!.subActions[0]!.stateBefore.tree = 'key AKIAIOSFODNN7EXAMPLE'
    const result = freeze()
    expect(result).toMatchObject({ kind: 'refused', refusals: [{ kind: 'egress-blocked' }] })
    expect(readCommittedCorpus(committedRoot).snapshot.entries).toHaveLength(0)
    expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ detector: 'awsKey', action: 'block', channel: expect.stringMatching(/^eval-seeding:cassette:/) })]))
  })

  it('answers missing steps and cached-only steps without creating a committed root', () => {
    mark.stepIndex = 2
    expect(freeze()).toEqual({ kind: 'step-not-found', stepCount: 2 })
    mark.stepIndex = 1
    expect(freeze()).toEqual({ kind: 'no-leaf-cassette' })
    expect(existsSync(committedRoot)).toBe(false)
  })
})
