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
  RunsStartInput,
  StepEvidence,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'

import type { DraftRunPortLike, ParsedDraftLike, SuiteFingerprintIndexLike } from '../ports.js'

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
    verifierVerdict: { pass: true, reasoning: 'fixture' },
    ...(member.infeasibleSteps?.includes(stepIndex) === true
      ? { termination: { kind: 'infeasible', reason: 'fixture: the control does not exist' } }
      : {}),
    ...(member.planningFailureSteps?.includes(stepIndex) === true
      ? { planningFailure: { turnIndex: 0, exchanges: [] } }
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

export function runDocument(runId: string, members: readonly MemberFixture[]): CompletedRunHandoff {
  return {
    schemaVersion: 6,
    runId,
    scope: { tier: 'product', key: 'local-form' },
    buildOrdinal: 1,
    gateRun: true,
    excludedFromOutcomes: true,
    executionContext: 'local-headless',
    aggregateVerdict: 'passed',
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
  /** One entry per run to serve, in order. `undefined` models an unreadable run record. */
  readonly runs: readonly (readonly MemberFixture[] | undefined)[]
  /** Drop the markers from the acknowledgment, modelling a host that did not accept the gate-run. */
  readonly dropMarkers?: boolean
}

/**
 * A run port that scripts a sequence of run documents and records every start input.
 *
 * The acknowledgment copies its markers from the DOCUMENT rather than from the request, exactly as
 * `runs.start` does — a fake that echoed the request would make the evaluator's confirmation check
 * pass for a host that had silently dropped the flags, which is the one thing the check exists to
 * catch.
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
          : {
              ...(document?.gateRun === undefined ? {} : { gateRun: document.gateRun }),
              ...(document?.excludedFromOutcomes === undefined
                ? {}
                : { excludedFromOutcomes: document.excludedFromOutcomes }),
            }),
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
