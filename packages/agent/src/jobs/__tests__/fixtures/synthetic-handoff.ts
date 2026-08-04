// A parameterizable synthetic CompletedRunHandoff builder (Phase 389, plan 01).
//
// One substrate for the whole phase: the tracer's handler test drives it with a handful of
// failures, plan 04's author harness scripts the `unknown` members it upgrades, plan 05's
// cluster tests give N failures one shared anchor, and plan 07's ANLZ-04 acceptance scales
// `failureCount` to 40. Built general NOW so none of them mints a second fixture vocabulary.
//
// Every failing member carries quotable captured evidence in all three places the template
// author may quote from — `stepText`, `verifierVerdict.reasoning`, `subActions[].result.error`
// — and the shared element/page anchors are reachable through the exercised-anchors walk
// (`plannedAction.ref` resolves against `stateBefore.elements`, `stateBefore.url` mints the
// page anchor). Step-less failures model the suite-bootstrap case: outcome without steps.

import type {
  CompletedRunHandoff,
  ElementInfo,
  PerTestOutcome,
  ScreenState,
  ServedBrief,
  StepEvidence,
  Verdict,
} from '@vostride/agent-qa-schema'
import { asRef, asRunId } from '@vostride/agent-qa-schema'

export interface SyntheticHandoffOptions {
  readonly runId?: string
  /** Failed member tests WITH one captured step each (quotable evidence, shared anchor). */
  readonly failureCount?: number
  /** Failed member tests with ZERO captured steps — the suite-bootstrap posture. */
  readonly steplessFailureCount?: number
  /** Clean passes appended after the failures; they never receive a verdict. */
  readonly passedCount?: number
  /** The one element every stepped failure exercised. */
  readonly sharedAnchor?: { readonly role: string; readonly name: string }
  /** The sub-action error text — the first thing the template author quotes. */
  readonly evidenceText?: string
  /** The verifier's reasoning — the quote fallback when no sub-action error exists. */
  readonly verifierReasoning?: string
  /** The route every stepped failure's screen carried (the page anchor). */
  readonly route?: string
  /**
   * A persisted deterministic verdict for the stepped failure at this index, or undefined
   * for the floor's minted `unknown`. Ranges over stepped failures only.
   */
  readonly rootCauseFor?: (failureIndex: number) => Verdict | undefined
}

function servedBrief(): ServedBrief {
  return {
    scope: { tier: 'product', key: 'synthetic' },
    asOfBuild: 1,
    budget: 0,
    truncation: 'none',
    channel1: [],
    channel2: [],
    channel3: [],
    briefDigest: 'synthetic-brief-digest',
  }
}

function sharedElement(role: string, name: string): ElementInfo {
  return {
    ref: asRef('e1'),
    role,
    name,
    nameNormalized: name.trim().toLowerCase(),
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
  }
}

function screenState(element: ElementInfo, route: string): ScreenState {
  return {
    platform: 'web',
    tree: '',
    elements: [element],
    refMap: {},
    url: route,
    timestamp: 1,
    metadata: {
      coordSpace: 'viewport',
      viewportWidth: 1280,
      viewportHeight: 720,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1280, contentHeight: 720 },
      captureMode: 'textOnly',
    },
  }
}

function failingStep(options: {
  readonly element: ElementInfo
  readonly route: string
  readonly evidenceText: string
  readonly verifierReasoning: string
}): StepEvidence {
  return {
    stepIndex: 0,
    stepText: `click the ${options.element.name} button`,
    cacheStatus: 'miss',
    servedBrief: servedBrief(),
    subActions: [
      {
        plan: `click ${options.element.name}`,
        plannedAction: { type: 'click', ref: options.element.ref },
        stateBefore: screenState(options.element, options.route),
        result: { success: false, error: options.evidenceText },
      },
    ],
    verifierVerdict: { pass: false, reasoning: options.verifierReasoning },
  }
}

/**
 * Build a valid CompletedRunHandoff with the requested failure population.
 *
 * Member order (and therefore `testIndex`): stepped failures, then step-less failures,
 * then clean passes. Every stepped failure shares ONE anchor pair — the element and the
 * page route — which is exactly what plan 05's clustering and 390's recurrence window
 * group over.
 */
export function buildSyntheticHandoff(
  options: SyntheticHandoffOptions = {},
): CompletedRunHandoff {
  const {
    runId = 'run-389-synthetic',
    failureCount = 1,
    steplessFailureCount = 0,
    passedCount = 0,
    sharedAnchor = { role: 'button', name: 'Submit' },
    evidenceText = 'Error: element "Submit" not found',
    verifierReasoning = 'the submit button never appeared on the checkout screen',
    route = '/checkout',
    rootCauseFor = () => undefined,
  } = options

  const element = sharedElement(sharedAnchor.role, sharedAnchor.name)
  const tests: PerTestOutcome[] = []

  for (let index = 0; index < failureCount; index += 1) {
    const rootCause = rootCauseFor(index)
    tests.push({
      testId: `t_failed_${index}`,
      testName: `stepped failure ${index}`,
      filePath: `tests/failed-${index}.yaml`,
      testIndex: tests.length,
      outcome: 'failed',
      steps: [failingStep({ element, route, evidenceText, verifierReasoning })],
      ...(rootCause === undefined ? {} : { rootCause }),
    })
  }

  for (let index = 0; index < steplessFailureCount; index += 1) {
    tests.push({
      testId: `t_stepless_${index}`,
      testName: `step-less failure ${index}`,
      filePath: `tests/stepless-${index}.yaml`,
      testIndex: tests.length,
      outcome: 'failed',
      steps: [],
    })
  }

  for (let index = 0; index < passedCount; index += 1) {
    tests.push({
      testId: `t_passed_${index}`,
      testName: `clean pass ${index}`,
      filePath: `tests/passed-${index}.yaml`,
      testIndex: tests.length,
      outcome: 'passed',
      steps: [],
    })
  }

  return {
    schemaVersion: 5,
    runId: asRunId(runId),
    scope: { tier: 'product', key: 'synthetic-389' },
    buildOrdinal: 1,
    executionContext: 'local-headless',
    aggregateVerdict: failureCount + steplessFailureCount > 0 ? 'failed' : 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1,
    endedAt: 2,
    tests,
  }
}
