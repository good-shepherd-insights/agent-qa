// PROC-01 write-side validation suite (381-03): the procedure disposition wall.
// "LLM proposes, code disposes" (D-02/D-03) — every reject is a deterministic
// structural verdict against verified queue evidence, never LLM text.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { serializeProcedureBody } from '@vostride/agent-qa-schema'
import type { Anchor, Delta, DistilledObservation } from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AUTHORED_CHECKPOINT_SCHEMA_VERSION,
  disposeDelta,
  parseAuthoredCheckpoint,
  sliceAuthoredCheckpoint,
  type AuthoredDeltaCheckpoint,
} from '../../index.js'
import type { ProcedureDispositionEvidence } from '../disposition.js'
import {
  makeProcedureBodyPayloadFixture,
  makeProcedureBundleDraftFixture,
} from '../../__tests__/fixtures/bundle-fixture.js'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

const OBSERVATION_STEP_KEYS = ['enter-email', 'enter-password', 'submit'] as const
const OBSERVATION_ELEMENT_KEYS = [
  'textbox:email',
  'textbox:password',
  'button:sign in',
] as const

let root: string
let knowledgeRoot: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'knowledge-procedure-disposition-'))
  knowledgeRoot = join(root, 'agent-qa-knowledge')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeObservations(): DistilledObservation[] {
  return OBSERVATION_STEP_KEYS.map((naturalKey, index) => ({
    schemaVersion: 1,
    step: { naturalKey, ordinal: index },
    platform: 'web' as const,
    test: { id: 'sign-in-test' },
    flow: {
      name: 'Sign in flow',
      ...(index === 0 ? {} : { precedes: OBSERVATION_STEP_KEYS[index - 1]! }),
    },
    surface: { kind: 'page' as const, naturalKey: '/login' },
    element: { naturalKey: OBSERVATION_ELEMENT_KEYS[index]! },
    observedAtOrdinal: 81 + index,
  }))
}

function makeEvidence(
  overrides: Partial<ProcedureDispositionEvidence> = {},
): ProcedureDispositionEvidence {
  return {
    distilledObservations: makeObservations(),
    captureReceipt: {
      regions: [
        {
          stepIndex: 1,
          elementRef: 'e-sign-in',
          role: 'textbox',
          normalizedName: 'password',
          reason: 'credential-name',
        },
      ],
      interactions: [0, 1, 2].map((stepIndex) => ({
        stepIndex,
        elementRef: 'e-sign-in',
      })),
      omissions: [],
      redactions: [],
    },
    artifactInventory: [],
    candidateDir: join(root, 'claimed', 'candidate'),
    policy,
    auditBaseDir: join(root, '.agent-qa'),
    ...overrides,
  }
}

function addDelta(
  overrides: Partial<Parameters<typeof makeProcedureBundleDraftFixture>[0]> = {},
): Extract<Delta, { kind: 'Add' }> {
  const draft = makeProcedureBundleDraftFixture(overrides)
  return {
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
}

function checkpointFor(delta: Delta): AuthoredDeltaCheckpoint {
  const parsed = parseAuthoredCheckpoint({
    schemaVersion: AUTHORED_CHECKPOINT_SCHEMA_VERSION,
    deltas: [delta],
    neighborIds: [],
    preconditions: [],
    authorship: {
      path: 'llm',
      model: { id: 'procedure-fixture' },
      executionContext: 'local-interactive',
    },
  })
  return sliceAuthoredCheckpoint(parsed)[0]!
}

function dispose(
  delta: Extract<Delta, { kind: 'Add' }>,
  evidence: ProcedureDispositionEvidence | null = makeEvidence(),
) {
  return disposeDelta({
    delta,
    checkpoint: checkpointFor(delta),
    profile: { mode: 'drain-to-active' },
    knowledgeRoot,
    candidate: {
      anchors: [...delta.bundle.anchors],
      scope: delta.bundle.scope,
      buildOrdinal: 81,
      curationJobId: 'procedure-disposition-job',
      ...(evidence === null ? {} : { procedureEvidence: evidence }),
    },
    drainState: { supersedesSeenByAnchorKey: new Map() },
  })
}

describe('procedure extraction disposition — structural candidacy (D-02)', () => {
  it('rejects a procedure Add whose body parseProcedureBody cannot decode', () => {
    const outcome = dispose(
      addDelta({ body: 'Enter email, enter password, and submit the form.' }),
    )
    expect(outcome).toEqual({ kind: 'noop', reason: 'procedure-body-unparseable' })
  })

  it('rejects a candidate covering a step with no verified-PASS observation evidence', () => {
    const observations = makeObservations().filter(
      (observation) => observation.step.naturalKey !== 'enter-password',
    )
    const outcome = dispose(
      addDelta(),
      makeEvidence({ distilledObservations: observations }),
    )
    expect(outcome).toEqual({ kind: 'noop', reason: 'procedure-step-coverage' })
  })

  it('rejects a candidate whose covered step lacks resolved-element evidence', () => {
    const observations = makeObservations().map((observation) =>
      observation.step.naturalKey === 'enter-password'
        ? { ...observation, element: undefined }
        : observation,
    ) as DistilledObservation[]
    const outcome = dispose(
      addDelta(),
      makeEvidence({ distilledObservations: observations }),
    )
    expect(outcome).toEqual({
      kind: 'noop',
      reason: 'procedure-step-unresolved-element',
    })
  })

  it('rejects a candidate whose covered observation ordinals are non-contiguous', () => {
    const observations = makeObservations().map((observation) =>
      observation.step.naturalKey === 'submit'
        ? { ...observation, step: { ...observation.step, ordinal: 3 } }
        : observation,
    )
    const outcome = dispose(
      addDelta(),
      makeEvidence({ distilledObservations: observations }),
    )
    expect(outcome).toEqual({ kind: 'noop', reason: 'procedure-span-non-contiguous' })
  })

  it('rejects a candidate with no flow anchor', () => {
    const outcome = dispose(addDelta({ anchors: [{ t: 'page', route: '/login' }] }))
    expect(outcome).toEqual({ kind: 'noop', reason: 'procedure-flow-anchor' })
  })

  it('rejects a candidate whose page anchors are disjoint from covered surfaces', () => {
    const anchors: Anchor[] = [
      { t: 'flow', name: 'Sign in flow' },
      { t: 'page', route: '/settings' },
    ]
    const outcome = dispose(addDelta({ anchors }))
    expect(outcome).toEqual({ kind: 'noop', reason: 'procedure-page-anchor-disjoint' })
  })

  it('rejects a step sequence containing a tapCoordinate completing action (shared schema list)', () => {
    const payload = makeProcedureBodyPayloadFixture()
    payload.steps[2] = {
      ...payload.steps[2]!,
      action: { ...payload.steps[2]!.action, type: 'tapCoordinate' },
    }
    const outcome = dispose(addDelta({ body: serializeProcedureBody(payload) }))
    expect(outcome).toEqual({
      kind: 'noop',
      reason: 'procedure-non-replayable-action',
    })
  })

  it('rejects a step sequence containing an assertAI completing action', () => {
    const payload = makeProcedureBodyPayloadFixture()
    payload.steps[2] = {
      ...payload.steps[2]!,
      action: { ...payload.steps[2]!.action, type: 'assertAI' },
    }
    const outcome = dispose(addDelta({ body: serializeProcedureBody(payload) }))
    expect(outcome).toEqual({
      kind: 'noop',
      reason: 'procedure-non-replayable-action',
    })
  })

  it('rejects a step whose action shape carries a raw-coordinate key', () => {
    const payload = makeProcedureBodyPayloadFixture()
    payload.steps[2] = {
      ...payload.steps[2]!,
      action: {
        ...payload.steps[2]!.action,
        values: { x: '100' },
      },
    }
    const outcome = dispose(addDelta({ body: serializeProcedureBody(payload) }))
    expect(outcome).toEqual({
      kind: 'noop',
      reason: 'procedure-non-replayable-action',
    })
  })

  it('fails closed when a procedure delta arrives without extraction evidence', () => {
    const outcome = dispose(addDelta(), null)
    expect(outcome).toEqual({ kind: 'noop', reason: 'procedure-evidence-missing' })
  })

  it('disposes a well-formed whole-flow candidate into the normal commit flow', () => {
    const delta = addDelta()
    const outcome = dispose(delta)
    expect(outcome).toMatchObject({ kind: 'apply', delta })
  })
})
