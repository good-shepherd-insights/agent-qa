// Phase 431 plan 02 (D-03/D-06, T-431-05): OVERVIEW-COLD-SCOPE.
//
// `runs.overview` returns stored text — test names, step labels and served record summaries — so a
// cold host must open the same read scope the other stored-text reads use and mask this project's
// declared secrets with it. Without that scope the op falls to its no-context arm and every label
// is the display marker, which is the difference the masked cell below measures. `runs.list`
// carries the same stored test names and joined the scope in the 431 code review.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invokeFunction } from '@vostride/agent-qa-agent'
import { setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import { ambientMaskingContextResolver } from '@vostride/agent-qa-safety-local'
import { FsHandoffStore } from '@vostride/agent-qa-runner-local'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION,
  RunOverviewProjectionSchema,
  RunsListOutputSchema,
  maskedMarker,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  FunctionCaller,
  RunDetailRows,
  RunId,
  RunOverviewProjection,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COLD_READ_SCOPE_FUNCTION_IDS, composeLocalAgent } from '../compose-local-agent.js'

const RUN_ID = 'run-431-overview-cold'
const SENTINEL = 'T431-overview-cold-sentinel-not-a-real-credential'
const REDACTED = maskedMarker('secret')

const READER: FunctionCaller = {
  surface: 'test',
  grantedScopes: ['read'],
  safeMode: false,
  origin: 'agent',
}

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-qa-431-overview-cold-'))
  setActiveMaskingContextResolver(ambientMaskingContextResolver)
  const handoff: CompletedRunHandoff = {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: RUN_ID as RunId,
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: 3,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 10,
    endedAt: 20,
    tests: [{
      testId: 'test-login',
      testName: `Login as ${SENTINEL}`,
      filePath: 'tests/login.yaml',
      testIndex: 0,
      outcome: 'failed',
      steps: [{
        stepIndex: 0,
        stepText: `Type ${SENTINEL} into the password field`,
        cacheStatus: 'miss',
        servedBrief: {
          scope: { tier: 'product', key: 'shop' },
          asOfBuild: 3,
          budget: 400,
          truncation: '',
          channel1: [{ id: 'rec-login' as never, kind: 'fact', summary: `password is ${SENTINEL}`,
            trust: 0.5, status: 'active', servedAsCanary: false, tier: 'context' }],
          channel2: [],
          channel3: [],
          briefDigest: 'brief-0',
        },
        subActions: [],
        verifierVerdict: { pass: false, reasoning: 'recorded reasoning' },
      }],
    }],
  }
  new FsHandoffStore({ root: join(root, '.agent-qa'), runId: RUN_ID }).save(handoff)
})

afterEach(() => {
  setActiveMaskingContextResolver(() => undefined)
  rmSync(root, { recursive: true, force: true })
})

const rows: RunDetailRows = {
  runId: RUN_ID,
  members: [{ testIndex: 0, testId: 'test-login', attempts: 1 }],
  steps: [{ testIndex: 0, stepIndex: 0, stepText: `Type ${SENTINEL} into the password field`,
    cacheStatus: 'miss', verifierVerdict: { pass: false, reasoning: 'recorded reasoning' },
    selfHealOccurred: false, briefDigest: 'brief-0', status: 'failed' }],
  subActions: [],
}

function host(sources?: () => Promise<unknown>) {
  return composeLocalAgent({
    agentQaRoot: join(root, '.agent-qa'),
    mintQuarantineIdentityPath: (path) => path,
    config: { getMasked: async () => ({ schemaVersion: 1, configPath: 'agent-qa.config.yaml', entries: [] }) },
    knowledgeRoot: () => join(root, 'knowledge'),
    model: () => { throw new Error('an overview read must not resolve a model') },
    resolveExecutionContext: () => 'local-headless',
    runDetail: { read: async () => rows },
    ...(sources === undefined ? {} : {
      readMaskingSources: sources as NonNullable<Parameters<typeof composeLocalAgent>[0]['readMaskingSources']>,
    }),
  })
}

const declared = () => Promise.resolve({
  secretsContent: `OVERVIEW_PASSWORD=${SENTINEL}\n`,
  secretStores: [],
  env: {},
})

async function overviewThrough(composed: ReturnType<typeof host>): Promise<RunOverviewProjection> {
  return RunOverviewProjectionSchema.parse(
    await invokeFunction(composed.registry, 'runs.overview', { runId: RUN_ID }, READER))
}

function storedText(overview: RunOverviewProjection) {
  const [test] = overview.tests
  const [step] = test?.steps ?? []
  const records = step?.knowledge.state === 'recorded' ? step.knowledge.records : []
  return { name: test?.name.text, label: step?.label?.text, summary: records[0]?.summary?.text }
}

describe('OVERVIEW-COLD-SCOPE: runs.overview reads stored text under the cold read scope', () => {
  it('pins the cold read-scope allowlist to exactly seven stored-text reads', () => {
    expect([...COLD_READ_SCOPE_FUNCTION_IDS]).toEqual([
      'runs.postprocessing', 'runs.knowledge', 'runs.evidence', 'runs.marks.history',
      'runs.mark.preview', 'runs.overview', 'runs.list',
    ])
  })

  it('masks declared secrets in the cold overview and keeps the rest readable', async () => {
    const composed = host(declared)
    try {
      const overview = await overviewThrough(composed)
      expect(storedText(overview)).toEqual({
        name: `Login as ${REDACTED}`,
        label: `Type ${REDACTED} into the password field`,
        summary: `password is ${REDACTED}`,
      })
      expect(JSON.stringify(overview)).not.toContain(SENTINEL)
    } finally {
      await composed.close()
    }
  })

  it('opens the scope for the overview and not for an unrelated read', async () => {
    const sources = vi.fn(declared)
    const composed = host(sources)
    try {
      await invokeFunction(composed.registry, 'runs.detail', { runId: RUN_ID }, READER)
      expect(sources).not.toHaveBeenCalled()
      await overviewThrough(composed)
      expect(sources).toHaveBeenCalledTimes(1)
    } finally {
      await composed.close()
    }
  })

  it('masks the run list test names and never matches the title filter on a masked span', async () => {
    const listed = async (composed: ReturnType<typeof host>, input: Record<string, unknown>) =>
      RunsListOutputSchema.parse(await invokeFunction(composed.registry, 'runs.list', input, READER))
    const composed = host(declared)
    try {
      const rows = await listed(composed, {})
      expect(rows.map((row) => row.tests.map((test) => test.testName))).toEqual([[`Login as ${REDACTED}`]])
      expect(JSON.stringify(rows)).not.toContain(SENTINEL)
      expect(await listed(composed, { test: SENTINEL.slice(0, 12) })).toEqual([])
      expect((await listed(composed, { test: 'login as' })).map((row) => row.runId)).toEqual([RUN_ID])
    } finally {
      await composed.close()
    }
    const cold = host()
    try {
      const rows = await listed(cold, {})
      expect(rows.map((row) => row.tests.map((test) => test.testName))).toEqual([[REDACTED]])
      expect(await listed(cold, { test: 'login' })).toEqual([])
      expect((await listed(cold, { test: 'test-login' })).map((row) => row.runId)).toEqual([RUN_ID])
    } finally {
      await cold.close()
    }
  })

  it('falls to the no-context marker, never cleartext, on a host with no masking sources', async () => {
    const composed = host()
    try {
      const overview = await overviewThrough(composed)
      expect(storedText(overview)).toEqual({ name: REDACTED, label: REDACTED, summary: REDACTED })
      expect(JSON.stringify(overview)).not.toContain(SENTINEL)
    } finally {
      await composed.close()
    }
  })
})
