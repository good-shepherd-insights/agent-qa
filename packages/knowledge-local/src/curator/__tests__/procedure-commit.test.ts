import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Delta } from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CURATION_QUEUE_SCHEMA_VERSION,
  candidateContentAddress,
  commitCurationDelta,
  loadBundle,
  openIndexReaderConnection,
  verifyBundleIntegrity,
  type AuthoredCheckpoint,
  type CommitCurationDependencies,
  type CommitCurationJob,
} from '../../index.js'
import { candidateAddressFixture } from '../../__tests__/fixtures/curation-candidate-fixture.js'
import {
  makeProcedureBundleDraftFixture,
  makeProcedureScreenStateSequenceFixture,
} from '../../__tests__/fixtures/bundle-fixture.js'

describe('D-02 procedure-kind commit mint contract', () => {
  let root: string
  let knowledgeRoot: string
  let auditBaseDir: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'knowledge-procedure-commit-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    auditBaseDir = join(root, '.agent-qa')
    mkdirSync(knowledgeRoot, { recursive: true })
    writeFileSync(join(knowledgeRoot, '.epoch'), '1\n', 'utf8')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function commitProcedure() {
    const draft = makeProcedureBundleDraftFixture()
    const screenStates = makeProcedureScreenStateSequenceFixture()
    const artifacts = screenStates.map((_, stepIndex) => {
      const bytes = Buffer.from(`procedure capture ${stepIndex}\n`)
      return {
        bytes,
        sha: createHash('sha256').update(bytes).digest('hex'),
        stepIndex,
      }
    })
    const fields = candidateAddressFixture({
      schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
      sourceRunId: 'run-procedure-commit',
      scope: draft.scope,
      buildOrdinal: 81,
      executionContext: 'local-interactive',
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'procedure',
      anchors: draft.anchors,
      summarySeed: draft.summary,
      bodySeed: draft.body,
      distilledObservations: screenStates.map((_, stepIndex) => ({
        schemaVersion: 1,
        step: { naturalKey: ['enter-email', 'enter-password', 'submit'][stepIndex]!, ordinal: stepIndex },
        platform: 'web',
        test: { id: 'sign-in-test' },
        procedure: { id: 'sign-in-flow' },
        flow: {
          name: 'Sign in flow',
          ...(stepIndex === 0 ? {} : { precedes: ['enter-email', 'enter-password'][stepIndex - 1]! }),
        },
        surface: { kind: 'page', naturalKey: '/login' },
        observedAtOrdinal: 81 + stepIndex,
      })),
      evidenceToken: 'procedure-evidence',
      attributingObservationId: 'run-procedure-commit:test-sign-in:step-0',
      artifactInventory: artifacts.map(({ bytes, sha, stepIndex }) => ({
        relativePath: `artifacts/${sha}`,
        sha256: sha,
        bytes: bytes.byteLength,
        stepIndex,
        role: 'opaque-evidence',
        originalName: `procedure-step-${stepIndex}.txt`,
      })),
      captureReceipt: {
        regions: [
          {
            stepIndex: 1,
            elementRef: screenStates[1]!.elements[0]!.ref,
            role: 'textbox',
            normalizedName: 'password',
            reason: 'credential-name',
          },
        ],
        interactions: artifacts.map(({ stepIndex }) => ({
          stepIndex,
          elementRef: screenStates[stepIndex]!.elements[0]!.ref,
        })),
        omissions: [],
        redactions: [],
      },
      emittedAt: '2026-07-15T10:00:00.000Z',
    })
    expect(
      fields.artifactInventory.map(({ stepIndex, role, originalName }) => ({
        stepIndex,
        role,
        originalName,
      })),
    ).toEqual([
      { stepIndex: 0, role: 'opaque-evidence', originalName: 'procedure-step-0.txt' },
      { stepIndex: 1, role: 'opaque-evidence', originalName: 'procedure-step-1.txt' },
      { stepIndex: 2, role: 'opaque-evidence', originalName: 'procedure-step-2.txt' },
    ])
    expect(fields.captureReceipt).toMatchObject({
      regions: [
        {
          stepIndex: 1,
          role: 'textbox',
          normalizedName: 'password',
          reason: 'credential-name',
        },
      ],
      interactions: [
        { stepIndex: 0 },
        { stepIndex: 1 },
        { stepIndex: 2 },
      ],
      omissions: [],
      redactions: [],
    })
    const candidateId = candidateContentAddress(fields)
    const candidateDir = join(root, 'claimed', candidateId)
    const artifactsDir = join(candidateDir, 'artifacts')
    mkdirSync(artifactsDir, { recursive: true })
    for (const artifact of artifacts) {
      writeFileSync(join(artifactsDir, artifact.sha), artifact.bytes)
    }
    const job: CommitCurationJob = {
      kind: 'claimed',
      candidateId,
      leaseId: 'procedure-lease',
      payload: { candidateId, ...fields },
      candidateDir,
      payloadPath: join(candidateDir, 'payload.json'),
      artifactsDir,
      screenStates,
    }
    const delta: Delta = {
      kind: 'Add',
      origin: 'agent',
      scope: draft.scope,
      citedIds: [],
      authorship: {
        path: 'llm',
        model: { id: 'procedure-fixture' },
        executionContext: 'local-interactive',
      },
      bundle: draft,
    }
    const checkpoint: AuthoredCheckpoint = {
      schemaVersion: 1,
      delta,
      neighborIds: [],
      preconditions: [],
      authorship: delta.authorship!,
    }
    const dependencies: CommitCurationDependencies = {
      knowledgeRoot,
      auditBaseDir,
      epoch: 1,
      profile: { mode: 'drain-to-active' },
      drainState: { supersedesSeenByAnchorKey: new Map() },
      policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
    }
    return commitCurationDelta(dependencies, job, checkpoint)
  }

  it('publishes manifest, procedure frontmatter, ordered ScreenStates, per-step artifacts, and index row', () => {
    const outcome = commitProcedure()
    expect(outcome.kind).toBe('applied')
    if (outcome.kind !== 'applied') throw new Error('expected applied procedure')

    const loaded = loadBundle(outcome.bundleDir)
    expect(loaded.kind).toBe('loaded')
    if (loaded.kind !== 'loaded') throw new Error('expected loaded procedure')
    expect(loaded.bundle.manifest.complete).toBe(true)
    expect(loaded.bundle.frontmatter.kind).toBe('procedure')
    expect(loaded.bundle.screenStates).toHaveLength(3)
    expect(loaded.bundle.artifactsIndex.artifacts.map(({ stepIndex }) => stepIndex)).toEqual([0, 1, 2])

    const reader = openIndexReaderConnection(knowledgeRoot)
    try {
      expect(
        reader.db.prepare('SELECT bundle_id FROM records WHERE bundle_id = ?').get(outcome.bundleId),
      ).toMatchObject({ bundle_id: outcome.bundleId })
    } finally {
      reader.db.close()
    }
  })

  it('round-trips as a self-sufficient, integrity-valid committed bundle', () => {
    const outcome = commitProcedure()
    if (outcome.kind !== 'applied') throw new Error('expected applied procedure')

    expect(verifyBundleIntegrity(outcome.bundleDir)).toEqual({ ok: true, violations: [] })
    const roundTrip = loadBundle(outcome.bundleDir)
    expect(roundTrip.kind).toBe('loaded')
    if (roundTrip.kind !== 'loaded') throw new Error('expected procedure round-trip')
    expect(roundTrip.bundle.manifest.id).toBe(outcome.bundleId)
    expect(roundTrip.bundle.provenance).toMatchObject({
      mode: 'run-linked',
      curationJobId: expect.any(String),
      sourceBuildOrdinal: 81,
    })
  })
})
