import pc from 'picocolors'
import { unmaskForHumanOutput } from '@vostride/agent-qa-safety'
import type { MaskingContext } from '@vostride/agent-qa-schema'
import type {
  HookFinishedPayload,
  HookStartedPayload,
  RunEventEnvelope,
  RunFinishedPayload,
  RunStartedPayload,
  StepFinalizedPayload,
  StepStartedPayload,
  TestFinishedPayload,
  TestRetryScheduledPayload,
  TestStartedPayload,
} from '@vostride/agent-qa-schema'

export function humanDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${milliseconds}ms`
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds}s`
}

const CLEAR_LINE = '\x1B[2K\r'

export interface ConsoleReporterOptions {
  verbose?: boolean
  colorize?: boolean
  plain?: boolean
  logLevel?: string
  /** Injectable write target — every human write flows through here after unmasking. */
  write?: (chunk: string) => void
  /** Test seam: override TTY detection (defaults to process.stdout.isTTY). */
  isTTY?: boolean
  columns?: number
}

/**
 * The reporter handle every subscriber factory returns. `handler` is attached to the run
 * session bus; `flush` is awaited by the CLI after `session.done`; `pauseLive`/`resumeLive`
 * are the Pitfall-4 coordination seam the Plan 09 confirm decorator uses to clear the live
 * TTY line before a readline prompt.
 */
export interface ConsoleReporterHandle {
  handler: (envelope: RunEventEnvelope) => void
  flush: () => Promise<void>
  pauseLive: () => void
  resumeLive: () => void
}

interface TestMeta {
  name: string
  filePath: string
}

/**
 * `createConsoleReporter` — the bus-subscriber successor to core's `ConsoleReporter`
 * (D-01/D-03). Pure accumulation from typed envelopes (D-04, replay-equivalent). Every
 * stdout write composes its final string from MASKED payload data, then calls
 * `unmaskForHumanOutput(ctx, finalString)` exactly ONCE immediately before the write
 * (D-09/D-10) — the injected `ctx` is the only unmasking authority (never the ambient
 * resolver). The human terminal is the sole unmasking surface in the phase.
 */
export function createConsoleReporter(
  ctx: MaskingContext,
  options: ConsoleReporterOptions = {},
): ConsoleReporterHandle {
  const verbose = options.verbose ?? false
  const isTTY = options.isTTY ?? process.stdout.isTTY === true
  const plain = options.plain ?? (!isTTY || process.env.CI === 'true')
  const colorize = plain ? false : (options.colorize ?? true)
  const canOverwrite = !plain && isTTY && options.logLevel !== 'debug'
  const sink = options.write ?? ((chunk: string) => void process.stdout.write(chunk))

  // The single unmask-then-write chokepoint (SEAM-05). No payload-derived string may
  // reach the sink except through here.
  function emit(finalMasked: string): void {
    sink(unmaskForHumanOutput(ctx, finalMasked))
  }

  let livePaused = false
  let lastWriteLen = 0

  function stripAnsi(text: string): string {
    return text.replace(/\x1B\[[0-9;]*m/g, '')
  }

  function transient(text: string): void {
    if (!canOverwrite || livePaused) return
    emit(CLEAR_LINE + text)
    lastWriteLen = stripAnsi(text).length
  }

  function println(text: string): void {
    if (canOverwrite && !livePaused) {
      emit(CLEAR_LINE + text + '\n')
      lastWriteLen = 0
    } else {
      emit(text + '\n')
    }
  }

  function c(fn: (s: string) => string, text: string): string {
    return colorize ? fn(text) : text
  }

  // --- accumulation state (D-04) ---------------------------------------------
  let memberTestCount = 0
  let currentSuiteId: string | undefined
  let sawSuite = false

  // aggregate step tallies (flushed from per-test buckets at testFinished)
  let stepsPassed = 0
  let stepsFailed = 0
  let stepsSkipped = 0
  let cacheHits = 0
  let cacheMisses = 0

  // per-test buckets (reset on testStarted and testRetryScheduled)
  let ptPassed = 0
  let ptFailed = 0
  let ptSkipped = 0

  // test-level tallies
  let testsPassed = 0
  let testsFailed = 0
  let testsSkipped = 0
  let totalDurationMs = 0

  const stepTextByIndex = new Map<number, string>()
  const testMeta = new Map<number, TestMeta>()
  const failedTests: { name: string; failureSummary?: string }[] = []
  const hookPhaseStarted = new Set<string>()

  function resetPerTest(): void {
    ptPassed = 0
    ptFailed = 0
    ptSkipped = 0
    stepTextByIndex.clear()
    hookPhaseStarted.clear()
  }

  function statusIcon(status: string | undefined): string {
    if (plain) {
      switch (status) {
        case 'passed':
        case 'healed':
          return 'ok'
        case 'failed':
          return 'x'
        case 'skipped':
        case 'cancelled':
          return 'skipped'
        default:
          return '-'
      }
    }
    switch (status) {
      case 'passed':
        return c(pc.green, '✓')
      case 'healed':
        return c(pc.yellow, '✓')
      case 'failed':
        return c(pc.red, '✗')
      case 'skipped':
      case 'cancelled':
        return c(pc.dim, '○')
      default:
        return ' '
    }
  }

  function testBadge(status: 'running' | 'passed' | 'failed'): string {
    if (plain) return status === 'running' ? 'RUN' : status === 'passed' ? 'PASS' : 'FAIL'
    switch (status) {
      case 'running':
        return c(pc.bgYellow, c(pc.black, ' RUN  '))
      case 'passed':
        return c(pc.bgGreen, c(pc.black, ' PASS '))
      case 'failed':
        return c(pc.bgRed, c(pc.white, ' FAIL '))
    }
  }

  function formatStepsLine(): string {
    const total = stepsPassed + stepsFailed + stepsSkipped
    const parts: string[] = []
    if (stepsPassed > 0) parts.push(c(pc.green, `${stepsPassed} passed`))
    if (stepsFailed > 0) parts.push(c(pc.red, `${stepsFailed} failed`))
    if (stepsSkipped > 0) parts.push(c(pc.dim, `${stepsSkipped} skipped`))
    parts.push(`${total} total`)
    return parts.join(', ')
  }

  // --- per-event handlers -----------------------------------------------------
  function onRunStarted(payload: RunStartedPayload): void {
    memberTestCount = payload.memberTestCount
    const model = process.env.AGENT_QA_LLM_MODEL
    const provider = process.env.AGENT_QA_LLM_PROVIDER
    const modelInfo = model
      ? `  ${c(pc.dim, `Model: ${model}${provider ? ` (${provider})` : ''}`)}\n`
      : ''
    println(`\n${c(pc.bold, `Running ${memberTestCount} test(s)...`)}\n${modelInfo}`)
  }

  function onTestStarted(payload: TestStartedPayload): void {
    resetPerTest()
    testMeta.set(payload.testIndex, {
      name: payload.name,
      filePath: payload.filePath ?? payload.name,
    })
    if (payload.suiteId && payload.suiteId !== currentSuiteId) {
      currentSuiteId = payload.suiteId
      sawSuite = true
      println(`\n${c(pc.bold, `Suite: ${payload.suiteName ?? payload.suiteId}`)}`)
    }
    const indent = sawSuite ? '  ' : ''
    transient(`${indent}${testBadge('running')} ${payload.filePath ?? payload.name}`)
  }

  function onStepStarted(payload: StepStartedPayload): void {
    stepTextByIndex.set(payload.stepIndex, payload.stepText)
    transient(`${plain ? '->' : c(pc.dim, '→')} ${payload.stepText}`)
  }

  function onStepFinalized(payload: StepFinalizedPayload): void {
    const status = payload.status
    if (status === 'passed' || status === 'healed') ptPassed++
    else if (status === 'failed') ptFailed++
    else if (status === 'skipped' || status === 'cancelled') ptSkipped++

    if (payload.cacheStatus === 'hit') cacheHits++
    else if (payload.cacheStatus === 'miss') cacheMisses++

    const stepText = stepTextByIndex.get(payload.stepIndex) ?? `Step ${payload.stepIndex + 1}`
    const dur = humanDuration(payload.durationMs ?? 0)
    println(`${statusIcon(status)} ${stepText} ${c(pc.dim, dur)}`)
    if (status === 'failed' && payload.error) {
      println(`  ${c(pc.red, 'Error:')} ${payload.error}`)
    }
  }

  function onHookStarted(payload: HookStartedPayload): void {
    const phaseKey = payload.phase === 'inline' ? `inline:${payload.hookName}` : payload.phase
    if (hookPhaseStarted.has(phaseKey)) return
    hookPhaseStarted.add(phaseKey)
    const label =
      payload.phase === 'setup'
        ? 'Running setup hooks'
        : payload.phase === 'teardown'
          ? 'Running teardown hooks'
          : `Running hook: ${payload.hookName}`
    println(`${plain ? 'RUN' : c(pc.bold, '▶')} ${label}`)
  }

  function onHookFinished(payload: HookFinishedPayload): void {
    const icon = statusIcon(payload.status === 'passed' ? 'passed' : payload.status === 'failed' ? 'failed' : 'skipped')
    println(`  ${icon} ${payload.hookName} ${c(pc.dim, humanDuration(payload.durationMs))}`)
    if (payload.status === 'failed' && payload.error) {
      println(`    ${c(pc.red, 'Error:')} ${payload.error}`)
    }
    if (verbose && payload.variables && Object.keys(payload.variables).length > 0) {
      for (const [key, value] of Object.entries(payload.variables)) {
        println(`    ${plain ? '->' : c(pc.dim, '↳')} ${key}=${value}`)
      }
    }
  }

  function onTestRetryScheduled(_payload: TestRetryScheduledPayload): void {
    // A new attempt begins: drop the aborted attempt's step accumulation so the
    // aggregate summary counts only the final attempt (D-01/Q-3).
    resetPerTest()
  }

  function onTestFinished(payload: TestFinishedPayload): void {
    // flush per-test buckets into the aggregate (retry-reset already dropped stale attempts)
    stepsPassed += ptPassed
    stepsFailed += ptFailed
    stepsSkipped += ptSkipped
    totalDurationMs += payload.durationMs ?? 0

    const meta = testMeta.get(payload.testIndex)
    const name = meta?.name ?? `Test ${payload.testIndex + 1}`
    const outcome = payload.outcome
    const failed = outcome === 'failed' || outcome === 'timeout'
    const skipped = outcome === 'skipped' || outcome === 'cancelled'
    if (failed) testsFailed++
    else if (skipped) testsSkipped++
    else testsPassed++

    if (failed) failedTests.push({ name, failureSummary: payload.failureSummary })

    const badge = failed ? testBadge('failed') : skipped ? statusIcon('skipped') : testBadge('passed')
    const indent = sawSuite ? '  ' : ''
    const dur = skipped ? '(skipped)' : humanDuration(payload.durationMs ?? 0)
    println(`${indent}${badge} ${name} ${c(pc.dim, dur)}`)
    println('')
  }

  function onRunFinished(_payload: RunFinishedPayload): void {
    println('')
    const total = testsPassed + testsFailed + testsSkipped
    if (failedTests.length > 0) {
      println(c(pc.red, 'Failed tests:'))
      for (const failure of failedTests) {
        println(`  ${plain ? 'x' : c(pc.red, '✗')} ${failure.name}`)
        if (failure.failureSummary) {
          for (const line of failure.failureSummary.split('\n')) {
            println(`    ${c(pc.dim, line)}`)
          }
        }
      }
    }
    println(`Tests:  ${testsPassed} of ${total} passed`)
    println(`Steps:  ${formatStepsLine()}`)
    println(`Cache:  ${cacheHits} hits, ${cacheMisses} misses`)
    println(`Time:   ${humanDuration(totalDurationMs)}`)
    println('')
  }

  function handler(envelope: RunEventEnvelope): void {
    // The bus detaches a throwing subscriber, but a detached console mid-run is a UX
    // failure — guard so a single malformed envelope never blanks the terminal.
    try {
      switch (envelope.type) {
        case 'runStarted':
          onRunStarted(envelope.payload as RunStartedPayload)
          break
        case 'testStarted':
          onTestStarted(envelope.payload as TestStartedPayload)
          break
        case 'stepStarted':
          onStepStarted(envelope.payload as StepStartedPayload)
          break
        case 'stepFinalized':
          onStepFinalized(envelope.payload as StepFinalizedPayload)
          break
        case 'hookStarted':
          onHookStarted(envelope.payload as HookStartedPayload)
          break
        case 'hookFinished':
          onHookFinished(envelope.payload as HookFinishedPayload)
          break
        case 'testRetryScheduled':
          onTestRetryScheduled(envelope.payload as TestRetryScheduledPayload)
          break
        case 'testFinished':
          onTestFinished(envelope.payload as TestFinishedPayload)
          break
        case 'runFinished':
          onRunFinished(envelope.payload as RunFinishedPayload)
          break
        default:
          // verdict / diagnostics / sub-action ticks / chips — no console surface
          break
      }
    } catch {
      // swallow: never detach the console mid-run
    }
  }

  function pauseLive(): void {
    if (canOverwrite && lastWriteLen > 0) {
      emit('\n')
      lastWriteLen = 0
    }
    livePaused = true
  }

  function resumeLive(): void {
    livePaused = false
  }

  async function flush(): Promise<void> {
    // Console does no buffered I/O; the seam exists for interface uniformity.
  }

  return { handler, flush, pauseLive, resumeLive }
}
