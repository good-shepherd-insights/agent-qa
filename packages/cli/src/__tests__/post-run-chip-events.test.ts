// The chip trail an in-process drain leaves behind (Phase 388 plan 04, D-13 / D-16).
//
// Driven through the REAL tail against a real sqlite store, a real handoff and the real handler
// bodies, because the claim is about what a finished run's `events.jsonl` CONTAINS after the
// chain ran — and a fake pump would let the emitter agree with a story nothing durable told.
// The events file is written by hand as a three-line fixture rather than by a real run: what
// matters to the seq claim is only that a log with a `runFinished` at `finalSeq` exists, and
// standing a whole runner up to produce one would put the runner between this proof and its
// subject.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import {
  composeLocalAgent,
  DIGEST_JOB_ID_SOURCE,
  type LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import type { AuditSink } from '@vostride/agent-qa-safety'
import {
  asRunId,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  type CompletedRunHandoff,
  type GuardrailPolicy,
  type RunEventEnvelope,
  type Verdict,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  runPostRunTail,
  type PostRunTailOperations,
  type RunPostRunTailOptions,
} from '../curation/post-run-tail.js'

const RUN_ID = 'run-388-04-chips'
const EVENTS_FILE = 'events.jsonl'

const TEST_MODEL: JobModelCapability = {
  modelId: 'test:post-run-chip-events',
  generate: () => {
    throw new Error('the post-run chain never authors in 388')
  },
}

const TEST_CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/post-run-chip-events.config.yaml',
    entries: [],
  }),
}

const PERSISTED_ROOT_CAUSE: Verdict = {
  class: 'timeout',
  producer: 'deterministic-classifier',
  confidence: 1,
  evidence: {
    citedSteps: [0],
    citedAnchors: [],
    citedArtifacts: [],
    rationale: 'member outcome timeout',
  },
  memoryMisdirectionRuledOut: true,
  perTest: 0,
}

function fixtureHandoff(runId: string): CompletedRunHandoff {
  return {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: asRunId(runId),
    scope: { tier: 'product', key: 'chips-storefront' },
    buildOrdinal: 4,
    executionContext: 'local-headless',
    aggregateVerdict: 'failed',
    configDigests: { suiteConfigDigest: 'suite-digest', testConfigDigest: 'test-digest' },
    startedAt: 1,
    endedAt: 2,
    tests: [
      {
        testId: 't_classified',
        testName: 'member the classifier reached',
        filePath: 'tests/classified.yaml',
        testIndex: 0,
        outcome: 'timeout',
        steps: [],
        rootCause: PERSISTED_ROOT_CAUSE,
      },
      {
        testId: 't_unclassified',
        testName: 'member the classifier declined',
        filePath: 'tests/unclassified.yaml',
        testIndex: 1,
        outcome: 'failed',
        steps: [],
      },
    ],
  }
}

/**
 * The run's own log as the runner left it: `runFinished` last, `finalSeq` its own seq.
 *
 * Three lines, and the third one is the whole point — every chip envelope the emitter appends
 * has to continue from THIS number, not from one the emitter chose.
 */
const FIXTURE_EVENT_LINES = [
  { seq: 1, ts: 10, runId: RUN_ID, type: 'runStarted', payload: { busSchemaVersion: 1 } },
  { seq: 2, ts: 20, runId: RUN_ID, type: 'verdict', payload: { verdict: 'failed' } },
  {
    seq: 3,
    ts: 30,
    runId: RUN_ID,
    type: 'runFinished',
    payload: { aggregateVerdict: 'failed', disposition: 'detached', finalSeq: 3 },
  },
] as unknown as RunEventEnvelope[]

const roots: string[] = []
const hosts: LocalAgentHost[] = []

afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Fixture {
  agentQaRoot: string
  eventsPath: string
  warn: ReturnType<typeof vi.fn>
  info: ReturnType<typeof vi.fn>
  options(overrides?: Partial<PostRunTailOperations>): RunPostRunTailOptions
}

function fixture(behaviour: {
  curateRun?: () => Promise<{ curated: number; deprecated: number }>
} = {}): Fixture {
  const agentQaRoot = mkdtempSync(join(tmpdir(), 'agent-qa-388-04-'))
  roots.push(agentQaRoot)
  const knowledgeRoot = join(agentQaRoot, 'knowledge')
  mkdirSync(knowledgeRoot, { recursive: true })

  const runDir = join(agentQaRoot, RUNS_SUBDIR, slugBranch(RUN_ID))
  mkdirSync(runDir, { recursive: true })
  writeFileSync(
    join(runDir, HANDOFF_FILE),
    `${JSON.stringify(fixtureHandoff(RUN_ID))}\n`,
    'utf8',
  )
  const eventsPath = join(runDir, EVENTS_FILE)
  writeFileSync(
    eventsPath,
    `${FIXTURE_EVENT_LINES.map((line) => JSON.stringify(line)).join('\n')}\n`,
    'utf8',
  )

  const warn = vi.fn<(message: string) => void>()
  const info = vi.fn<(message: string) => void>()

  return {
    agentQaRoot,
    eventsPath,
    warn,
    info,
    options(overrides: Partial<PostRunTailOperations> = {}): RunPostRunTailOptions {
      return {
        runId: RUN_ID,
        agentQaRoot,
        configPath: join(agentQaRoot, 'agent-qa.config.yaml'),
        knowledgeConfig: { dir: 'knowledge' },
        configDir: agentQaRoot,
        auditSink: {} as AuditSink,
        policy: {} as GuardrailPolicy,
        log: {
          warn: (message: string) => warn(message),
          info: (message: string) => info(message),
        },
        operations: {
          resolveKnowledgeRoot: () => knowledgeRoot,
          runCurationTail: async () => undefined,
          composeHost: () => {
            const host = composeLocalAgent({
              agentQaRoot,
              config: TEST_CONFIG,
              knowledgeRoot: () => knowledgeRoot,
              model: () => TEST_MODEL,
              idSource: DIGEST_JOB_ID_SOURCE,
              postRun: {
                curateRun: behaviour.curateRun
                  ?? (async () => ({ curated: 2, deprecated: 1 })),
              },
            })
            hosts.push(host)
            return host
          },
          ...overrides,
        },
      }
    },
  }
}

function readEvents(eventsPath: string): RunEventEnvelope[] {
  return readFileSync(eventsPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RunEventEnvelope)
}

const FIXTURE_BYTES = `${FIXTURE_EVENT_LINES.map((line) => JSON.stringify(line)).join('\n')}\n`

describe('the post-run chip emitter (ANLZ-05, D-13/D-16)', () => {
  it('continues the run log seq and appends one pair per drained stage', async () => {
    const f = fixture()
    const tail = runPostRunTail(f.options())
    await tail.enqueue()
    await tail.drain()

    expect(tail.report().drain).toBe('drained')
    const events = readEvents(f.eventsPath)
    // The run's own three lines are untouched, byte for byte.
    expect(readFileSync(f.eventsPath, 'utf8').startsWith(FIXTURE_BYTES)).toBe(true)

    const appended = events.slice(FIXTURE_EVENT_LINES.length)
    expect(appended.map((event) => event.type)).toEqual([
      'analysisStarted',
      'analysisCompleted',
      'curationStarted',
      'curationCompleted',
    ])
    // Gapless continuation from `runFinished.finalSeq`, in append order.
    expect(appended.map((event) => event.seq)).toEqual([4, 5, 6, 7])
    for (const event of appended) {
      expect(event.runId).toBe(RUN_ID)
      expect(event.payload).toEqual({ runId: RUN_ID })
      expect(typeof event.ts).toBe('number')
    }
  })

  it('emits no issues chip at all while the triage slot is unfilled (D-15)', async () => {
    const f = fixture()
    const tail = runPostRunTail(f.options())
    await tail.enqueue()
    await tail.drain()

    const types = readEvents(f.eventsPath).map((event) => event.type)
    expect(types.filter((type) => type.startsWith('issues'))).toEqual([])
    // `notify` is a function-layer emission and not a chip: no envelope claims it either.
    expect(types.filter((type) => type.toLowerCase().includes('notif'))).toEqual([])
  })

  it('appends NOTHING when the chain is handed to the daemon (D-13)', async () => {
    const f = fixture()
    const tail = runPostRunTail(f.options({
      acquireWriterLease: () => ({ kind: 'held', holder: { pid: 4242 } }),
      nudgeDaemon: async () => undefined,
    } as unknown as Partial<PostRunTailOperations>))
    await tail.enqueue()
    await tail.drain()

    expect(tail.report().drain).toBe('handed-off')
    expect(readFileSync(f.eventsPath, 'utf8')).toBe(FIXTURE_BYTES)
  })

  it('appends nothing when the drain leg never runs (--detach)', async () => {
    const f = fixture()
    const tail = runPostRunTail(f.options())
    await tail.enqueue()
    // `runVerdictFirstCurationTail` short-circuits before `drain()` under --detach.

    expect(tail.report().drain).toBe('not-attempted')
    expect(readFileSync(f.eventsPath, 'utf8')).toBe(FIXTURE_BYTES)
  })

  it('reports a stage that failed from its OWN observed outcome, never from the next one',
    async () => {
      const f = fixture({
        curateRun: async () => {
          throw new Error('the curation fold could not open the knowledge root')
        },
      })
      const tail = runPostRunTail(f.options())
      await tail.enqueue()
      await tail.drain()

      const appended = readEvents(f.eventsPath).slice(FIXTURE_EVENT_LINES.length)
      expect(appended.map((event) => event.type)).toEqual([
        'analysisStarted',
        'analysisCompleted',
        'curationStarted',
        'curationFailed',
      ])
      const failure = appended.at(-1)!.payload as { runId: string; error?: string; willRetry?: boolean }
      expect(failure.runId).toBe(RUN_ID)
      expect(failure.error).toContain('knowledge root')
      // The disposition is the ONLY source for this field — a retry-scheduled stage says so,
      // a permanently failed one does not claim a retry nobody scheduled.
      expect(failure.willRetry).toBe(tail.report().drain === 'retry-scheduled')
    })

  it('rides a direct append and never the run bus (D-16)', () => {
    const source = readFileSync(
      new URL('../curation/post-run-chip-emitter.ts', import.meta.url),
      'utf8',
    )
    // Anchored at the start of a line and on `import`/`}` so a rationale comment naming a
    // module is not scanned as one (the 388-02 specifier-extractor hazard, in miniature).
    const specifiers = [...source.matchAll(/^(?:import .*|\})\s*from '([^']+)'/gmu)]
      .map((match) => match[1]!)
      .sort()
    // The bus, its subscribers and the runner's event-log port are all flushed and closed by
    // the time this file runs. Reaching any of them would be reaching a producer that is gone.
    expect(specifiers).toEqual([
      './curation-tail.js',
      '@vostride/agent-qa-schema',
      'node:fs',
    ])
    // …and the append itself is the raw `FsEventLog` discipline, stated once.
    expect(source.match(/appendFileSync\(/gu) ?? []).toHaveLength(1)
  })
})
