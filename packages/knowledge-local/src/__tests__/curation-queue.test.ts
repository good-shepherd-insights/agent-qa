import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'

import {
  ARTIFACT_STEP_CAP_BYTES,
  ARTIFACT_VALUE_REDACTION_PLACEHOLDER,
} from '../artifact-copy.js'
import {
  enqueueCurationCandidate,
  enqueueCurationCandidateProjection,
  readCurationCandidatePayload,
} from '../queue/curation-queue.js'
import type {
  CurationProjectionArtifactSource,
  EnqueueCurationCandidateProjectionOutcome,
} from '../queue/curation-queue.js'
import {
  QUEUE_MAX_EMITS_PER_RUN,
  QUEUE_MAX_JOBS_PER_SCOPE,
  queueRoot,
  queuedCandidateDir,
} from '../queue/queue-layout.js'
import {
  CURATION_QUEUE_SCHEMA_VERSION,
  artifactFreeCaptureReceipt,
  candidateContentAddress,
  type BuildCurationCandidateAddressFieldsInput,
  type CurationArtifactDescriptor,
  type CurationArtifactRole,
  type CurationCaptureReceipt,
  type CurationCandidatePayload,
  type CurationCandidateProjection,
} from '../queue/queue-payload.js'
import { candidateAddressFixture } from './fixtures/curation-candidate-fixture.js'

type CandidateFixtureOverrides = Pick<
  BuildCurationCandidateAddressFieldsInput,
  'captureReceipt'
> &
  Partial<Omit<BuildCurationCandidateAddressFieldsInput, 'captureReceipt'>>

function sha(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('curation queue atomic emit drop (CUR-04/T-378-07..09)', () => {
  let root: string
  let knowledgeRoot: string
  let sourceRoot: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-curation-queue-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    sourceRoot = join(root, 'sources')
    mkdirSync(sourceRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function addressFields(
    overrides: CandidateFixtureOverrides,
  ): BuildCurationCandidateAddressFieldsInput {
    return candidateAddressFixture({
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
    })
  }

  function payload(overrides: CandidateFixtureOverrides): CurationCandidatePayload {
    const fields = addressFields(overrides)
    return { candidateId: candidateContentAddress(fields), ...fields }
  }

  function artifactCaptureReceipt(stepIndex: number): CurationCaptureReceipt {
    return {
      regions: [],
      interactions: [{ stepIndex }],
      omissions: [],
      redactions: [],
    }
  }

  function seedQueued(candidate: CurationCandidatePayload, rootOverride = knowledgeRoot): void {
    const candidateDir = queuedCandidateDir(rootOverride, candidate.candidateId)
    mkdirSync(candidateDir, { recursive: true })
    writeFileSync(join(candidateDir, 'payload.json'), JSON.stringify(candidate), 'utf8')
  }

  function projection(
    overrides: Partial<CurationCandidateProjection> = {},
  ): CurationCandidateProjection {
    return {
      sourceRunId: 'projection-run',
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
      distilledObservations: [],
      evidenceToken: 'projection-evidence',
      attributingObservationId: 'projection-run:test-0:step-0',
      artifactDescriptors: [],
      captureEvidence: { elements: [] },
      stepInteractions: [],
      emittedAt: '2026-07-15T10:00:00.000Z',
      ...overrides,
    }
  }

  function projectionArtifact(
    name: string,
    bytes: Uint8Array,
    stepIndex: number,
    role: CurationArtifactRole,
  ): {
    descriptor: CurationArtifactDescriptor
    source: CurationProjectionArtifactSource
  } {
    const sourcePath = join(sourceRoot, name)
    writeFileSync(sourcePath, bytes)
    const artifactId = `artifact-${name}`
    return {
      descriptor: {
        ref: { id: artifactId, sha: sha(bytes) },
        stepIndex,
        role,
        originalName: name,
      },
      source: { artifactId, sourcePath },
    }
  }

  function queueFiles(dir = queueRoot(knowledgeRoot)): { path: string; bytes: Buffer }[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      return entry.isDirectory() ? queueFiles(path) : [{ path, bytes: readFileSync(path) }]
    })
  }

  function expectQueueTreeEmpty(): void {
    expect(queueFiles()).toEqual([])
  }

  it('hashes only deterministic fields regardless of object order or emittedAt', () => {
    const first = addressFields({ captureReceipt: artifactFreeCaptureReceipt() })
    const reordered = {
      emittedAt: '2099-01-01T00:00:00.000Z',
      artifactInventory: first.artifactInventory,
      captureReceipt: first.captureReceipt,
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
    } satisfies BuildCurationCandidateAddressFieldsInput

    expect(candidateContentAddress(reordered)).toBe(candidateContentAddress(first))
  })

  it('requires an explicit capture receipt in the shared candidate fixture input', () => {
    type FixtureInput = Parameters<typeof candidateAddressFixture>[0]
    type ReceiptIsRequired = {} extends Pick<FixtureInput, 'captureReceipt'> ? false : true
    const receiptIsRequired: ReceiptIsRequired = true

    expect(receiptIsRequired).toBe(true)
  })

  it('publishes payload and artifact bytes atomically then coalesces without rewriting', () => {
    const artifactBytes = Buffer.from('curation evidence')
    const artifactSha = sha(artifactBytes)
    const artifactSource = join(root, 'evidence.bin')
    writeFileSync(artifactSource, artifactBytes)
    const candidate = payload({
      captureReceipt: artifactCaptureReceipt(0),
      artifactInventory: [
        {
          relativePath: `artifacts/${artifactSha}`,
          sha256: artifactSha,
          bytes: artifactBytes.byteLength,
          stepIndex: 0,
          role: 'opaque-evidence',
          originalName: 'evidence.bin',
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

  it('omits credential screenshots before queue-root write and emits a value-free receipt', () => {
    const credential = 'fixture-queue-credential'
    const screenshotBytes = Buffer.from(`screenshot pixels ${credential}`)
    const screenshot = projectionArtifact('credential.png', screenshotBytes, 4, 'screenshot')
    const rawSha = screenshot.descriptor.ref.sha
    const rawProjection = projection({
      artifactDescriptors: [screenshot.descriptor],
      captureEvidence: {
        elements: [
          {
            stepIndex: 4,
            elementRef: 'credential-field',
            role: 'textbox',
            name: 'API key',
            value: credential,
          },
        ],
      },
      stepInteractions: [{ stepIndex: 4, elementRef: 'credential-field' }],
    })

    const outcome = enqueueCurationCandidateProjection({
      knowledgeRoot,
      projection: rawProjection,
      artifactSources: [screenshot.source],
    })

    expect(outcome.kind).toBe('enqueued')
    if (outcome.kind !== 'enqueued') throw new Error('expected enqueued projection')
    const candidateDir = queuedCandidateDir(knowledgeRoot, outcome.candidateId)
    const parsed = readCurationCandidatePayload(candidateDir)
    expect(parsed.kind).toBe('parsed')
    if (parsed.kind !== 'parsed') throw new Error('expected parsed projection payload')
    expect(parsed.payload.artifactInventory).toEqual([])
    expect(parsed.payload.captureReceipt).toEqual({
      regions: [
        {
          stepIndex: 4,
          elementRef: 'credential-field',
          role: 'textbox',
          normalizedName: 'api key',
          reason: 'credential-name',
        },
      ],
      interactions: [{ stepIndex: 4, elementRef: 'credential-field' }],
      omissions: [
        {
          stepIndex: 4,
          ref: screenshot.descriptor.ref.id,
          role: 'screenshot',
          originalName: 'credential.png',
          reason: 'capture-blacklist',
        },
      ],
      redactions: [],
    })
    const files = queueFiles()
    expect(files.some(({ path }) => path.includes(rawSha))).toBe(false)
    expect(Buffer.concat(files.map(({ bytes }) => bytes)).toString('utf8')).not.toContain(
      credential,
    )
  })

  it.each(['dom-snapshot', 'ax-snapshot'] as const)(
    'redacts %s bytes before hashing and coalesces on the finalized candidate id',
    (role) => {
      const credential = 'fixture-dom-credential'
      const rawBytes = Buffer.from(JSON.stringify({ ref: 'credential-field', value: credential }))
      const snapshot = projectionArtifact(`${role}.json`, rawBytes, 4, role)
      const rawProjection = projection({
        artifactDescriptors: [snapshot.descriptor],
        captureEvidence: {
          elements: [
            {
              stepIndex: 4,
              elementRef: 'credential-field',
              role: 'textbox',
              name: 'Password',
              inputType: 'password',
              value: credential,
            },
          ],
        },
        stepInteractions: [{ stepIndex: 4, elementRef: 'credential-field' }],
      })

      const first = enqueueCurationCandidateProjection({
        knowledgeRoot,
        projection: rawProjection,
        artifactSources: [snapshot.source],
      })
      expect(first.kind).toBe('enqueued')
      if (first.kind !== 'enqueued') throw new Error('expected enqueued projection')
      const candidateDir = queuedCandidateDir(knowledgeRoot, first.candidateId)
      const parsed = readCurationCandidatePayload(candidateDir)
      expect(parsed.kind).toBe('parsed')
      if (parsed.kind !== 'parsed') throw new Error('expected parsed projection payload')
      const inventory = parsed.payload.artifactInventory[0]!
      const safeBytes = readFileSync(join(candidateDir, inventory.relativePath), 'utf8')

      expect(inventory).toMatchObject({
        role,
        originalName: `${role}.json`,
        sha256: sha(Buffer.from(safeBytes)),
        bytes: Buffer.byteLength(safeBytes),
      })
      expect(inventory.sha256).not.toBe(snapshot.descriptor.ref.sha)
      expect(safeBytes).toContain(ARTIFACT_VALUE_REDACTION_PLACEHOLDER)
      expect(safeBytes).not.toContain(credential)
      expect(parsed.payload.captureReceipt?.redactions).toEqual([
        {
          stepIndex: 4,
          ref: snapshot.descriptor.ref.id,
          role,
          originalName: `${role}.json`,
          reason: 'capture-blacklist',
          safeSha256: inventory.sha256,
        },
      ])
      expect(parsed.payload.candidateId).toBe(first.candidateId)

      const duplicate = enqueueCurationCandidateProjection({
        knowledgeRoot,
        projection: { ...rawProjection, emittedAt: '2099-01-01T00:00:00.000Z' },
        artifactSources: [snapshot.source],
      })
      expect(duplicate).toEqual({ kind: 'coalesced', candidateId: first.candidateId })
      expect(queueFiles().some(({ path }) => path.includes(snapshot.descriptor.ref.sha))).toBe(
        false,
      )
    },
  )

  it('cleans staging and exposes no candidate for malformed, missing, mismatched, or inconsistent input', () => {
    const source = projectionArtifact(
      'source.txt',
      Buffer.from('safe source bytes'),
      0,
      'opaque-evidence',
    )
    const cases = [
      {
        projection: { ...projection(), scope: undefined } as unknown as CurationCandidateProjection,
        artifactSources: [] as CurationProjectionArtifactSource[],
        reason: 'invalid-payload',
      },
      {
        projection: projection({ artifactDescriptors: [source.descriptor] }),
        artifactSources: [{ ...source.source, sourcePath: join(sourceRoot, 'missing.txt') }],
        reason: 'artifact-missing',
      },
      {
        projection: projection({
          artifactDescriptors: [
            { ...source.descriptor, ref: { ...source.descriptor.ref, sha: '0'.repeat(64) } },
          ],
        }),
        artifactSources: [source.source],
        reason: 'artifact-sha-mismatch',
      },
    ] as const

    for (const scenario of cases) {
      expect(
        enqueueCurationCandidateProjection({
          knowledgeRoot,
          projection: scenario.projection,
          artifactSources: scenario.artifactSources,
        }),
      ).toEqual({ kind: 'refused', reason: scenario.reason })
      expectQueueTreeEmpty()
    }

    const duplicateBytes = Buffer.from('same redacted credential')
    const dom = projectionArtifact('same.dom.json', duplicateBytes, 4, 'dom-snapshot')
    const ax = projectionArtifact('same.ax.json', duplicateBytes, 4, 'ax-snapshot')
    expect(
      enqueueCurationCandidateProjection({
        knowledgeRoot,
        projection: projection({ artifactDescriptors: [dom.descriptor, ax.descriptor] }),
        artifactSources: [dom.source, ax.source],
      }),
    ).toEqual({ kind: 'refused', reason: 'artifact-inventory-mismatch' })
    expectQueueTreeEmpty()
  })

  it('returns finalized candidate ids for enqueued, coalesced, and cap-exceeded outcomes', () => {
    expectTypeOf<EnqueueCurationCandidateProjectionOutcome>().toMatchTypeOf<
      | { kind: 'enqueued'; candidateId: string }
      | { kind: 'coalesced'; candidateId: string }
      | { kind: 'cap-exceeded'; candidateId: string }
      | { kind: 'refused'; reason: string }
    >()

    const first = enqueueCurationCandidateProjection({
      knowledgeRoot,
      projection: projection(),
      artifactSources: [],
    })
    expect(first.kind).toBe('enqueued')
    if (first.kind !== 'enqueued') throw new Error('expected enqueued projection')
    expect(
      enqueueCurationCandidateProjection({
        knowledgeRoot,
        projection: projection(),
        artifactSources: [],
      }),
    ).toEqual({ kind: 'coalesced', candidateId: first.candidateId })

    const capRoot = join(root, 'cap-root')
    for (let index = 0; index < QUEUE_MAX_JOBS_PER_SCOPE; index += 1) {
      seedQueued(
        payload({
          captureReceipt: artifactFreeCaptureReceipt(),
          sourceRunId: `cap-run-${index}`,
          attributingObservationId: `cap-observation-${index}`,
          evidenceToken: `cap-evidence-${index}`,
        }),
        capRoot,
      )
    }
    const capped = enqueueCurationCandidateProjection({
      knowledgeRoot: capRoot,
      projection: projection({
        sourceRunId: 'cap-overflow-run',
        attributingObservationId: 'cap-overflow-observation',
        evidenceToken: 'cap-overflow-evidence',
      }),
      artifactSources: [],
    })
    expect(capped.kind).toBe('cap-exceeded')
    if (capped.kind !== 'cap-exceeded') throw new Error('expected cap-exceeded projection')
    expect(existsSync(queuedCandidateDir(capRoot, capped.candidateId))).toBe(false)
  })

  it('retains the legacy finalized-payload entry and string outcome', () => {
    const candidate = payload({ captureReceipt: artifactFreeCaptureReceipt() })
    expect(
      enqueueCurationCandidate({
        knowledgeRoot,
        payload: candidate,
        artifactSources: [],
      }),
    ).toBe('enqueued')
    expect(readCurationCandidatePayload(queuedCandidateDir(knowledgeRoot, candidate.candidateId)))
      .toMatchObject({ kind: 'parsed', payload: candidate })
  })

  it('fails closed at the per-scope and per-run queue caps without visible bytes', () => {
    for (let index = 0; index < QUEUE_MAX_JOBS_PER_SCOPE; index += 1) {
      const candidate = payload({
        captureReceipt: artifactFreeCaptureReceipt(),
        sourceRunId: `scope-run-${index}`,
        attributingObservationId: `scope-observation-${index}`,
        evidenceToken: `scope-evidence-${index}`,
      })
      seedQueued(candidate)
    }
    const scopeOverflow = payload({
      captureReceipt: artifactFreeCaptureReceipt(),
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
        captureReceipt: artifactFreeCaptureReceipt(),
        sourceRunId: 'one-hot-run',
        scope: { tier: 'test', key: `test-${index}` },
        attributingObservationId: `run-observation-${index}`,
        evidenceToken: `run-evidence-${index}`,
      })
      seedQueued(candidate, secondKnowledgeRoot)
    }
    const runOverflow = payload({
      captureReceipt: artifactFreeCaptureReceipt(),
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
      captureReceipt: artifactCaptureReceipt(0),
      artifactInventory: [
        {
          relativePath: `artifacts/${artifactSha}`,
          sha256: artifactSha,
          bytes: artifactBytes.byteLength,
          stepIndex: 0,
          role: 'opaque-evidence',
          originalName: 'oversized.bin',
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
