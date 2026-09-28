// Phase 431 plan 02 (D-06, PXH-AGENT-06): `runs.overview`, one completed run's address map.
//
// Driven through the real built-in registry and `invokeFunction`, so the strict input, the
// completed-handoff gate, the op and the declared output contract are one measured path.

import { createHash } from 'node:crypto'

import { createMaskingContext, setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import type { AuditSink } from '@vostride/agent-qa-safety'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  asRunId,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  FunctionCaller,
  PerTestOutcome,
  RecordedTargets,
  RunDetailRows,
  RunDetailStep,
  RunDetailSubAction,
  StepEvidence,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FunctionInputError, FunctionNotBoundError, invokeFunction } from '../invoke.js'
import { RunNotFoundError } from '../ops/runs-get.js'
import { createFunctionRegistry } from '../registry.js'
import type { FunctionDeps, KnowledgeReaderPort } from '../spec.js'

const OVERVIEW = 'runs.overview'
const RUN_ID = 'run-431-overview'

const READER: FunctionCaller = {
  surface: 'test',
  grantedScopes: ['read'],
  safeMode: false,
  origin: 'agent',
}

const NO_AUDIT: AuditSink = { appendExecutionAudit() {}, appendGuardrailAudit() {} }

const sha = (seed: string) => createHash('sha256').update(seed).digest('hex')

function handoffStep(stepIndex: number, stepText: string): StepEvidence {
  return {
    stepIndex,
    stepText,
    cacheStatus: 'miss',
    servedBrief: {
      scope: { tier: 'product', key: 'shop' },
      asOfBuild: 5,
      budget: 400,
      truncation: '',
      channel1: [],
      channel2: [],
      channel3: [],
      briefDigest: `brief-${String(stepIndex)}`,
    },
    subActions: [],
    verifierVerdict: { pass: true, reasoning: 'recorded reasoning' },
  }
}

function member(testIndex: number, testId: string, testName: string, steps: StepEvidence[]): PerTestOutcome {
  return { testId, testName, filePath: `tests/${testId}.yaml`, testIndex, outcome: 'passed', steps }
}

function completed(tests: PerTestOutcome[]): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(RUN_ID),
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: 5,
    executionContext: 'local-headless',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_000,
    endedAt: 9_000,
    tests,
  }
}

function detailStep(testIndex: number, stepIndex: number, stepText: string): RunDetailStep {
  return {
    testIndex,
    stepIndex,
    stepText,
    cacheStatus: 'miss',
    verifierVerdict: { pass: true, reasoning: 'recorded reasoning' },
    selfHealOccurred: false,
    briefDigest: `brief-${String(stepIndex)}`,
    status: 'passed',
    durationMs: 227.4,
    tokenUsage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
  }
}

function subAction(testIndex: number, stepIndex: number, subActionIndex: number): RunDetailSubAction {
  const screenshot = sha(`shot-${String(testIndex)}-${String(stepIndex)}-${String(subActionIndex)}`)
  return {
    testIndex,
    stepIndex,
    subActionIndex,
    plan: 'recorded plan prose',
    plannedAction: { type: 'navigate', to: 'url', url: 'https://example.test' },
    result: { success: true },
    screenStateHash: 'before',
    artifactRefs: [{ id: `decision-screenshot:${screenshot}`, sha: screenshot }],
  }
}

const EMPTY_KNOWLEDGE: KnowledgeReaderPort = {
  listBundles: () => Promise.resolve([]),
  inspectRecords: () => Promise.resolve([]),
  diffSince: () => Promise.resolve([]),
  showRecord: ({ recordId }) => Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId }),
}

interface Scene {
  document: CompletedRunHandoff | undefined
  rows: RunDetailRows | undefined
  targets?: RecordedTargets
  bindDetail?: boolean
}

function singleTestScene(): Scene {
  return {
    document: completed([member(0, 'test-checkout', 'Checkout smoke', [
      handoffStep(0, 'Open the home page'),
      handoffStep(1, 'Click Pay'),
    ])]),
    rows: {
      runId: RUN_ID,
      members: [{ testIndex: 0, testId: 'test-checkout', name: 'Checkout smoke', attempts: 1,
        outcome: 'passed', failureSummary: 'dashboard-only text' }],
      steps: [detailStep(0, 0, 'Open the home page'), detailStep(0, 1, 'Click Pay')],
      subActions: [subAction(0, 0, 0), subAction(0, 1, 0)],
    },
    targets: { status: 'recorded', names: ['example-web'] },
  }
}

function harness(scene: Scene) {
  const detailRead = vi.fn(async () => scene.rows)
  const deps: FunctionDeps = {
    runs: {
      list: () => Promise.resolve(scene.document === undefined ? [] : [scene.document]),
      get: (runId) => Promise.resolve(scene.document?.runId === runId ? scene.document : undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
      ...(scene.targets === undefined
        ? {}
        : { getRecordedTargets: () => Promise.resolve(scene.targets as RecordedTargets) }),
    },
    knowledge: EMPTY_KNOWLEDGE,
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({
        schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
    ...(scene.bindDetail === false ? {} : { runDetail: { read: detailRead } }),
  }
  const registry = createFunctionRegistry({
    deps,
    auditSink: NO_AUDIT,
    resolveExecutionContext: () => 'local-interactive',
  })
  return {
    registry,
    detailRead,
    overview: (input: unknown) => invokeFunction(registry, OVERVIEW, input, READER),
  }
}

beforeEach(() => setActiveMaskingContextResolver(() => createMaskingContext()))
afterEach(() => setActiveMaskingContextResolver(() => undefined))

describe('OVERVIEW-REGISTRY: runs.overview is a registered read over one completed run (D-06)', () => {
  it('lists runs.overview as a bound read-only registry op', () => {
    const declaration = harness(singleTestScene()).registry.list(READER)
      .find((entry) => entry.id === OVERVIEW)
    expect(declaration).toMatchObject({
      id: OVERVIEW,
      requiredScopes: ['read'],
      resultKind: 'unary',
      bindingStatus: 'bound',
      risk: { name: `fn:${OVERVIEW}`, recognized: true, readOnly: true },
    })
  })

  it('lists runs.overview unbound where the host owns no run-detail reader', async () => {
    const h = harness({ ...singleTestScene(), bindDetail: false })
    expect(h.registry.list(READER).find((entry) => entry.id === OVERVIEW)?.bindingStatus)
      .toBe('unbound')
    await expect(h.overview({ runId: RUN_ID })).rejects.toBeInstanceOf(FunctionNotBoundError)
  })

  it('returns the compact run, test and step identity of a completed single-test run', async () => {
    const result = await harness(singleTestScene()).overview({ runId: RUN_ID })
    expect(result).toMatchObject({
      runId: RUN_ID,
      scope: { tier: 'product', key: 'shop' },
      recordedTargets: { status: 'recorded', names: ['example-web'] },
      aggregateVerdict: 'passed',
      buildOrdinal: 5,
      startedAt: 1_000,
      endedAt: 9_000,
      tests: [{
        testIndex: 0,
        testId: 'test-checkout',
        name: { text: 'Checkout smoke' },
        outcome: 'passed',
        steps: [
          { stepIndex: 0, label: { text: 'Open the home page' }, status: 'passed' },
          { stepIndex: 1, label: { text: 'Click Pay' }, status: 'passed' },
        ],
      }],
    })
  })

  it('reports unknown recorded targets when the reader cannot say', async () => {
    const scene = singleTestScene()
    delete scene.targets
    expect(await harness(scene).overview({ runId: RUN_ID }))
      .toMatchObject({ recordedTargets: { status: 'unknown' } })
  })

  it('carries no dashboard tree, token sum, plan prose or member failure text', async () => {
    const result = await harness(singleTestScene()).overview({ runId: RUN_ID }) as Record<string, unknown>
    for (const key of ['members', 'subActions', 'tokens', 'models', 'steps']) {
      expect(result).not.toHaveProperty(key)
    }
    const wire = JSON.stringify(result)
    for (const fragment of ['plannedAction', 'recorded plan prose', 'dashboard-only text',
      'tokenUsage', 'recorded reasoning', 'screenStateHash']) {
      expect(wire).not.toContain(fragment)
    }
  })

  it('refuses a run with no completed handoff before reading any projection rows', async () => {
    const missing = harness({ document: undefined, rows: undefined })
    await expect(missing.overview({ runId: RUN_ID })).rejects.toBeInstanceOf(RunNotFoundError)

    const inProgress = harness({ ...singleTestScene(), document: undefined })
    await expect(inProgress.overview({ runId: RUN_ID })).rejects.toBeInstanceOf(RunNotFoundError)
    expect(inProgress.detailRead).not.toHaveBeenCalled()
  })

  it('refuses extra input keys and an unsafe run id at the strict input contract', async () => {
    const h = harness(singleTestScene())
    await expect(h.overview({ runId: RUN_ID, testIndex: 0 })).rejects.toBeInstanceOf(FunctionInputError)
    await expect(h.overview({ runId: '../outside' })).rejects.toBeInstanceOf(FunctionInputError)
    await expect(h.overview({})).rejects.toBeInstanceOf(FunctionInputError)
    expect(h.detailRead).not.toHaveBeenCalled()
  })
})
