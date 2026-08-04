// JOBQ-06's byte-proof: the post-run chain is invisible to the verdict (Phase 388 plan 05).
//
// The requirement's own sentence is three claims — the verdict is reported and the exit code
// determined BEFORE the enqueue, an enqueue failure is surfaced but never thrown, and
// post-processing never gates the verdict or the navigation. The first two already have
// executed regressions (388-02). The third is the one this file exists for, and it is the one
// spot-checks cannot carry: `expect(exitCode).toBe(1)` passes just as happily against a tail
// that interleaved a warning through the reporter's summary block (RESEARCH Pitfall 10).
//
// So the same scenario runs TWICE — enqueue induced to fail, and not — and what is compared is
// the WHOLE captured byte sequence of each channel, the 385 D-03 logical-dump discipline
// applied to output. Three things make the comparison non-vacuous rather than a comparison of
// two empty strings:
//
//   1. The verdict-scoped output is the SHIPPED console reporter's rendering of the shipped
//      envelope fixture, through the reporter's own injected writer. Real bytes, ~2 KB of them,
//      produced by the code a user actually reads.
//   2. The tail's log is the REAL `curationTailLog` from `run.ts`, so which CHANNEL each
//      post-run line lands on is under test rather than chosen by this file. Route the D-08
//      line to `console.log` in run.ts and the stdout comparison goes red.
//   3. The two scenarios genuinely diverge after the boundary: A prints a close-out line, B
//      prints the D-07 warning. A comparison that held over identical suffixes would be
//      proving nothing; this one holds over a prefix whose suffixes differ.
//
// The tail is bound through `runVerdictFirstCurationTail` — the SAME wrapper entry both
// production sites use — so the freeze-then-enqueue ordering is the subject rather than a
// reconstruction of it.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import {
  composeLocalAgent,
  DIGEST_JOB_ID_SOURCE,
  type LocalAgentHost,
} from '@vostride/agent-qa-agent-local'
import { mapVerdictToExitCode } from '@vostride/agent-qa-runner'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import type { AuditSink } from '@vostride/agent-qa-safety'
import {
  asRunId,
  CURRENT_HANDOFF_SCHEMA_VERSION,
  type CompletedRunHandoff,
  type GuardrailPolicy,
  type PostProcessingStatus,
  type RunEventEnvelope,
  type Verdict,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { curationTailLog } from '../commands/run.js'
import { runVerdictFirstCurationTail } from '../curation/curation-tail.js'
import {
  analysisFetchCommand,
  runPostRunTail,
  type PostRunTailHostInput,
  type PostRunTailOperations,
  type RunPostRunTailOptions,
} from '../curation/post-run-tail.js'
import { createConsoleReporter } from '../reporters/console-reporter.js'
import { buildReporterFixture } from './reporters/fixtures.js'

const RUN_ID = 'run-388-05-isolation'
const EVENTS_FILE = 'events.jsonl'

// 389-04's author swap put unknown-floor members on the model path, so a throwing stub
// now aborts the chain under test. Unparseable text makes the author degrade per-test to
// the byte-identical deterministic floor (plan 04's proven posture) — chain mechanics
// keep their 388-era shape.
const TEST_MODEL: JobModelCapability = {
  modelId: 'test:post-run-exit-isolation',
  generate: async () => ({ text: 'not an author payload' }),
}

const TEST_CONFIG: ConfigReaderPort = {
  getMasked: () => Promise.resolve({
    schemaVersion: 1,
    configPath: '/tmp/post-run-exit-isolation.config.yaml',
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
    scope: { tier: 'product', key: 'isolation-storefront' },
    buildOrdinal: 5,
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

/** The run's own log as the runner left it — the emitter continues from `runFinished.finalSeq`. */
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
  vi.restoreAllMocks()
})

interface Fixture {
  agentQaRoot: string
  /** The composition every scenario uses — wrapped, never replaced, by the failure legs. */
  composeTestHost(input: PostRunTailHostInput): LocalAgentHost
  options(overrides?: Partial<PostRunTailOperations>): RunPostRunTailOptions
}

function fixture(): Fixture {
  const agentQaRoot = mkdtempSync(join(tmpdir(), 'agent-qa-388-05-'))
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
  writeFileSync(
    join(runDir, EVENTS_FILE),
    `${FIXTURE_EVENT_LINES.map((line) => JSON.stringify(line)).join('\n')}\n`,
    'utf8',
  )

  const composeTestHost = (): LocalAgentHost => {
    const host = composeLocalAgent({
      agentQaRoot,
      config: TEST_CONFIG,
      knowledgeRoot: () => knowledgeRoot,
      model: () => TEST_MODEL,
      idSource: DIGEST_JOB_ID_SOURCE,
      postRun: {
        curateRun: async () => ({ curated: 2, deprecated: 1, complete: true }),
        // True of this substitute: it returns counts without ever reaching candidate emission.
        candidateProse: 'masker-active',
      },
    })
    hosts.push(host)
    return host
  }

  return {
    agentQaRoot,
    composeTestHost,
    options(overrides: Partial<PostRunTailOperations> = {}): RunPostRunTailOptions {
      return {
        runId: RUN_ID,
        agentQaRoot,
        configPath: join(agentQaRoot, 'agent-qa.config.yaml'),
        knowledgeConfig: { dir: 'knowledge' },
        configDir: agentQaRoot,
        auditSink: {} as AuditSink,
        policy: {} as GuardrailPolicy,
        // The PRODUCTION log object, not a double. Every post-run line's channel is therefore
        // run.ts's choice and not this file's, which is what makes the stdout comparison a
        // statement about the product.
        log: curationTailLog,
        operations: {
          resolveKnowledgeRoot: () => knowledgeRoot,
          runCurationTail: async () => undefined,
          composeHost: composeTestHost,
          ...overrides,
        },
      }
    },
  }
}

/**
 * The two process channels, captured as ordered byte sequences.
 *
 * `console.log` is stdout and `console.error`/`console.warn` are stderr — Node's contract, and
 * the reason the split is meaningful here: the reporter and the CLI's navigation lines are the
 * stdout stream a `| tee` or a CI log parser consumes, and JOBQ-06 is the promise that a
 * post-run concern never appears in it.
 */
interface Channels {
  stdout: string
  stderr: string
}

function captureChannels(channels: Channels): () => void {
  const toStdout = (...args: unknown[]): void => {
    channels.stdout += `${args.map((arg) => String(arg)).join(' ')}\n`
  }
  const toStderr = (...args: unknown[]): void => {
    channels.stderr += `${args.map((arg) => String(arg)).join(' ')}\n`
  }
  const spies = [
    vi.spyOn(console, 'log').mockImplementation(toStdout),
    vi.spyOn(console, 'error').mockImplementation(toStderr),
    vi.spyOn(console, 'warn').mockImplementation(toStderr),
  ]
  return () => {
    for (const spy of spies) spy.mockRestore()
  }
}

interface Scenario {
  /** What the process would exit with. */
  exitCode: number
  /** Everything on each channel, first byte to last. */
  stdout: string
  stderr: string
  /** The same two, snapshotted the instant before the tail is entered. */
  verdictScopedStdout: string
  verdictScopedStderr: string
  /** Anything the wrapper's defensive boundary had to catch — this must stay empty (D-07). */
  unexpectedErrors: unknown[]
  /** Ordered landmarks, for the freeze-before-enqueue pin. */
  order: string[]
  /** Everything on stdout at the instant the enqueue ran. */
  stdoutAtEnqueue: string | undefined
}

/**
 * One complete run of the production shape: reporter → navigation → freeze → wrapper → tail.
 *
 * The reporter, the navigation line and the exit-code freeze happen before the snapshot; the
 * tail is CONSTRUCTED after it, so the snapshot boundary is exactly where run.ts's boundary is
 * and anything the tail does — including anything its construction does (388-02 D-3) — falls on
 * the far side of the comparison.
 */
async function runScenario(
  f: Fixture,
  input: { operations?: Partial<PostRunTailOperations>; detach?: boolean } = {},
): Promise<Scenario> {
  const channels: Channels = { stdout: '', stderr: '' }
  const order: string[] = []
  let stdoutAtEnqueue: string | undefined
  const restore = captureChannels(channels)
  try {
    // 1. The SHIPPED console reporter over the SHIPPED envelope fixture, through the reporter's
    //    own injected writer. `plain`/`isTTY:false` remove the TTY control codes so what is
    //    compared is the text a CI log holds.
    const reporterFixture = buildReporterFixture()
    const reporter = createConsoleReporter(reporterFixture.ctx, {
      plain: true,
      colorize: false,
      verbose: true,
      isTTY: false,
      write: (chunk: string) => {
        channels.stdout += chunk
      },
    })
    for (const envelope of reporterFixture.envelopes) reporter.handler(envelope)
    await reporter.flush()

    // 2. The CLI's navigation line, on the channel `printRunId` uses (pinned by source below).
    console.log(`Run ID: ${RUN_ID}`)
    order.push('verdict-output')

    // 3. The freeze — the REAL mapping, from the fixture's own aggregate verdict.
    const exitCode = mapVerdictToExitCode('failed')
    order.push('exit-code-frozen')

    const verdictScopedStdout = channels.stdout
    const verdictScopedStderr = channels.stderr

    // 4. The tail, bound exactly as both run.ts sites bind it. Each leg records the moment the
    //    WRAPPER called it — the ordering claim is about the wrapper's gates, so a landmark
    //    that vanished when a leg short-circuited would let a reorder hide behind an absence.
    const tail = runPostRunTail(f.options(input.operations))
    const unexpectedErrors: unknown[] = []
    const returned = await runVerdictFirstCurationTail({
      exitCode,
      detach: input.detach === true,
      enqueue: async () => {
        order.push('enqueue')
        stdoutAtEnqueue = channels.stdout
        await tail.enqueue()
      },
      runTail: async () => {
        order.push('drain')
        await tail.drain()
      },
      finish: async (i) => {
        order.push('finish')
        await tail.finish(i)
      },
      onUnexpectedError: (error) => {
        unexpectedErrors.push(error)
      },
    })

    return {
      exitCode: returned,
      stdout: channels.stdout,
      stderr: channels.stderr,
      verdictScopedStdout,
      verdictScopedStderr,
      unexpectedErrors,
      order,
      stdoutAtEnqueue,
    }
  } finally {
    restore()
  }
}

/** Split a captured channel into the verdict-scoped prefix and whatever the tail added. */
function tailSuffix(whole: string, prefix: string): string {
  expect(whole.startsWith(prefix)).toBe(true)
  return whole.slice(prefix.length)
}

function lines(text: string): string[] {
  return text.split('\n').filter((line) => line.length > 0)
}

/**
 * The enqueue leg, rejected inside the STORE — the truest form of "the enqueue failed".
 *
 * The real composition is WRAPPED rather than replaced: everything else about the host, the
 * queue and the handlers stays the shipped thing, so what the clean run and this run differ by
 * is one rejected call and nothing else.
 */
function rejectTheEnqueue(f: Fixture, message: string): Partial<PostRunTailOperations> {
  return {
    composeHost: (composeInput) => {
      const host = f.composeTestHost(composeInput)
      return {
        ...host,
        jobs: async () => {
          const jobs = await host.jobs()
          return {
            ...jobs,
            queue: {
              ...jobs.queue,
              enqueue: async () => {
                throw new Error(message)
              },
            },
          }
        },
      } as unknown as LocalAgentHost
    },
  }
}

/** The host itself refusing to open its store — the enqueue never reaches a queue at all. */
function rejectTheStoreOpen(f: Fixture, message: string): Partial<PostRunTailOperations> {
  return {
    composeHost: (composeInput) => ({
      ...f.composeTestHost(composeInput),
      jobs: async () => {
        throw new Error(message)
      },
    }) as unknown as LocalAgentHost,
  }
}

describe('JOBQ-06 — an induced enqueue failure is invisible to the verdict', () => {
  it('is byte-identical to the clean run in exit code and verdict-scoped output', async () => {
    const clean = await runScenario(fixture())
    const failing = fixture()
    const failed = await runScenario(failing, {
      operations: rejectTheEnqueue(failing, 'the job store rejected the hand-off'),
    })

    // The verdict-scoped output is REAL and substantial — a byte comparison of two empty
    // strings would prove nothing, so this is asserted before anything is compared to it.
    expect(clean.verdictScopedStdout.length).toBeGreaterThan(500)
    expect(clean.verdictScopedStdout).toContain('Checkout test')
    expect(clean.verdictScopedStdout).toContain(`Run ID: ${RUN_ID}`)

    // 1. The exit code. Strictly equal, and equal to the verdict's own mapping.
    expect(failed.exitCode).toBe(clean.exitCode)
    expect(clean.exitCode).toBe(mapVerdictToExitCode('failed'))

    // 2. The reporter and the navigation, WHOLE SEQUENCE. Not a line pick, not a substring:
    //    every byte either process wrote to stdout, compared as one string.
    expect(failed.stdout).toBe(clean.stdout)
    // …and the tail contributed none of them, in either scenario. This is the assertion that
    // makes the equality above load-bearing rather than a coincidence of two equal prefixes:
    // a post-run line routed to stdout appears in exactly one of the two runs.
    expect(clean.stdout).toBe(clean.verdictScopedStdout)
    expect(failed.stdout).toBe(failed.verdictScopedStdout)

    // 3. The stderr prefix — everything written before the tail — is byte-identical too.
    expect(failed.verdictScopedStderr).toBe(clean.verdictScopedStderr)

    // 4. The sole difference is one warning, and it lands strictly AFTER the boundary.
    const failedSuffix = tailSuffix(failed.stderr, failed.verdictScopedStderr)
    const cleanSuffix = tailSuffix(clean.stderr, clean.verdictScopedStderr)
    expect(lines(failedSuffix)).toHaveLength(1)
    expect(failedSuffix).toContain('the job store rejected the hand-off')
    expect(failedSuffix).toContain('the verdict and exit code are unaffected')
    expect(failed.stderr.indexOf('was not queued'))
      .toBeGreaterThanOrEqual(failed.verdictScopedStderr.length)
    // The clean run's own close-out is the other half of the divergence: the suffixes DIFFER,
    // which is why the prefix identity above is a claim and not an artefact. Since 389 D-12
    // the clean drain also prints the clustered sentence block after the close-out — the
    // in-process drain completed analyze-run, so the sentences are IN the CI output, one
    // representative per cluster, through the one `analysis.get` producer.
    const cleanLines = lines(cleanSuffix)
    expect(cleanLines[0]).toContain(`post-processing done for ${RUN_ID}`)
    expect(cleanLines[1]).toBe('analysis — 2 distinct problems:')
    expect(cleanLines).toHaveLength(4)
    expect(cleanSuffix).not.toBe(failedSuffix)

    // 5. Nothing escaped the tail. The wrapper's defensive boundary was never needed — a tail
    //    that rethrew would land here even though the exit code survived (D-07).
    expect(clean.unexpectedErrors).toEqual([])
    expect(failed.unexpectedErrors).toEqual([])
  })

  it.each([
    {
      leg: 'the handoff cannot be read',
      inject: (): Partial<PostRunTailOperations> => ({
        loadCompletedRunHandoff: () => {
          throw new Error('the handoff store is unreachable')
        },
      }),
      detail: 'the handoff store is unreachable',
    },
    {
      leg: 'the job store will not open',
      inject: (f: Fixture): Partial<PostRunTailOperations> =>
        rejectTheStoreOpen(f, 'the job store could not be opened'),
      detail: 'the job store could not be opened',
    },
    {
      leg: 'the queue rejects the hand-off',
      inject: (f: Fixture): Partial<PostRunTailOperations> =>
        rejectTheEnqueue(f, 'the job store rejected the hand-off'),
      detail: 'the job store rejected the hand-off',
    },
    {
      leg: 'the durable status read fails',
      inject: (): Partial<PostRunTailOperations> => ({
        readPostProcessingStatus: async (): Promise<PostProcessingStatus> => {
          throw new Error('the status projection could not be read')
        },
      }),
      detail: 'the status projection could not be read',
    },
  ])('warns and resolves with the frozen code when $leg', async ({ inject, detail }) => {
    const reference = await runScenario(fixture())
    const failing = fixture()
    const failed = await runScenario(failing, { operations: inject(failing) })

    expect(failed.exitCode).toBe(reference.exitCode)
    // The whole verdict-scoped sequence, unmoved by the failure.
    expect(failed.stdout).toBe(reference.stdout)
    expect(failed.stdout).toBe(failed.verdictScopedStdout)
    expect(failed.verdictScopedStderr).toBe(reference.verdictScopedStderr)
    // Warned, on stderr, after the boundary — and never thrown.
    const suffix = tailSuffix(failed.stderr, failed.verdictScopedStderr)
    expect(suffix).toContain(detail)
    expect(lines(suffix).length).toBeGreaterThanOrEqual(1)
    expect(failed.unexpectedErrors).toEqual([])
  })
})

describe('JOBQ-06 — the structural halves', () => {
  it('runs the enqueue only after the verdict output is complete and the code is frozen',
    async () => {
      const f = fixture()
      const scenario = await runScenario(f)

      // A behavioural pin, not a source grep: a wrapper that moved the enqueue past the drain,
      // or past the detach gate, reorders this list.
      expect(scenario.order).toEqual([
        'verdict-output',
        'exit-code-frozen',
        'enqueue',
        'drain',
        'finish',
      ])
      // The enqueue observed a verdict-scoped output that was already whole — and nothing was
      // appended to it afterwards, so no post-processing byte can precede a verdict byte.
      expect(scenario.stdoutAtEnqueue).toBe(scenario.verdictScopedStdout)
      expect(scenario.stdout).toBe(scenario.stdoutAtEnqueue)
      expect(scenario.exitCode).toBe(mapVerdictToExitCode('failed'))
    })

  it('still enqueues before the detach short-circuit, with the close-out on the same channel',
    async () => {
      const f = fixture()
      const scenario = await runScenario(f, { detach: true })

      // D-03 under the final plan-04 tail shape: the enqueue and the close-out both run; the
      // drain does not.
      expect(scenario.order).toEqual(['verdict-output', 'exit-code-frozen', 'enqueue', 'finish'])
      expect(scenario.stdout).toBe(scenario.verdictScopedStdout)
      expect(scenario.exitCode).toBe(mapVerdictToExitCode('failed'))
      expect(scenario.unexpectedErrors).toEqual([])
      const suffix = tailSuffix(scenario.stderr, scenario.verdictScopedStderr)
      expect(lines(suffix)).toEqual([
        'post-processing — analysis: pending · curation: pending · issues: reserved'
        // 389 D-12: nothing drained under --detach, so the line carries the fetch command.
        + ` · sentences: ${analysisFetchCommand(RUN_ID)}`,
      ])
    })

  it('routes both run.ts tail sites through the one helper and no legacy per-site tail', () => {
    const source = readFileSync(
      new URL('../commands/run.ts', import.meta.url),
      'utf8',
    )
    // Pitfall 1's regression pin: two sites, one helper, three legs each.
    expect(source.match(/runPostRunTail\(/gu) ?? []).toHaveLength(2)
    expect(source.match(/runVerdictFirstCurationTail\(/gu) ?? []).toHaveLength(2)
    expect(source.match(/postRunTail\.enqueue\(\)/gu) ?? []).toHaveLength(2)
    expect(source.match(/postRunTail\.drain\(\)/gu) ?? []).toHaveLength(2)
    expect(source.match(/postRunTail\.finish\(/gu) ?? []).toHaveLength(2)
    // The v51 per-site tail is named at neither site any more (388-02's extraction).
    expect(source.match(/runCurationTail\(/gu) ?? []).toHaveLength(0)
    // …and the navigation line this file mirrors is on stdout, where the tail never writes.
    expect(source).toContain('console.log(`Run ID: ${runId}`)')
  })
})
