// The daemon's production runs.start child boundary (Phase 386, Plan 08).
//
// This file has two jobs. Vitest loads it as the acceptance test; the production daemon
// launches the same file as a REAL Node child through its injected cliEntry fixture seam. The
// child writes the durable run facts through the shipped stores, so the daemon composition must
// discover them from disk exactly as it would after the real CLI completed. No run executor or
// child launcher is injected into the host.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import type {
  CompletedRunHandoff,
  ExecutionContext,
  RunEventEnvelope,
  RunId,
} from '@vostride/agent-qa-schema'
import type { DaemonHostOperations } from '../daemon/host.js'

const FIXTURE_ENTRY = fileURLToPath(import.meta.url)
const FIXTURE_STDERR = 'daemon run child fixture completed'

// Keep this list pinned to safety-local's recognized environment markers. The test clears the
// complete ambient marker set for the headless branch, then restores every original value.
const RECOGNIZED_CI_MARKERS = [
  'CI',
  'GITHUB_ACTIONS',
  'GITLAB_CI',
  'CIRCLECI',
  'BUILDKITE',
  'JENKINS_URL',
  'TRAVIS',
  'APPVEYOR',
  'TF_BUILD',
  'CODEBUILD_BUILD_ID',
  'DRONE',
  'SEMAPHORE',
  'BITBUCKET_BUILD_NUMBER',
  'TEAMCITY_VERSION',
] as const

interface ChildReport {
  readonly argv: readonly string[]
  readonly runId: string
  readonly configPath: string
  readonly patterns: readonly string[]
  readonly stdinIsTty: boolean
  readonly stdoutIsTty: boolean
  readonly executionContext: ExecutionContext
  readonly githubActions: string | null
}

function isDirectRunChild(): boolean {
  return process.env.AGENT_QA_RUN_ID !== undefined
    && process.argv[1] !== undefined
    && resolve(process.argv[1]) === resolve(FIXTURE_ENTRY)
}

function requiredArg(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (value === undefined || value.length === 0) {
    throw new Error(`daemon run child fixture requires ${name}`)
  }
  return value
}

async function runDirectChild(): Promise<void> {
  const [runnerLocal, schema, safetyLocal] = await Promise.all([
    import('@vostride/agent-qa-runner-local'),
    import('@vostride/agent-qa-schema'),
    import('@vostride/agent-qa-safety-local'),
  ])
  const runId = process.env.AGENT_QA_RUN_ID
  if (runId === undefined || runId.length === 0) {
    throw new Error('daemon run child fixture requires AGENT_QA_RUN_ID')
  }
  const configPath = requiredArg('--config')
  const runIndex = process.argv.indexOf('run')
  const separatorIndex = process.argv.indexOf('--')
  if (runIndex === -1 || separatorIndex < runIndex) {
    throw new Error('daemon run child fixture requires `run -- [patterns]` argv')
  }
  const patterns = process.argv.slice(separatorIndex + 1)
  const executionContext = safetyLocal.detectExecutionContext()
  const runtimeRoot = join(dirname(configPath), '.agent-qa')

  const log = new runnerLocal.FsEventLog({ root: runtimeRoot, runId })
  const events: RunEventEnvelope[] = [
    { seq: 1, ts: 1_700_000_000_001, runId, type: 'runStarted', payload: {} },
    { seq: 2, ts: 1_700_000_000_002, runId, type: 'testStarted', payload: {} },
    { seq: 3, ts: 1_700_000_000_003, runId, type: 'testFinished', payload: {} },
    { seq: 4, ts: 1_700_000_000_004, runId, type: 'runFinished', payload: {} },
  ] as RunEventEnvelope[]
  for (const event of events) log.append(event)

  const handoff: CompletedRunHandoff = {
    schemaVersion: schema.CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: runId as RunId,
    scope: { tier: 'product', key: 'daemon-child' },
    buildOrdinal: 8,
    executionContext,
    aggregateVerdict: 'passed',
    configDigests: {
      suiteConfigDigest: 'daemon-child-suite',
      testConfigDigest: 'daemon-child-test',
    },
    startedAt: 1_700_000_000_001,
    endedAt: 1_700_000_000_004,
    tests: [{
      testId: 'daemon-child-test',
      testName: 'daemon child durable run',
      filePath: patterns[0] ?? 'tests/default.yaml',
      testIndex: 0,
      outcome: 'passed',
      steps: [],
    }] as CompletedRunHandoff['tests'],
  }
  new runnerLocal.FsHandoffStore({ root: runtimeRoot, runId }).save(handoff)

  const report: ChildReport = {
    argv: process.argv.slice(2),
    runId,
    configPath,
    patterns,
    stdinIsTty: Boolean(process.stdin.isTTY),
    stdoutIsTty: Boolean(process.stdout.isTTY),
    executionContext,
    githubActions: process.env.GITHUB_ACTIONS ?? null,
  }
  process.stdout.write(`${JSON.stringify(report)}\n`)
  process.stderr.write(`${FIXTURE_STDERR}\n`)
}

if (isDirectRunChild()) {
  await runDirectChild()
} else {
  const [vitest, hostModule, clientModule, eventsModule, runnerLocal] = await Promise.all([
    import('vitest'),
    import('../daemon/host.js'),
    import('../daemon/client.js'),
    import('../daemon/events.js'),
    import('@vostride/agent-qa-runner-local'),
  ])
  const { afterEach, describe, expect, it, vi } = vitest
  const { runDaemonHost } = hostModule
  const { invokeViaDaemon } = clientModule
  const { DAEMON_EVENTS_FILE } = eventsModule
  const { slugBranch } = runnerLocal

  const temporaryRoots: string[] = []

  interface FixturePaths {
    readonly root: string
    readonly agentQaRoot: string
    readonly knowledgeRoot: string
    readonly configPath: string
  }

  function fixturePaths(): FixturePaths {
    const root = mkdtempSync(join(tmpdir(), 'agent-qa-daemon-run-child-'))
    temporaryRoots.push(root)
    const configPath = join(root, 'agent-qa.config.yaml')
    writeFileSync(configPath, '{}\n', 'utf8')
    return {
      root,
      agentQaRoot: join(root, '.agent-qa'),
      knowledgeRoot: join(root, 'agent-qa-knowledge'),
      configPath,
    }
  }

  const TEST_MODEL: JobModelCapability = {
    modelId: 'test:daemon-run-child',
    generate: () => Promise.resolve({ text: 'unused' }),
  }

  function testConfig(configPath: string): ConfigReaderPort {
    return {
      getMasked: () => Promise.resolve({
        schemaVersion: 1,
        configPath,
        entries: [],
      }),
    }
  }

  function signalHarness(): {
    readonly operations: Partial<DaemonHostOperations>
    signal(signal: NodeJS.Signals): void
  } {
    const listeners = new Map<NodeJS.Signals, () => void>()
    return {
      operations: {
        setInterval: (_callback, intervalMs) => (
          intervalMs as unknown as ReturnType<typeof setInterval>
        ),
        clearInterval: () => undefined,
        onSignal: (signal, listener) => listeners.set(signal, listener),
        offSignal: (signal, listener) => {
          if (listeners.get(signal) === listener) listeners.delete(signal)
        },
        hardExit: (code) => {
          throw new Error(`unexpected daemon hard exit ${code}`)
        },
      },
      signal(signal) {
        const listener = listeners.get(signal)
        if (listener === undefined) throw new Error(`${signal} listener was not installed`)
        listener()
      },
    }
  }

  async function waitUntil(
    predicate: () => boolean,
    message: string,
    timeoutMs = 30_000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!predicate()) {
      if (Date.now() >= deadline) throw new Error(message)
      await new Promise((resolveWait) => setTimeout(resolveWait, 10))
    }
  }

  function readChildReport(path: string): ChildReport {
    return JSON.parse(readFileSync(path, 'utf8').trim()) as ChildReport
  }

  function readDaemonEvents(agentQaRoot: string): Array<Record<string, unknown>> {
    return readFileSync(join(agentQaRoot, DAEMON_EVENTS_FILE), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  function saveAmbientMarkers(): Map<string, string | undefined> {
    return new Map(RECOGNIZED_CI_MARKERS.map((name) => [name, process.env[name]]))
  }

  function clearAmbientMarkers(): void {
    for (const name of RECOGNIZED_CI_MARKERS) delete process.env[name]
  }

  function restoreAmbientMarkers(saved: ReadonlyMap<string, string | undefined>): void {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }

  afterEach(() => {
    vi.restoreAllMocks()
    for (const root of temporaryRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  describe('daemon runs.start real child boundary', () => {
    it('captures a piped child, preserves ambient context markers, and acknowledges durable facts', async () => {
      const paths = fixturePaths()
      const signals = signalHarness()
      let started = false
      const hostErrors: string[] = []
      const running = runDaemonHost({
        agentQaRoot: paths.agentQaRoot,
        knowledgeRoot: paths.knowledgeRoot,
        configPath: paths.configPath,
        cliEntry: FIXTURE_ENTRY,
        config: testConfig(paths.configPath),
        model: () => TEST_MODEL,
        operations: signals.operations,
        logger: {
          info: () => { started = true },
          error: (message) => hostErrors.push(message),
        },
      })
      await waitUntil(() => started, 'daemon did not finish starting')

      const savedMarkers = saveAmbientMarkers()
      const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      let headless: unknown
      let ci: unknown
      try {
        clearAmbientMarkers()
        headless = await invokeViaDaemon({
          agentQaRoot: paths.agentQaRoot,
          functionId: 'runs.start',
          input: { patterns: ['tests/headless.yaml'] },
        })
        process.env.GITHUB_ACTIONS = '1'
        ci = await invokeViaDaemon({
          agentQaRoot: paths.agentQaRoot,
          functionId: 'runs.start',
          input: { patterns: ['tests/ci.yaml'] },
        })
        expect(stdoutWrite).not.toHaveBeenCalled()
      } finally {
        stdoutWrite.mockRestore()
        restoreAmbientMarkers(savedMarkers)
      }

      const acknowledgements = [
        { value: headless, expectedContext: 'local-headless', pattern: 'tests/headless.yaml' },
        { value: ci, expectedContext: 'ci', pattern: 'tests/ci.yaml' },
      ] as const

      for (const { value, expectedContext, pattern } of acknowledgements) {
        expect(value).toMatchObject({
          scope: { tier: 'product', key: 'daemon-child' },
          executionContext: expectedContext,
          buildOrdinal: 8,
          startedAt: 1_700_000_000_001,
          testCount: 1,
        })
        const runId = (value as { runId: string }).runId
        const runDir = join(paths.agentQaRoot, 'runs', slugBranch(runId))
        const report = readChildReport(join(runDir, 'run-child.stdout.log'))
        expect(report).toEqual({
          argv: ['--config', paths.configPath, 'run', '--', pattern],
          runId,
          configPath: paths.configPath,
          patterns: [pattern],
          stdinIsTty: false,
          stdoutIsTty: false,
          executionContext: expectedContext,
          githubActions: expectedContext === 'ci' ? '1' : null,
        })
        expect(readFileSync(join(runDir, 'run-child.stderr.log'), 'utf8'))
          .toBe(`${FIXTURE_STDERR}\n`)
        expect(readFileSync(join(runDir, 'events.jsonl'), 'utf8').trim().split('\n'))
          .toHaveLength(4)
        expect(JSON.parse(readFileSync(join(runDir, 'handoff.json'), 'utf8')))
          .toMatchObject({ runId, executionContext: expectedContext, aggregateVerdict: 'passed' })
      }

      const runIds = acknowledgements.map(({ value }) => (value as { runId: string }).runId)
      const childExitEvents = readDaemonEvents(paths.agentQaRoot)
        .filter((event) => event.kind === 'run-child-exit')
      expect(childExitEvents).toHaveLength(2)
      for (const [index, event] of childExitEvents.entries()) {
        expect(event).toEqual({
          ts: expect.any(String),
          kind: 'run-child-exit',
          runId: runIds[index],
          exitCode: 0,
        })
        expect(event).not.toHaveProperty('stdout')
        expect(event).not.toHaveProperty('stderr')
      }
      expect(hostErrors).toEqual([])

      signals.signal('SIGTERM')
      await expect(running).resolves.toBe(0)
    })
  })
}
