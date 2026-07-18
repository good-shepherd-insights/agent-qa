import {
  asRecordId,
  BundleOutcomeEventSchema,
  canonicalJson,
  normalizeAnchor,
  serializeProcedureBody,
  type Anchor,
  type BundleOutcomeEvent,
  type BundleProvenance,
  type CurationAuthorship,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { makeProcedureBodyPayloadFixture } from '../../__tests__/fixtures/bundle-fixture.js'
import {
  matchProcedure,
  type MatchProcedureInput,
  type ProcedureMatchCandidate,
} from '../get-procedure.js'

const SIGN_IN_ANCHORS: Anchor[] = [
  { t: 'flow', name: 'Sign in flow' },
  { t: 'page', route: '/login' },
]

const CHECKOUT_ANCHORS: Anchor[] = [
  { t: 'flow', name: 'Checkout flow' },
  { t: 'page', route: '/checkout' },
]

const FULL_AUTHORSHIP: CurationAuthorship = {
  path: 'llm',
  model: { id: 'claude-sonnet-4' },
  executionContext: 'local-interactive',
}

const DEGRADED_AUTHORSHIP: CurationAuthorship = {
  path: 'llm-repaired',
  model: { id: 'claude-sonnet-4' },
  executionContext: 'local-interactive',
}

const FLOOR_AUTHORSHIP: CurationAuthorship = {
  path: 'deterministic-fallback',
  executionContext: 'local-interactive',
}

function confirmedEvents(count: number, key: string): BundleOutcomeEvent[] {
  return Array.from({ length: count }, (_, index) =>
    BundleOutcomeEventSchema.parse({
      type: 'confirmed',
      evidenceToken: `confirm-${key}-${index}`,
      curationJobId: `job-${key}-${index}`,
      buildOrdinal: 10 + index,
    }))
}

function deprecatedEvent(key: string): BundleOutcomeEvent {
  return BundleOutcomeEventSchema.parse({
    type: 'deprecated',
    evidenceToken: `deprecate-${key}`,
    curationJobId: `job-deprecate-${key}`,
    buildOrdinal: 12,
    reason: 'matcher fixture',
  })
}

function runLinkedProvenance(options: {
  authorship?: CurationAuthorship
  withheld?: boolean
} = {}): BundleProvenance {
  return {
    schemaVersion: 1,
    mode: 'run-linked',
    originClass: 'agent-verified',
    runId: 'run-matcher',
    testId: 'test-matcher',
    stepIndex: 0,
    ...(options.authorship === undefined ? {} : { authorship: options.authorship }),
    ...(options.withheld === true ? { withheld: true } : {}),
  }
}

interface CandidateOptions {
  id: string
  kind?: string
  status?: string
  validity?: string
  anchors?: Anchor[]
  summary?: string
  body?: string
  events?: BundleOutcomeEvent[]
  authorship?: CurationAuthorship
  withheld?: boolean
}

function candidate(options: CandidateOptions): ProcedureMatchCandidate {
  const anchors = options.anchors ?? SIGN_IN_ANCHORS
  const summary = options.summary ?? 'Sign in with recorded credentials'
  return {
    entry: {
      id: asRecordId(options.id),
      kind: options.kind ?? 'procedure',
      title: summary,
      summary,
      trust: 0.6,
      anchors: anchors.map(normalizeAnchor),
      status: options.status ?? 'candidate',
      servedAsCanary: false,
      scope: { tier: 'product', key: 'matcher-store' },
      validity: options.validity ?? 'current',
    },
    bundle: {
      summary,
      body: options.body ?? serializeProcedureBody(makeProcedureBodyPayloadFixture()),
      events: options.events ?? confirmedEvents(2, options.id),
      provenance: runLinkedProvenance({
        authorship: options.authorship ?? FULL_AUTHORSHIP,
        ...(options.withheld === true ? { withheld: true } : {}),
      }),
    },
  }
}

function matchInput(
  entries: readonly ProcedureMatchCandidate[],
  overrides: Partial<Omit<MatchProcedureInput, 'entries'>> = {},
): MatchProcedureInput {
  return {
    entries,
    intent: 'sign in',
    anchors: SIGN_IN_ANCHORS,
    bindingNames: ['email', 'password'],
    ...overrides,
  }
}

describe('matchProcedure kind-aware admission', () => {
  it('matches a candidate-status procedure with open validity', () => {
    const match = matchProcedure(matchInput([candidate({ id: 'proc-open' })]))

    expect(match?.id).toBe('proc-open')
  })

  it('never matches a withheld candidate procedure', () => {
    expect(
      matchProcedure(matchInput([candidate({ id: 'proc-withheld', withheld: true })])),
    ).toBeUndefined()
  })

  it('never matches a user-deprecated candidate procedure', () => {
    const deprecated = candidate({
      id: 'proc-deprecated',
      events: [...confirmedEvents(2, 'proc-deprecated'), deprecatedEvent('proc-deprecated')],
    })

    expect(matchProcedure(matchInput([deprecated]))).toBeUndefined()
  })

  it('never matches a closed-validity candidate procedure', () => {
    expect(
      matchProcedure(matchInput([candidate({ id: 'proc-closed', validity: '10:12' })])),
    ).toBeUndefined()
  })

  it('never surfaces fact or caution candidates through the procedure channel', () => {
    expect(
      matchProcedure(matchInput([
        candidate({ id: 'fact-candidate', kind: 'fact' }),
        candidate({ id: 'caution-candidate', kind: 'caution' }),
      ])),
    ).toBeUndefined()
  })

  it('admits an active-status procedure (impossible in M2 but total)', () => {
    const match = matchProcedure(matchInput([candidate({ id: 'proc-active', status: 'active' })]))

    expect(match?.id).toBe('proc-active')
  })
})

describe('matchProcedure anchor matching', () => {
  it('returns the procedure whose normalized flow/page anchors overlap the screen anchors', () => {
    const store = [
      candidate({ id: 'proc-sign-in' }),
      candidate({
        id: 'proc-checkout',
        anchors: CHECKOUT_ANCHORS,
        summary: 'Checkout with saved cart',
      }),
    ]

    const match = matchProcedure(matchInput(store, {
      anchors: [{ t: 'page', route: '/login' }],
    }))

    expect(match?.id).toBe('proc-sign-in')
  })

  it('judges anchor equality on normalizeAnchor output, never raw strings', () => {
    const match = matchProcedure(matchInput([candidate({ id: 'proc-normalized' })], {
      anchors: [{ t: 'page', route: '/Login/#fragment' }],
    }))

    expect(match?.id).toBe('proc-normalized')
  })

  it('returns undefined when no anchors overlap', () => {
    expect(
      matchProcedure(matchInput([candidate({ id: 'proc-elsewhere' })], {
        anchors: [{ t: 'page', route: '/settings' }],
      })),
    ).toBeUndefined()
  })
})

describe('matchProcedure tier x confirmations x fillability fold', () => {
  it('recommends replay for full tier at the confirmation threshold with fillable params', () => {
    const match = matchProcedure(matchInput([
      candidate({ id: 'proc-full', events: confirmedEvents(2, 'proc-full') }),
    ]))

    expect(match?.authoringModelTier).toBe('full')
    expect(match?.replayRecommendation).toBe('replay')
  })

  it('keeps degraded tier at the full threshold but below the degraded bar as hint', () => {
    const match = matchProcedure(matchInput([
      candidate({
        id: 'proc-degraded',
        authorship: DEGRADED_AUTHORSHIP,
        events: confirmedEvents(2, 'proc-degraded'),
      }),
    ]))

    expect(match?.authoringModelTier).toBe('degraded')
    expect(match?.replayRecommendation).toBe('hint')
  })

  it('recommends replay for degraded tier once the higher degraded bar is met', () => {
    const match = matchProcedure(matchInput([
      candidate({
        id: 'proc-degraded-confirmed',
        authorship: DEGRADED_AUTHORSHIP,
        events: confirmedEvents(4, 'proc-degraded-confirmed'),
      }),
    ]))

    expect(match?.replayRecommendation).toBe('replay')
  })

  it('keeps floor tier hint-only regardless of confirmations', () => {
    const match = matchProcedure(matchInput([
      candidate({
        id: 'proc-floor',
        authorship: FLOOR_AUTHORSHIP,
        events: confirmedEvents(6, 'proc-floor'),
      }),
    ]))

    expect(match?.authoringModelTier).toBe('floor')
    expect(match?.replayRecommendation).toBe('hint')
  })

  it('downranks a qualified match to hint when one required parameter is unfillable', () => {
    const match = matchProcedure(matchInput([
      candidate({
        id: 'proc-unfillable',
        body: serializeProcedureBody(makeProcedureBodyPayloadFixture({
          parameters: [
            { name: 'email', type: 'string', required: true },
            { name: 'otp', type: 'string', required: true },
          ],
        })),
      }),
    ]))

    expect(match?.replayRecommendation).toBe('hint')
  })
})

describe('matchProcedure empty edges', () => {
  it('returns undefined against an empty store', () => {
    expect(matchProcedure(matchInput([]))).toBeUndefined()
  })

  it('downranks required-parameter procedures to hint when bindingNames is empty', () => {
    const match = matchProcedure(matchInput([candidate({ id: 'proc-no-bindings' })], {
      bindingNames: [],
    }))

    expect(match?.replayRecommendation).toBe('hint')
  })

  it('still recommends replay for optional-only parameters with empty bindingNames', () => {
    const match = matchProcedure(matchInput([
      candidate({
        id: 'proc-optional',
        body: serializeProcedureBody(makeProcedureBodyPayloadFixture({
          parameters: [{ name: 'email', type: 'string', required: false }],
        })),
      }),
    ], { bindingNames: [] }))

    expect(match?.replayRecommendation).toBe('replay')
  })
})

describe('matchProcedure determinism', () => {
  it('produces identical ProcedureMatch bytes for identical stores and inputs', () => {
    const buildStore = (): ProcedureMatchCandidate[] => [
      candidate({ id: 'proc-a' }),
      candidate({
        id: 'proc-b',
        anchors: CHECKOUT_ANCHORS,
        summary: 'Checkout with saved cart',
      }),
    ]

    const first = matchProcedure(matchInput(buildStore()))
    const second = matchProcedure(matchInput(buildStore()))

    expect(first).toBeDefined()
    expect(canonicalJson(first)).toBe(canonicalJson(second))
  })

  it('breaks equal-score ties by record id', () => {
    const match = matchProcedure(matchInput([
      candidate({ id: 'proc-tie-b', events: confirmedEvents(2, 'tie') }),
      candidate({ id: 'proc-tie-a', events: confirmedEvents(2, 'tie') }),
    ]))

    expect(match?.id).toBe('proc-tie-a')
  })
})
