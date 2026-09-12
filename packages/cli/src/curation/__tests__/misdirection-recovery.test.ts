// BOUNDED WORK AND HONEST RECOVERY (Phase 422 plan 14, D-18 / D-19 — task 2).
//
// THREE CLAIMS, AND THEY FAIL IN THREE DIFFERENT DIRECTIONS.
//
//   1. A RETRY MUST NOT RE-SPEND. The arbiter runs before the analysis enqueue, so every crash
//      between the two lands on a run that has already paid. A retry that re-derived its state
//      from what the enqueue carries would ask the provider the same questions again — the enqueue
//      being precisely the thing that did not happen. What is asserted here is stronger than "the
//      answer is cached": a fully recorded run makes ZERO arbiter calls of ANY kind on the second
//      pass, posture and decision location included.
//
//   2. AN INTERRUPTED ATTEMPT KEEPS ITS CHARGE. A reservation with no completion beside it is a
//      call this process did not see finish, and a remote call nobody saw finish is not a call
//      anybody may assume did not happen. So the allowance stays spent, the row reads `not-run`
//      with `interrupted` and unknown usage, and the next exposure in line meets a smaller budget.
//      The opposite design — refilling on restart — is a budget a crash loop can spend forever.
//
//   3. ABSENT IS NOT BROKEN. A run with no evaluation root and a run whose root cannot be read
//      record the SAME (empty) ledger and mean opposite things: the first earns D-19's
//      declared-only exemption and the second is an unbacked gated posture. The difference has to
//      be durable, or a later reader of `handoff.json` sees one empty array and cannot tell which.
//
// The cap is four (`ATTR_DEFAULT_MAX_MISDIRECTION_CHECKS`) and every cell that cares states its
// own. NOTHING HERE REACHES A PROVIDER OR AN EVALUATION ROOT: the arbiter is a port.

import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  asRecordId,
  asRef,
  asRunId,
  canonicalJson,
  computeBriefDigest,
  guardCompletedRunHandoff,
  sha256hex,
  slugBranch,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  ElementInfo,
  RecordId,
  ScreenState,
  ServedBrief,
  StepEvidence,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'

import { ATTR_DEFAULT_MAX_MISDIRECTION_CHECKS } from '../../eval-session-composition.js'
import {
  MISDIRECTION_CAP_EXCEEDED,
  MISDIRECTION_CHECK_FAILED,
  MISDIRECTION_DECISION_UNLOCATABLE,
  MISDIRECTION_INTERRUPTED,
  MISDIRECTION_NO_EVAL_ROOT,
  MISDIRECTION_POSTURE_UNAVAILABLE,
  MISDIRECTION_ROOT_UNREADABLE,
  misdirectionExposures,
  prepareMisdirectionEvidence,
  type MisdirectionArbiterPort,
  type MisdirectionChecked,
  type MisdirectionRootPostureRead,
} from '../misdirection-tail.js'
import {
  readMisdirectionRunPosture,
  readMisdirectionRunState,
} from '../misdirection-run-state.js'

const PRODUCT = 'storefront'
const CORPUS_DIGEST = 'c'.repeat(64)
const PROFILE_DIGEST = sha256hex('planner|judge')
const EVAL_ROOT: MisdirectionRootPostureRead = {
  kind: 'eval-root',
  corpusDigest: CORPUS_DIGEST,
  profileDigest: PROFILE_DIGEST,
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function element(): ElementInfo {
  return {
    ref: asRef('checkout'),
    role: 'button',
    name: 'Checkout',
    nameNormalized: 'checkout',
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    center: { x: 60, y: 40 },
    state: { enabled: true, focused: false, visible: true, clickable: true },
    labels: { ariaLabel: 'Checkout' },
    attributes: { 'data-testid': 'checkout' },
  }
}

function screen(): ScreenState {
  const checkout = element()
  return {
    platform: 'web',
    tree: 'button Checkout',
    elements: [checkout],
    refMap: { [checkout.ref]: { bounds: checkout.bounds!, center: checkout.center! } },
    url: '/cart',
    timestamp: 1_750_000_000_000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 1_280,
      viewportHeight: 720,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1_280, contentHeight: 1_440 },
    },
  }
}

function subAction(): SubActionEvidence {
  const state = screen()
  return {
    plan: 'Click Checkout',
    plannedAction: { type: 'click', ref: asRef('checkout') },
    stateBefore: state,
    stateAfter: state,
    result: { success: true },
  }
}

function candidateLine(id: RecordId) {
  return {
    id,
    kind: 'fact',
    summary: `${id} summary`,
    trust: 0.5,
    status: 'candidate',
    servedAsCanary: false,
    tier: 'L1',
  }
}

function servedBrief(ids: readonly RecordId[]): ServedBrief {
  const brief: ServedBrief = {
    scope: { tier: 'product', key: PRODUCT },
    asOfBuild: 7,
    budget: 1_000,
    truncation: 'none',
    channel1: ids.map(candidateLine),
    channel2: [],
    channel3: [],
    briefDigest: '',
  }
  return { ...brief, briefDigest: computeBriefDigest(brief) }
}

function step(stepIndex: number, ids: readonly RecordId[]): StepEvidence {
  return {
    stepIndex,
    stepText: `Step ${String(stepIndex)}`,
    cacheStatus: 'miss',
    servedBrief: servedBrief(ids),
    subActions: [subAction()],
    verifierVerdict: { pass: false, reasoning: 'the checkout never opened' },
  }
}

interface Member {
  readonly testId: string
  readonly testIndex: number
  readonly steps: StepEvidence[]
}

function handoffValue(members: readonly Member[]): CompletedRunHandoff {
  return guardCompletedRunHandoff({
    schemaVersion: 7,
    runId: asRunId('r_422-14-recovery'),
    scope: { tier: 'product', key: PRODUCT },
    buildOrdinal: 7,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_750_000_000_000,
    endedAt: 1_750_000_001_000,
    tests: members.map((member) => ({
      testId: member.testId,
      testName: member.testId,
      filePath: 'checkout.spec.yaml',
      testIndex: member.testIndex,
      outcome: 'failed',
      steps: member.steps,
    })),
  })
}

function project(members: readonly Member[]) {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-422-14r-'))
  roots.push(root)
  const agentQaRoot = join(root, '.agent-qa')
  const handoff = handoffValue(members)
  const runDir = join(agentQaRoot, 'runs', slugBranch(String(handoff.runId)))
  mkdirSync(runDir, { recursive: true })
  const handoffPath = join(runDir, 'handoff.json')
  writeFileSync(handoffPath, `${JSON.stringify(handoff)}\n`, 'utf8')
  return {
    agentQaRoot,
    runId: String(handoff.runId),
    runDir,
    handoffPath,
    onDisk: (): CompletedRunHandoff =>
      guardCompletedRunHandoff(JSON.parse(readFileSync(handoffPath, 'utf8'))),
    /** One pass of the producer over this run directory, exactly as a restart would make it. */
    prepare: async (arbiter: MisdirectionArbiterPort) =>
      await prepareMisdirectionEvidence({
        agentQaRoot,
        runDir,
        handoffPath,
        handoff: guardCompletedRunHandoff(JSON.parse(readFileSync(handoffPath, 'utf8'))),
        arbiter,
      }),
  }
}

interface ArbiterCalls {
  posture: number
  caps: number
  locate: string[]
  check: string[]
}

function stubArbiter(
  over: {
    posture?: MisdirectionRootPostureRead
    maxChecks?: number
    decisionOrdinalFor?: (input: { testId: string; stepIndex: number }) => number
    locate?: (input: { testId: string; stepIndex: number }) => Promise<unknown>
    check?: (input: { recordId: string }) => Promise<MisdirectionChecked>
  } = {},
): { port: MisdirectionArbiterPort; calls: ArbiterCalls } {
  const calls: ArbiterCalls = { posture: 0, caps: 0, locate: [], check: [] }
  const port: MisdirectionArbiterPort = {
    rootPosture: async () => {
      calls.posture += 1
      return over.posture ?? EVAL_ROOT
    },
    resolveCaps: async () => {
      calls.caps += 1
      return {
        maxChecks: over.maxChecks ?? ATTR_DEFAULT_MAX_MISDIRECTION_CHECKS,
        source: over.maxChecks === undefined ? 'default' : 'flag',
      }
    },
    locate: async (input) => {
      calls.locate.push(`${input.testId}#${String(input.stepIndex)}`)
      if (over.locate !== undefined) {
        return (await over.locate(input)) as Awaited<ReturnType<MisdirectionArbiterPort['locate']>>
      }
      return {
        kind: 'located',
        decisionOrdinal: over.decisionOrdinalFor?.(input) ?? input.stepIndex,
      }
    },
    check: async (input) => {
      calls.check.push(`${input.recordId}@${String(input.stepIndex)}`)
      if (over.check !== undefined) return await over.check(input)
      return {
        kind: 'checked',
        crossCheck: 'held',
        seedHonored: true,
        samples: { k: 3, seeds: [11, 12, 13], modelCalls: 5 },
      }
    },
  }
  return { port, calls }
}

function ids(count: number): RecordId[] {
  return Array.from({ length: count }, (_value, index) => asRecordId(`rec-${String(index)}`))
}

function oneFailingStep(records: readonly RecordId[]): Member[] {
  return [{ testId: 'checkout::one', testIndex: 0, steps: [step(0, records)] }]
}

describe('a recorded run is never re-spent (D-18)', () => {
  it('makes zero arbiter calls of ANY kind once every exposure is recorded', async () => {
    const fixture = project(oneFailingStep(ids(2)))
    const { port, calls } = stubArbiter()
    const first = await fixture.prepare(port)
    expect(first.rows).toHaveLength(2)
    const after = { ...calls, locate: [...calls.locate], check: [...calls.check] }
    expect(after.check).toHaveLength(2)

    const second = await fixture.prepare(port)
    // Posture and decision location included: a retry that merely skipped the provider call would
    // still extract cassettes and read the committed root on every crash loop.
    expect(calls).toEqual(after)
    expect(second.rows).toEqual(first.rows)
    expect(second.persisted).toBe(true)
  })

  it('keeps the charge for an interrupted attempt and never asks the provider again', async () => {
    const fixture = project(oneFailingStep(ids(2)))
    let attempts = 0
    const failing = stubArbiter({
      maxChecks: 1,
      check: async () => {
        attempts += 1
        throw new Error('the provider connection dropped mid-call')
      },
    })
    const first = await fixture.prepare(failing.port)
    expect(attempts).toBe(1)
    expect(first.rows[0]!.crossCheck).toBe('not-run')
    expect(first.rows[0]!.reason).toBe(MISDIRECTION_INTERRUPTED)
    // The charge survives the attempt that did not finish.
    const state = readMisdirectionRunState(fixture.runDir, fixture.runId)
    expect(state.reservations).toHaveLength(1)
    expect(state.interrupted).toHaveLength(1)
    expect(state.spent).toBe(1)

    // The restart, with a port that WOULD answer. It is never asked: the allowance is gone and
    // the interrupted exposure is reported rather than re-attempted.
    const healthy = stubArbiter({ maxChecks: 1 })
    const second = await fixture.prepare(healthy.port)
    expect(healthy.calls.check).toEqual([])
    expect(second.rows.map((row) => row.reason)).toEqual([
      MISDIRECTION_INTERRUPTED,
      MISDIRECTION_CAP_EXCEEDED,
    ])
  })

  it('never refills the cap on restart, however the arbiter would resolve it now', async () => {
    const fixture = project(oneFailingStep(ids(3)))
    const narrow = stubArbiter({ maxChecks: 1 })
    await fixture.prepare(narrow.port)
    expect(narrow.calls.check).toHaveLength(1)
    expect(readMisdirectionRunState(fixture.runDir, fixture.runId).policy).toEqual({
      schemaVersion: 1,
      runId: fixture.runId,
      maxChecks: 1,
      source: 'flag',
    })

    const widened = stubArbiter({ maxChecks: 9 })
    const second = await fixture.prepare(widened.port)
    expect(widened.calls.check).toEqual([])
    expect(second.rows.filter((row) => row.reason === MISDIRECTION_CAP_EXCEEDED)).toHaveLength(2)
  })
})

describe('the per-run check cap bounds the work (D-18)', () => {
  it('is four by default, recorded beside the gate-2 ablation cap', () => {
    expect(ATTR_DEFAULT_MAX_MISDIRECTION_CHECKS).toBe(4)
  })

  it('checks four of five records and retains the fifth as a not-run cap-exceeded result', async () => {
    const fixture = project(oneFailingStep(ids(5)))
    const { port, calls } = stubArbiter()
    const result = await fixture.prepare(port)

    expect(calls.check).toHaveLength(ATTR_DEFAULT_MAX_MISDIRECTION_CHECKS)
    expect(result.rows).toHaveLength(5)
    expect(result.rows.slice(0, 4).map((row) => row.crossCheck)).toEqual([
      'held',
      'held',
      'held',
      'held',
    ])
    const excess = result.rows[4]!
    expect(excess.crossCheck).toBe('not-run')
    expect(excess.reason).toBe(MISDIRECTION_CAP_EXCEEDED)
    // RETAINED, not dropped: the aggregation has to see an unchecked record rather than a
    // silently shorter ledger.
    expect(fixture.onDisk().misdirectionEvidence).toHaveLength(5)
  })

  it('retains the capped row durably, so a later pass cannot quietly check it after all', async () => {
    const fixture = project(oneFailingStep(ids(5)))
    const { port } = stubArbiter()
    await fixture.prepare(port)
    const completions = readMisdirectionRunState(fixture.runDir, fixture.runId).completions
    expect(completions).toHaveLength(5)
    expect(completions.filter((row) => row.reason === MISDIRECTION_CAP_EXCEEDED)).toHaveLength(1)
    // The capped row cost no allowance: four checks, four reservations.
    expect(readMisdirectionRunState(fixture.runDir, fixture.runId).spent).toBe(4)
  })
})

describe('the evidence key is the EXPOSURE, never the record (D-18)', () => {
  it('keeps the same record on two different members as two distinct results', async () => {
    const shared = asRecordId('rec-shared')
    const fixture = project([
      { testId: 'a::one', testIndex: 0, steps: [step(0, [shared])] },
      { testId: 'b::two', testIndex: 1, steps: [step(3, [shared])] },
    ])
    const { port, calls } = stubArbiter({
      check: async () => ({
        kind: 'checked',
        crossCheck: 'held',
        seedHonored: true,
        samples: { k: 3, seeds: [11], modelCalls: 2 },
      }),
    })
    const result = await fixture.prepare(port)

    expect(calls.check).toEqual([`${shared}@0`, `${shared}@3`])
    expect(result.rows).toHaveLength(2)
    expect(result.rows.map((row) => [row.perTest, row.stepIndex, row.decisionOrdinal])).toEqual([
      [0, 0, 0],
      [1, 3, 3],
    ])
    // Two rows for one record, and the durable store keeps them apart too.
    expect(readMisdirectionRunState(fixture.runDir, fixture.runId).completions).toHaveLength(2)
  })

  it('reads one record served twice inside ONE brief as a single exposure', async () => {
    const twice = asRecordId('rec-twice')
    const fixture = project(oneFailingStep([twice, twice]))
    expect(misdirectionExposures(fixture.onDisk())).toHaveLength(1)
    const { port, calls } = stubArbiter()
    await fixture.prepare(port)
    expect(calls.check).toHaveLength(1)
  })

  it('orders by member, then failing step, then the record id as the final tie-break', async () => {
    const fixture = project([
      {
        testId: 'b::two',
        testIndex: 1,
        steps: [step(2, [asRecordId('rec-z'), asRecordId('rec-a')])],
      },
      { testId: 'a::one', testIndex: 0, steps: [step(5, [asRecordId('rec-m')])] },
    ])
    const { port, calls } = stubArbiter()
    await fixture.prepare(port)
    expect(calls.check).toEqual(['rec-m@5', 'rec-a@2', 'rec-z@2'])
  })
})

describe('an absent evaluation root is not a broken one (D-19)', () => {
  it('records an empty ledger with the declared-only backing when no root exists', async () => {
    const fixture = project(oneFailingStep(ids(1)))
    const { port, calls } = stubArbiter({ posture: { kind: 'no-eval-root' } })
    const result = await fixture.prepare(port)

    expect(result.posture).toBe('no-eval-root')
    expect(result.backing).toBe('declared-only')
    expect(result.rows).toEqual([])
    expect(result.notices).toContain(MISDIRECTION_NO_EVAL_ROOT)
    // EMPTY, never absent: the arbiter ran and had nothing it could record.
    expect(fixture.onDisk().misdirectionEvidence).toEqual([])
    expect(calls.locate).toEqual([])
    expect(calls.check).toEqual([])
  })

  it('records an empty ledger with NO backing when the root exists and cannot be read', async () => {
    const fixture = project(oneFailingStep(ids(1)))
    const { port, calls } = stubArbiter({
      posture: { kind: 'broken-eval-root', reason: 'committed corpus marker unreadable' },
    })
    const result = await fixture.prepare(port)

    expect(result.posture).toBe('broken-eval-root')
    expect(result.backing).toBeUndefined()
    expect(result.rows).toEqual([])
    expect(result.notices[0]).toContain(MISDIRECTION_POSTURE_UNAVAILABLE)
    expect(fixture.onDisk().misdirectionEvidence).toEqual([])
    expect(calls.check).toEqual([])
  })

  it('makes the two postures different DURABLE states, not merely different return values', async () => {
    const absent = project(oneFailingStep(ids(1)))
    await absent.prepare(stubArbiter({ posture: { kind: 'no-eval-root' } }).port)
    const broken = project(oneFailingStep(ids(1)))
    await broken.prepare(
      stubArbiter({ posture: { kind: 'broken-eval-root', reason: 'corpus unreadable' } }).port,
    )

    // Both handoffs carry the same empty ledger, so the difference has to live somewhere a later
    // reader can actually find it.
    expect(absent.onDisk().misdirectionEvidence).toEqual(broken.onDisk().misdirectionEvidence)
    expect(readMisdirectionRunPosture(absent.runDir, absent.runId)).toEqual({
      schemaVersion: 1,
      runId: absent.runId,
      kind: 'no-eval-root',
    })
    expect(readMisdirectionRunPosture(broken.runDir, broken.runId)).toEqual({
      schemaVersion: 1,
      runId: broken.runId,
      kind: 'broken-eval-root',
      reason: 'corpus unreadable',
    })
  })

  it('records the resolved corpus and profile identities when the root IS usable', async () => {
    const fixture = project(oneFailingStep(ids(1)))
    await fixture.prepare(stubArbiter().port)
    expect(readMisdirectionRunPosture(fixture.runDir, fixture.runId)).toEqual({
      schemaVersion: 1,
      runId: fixture.runId,
      kind: 'eval-root',
      corpusDigest: CORPUS_DIGEST,
      profileDigest: PROFILE_DIGEST,
    })
  })
})

describe('every refusal keeps its own words (D-18)', () => {
  it("turns an unavailable check into an inconclusive row carrying the port's own reason", async () => {
    const fixture = project(oneFailingStep(ids(1)))
    const { port } = stubArbiter({
      check: async () => ({ kind: 'unavailable', reason: 'active record rendered line is absent or ambiguous' }),
    })
    const result = await fixture.prepare(port)
    expect(result.rows[0]!.crossCheck).toBe('inconclusive')
    expect(result.rows[0]!.reason).toBe('active record rendered line is absent or ambiguous')
  })

  it('writes NO row for an unlocatable decision and names the cause instead', async () => {
    const fixture = project(oneFailingStep(ids(1)))
    const { port, calls } = stubArbiter({
      locate: async () => ({ kind: 'unavailable', reason: 'no live decision at target' }),
    })
    const result = await fixture.prepare(port)
    // Inventing a decision ordinal to carry a refusal would bind the row to a decision the run
    // never made; the record reads `unchecked` at fold time and the cause stays visible here.
    expect(result.rows).toEqual([])
    expect(result.notices[0]).toContain('no live decision at target')
    expect(calls.check).toEqual([])
    expect(fixture.onDisk().misdirectionEvidence).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------
// CR-04 — a resolver or provider exception is never forwarded as text
// ---------------------------------------------------------------------------------------

// The calls behind this port are `resolveEvalSession` (registry + credential resolution),
// `readMisdirectionRootPosture`, `locateMisdirectionDecision` and `runMisdirectionCheck` -- a
// provider call. Their exception text used to be carried verbatim into TWO places that must
// never hold untrusted free text: the durable `misdirection-posture.json` `reason` field, and
// the `notices` array, which is returned to the caller through no masker. The sibling
// preflight in this same phase already refuses to forward resolver messages.
describe('CR-04: exception text from a credential-resolving layer never becomes disclosure', () => {
  const SECRET = 'registry entry acme-llm: provider key sk-live-DEADBEEF rejected'

  it('reduces a throwing rootPosture to a closed word, on disk and in the notices', async () => {
    const fixture = project(oneFailingStep(ids(1)))
    const port: MisdirectionArbiterPort = {
      ...stubArbiter().port,
      rootPosture: async () => { throw new Error(SECRET) },
    }
    const result = await fixture.prepare(port)

    expect(result.posture).toBe('broken-eval-root')
    expect(JSON.stringify(result.notices)).not.toContain('sk-live-DEADBEEF')
    expect(JSON.stringify(result.notices)).not.toContain('acme-llm')
    expect(result.notices).toEqual([
      `${MISDIRECTION_POSTURE_UNAVAILABLE}: ${MISDIRECTION_ROOT_UNREADABLE}`,
    ])
    // The DURABLE record is the half no downstream allow-list protects.
    expect(readMisdirectionRunPosture(fixture.runDir, fixture.runId)).toEqual({
      schemaVersion: 1,
      runId: fixture.runId,
      kind: 'broken-eval-root',
      reason: MISDIRECTION_ROOT_UNREADABLE,
    })
  })

  it('reduces a throwing locate to a closed word', async () => {
    const fixture = project(oneFailingStep(ids(1)))
    const port: MisdirectionArbiterPort = {
      ...stubArbiter().port,
      locate: async () => { throw new Error(SECRET) },
    }
    const result = await fixture.prepare(port)

    expect(result.rows).toEqual([])
    expect(JSON.stringify(result.notices)).not.toContain('sk-live-DEADBEEF')
    expect(result.notices).toEqual([`rec-0 at step 0: ${MISDIRECTION_DECISION_UNLOCATABLE}`])
  })

  it('reduces a throwing check -- a provider call -- to a closed word', async () => {
    const fixture = project(oneFailingStep(ids(1)))
    const port: MisdirectionArbiterPort = {
      ...stubArbiter().port,
      check: async () => { throw new Error(SECRET) },
    }
    const result = await fixture.prepare(port)

    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]?.crossCheck).toBe('not-run')
    expect(JSON.stringify(result.notices)).not.toContain('sk-live-DEADBEEF')
    expect(result.notices).toEqual([`rec-0 at step 0: ${MISDIRECTION_CHECK_FAILED}`])
  })
})

// ---------------------------------------------------------------------------------------
// WR-08 — the sidecar write does not repermission or re-serialise the runner's document
// ---------------------------------------------------------------------------------------

describe('WR-08: persistMisdirectionSidecar leaves handoff.json as it found it', () => {
  it('does not narrow the file mode the runner chose', async () => {
    const fixture = project(oneFailingStep(ids(1)))
    // A group-readable handoff, as a runner sharing a run directory would leave it.
    chmodSync(fixture.handoffPath, 0o640)

    await fixture.prepare(stubArbiter().port)

    // The sidecar staged at a hardcoded 0o600 and renamed over the original, silently
    // tightening the document to owner-only on the FIRST write with any exposure.
    expect(statSync(fixture.handoffPath).mode & 0o777).toBe(0o640)
    // And it really did write: the claim is "unchanged mode", not "no write happened".
    expect(fixture.onDisk().misdirectionEvidence).toHaveLength(1)
  })

  it('serialises canonically, so the document has ONE spelling', async () => {
    const fixture = project(oneFailingStep(ids(1)))
    await fixture.prepare(stubArbiter().port)

    const text = readFileSync(fixture.handoffPath, 'utf8')
    const parsed: unknown = JSON.parse(text)
    expect(text).toBe(`${canonicalJson(parsed)}\n`)
  })
})
