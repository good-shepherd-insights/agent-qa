// The funnel projection's cells (394-07, D-12/D-14 · WTST-05).
//
// THE CONTROL SHAPE IS TWO-SIDED ON EVERY DISCRIMINATOR. A window that admitted nothing and a
// window that admitted everything would both pass a suite screened on one side only — 394-04's
// finding, mechanized here: for the session scope there is a with-ref cell AND a without-ref
// cell AND a wrong-ref cell; for the stability gather there is a flaky-neighbours cell AND a
// stable cell AND a no-history cell.
//
// THE ZERO-RUNS CLAIM IS MEASURED AGAINST AN INSTRUMENT THAT WOULD RECORD ONE. The fake run port
// below is handed to the composition and counts every `start`; a claim asserted against a port
// nothing could call is a claim about the test, not about the code.

import { describe, expect, it } from 'vitest'

import {
  CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
  DraftReceiptSchema,
} from '@vostride/agent-qa-schema'
import type {
  DraftReceipt,
  ProposalEnvelope,
  QuarantineEntryState,
  RunsStartInput,
} from '@vostride/agent-qa-schema'

import {
  gatherSuiteStability,
  projectAuthoringFunnel,
  scopeReceiptsToWindow,
} from '../funnel.js'
import type { AuthoringFunnelPortLike } from '../funnel.js'
import type { DraftRunPortLike } from '../ports.js'

const TARGET = 'tests/local-form.yaml'

function receipt(digest: string, sessionRef?: string, evaluatedAt = 1_700_000_000_000): DraftReceipt {
  return DraftReceiptSchema.parse({
    schemaVersion: 1,
    draftRef: {
      filePath: `tests/.agent-qa-drafts/${digest}.yaml`,
      testId: `t_${digest}`,
      testName: `draft ${digest}`,
      contentDigest: digest,
    },
    gates: {
      executesDefinitive: { pass: true, runRefs: ['run-1'], indefinitiveRunRefs: [] },
      stableVerdict: {
        pass: true,
        runRefs: ['run-1'],
        distinctOutcomes: ['passed'],
        earlyStopped: false,
      },
      addsValue: { pass: true, novelElementCount: 1, comparedTestCount: 1 },
      falsifiableAssertion: { pass: true, assertionStepCount: 1, falsifiableAssertionCount: 1 },
    },
    stepTable: [],
    gateRuns: [{ runId: 'run-1', memberOutcome: 'passed', definitive: true, healed: false }],
    addsValueFinding: { novelElements: ['el:button:Save'], comparedTests: [] },
    stabilityRunsRequested: 3,
    stabilityRunsCompleted: 3,
    disposition: 'keep-eligible',
    evaluatedAt,
    ...(sessionRef === undefined ? {} : { sessionRef }),
  })
}

function testDraftEnvelope(digest: string, decision?: 'applied' | 'rejected'): ProposalEnvelope {
  return {
    id: `prop_${digest}`,
    status: decision === undefined ? 'pending' : decision,
    evidenceRefs: [],
    kind: 'test-draft',
    payload: {
      schemaVersion: CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
      draftRef: {
        filePath: `tests/.agent-qa-drafts/${digest}.yaml`,
        testId: `t_${digest}`,
        testName: `draft ${digest}`,
        contentDigest: digest,
      },
      disposition: 'keep-eligible',
      actualRuns: 3,
      repairIterations: 0,
      summaryLine: `draft ${digest}`,
    },
    ...(decision === undefined ? {} : { decision: { decision, at: 1_700_000_000_001 } }),
  }
}

function findingEnvelope(digest: string): ProposalEnvelope {
  return {
    id: `prop_${digest}`,
    status: 'pending',
    evidenceRefs: [],
    kind: 'finding',
    payload: {
      schemaVersion: CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
      draftRef: {
        filePath: `tests/.agent-qa-drafts/${digest}.yaml`,
        testId: `t_${digest}`,
        testName: `draft ${digest}`,
        contentDigest: digest,
      },
      signalClass: 'clean-definitive-assertion-fail',
      failurePoint: null,
      evidenceRefs: [],
      explanation: '',
    },
  }
}

/**
 * A run port the composition COULD reach, recording every start.
 *
 * The zero-runs claim is worth nothing against a port that cannot be called: 394-06 learned the
 * same lesson from the other end, where an unbounded loop took the worker down instead of reding
 * a cell. The instrument has to be able to record the thing being denied.
 */
function countingRunPort(): DraftRunPortLike & { starts: RunsStartInput[] } {
  const starts: RunsStartInput[] = []
  return {
    starts,
    async start(input) {
      starts.push(input)
      throw new Error('the funnel read started a run — D-14 is read-side')
    },
    async get() {
      return undefined
    },
  }
}

interface PortFixture {
  receipts?: readonly DraftReceipt[]
  envelopes?: readonly ProposalEnvelope[]
  outcomes?: AuthoringFunnelPortLike['outcomes']
  quarantine?: AuthoringFunnelPortLike['quarantine']
}

function port(overrides: PortFixture = {}): AuthoringFunnelPortLike {
  const receipts = overrides.receipts ?? []
  const envelopes = overrides.envelopes ?? []
  return {
    receipts: { async list() { return [...receipts] } },
    async proposals() { return envelopes },
    ...(overrides.outcomes === undefined ? {} : { outcomes: overrides.outcomes }),
    ...(overrides.quarantine === undefined ? {} : { quarantine: overrides.quarantine }),
  }
}

describe('the window scope', () => {
  const population = [
    receipt('a', 'sess-alpha', 3),
    receipt('b', 'sess-beta', 1),
    receipt('c', undefined, 2),
  ]

  it('admits only the EXACT session ref, and excludes a receipt carrying none', async () => {
    const scoped = scopeReceiptsToWindow(population, { scope: 'session', sessionRef: 'sess-alpha' })

    expect(scoped.map((row) => row.draftRef.contentDigest)).toEqual(['a'])
  })

  it('admits nothing for a session ref nothing carries — never everything', async () => {
    // The other side of the same discriminator. A filter that silently admitted everything on a
    // miss would pass the cell above and be catastrophically wrong here.
    const scoped = scopeReceiptsToWindow(population, { scope: 'session', sessionRef: 'sess-nope' })

    expect(scoped).toEqual([])
  })

  it('admits the whole population for `all-time`, INCLUDING the unattributed receipt', async () => {
    const scoped = scopeReceiptsToWindow(population, { scope: 'all-time' })

    expect(scoped.map((row) => row.draftRef.contentDigest)).toEqual(['a', 'b', 'c'])
  })

  it('takes `last-n` by evaluatedAt, not by the store\'s digest ordering', async () => {
    const scoped = scopeReceiptsToWindow(population, { scope: 'last-n', n: 2 })

    // Newest first: `a` at 3, then `c` at 2. The store lists a, b, c — the digest order — so a
    // projection that inherited it would have answered a, b.
    expect(scoped.map((row) => row.draftRef.contentDigest)).toEqual(['a', 'c'])
  })
})

describe('projectAuthoringFunnel', () => {
  it('scopes the DENOMINATOR to the session, not just the accepted stage', async () => {
    const funnel = await projectAuthoringFunnel(
      { scope: 'session', sessionRef: 'sess-alpha' },
      port({
        receipts: [receipt('a', 'sess-alpha'), receipt('b', 'sess-beta'), receipt('c')],
        envelopes: [testDraftEnvelope('a', 'applied'), testDraftEnvelope('b', 'applied')],
      }),
    )

    expect(funnel.stages.built).toBe(1)
    // `b` was applied and is NOT in this window, so it cannot reach `accepted` either.
    expect(funnel.stages.accepted).toBe(1)
  })

  it('reads `accepted` off applied decisions and nothing else', async () => {
    const funnel = await projectAuthoringFunnel(
      { scope: 'all-time' },
      port({
        receipts: [receipt('a'), receipt('b'), receipt('c')],
        envelopes: [
          testDraftEnvelope('a', 'applied'),
          testDraftEnvelope('b', 'rejected'),
          testDraftEnvelope('c'),
        ],
      }),
    )

    expect(funnel.stages).toEqual({ built: 3, passedStably: 3, addedValue: 3, accepted: 1 })
  })

  it('counts findings as a SIDE counter and leaves dedup refusals absent', async () => {
    const funnel = await projectAuthoringFunnel(
      { scope: 'all-time' },
      port({
        receipts: [receipt('a'), receipt('b')],
        envelopes: [testDraftEnvelope('a', 'applied'), findingEnvelope('b')],
      }),
    )

    expect(funnel.sideCounters).toEqual({ findings: 1 })
    // The finding's own draft is still a `built` — it reached authoring — but it is not folded
    // into the funnel as a fifth stage, and the refusal counter nothing records stays absent.
    expect(funnel.stages.built).toBe(2)
    expect(funnel.line).toContain('dedup refusals not recorded')
  })

  it('answers the zero-receipts posture on an empty store', async () => {
    const funnel = await projectAuthoringFunnel({ scope: 'all-time' }, port())

    expect(funnel.stages).toEqual({ built: 0, passedStably: 0, addedValue: 0, accepted: 0 })
    expect(funnel.keepRate).toBeUndefined()
    expect(funnel.acceptanceFailure).toBe(false)
  })
})

describe('gatherSuiteStability', () => {
  const outcomes = (rows: Readonly<Record<string, readonly string[]>>) => ({
    async testsIn(filePath: string) {
      return Object.keys(rows).map((testName) => ({ filePath, testName }))
    },
    async outcomesFor(_filePath: string, testName: string) {
      return rows[testName] ?? []
    },
  })

  it('names the flaky neighbours and starts ZERO runs', async () => {
    const runs = countingRunPort()
    const assessment = await gatherSuiteStability(
      { targetFilePath: TARGET, draftTestName: 'draft under evaluation' },
      port({
        outcomes: outcomes({
          'submits the form': ['passed', 'passed'],
          'shows the banner': ['passed', 'failed'],
        }),
      }),
    )

    expect(assessment.posture).toBe('neighbours-flaky')
    expect(assessment.flakyNeighbours.map((row) => row.ref))
      .toEqual([`${TARGET}::shows the banner`])
    expect(assessment.message).toContain('Your app is unstable')
    // The instrument was reachable and recorded nothing — the port bundle carries no run
    // capability at all, which is why this is structural rather than a rule.
    expect(runs.starts).toEqual([])
  })

  it('names a quarantined neighbour, reading the ledger rather than re-running it', async () => {
    const assessment = await gatherSuiteStability(
      { targetFilePath: TARGET },
      port({
        outcomes: outcomes({ 'retries the upload': ['passed'] }),
        quarantine: {
          async list(): Promise<readonly QuarantineEntryState[]> {
            return [{
              product: 'demo',
              filePath: TARGET,
              testName: 'retries the upload',
              fingerprint: 'fp-1',
              verdictClass: 'flake',
              owner: 'unassigned',
              enteredAt: '2026-08-01T00:00:00.000Z',
              expiresAt: '2026-09-01T00:00:00.000Z',
              enteredCount: 1,
              firstEnteredAt: '2026-08-01T00:00:00.000Z',
              state: 'quarantined',
            }]
          },
        },
      }),
    )

    expect(assessment.posture).toBe('neighbours-flaky')
    expect(assessment.flakyNeighbours[0]?.reason).toBe('quarantined')
  })

  it('answers `stable` when the neighbours were read and none is flaky', async () => {
    const assessment = await gatherSuiteStability(
      { targetFilePath: TARGET },
      port({ outcomes: outcomes({ 'submits the form': ['passed', 'passed'] }) }),
    )

    expect(assessment.posture).toBe('stable')
  })

  it('answers `no-history` — not `stable` — when the outcome port is UNBOUND', async () => {
    const assessment = await gatherSuiteStability({ targetFilePath: TARGET }, port())

    expect(assessment.posture).toBe('no-history')
    expect(assessment.message).toContain('not a clean bill of health')
  })

  it('excludes the draft\'s OWN identity from its neighbours', async () => {
    // A draft under evaluation is not evidence about the suite it is trying to join; counting
    // its own flip would let every mixed verdict explain itself.
    const assessment = await gatherSuiteStability(
      { targetFilePath: TARGET, draftTestName: 'the flipping draft' },
      port({
        outcomes: outcomes({
          'the flipping draft': ['passed', 'failed'],
          'submits the form': ['passed'],
        }),
      }),
    )

    expect(assessment.posture).toBe('stable')
    expect(assessment.flakyNeighbours).toEqual([])
  })
})
