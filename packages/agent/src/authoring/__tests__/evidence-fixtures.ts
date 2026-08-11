// Shared gate-run fixtures for the authoring suites (393-06).
//
// The evaluator reads execution EVIDENCE — a run document's member outcome, its per-step
// sub-actions, and the elements those sub-actions resolved against on the pre-action screen — so
// the fakes here build that evidence rather than the answers derived from it. The expected
// fingerprint bytes are never spelled as literals in any test: they are computed by schema's own
// `actionAnchorElement` from the same fixture the port serves, so a fixture cannot pin a string
// the recipe would never mint (the produced-not-literal law).
//
// Not a `.test.ts` file, so vitest's `src/**/__tests__/**/*.test.ts` include never collects it.

import { actionAnchorElement } from '@vostride/agent-qa-schema'
import type {
  Action,
  CompletedRunHandoff,
  ElementInfo,
  MemberTestOutcome,
  PerTestOutcome,
  RunStartAcknowledgement,
  RunStatus,
  RunsStartInput,
  StepEvidence,
  SubActionEvidence,
  VerdictSource,
} from '@vostride/agent-qa-schema'

import type { DraftRunPortLike, ParsedDraftLike, SuiteFingerprintIndexLike } from '../ports.js'

// ---- 394-05 widening -------------------------------------------------------------------------
//
// The router (394-05) reads FAILURE evidence, and every builder below was written by 393 for the
// gate evaluator, which only ever needed passing or mechanically-broken members. Four additive
// optional members close that gap: a step whose verifier said NO (`failedSteps`), the path that
// produced that verdict (`verdictSourceSteps`), the exhausted-ladder terminal block
// (`stagnationSteps`), and an aggregate override for a document whose member did not pass.
//
// Additive and optional, so every 393 fixture builds byte-identically to before. They are added
// HERE rather than mirrored in the router's own suite because a corpus assembled from a second
// builder is a corpus of inputs the first builder cannot emit, which is the produced-not-literal
// law applied to fixtures rather than to documents.

export const LOCAL_FORM_URL = 'http://127.0.0.1:8931/form.html'

/** One exercised sub-action: an action type, the ref it named, and the element that ref resolved to. */
export interface SubActionFixture {
  readonly type: string
  readonly ref?: string
  readonly role?: string
  readonly name?: string
  readonly url?: string
  readonly urlAfter?: string
  readonly success?: boolean
}

export interface MemberFixture {
  readonly filePath: string
  readonly testName: string
  readonly outcome: MemberTestOutcome
  /** One entry per test step; each entry is that step's sub-actions. */
  readonly steps: readonly (readonly SubActionFixture[])[]
  /** Step indices carrying a typed infeasible termination block. */
  readonly infeasibleSteps?: readonly number[]
  /** Step indices carrying a structural planning failure. */
  readonly planningFailureSteps?: readonly number[]
  /** Step indices carrying a flagged cycle. */
  readonly cycleSteps?: readonly number[]
  /** Step indices carrying a recorded self-heal. */
  readonly selfHealSteps?: readonly number[]
  /** Step indices whose verifier said NO — `verifierVerdict.pass === false` (394-05). */
  readonly failedSteps?: readonly number[]
  /** Which path produced a step's verdict, per step (394-05). Absent ⇒ the step records none. */
  readonly verdictSourceSteps?: readonly VerdictSourceFixture[]
  /** Step indices carrying the exhausted-ladder stagnation terminal block (394-05). */
  readonly stagnationSteps?: readonly number[]
}

/** One step's recorded {@link VerdictSource}. */
export interface VerdictSourceFixture {
  readonly stepIndex: number
  readonly source: VerdictSource
}

function elementInfo(ref: string, role: string, name: string): ElementInfo {
  return {
    ref,
    role,
    name,
    nameNormalized: name,
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
  } as unknown as ElementInfo
}

function screenState(url: string | undefined, elements: ElementInfo[], timestamp: number): unknown {
  return {
    platform: 'web',
    tree: '',
    elements,
    refMap: {},
    timestamp,
    metadata: {},
    ...(url === undefined ? {} : { url }),
  }
}

export function subActionEvidence(fixture: SubActionFixture): SubActionEvidence {
  const elements = fixture.ref === undefined
    ? []
    : [elementInfo(fixture.ref, fixture.role ?? 'button', fixture.name ?? 'submit')]
  return {
    plan: `plan ${fixture.type}`,
    plannedAction: {
      type: fixture.type,
      ...(fixture.ref === undefined ? {} : { ref: fixture.ref }),
    } as unknown as Action,
    stateBefore: screenState(fixture.url ?? LOCAL_FORM_URL, elements, 0),
    ...(fixture.urlAfter === undefined
      ? {}
      : { stateAfter: screenState(fixture.urlAfter, [], 1) }),
    result: { success: fixture.success ?? true },
  } as unknown as SubActionEvidence
}

/** The element bytes one fixture sub-action contributes, minted by the shipped recipe. */
export function expectedElement(fixture: SubActionFixture): string {
  const anchor = fixture.ref === undefined
    ? { t: 'page' as const, route: fixture.url ?? LOCAL_FORM_URL }
    : {
        t: 'el' as const,
        role: fixture.role ?? 'button',
        name: fixture.name ?? 'submit',
        ordinal: 0,
      }
  const route = fixture.urlAfter ?? fixture.url ?? LOCAL_FORM_URL
  return actionAnchorElement({
    kind: fixture.type === 'assertValue' || fixture.type === 'assertAI' ? 'assert' : 'action',
    type: fixture.type,
    anchor,
    ...(anchor.t === 'el' ? { route } : {}),
  })
}

function stepEvidence(
  stepIndex: number,
  subActions: readonly SubActionFixture[],
  member: MemberFixture,
): StepEvidence {
  return {
    stepIndex,
    stepText: `step ${stepIndex}`,
    cacheStatus: 'miss',
    servedBrief: {
      scope: { tier: 'product', key: 'local-form' },
      asOfBuild: 1,
      budget: 1,
      truncation: 'none',
      channel1: [],
      channel2: [],
      channel3: [],
    },
    subActions: subActions.map(subActionEvidence),
    verifierVerdict: member.failedSteps?.includes(stepIndex) === true
      ? { pass: false, reasoning: `fixture: step ${stepIndex} did not show what the test claims` }
      : { pass: true, reasoning: 'fixture' },
    ...(() => {
      const row = member.verdictSourceSteps?.find((entry) => entry.stepIndex === stepIndex)
      return row === undefined ? {} : { verdictSource: row.source }
    })(),
    ...(member.stagnationSteps?.includes(stepIndex) === true
      ? {
          stagnation: {
            anchorKey: 'fixture:anchor',
            counts: [{ class: 'unresponsive', count: 3 }],
            total: 3,
          },
        }
      : {}),
    ...(member.infeasibleSteps?.includes(stepIndex) === true
      ? { termination: { kind: 'infeasible', reason: 'fixture: the control does not exist' } }
      : {}),
    ...(member.planningFailureSteps?.includes(stepIndex) === true
      // The REAL `PlanningFailureEvidence` shape (`reason`/`message`/`exchanges`). It was
      // `{turnIndex, exchanges}` until 394-05: nothing reads the fields — every consumer reads
      // PRESENCE — so the cast hid it, and a fixture that models a shape the runner never writes
      // is exactly the input a differential cannot distinguish from a real one.
      ? {
          planningFailure: {
            reason: 'planning-turn-failed',
            message: 'fixture: the planning turn produced no usable decision',
            exchanges: [],
          },
        }
      : {}),
    ...(member.cycleSteps?.includes(stepIndex) === true
      ? { cycle: { revisitedKey: 'k', windowSummary: [], reason: 'fixture: revisitation' } }
      : {}),
    ...(member.selfHealSteps?.includes(stepIndex) === true
      ? {
          selfHeal: {
            failedDecision: {
              plan: 'fixture',
              plannedAction: { type: 'click' } as unknown as Action,
              result: { success: false },
            },
            recoveringDecision: {
              plan: 'fixture',
              plannedAction: { type: 'click' } as unknown as Action,
              result: { success: true },
            },
          },
        }
      : {}),
  } as unknown as StepEvidence
}

export function memberOutcome(fixture: MemberFixture): PerTestOutcome {
  return {
    testId: 't_fixture',
    testName: fixture.testName,
    filePath: fixture.filePath,
    testIndex: 0,
    outcome: fixture.outcome,
    steps: fixture.steps.map((subActions, index) => stepEvidence(index, subActions, fixture)),
  } as unknown as PerTestOutcome
}

/**
 * The aggregate a run document carries, DERIVED from its members rather than pinned (394-05).
 *
 * A document whose member timed out while its `aggregateVerdict` read `passed` is not a document
 * the runner can produce, and the router's corpus must not be able to pin one. Skips are not
 * failures; a heal is a pass.
 */
function deriveAggregateVerdict(members: readonly MemberFixture[]): RunStatus {
  const outcomes = members.map((member) => member.outcome)
  for (const status of ['cancelled', 'timeout', 'failed', 'healed'] as const) {
    if (outcomes.includes(status)) return status
  }
  return 'passed'
}

export function runDocument(runId: string, members: readonly MemberFixture[]): CompletedRunHandoff {
  return {
    schemaVersion: 6,
    runId,
    scope: { tier: 'product', key: 'local-form' },
    buildOrdinal: 1,
    gateRun: true,
    excludedFromOutcomes: true,
    executionContext: 'local-headless',
    aggregateVerdict: deriveAggregateVerdict(members),
    configDigests: { suiteConfigDigest: 'a', testConfigDigest: 'b' },
    startedAt: 0,
    endedAt: 1,
    tests: members.map(memberOutcome),
  } as unknown as CompletedRunHandoff
}

export interface RecordingRunPort extends DraftRunPortLike {
  readonly startInputs: RunsStartInput[]
  readonly startedRunIds: string[]
}

export interface FakeRunPortOptions {
  /**
   * One entry per run to serve, in order. `undefined` models a run that `runs.start` acknowledged
   * normally but whose completed record is no longer readable when `get` is called.
   */
  readonly runs: readonly (readonly MemberFixture[] | undefined)[]
  /** Drop the markers from the acknowledgment, modelling a host that did not accept the gate-run. */
  readonly dropMarkers?: boolean
}

/**
 * A run port that scripts a sequence of run documents and records every start input.
 *
 * THE ACKNOWLEDGMENT IS NOT AN ECHO OF THE REQUEST. `runs.start` reads the run's own durable
 * record and copies both markers off it, and refuses with `RunNotRecordedError` rather than
 * acknowledging a run it has no record for — so a real acknowledgment always carries the record's
 * markers, and `dropMarkers` is the only way to model a host that did not accept the run as a
 * gate-run. A fake that echoed the request instead would let the evaluator's confirmation check
 * pass for a host that had silently dropped the flags, which is the one thing that check exists to
 * catch. It follows that "the record is unreadable" cannot be expressed as a marker-less
 * acknowledgment — it is a later `get` returning nothing, which is what `undefined` models here.
 */
export function fakeRunPort(options: FakeRunPortOptions): RecordingRunPort {
  const startInputs: RunsStartInput[] = []
  const startedRunIds: string[] = []
  const documents = new Map<string, CompletedRunHandoff | undefined>()

  return {
    startInputs,
    startedRunIds,
    async start(input: RunsStartInput): Promise<RunStartAcknowledgement> {
      const index = startInputs.length
      startInputs.push(input)
      const runId = `r_fixture-${index}`
      startedRunIds.push(runId)
      const members = options.runs[index]
      const document = members === undefined ? undefined : runDocument(runId, members)
      documents.set(runId, document)
      return {
        runId,
        scope: { tier: 'product', key: 'local-form' },
        executionContext: 'local-headless',
        buildOrdinal: 1,
        startedAt: 0,
        testCount: document?.tests.length ?? 0,
        ...(options.dropMarkers === true
          ? {}
          : { gateRun: true, excludedFromOutcomes: true }),
      } as unknown as RunStartAcknowledgement
    },
    async get(runId: string): Promise<CompletedRunHandoff | undefined> {
      return documents.get(runId)
    },
  }
}

export interface FakeIndexEntry {
  readonly filePath: string
  readonly testName: string
  readonly elements: readonly string[]
}

/** An in-memory stand-in for `createSuiteFingerprintIndex`, with the same three verbs. */
export function fakeFingerprintIndex(
  entries: readonly FakeIndexEntry[],
): SuiteFingerprintIndexLike {
  return {
    elementUnion: () => new Set(entries.flatMap((entry) => [...entry.elements])),
    coveredTests: () => entries.map(({ filePath, testName }) => ({ filePath, testName })),
    elementsForTest: (filePath, testName) =>
      entries.find((entry) => entry.filePath === filePath && entry.testName === testName)
        ?.elements ?? [],
  }
}

/** The accept-control draft, step text copied verbatim from `fixtures/corpus/accept-control.yaml`. */
export const ACCEPT_CONTROL_DRAFT: ParsedDraftLike = {
  testId: 't_hong-lat-plot-noise-memory-common-binary-tol-liv-argent',
  filePath: 'tests/accept-control.yaml',
  testName: 'Confirm the local account form page heading',
  steps: [
    'Type "alice" into the Username field',
    'Verify the page heading says "Local Form"',
  ],
  contentDigest: 'digest-accept-control',
}

/** What the accept control exercises: the Username textbox, then the page heading. */
export const ACCEPT_CONTROL_SUBACTIONS: readonly SubActionFixture[][] = [
  [{ type: 'fill', ref: 'e1', role: 'textbox', name: 'username' }],
  [{ type: 'assertValue', ref: 'e2', role: 'heading', name: 'local form' }],
]

export function acceptControlMember(outcome: MemberTestOutcome = 'healed'): MemberFixture {
  return {
    filePath: ACCEPT_CONTROL_DRAFT.filePath,
    testName: ACCEPT_CONTROL_DRAFT.testName,
    outcome,
    steps: ACCEPT_CONTROL_SUBACTIONS,
    ...(outcome === 'healed' ? { selfHealSteps: [0] } : {}),
  }
}
