import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ARTIFACT_STEP_CAP_BYTES } from '../artifact-copy.js'
import {
  enqueueCurationCandidate,
  readCurationCandidatePayload,
} from '../queue/curation-queue.js'
import {
  QUEUE_MAX_EMITS_PER_RUN,
  QUEUE_MAX_JOBS_PER_SCOPE,
  queueRoot,
  queuedCandidateDir,
} from '../queue/queue-layout.js'
import {
  CURATION_QUEUE_SCHEMA_VERSION,
  candidateContentAddress,
  type CurationCandidateAddressFields,
  type CurationCandidatePayload,
} from '../queue/queue-payload.js'

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('curation queue atomic emit drop (CUR-04/T-378-07..09)', () => {
  let root: string
  let knowledgeRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-curation-queue-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function addressFields(
    overrides: Partial<CurationCandidateAddressFields> = {},
  ): CurationCandidateAddressFields {
    return {
      schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
      sourceRunId: 'run-1',
      scope: { tier: 'product', key: 'storefront' },
      buildOrdinal: 42,
      executionContext: 'local-interactive',
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'fact',
      subtype: 'selector',
      anchors: [{ t: 'el', role: 'button', name: 'Checkout' }],
      summarySeed: 'Checkout button selector',
      bodySeed: 'The checkout button was resolved and verified.',
      distilledObservations: [
        {
          schemaVersion: 1,
          step: { naturalKey: 'checkout-click', ordinal: 0 },
          platform: 'web',
          element: { naturalKey: 'button:checkout' },
          observedAtOrdinal: 42,
        },
      ],
      evidenceToken: 'evidence-1',
      attributingObservationId: 'run-1:test-0:step-0',
      artifactInventory: [],
      emittedAt: '2026-07-15T10:00:00.000Z',
      ...overrides,
    }
  }

  function payload(
    overrides: Partial<CurationCandidateAddressFields> = {},
  ): CurationCandidatePayload {
    const fields = addressFields(overrides)
    return { candidateId: candidateContentAddress(fields), ...fields }
  }

  function seedQueued(candidate: CurationCandidatePayload, rootOverride = knowledgeRoot): void {
    const candidateDir = queuedCandidateDir(rootOverride, candidate.candidateId)
    mkdirSync(candidateDir, { recursive: true })
    writeFileSync(join(candidateDir, 'payload.json'), JSON.stringify(candidate), 'utf8')
  }

  it('hashes only deterministic fields regardless of object order or emittedAt', () => {
    const first = addressFields()
    const reordered = {
      emittedAt: '2099-01-01T00:00:00.000Z',
      artifactInventory: first.artifactInventory,
      attributingObservationId: first.attributingObservationId,
      evidenceToken: first.evidenceToken,
      distilledObservations: first.distilledObservations,
      bodySeed: first.bodySeed,
      summarySeed: first.summarySeed,
      anchors: first.anchors,
      subtype: first.subtype,
      kind: first.kind,
      injectionFlagged: first.injectionFlagged,
      secretFlagged: first.secretFlagged,
      executionContext: first.executionContext,
      buildOrdinal: first.buildOrdinal,
      scope: { key: first.scope.key, tier: first.scope.tier },
      sourceRunId: first.sourceRunId,
      schemaVersion: first.schemaVersion,
    } satisfies CurationCandidateAddressFields

    expect(candidateContentAddress(reordered)).toBe(candidateContentAddress(first))
  })

  it('publishes payload and artifact bytes atomically then coalesces without rewriting', () => {
    const artifactBytes = Buffer.from('curation evidence')
    const artifactSha = sha(artifactBytes)
    const artifactSource = join(root, 'evidence.bin')
    writeFileSync(artifactSource, artifactBytes)
    const candidate = payload({
      artifactInventory: [
        {
          relativePath: `artifacts/${artifactSha}`,
          sha256: artifactSha,
          bytes: artifactBytes.byteLength,
          stepIndex: 0,
        },
      ],
    })

    expect(
      enqueueCurationCandidate({
        knowledgeRoot,
        payload: candidate,
        artifactSources: [
          { relativePath: `artifacts/${artifactSha}`, sourcePath: artifactSource },
        ],
      }),
    ).toBe('enqueued')

    const candidateDir = queuedCandidateDir(knowledgeRoot, candidate.candidateId)
    const payloadFile = join(candidateDir, 'payload.json')
    const firstPayloadBytes = readFileSync(payloadFile)
    expect(readFileSync(join(candidateDir, 'artifacts', artifactSha))).toEqual(artifactBytes)
    expect(readCurationCandidatePayload(candidateDir)).toEqual({
      kind: 'parsed',
      present: true,
      payload: candidate,
    })

    const duplicate = { ...candidate, emittedAt: '2099-01-01T00:00:00.000Z' }
    expect(
      enqueueCurationCandidate({
        knowledgeRoot,
        payload: duplicate,
        artifactSources: [
          { relativePath: `artifacts/${artifactSha}`, sourcePath: artifactSource },
        ],
      }),
    ).toBe('coalesced')
    expect(readFileSync(payloadFile)).toEqual(firstPayloadBytes)
    expect(readCurationCandidatePayload(candidateDir)).toEqual({
      kind: 'parsed',
      present: true,
      payload: candidate,
    })
  })

  it('fails closed at the per-scope and per-run queue caps without visible bytes', () => {
    for (let index = 0; index < QUEUE_MAX_JOBS_PER_SCOPE; index += 1) {
      const candidate = payload({
        sourceRunId: `scope-run-${index}`,
        attributingObservationId: `scope-observation-${index}`,
        evidenceToken: `scope-evidence-${index}`,
      })
      seedQueued(candidate)
    }
    const scopeOverflow = payload({
      sourceRunId: 'scope-overflow-run',
      attributingObservationId: 'scope-overflow-observation',
      evidenceToken: 'scope-overflow-evidence',
    })
    expect(
      enqueueCurationCandidate({
        knowledgeRoot,
        payload: scopeOverflow,
        artifactSources: [],
      }),
    ).toBe('cap-exceeded')
    expect(existsSync(queuedCandidateDir(knowledgeRoot, scopeOverflow.candidateId))).toBe(false)

    const secondKnowledgeRoot = join(root, 'second-knowledge-root')
    for (let index = 0; index < QUEUE_MAX_EMITS_PER_RUN; index += 1) {
      const candidate = payload({
        sourceRunId: 'one-hot-run',
        scope: { tier: 'test', key: `test-${index}` },
        attributingObservationId: `run-observation-${index}`,
        evidenceToken: `run-evidence-${index}`,
      })
      seedQueued(candidate, secondKnowledgeRoot)
    }
    const runOverflow = payload({
      sourceRunId: 'one-hot-run',
      scope: { tier: 'test', key: 'overflow-test' },
      attributingObservationId: 'run-overflow-observation',
      evidenceToken: 'run-overflow-evidence',
    })
    expect(
      enqueueCurationCandidate({
        knowledgeRoot: secondKnowledgeRoot,
        payload: runOverflow,
        artifactSources: [],
      }),
    ).toBe('cap-exceeded')
    expect(existsSync(queuedCandidateDir(secondKnowledgeRoot, runOverflow.candidateId))).toBe(
      false,
    )
  })

  it('returns a typed refusal when one artifact exceeds the imported step cap', () => {
    const artifactBytes = new Uint8Array(ARTIFACT_STEP_CAP_BYTES + 1).fill(97)
    const artifactSha = sha(artifactBytes)
    const artifactSource = join(root, 'oversized.bin')
    writeFileSync(artifactSource, artifactBytes)
    const candidate = payload({
      artifactInventory: [
        {
          relativePath: `artifacts/${artifactSha}`,
          sha256: artifactSha,
          bytes: artifactBytes.byteLength,
          stepIndex: 0,
        },
      ],
    })

    expect(
      enqueueCurationCandidate({
        knowledgeRoot,
        payload: candidate,
        artifactSources: [
          { relativePath: `artifacts/${artifactSha}`, sourcePath: artifactSource },
        ],
      }),
    ).toEqual({ kind: 'refused', reason: 'artifact-step-cap' })
    expect(existsSync(queuedCandidateDir(knowledgeRoot, candidate.candidateId))).toBe(false)
    expect(existsSync(join(queueRoot(knowledgeRoot), '.staging'))).toBe(false)
  })

  it('reports corrupt payload bytes as malformed instead of throwing', () => {
    const candidateDir = queuedCandidateDir(knowledgeRoot, 'a'.repeat(64))
    mkdirSync(candidateDir, { recursive: true })
    writeFileSync(join(candidateDir, 'payload.json'), '{not-json', 'utf8')

    expect(readCurationCandidatePayload(candidateDir)).toEqual({
      kind: 'malformed',
      present: true,
    })
  })
})
