import { asEvidenceToken, asRecordId } from '@vostride/agent-qa-schema'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  AUTHORED_CHECKPOINT_SCHEMA_VERSION,
  authoredCheckpointSchema,
  parseAuthoredCheckpoint,
  resolveDispositionProfile,
  type AuthorOutcome,
  type CurationJobView,
  type CuratorAuthor,
  type NeighborRecord,
} from '../../index.js'

const scope = { tier: 'product', key: 'storefront' } as const
const citedRecordId = asRecordId('fact-checkout-button')
const precondition = {
  recordId: citedRecordId,
  observedStatus: 'active',
  observedOrdinal: 41,
}

const authoredCheckpoint = {
  schemaVersion: AUTHORED_CHECKPOINT_SCHEMA_VERSION,
  delta: {
    kind: 'Confirm',
    origin: 'agent',
    scope,
    citedIds: [citedRecordId],
    precondition: [precondition],
    targetId: citedRecordId,
    evidenceToken: asEvidenceToken('evidence-checkout-button'),
  },
  neighborIds: [citedRecordId],
  preconditions: [precondition],
  authorship: {
    path: 'llm',
    model: { id: 'curator-model', family: 'test-family' },
    executionContext: 'local-interactive',
  },
} as const

describe('Curator author contract (CUR-01/SAFE-01)', () => {
  it('round-trips a structurally valid authored checkpoint with resolved ids', () => {
    expect(authoredCheckpointSchema.parse(authoredCheckpoint)).toEqual(authoredCheckpoint)
    expect(parseAuthoredCheckpoint(authoredCheckpoint)).toEqual(authoredCheckpoint)
  })

  it('leaves persisted-neighbor membership to disposition check 1', () => {
    const absentFromNeighborSet = {
      ...authoredCheckpoint,
      neighborIds: [asRecordId('different-neighbor')],
    }

    expect(() => authoredCheckpointSchema.parse(absentFromNeighborSet)).not.toThrow()
  })

  it('maps all SAFE-01 execution contexts to their authority mode', () => {
    expect(resolveDispositionProfile('local-interactive')).toEqual({
      mode: 'drain-to-active',
    })
    for (const executionContext of ['ci', 'cloud', 'local-headless'] as const) {
      expect(resolveDispositionProfile(executionContext)).toEqual({ mode: 'propose-only' })
    }
  })

  it('types the injected author seam and its complete outcome union', () => {
    expectTypeOf<CuratorAuthor>().toEqualTypeOf<
      (job: CurationJobView, neighbors: NeighborRecord[]) => Promise<AuthorOutcome>
    >()

    const parsedCheckpoint = parseAuthoredCheckpoint(authoredCheckpoint)
    const authored: AuthorOutcome = {
      kind: 'authored',
      delta: parsedCheckpoint.delta,
      authorship: parsedCheckpoint.authorship,
    }
    const fallbackReasons: Record<
      Extract<AuthorOutcome, { kind: 'fallback-required' }>['reason'],
      true
    > = {
      malformed: true,
      'no-model': true,
      'token-budget': true,
      'model-error': true,
    }

    expect(authored.kind).toBe('authored')
    expect(Object.keys(fallbackReasons).sort()).toEqual([
      'malformed',
      'model-error',
      'no-model',
      'token-budget',
    ])
  })
})
