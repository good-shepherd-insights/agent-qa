// The run reads under `agent-qa runs` (431 D-11/D-12/D-13).
//
// Each verb is a thin client: it normalizes its flags, composes the local agent, invokes the
// canonical op with CLI_FUNCTION_CALLER and prints what came back. `--json` prints the op's whole
// result unchanged, so it equals what the matching MCP tool returns. Without it, one compact line
// per test, step or record carries the addresses the next command takes; bodies, traces and
// documents stay in `--json`.

import { dirname, resolve } from 'node:path'

import {
  invokeFunction,
  RUNS_KNOWLEDGE_FUNCTION_ID,
  RUNS_LIST_FUNCTION_ID,
  RUNS_OVERVIEW_FUNCTION_ID,
} from '@vostride/agent-qa-agent'
import { RUNS_LIST_MAX_LIMIT, RunsListInputSchema } from '@vostride/agent-qa-schema'
import type {
  RunKnowledgeProjection,
  RunOverviewProjection,
  RunOverviewStep,
  RunSummary,
  RunsListInput,
} from '@vostride/agent-qa-schema'
import { Command, InvalidArgumentError, Option } from 'commander'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../composition/local-agent-host.js'

type Host = ReturnType<typeof composeCliLocalAgent>

const RUN_VERDICTS = RunsListInputSchema.shape.verdict.unwrap().options

const RFC3339 =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:([Zz])|([+-])(\d{2}):(\d{2}))$/

/**
 * RFC3339 with an explicit offset, normalized once to epoch milliseconds. A time with no offset
 * names no instant, and a leap second or sub-millisecond digit has no exact millisecond, so both
 * are refused rather than guessed.
 */
export function parseSinceTimestamp(value: string): number {
  const match = RFC3339.exec(value)
  if (match === null) {
    throw new InvalidArgumentError(
      'expected an RFC3339 time with an explicit offset, e.g. 2026-09-28T09:30:00Z or '
      + '2026-09-28T11:30:00+02:00 (at most millisecond precision)')
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as
    [number, number, number, number, number, number]
  const millis = match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0'))
  const offsetHours = match[10] === undefined ? 0 : Number(match[10])
  const offsetMinutes = match[11] === undefined ? 0 : Number(match[11])
  const local = Date.UTC(year, month - 1, day, hour, minute, second, millis)
  const check = new Date(local)
  if (
    hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59
    || check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) {
    throw new InvalidArgumentError(`${value} is not a valid calendar time`)
  }
  const sign = match[9] === '-' ? -1 : 1
  const epoch = local - sign * (offsetHours * 60 + offsetMinutes) * 60_000
  if (!Number.isSafeInteger(epoch) || epoch < 0) {
    throw new InvalidArgumentError(`${value} is before 1970-01-01T00:00:00Z`)
  }
  return epoch
}

function parseLimit(value: string): number {
  const limit = /^\d+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > RUNS_LIST_MAX_LIMIT) {
    throw new InvalidArgumentError(`limit must be an integer from 1 to ${String(RUNS_LIST_MAX_LIMIT)}`)
  }
  return limit
}

function parseFilterText(value: string): string {
  if (value.trim().length === 0) throw new InvalidArgumentError('must name something, not blank text')
  return value
}

function composeFor(cmd: Command): Host {
  const configPath = resolve(cmd.optsWithGlobals<{ config?: string }>().config ?? 'agent-qa.config.yaml')
  return composeCliLocalAgent({ configPath, agentQaRoot: resolve(dirname(configPath), '.agent-qa') })
}

/** Compose, invoke, print, and always close the host this verb opened. */
async function withHost(verb: string, cmd: Command, body: (host: Host) => Promise<void>): Promise<void> {
  let host: Host | undefined
  try {
    host = composeFor(cmd)
    await body(host)
  } catch (error) {
    reportFailure(verb, error)
  } finally {
    await host?.close()
  }
}

function reportFailure(verb: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const hint = error instanceof Error && error.name === 'RunNotFoundError'
    ? ' — run `agent-qa runs list` to see completed run ids'
    : ''
  console.error(`agent-qa runs ${verb}: ${message}${hint}`)
  process.exitCode = 1
}

function emitJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2))
}

function iso(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`
}

// ---- runs list ------------------------------------------------------------------------------------

export function renderRunList(rows: readonly RunSummary[], filtered: boolean): string {
  if (rows.length === 0) {
    return filtered ? 'No completed runs match these filters.' : 'No completed runs are recorded.'
  }
  const lines: string[] = []
  for (const row of rows) {
    const targets = row.recordedTargets.status === 'recorded' && row.recordedTargets.names.length > 0
      ? row.recordedTargets.names.join(', ')
      : `${row.scope.tier}:${row.scope.key}`
    lines.push(`${String(row.runId)} · ${row.aggregateVerdict} · ${targets} · build ${String(row.buildOrdinal)}`
      + ` · ended ${iso(row.endedAt)} · ${plural(row.testCount, 'test')}`)
    for (const test of row.tests) {
      lines.push(`  test ${String(test.testIndex)} · ${test.testId} · ${test.testName}`)
    }
  }
  lines.push('', `Next: agent-qa runs overview ${String(rows[0]!.runId)}`)
  return lines.join('\n')
}

interface ListOptions {
  verdict?: RunsListInput['verdict']
  test?: string
  target?: string
  since?: number
  limit?: number
  json?: boolean
}

function listInput(options: ListOptions): RunsListInput {
  return {
    ...(options.verdict === undefined ? {} : { verdict: options.verdict }),
    ...(options.test === undefined ? {} : { test: options.test }),
    ...(options.target === undefined ? {} : { target: options.target }),
    ...(options.since === undefined ? {} : { since: options.since }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  }
}

// ---- runs overview --------------------------------------------------------------------------------

function stepCaptureLine(step: RunOverviewStep): string | undefined {
  if (step.capture.state !== 'recorded') return 'capture unavailable'
  const { evidence, aria } = step.capture
  const parts: string[] = []
  if (evidence.console.state === 'present') {
    const { total, errors } = evidence.console.counts
    parts.push(`console ${String(total)}${errors > 0 ? ` (${plural(errors, 'error')})` : ''}`)
  }
  if (evidence.network.state === 'present') {
    const { total, failed } = evidence.network.counts
    parts.push(`network ${String(total)}${failed > 0 ? ` (${String(failed)} failed)` : ''}`)
  }
  if (evidence.a11y.state === 'present') {
    const { minor, moderate, serious, critical } = evidence.a11y.counts
    parts.push(`a11y ${String(minor + moderate + serious + critical)}`)
  }
  if (evidence.variables.state === 'present') parts.push(`variables ${String(evidence.variables.counts.count)}`)
  const ariaPresent = aria.filter((entry) => entry.state === 'present').map((entry) => entry.subActionIndex)
  if (ariaPresent.length > 0) parts.push(`aria sub-action ${ariaPresent.join(', ')}`)
  return parts.length === 0 ? undefined : parts.join(' · ')
}

function firstPresentKind(step: RunOverviewStep): string | undefined {
  if (step.capture.state !== 'recorded') return undefined
  const { evidence } = step.capture
  return (['console', 'network', 'a11y', 'variables'] as const)
    .find((kind) => evidence[kind].state === 'present')
}

export function renderRunOverview(overview: RunOverviewProjection): string {
  const runId = overview.runId
  const target = overview.recordedTargets.status === 'recorded' && overview.recordedTargets.names.length > 0
    ? overview.recordedTargets.names.join(', ')
    : `${overview.scope.tier}:${overview.scope.key}`
  const lines = [
    `Run ${runId} · ${overview.aggregateVerdict} · ${target} · build ${String(overview.buildOrdinal)}`,
    `Started ${iso(overview.startedAt)} · ended ${iso(overview.endedAt)}`,
  ]
  const candidates: { failing: boolean; lines: string[] }[] = []
  for (const test of overview.tests) {
    lines.push('', `Test ${String(test.testIndex)} · ${test.testId} · ${test.name.text} · ${test.outcome}`)
    if (test.recording.state === 'present') {
      lines.push(`  recording ${test.recording.address.sha} · ${test.recording.contentType}`
        + ` · ${String(test.recording.byteLength)} bytes`)
    }
    for (const step of test.steps) {
      lines.push(`  step ${String(step.stepIndex)} · ${step.label?.text ?? '(no label)'} · ${step.status ?? 'no status'}`)
      const capture = stepCaptureLine(step)
      if (capture !== undefined) lines.push(`    ${capture}`)
      if (step.capture.state === 'recorded') {
        for (const shot of step.capture.screenshots) {
          lines.push(`    screenshot ${shot.sha} · sub-action ${String(shot.subActionIndex)}`
            + `${shot.present === false ? ' · bytes missing' : ''}`)
        }
      }
      if (step.knowledge.state === 'recorded') {
        for (const record of step.knowledge.records) {
          lines.push(`    record ${record.recordId} · ${record.channel}${record.kind === undefined ? '' : ` · ${record.kind}`}`
            + `${record.summary === undefined ? '' : ` · ${record.summary.text}`}`)
        }
        const trace = step.knowledge.brief.trace
        lines.push(`    brief ${trace.kind === 'answered' ? 'trace recorded' : `no trace (${trace.reason})`}`)
      }
      const kind = firstPresentKind(step)
      const fetches = [
        ...(kind === undefined ? [] : [`agent-qa runs evidence ${runId} --test ${String(test.testIndex)} `
          + `--step ${String(step.stepIndex)} --kind ${kind}`]),
        ...(step.capture.state === 'recorded' && step.capture.screenshots[0] !== undefined
          ? [`agent-qa runs evidence ${runId} --screenshot ${step.capture.screenshots[0].sha} --out <file>`]
          : []),
        ...(step.knowledge.state === 'recorded'
          ? [`agent-qa knowledge brief-why ${runId} --step ${String(step.stepIndex)} --test ${test.testId}`]
          : []),
      ]
      if (fetches.length > 0) {
        candidates.push({ failing: step.status !== undefined && step.status !== 'passed', lines: fetches })
      }
    }
  }
  const learned = overview.learned
  if (learned.snapshot.state === 'recorded') {
    const counts = Object.entries(learned.snapshot.breakdown)
      .filter(([, count]) => count > 0)
      .map(([bucket, count]) => `${String(count)} ${bucket}`)
    lines.push('', `Learned: ${counts.length === 0 ? 'nothing' : counts.join(' · ')}`)
    for (const row of learned.snapshot.rows) lines.push(`  ${row.bucket} ${row.recordId}`)
  } else {
    lines.push('', `Learned: snapshot ${learned.snapshot.state === 'withheld'
      ? `withheld (${learned.snapshot.reason})` : 'not recorded'} · curation ${learned.curation.status}`)
    for (const change of learned.changes) lines.push(`  ${change.change} ${change.recordId} @${String(change.atOrdinal)}`)
  }
  const next = (candidates.find((candidate) => candidate.failing) ?? candidates[0])?.lines ?? []
  if (next.length > 0) lines.push('', ...next.map((line, index) => `${index === 0 ? 'Next:' : '     '} ${line}`))
  return lines.join('\n')
}

// ---- runs knowledge -------------------------------------------------------------------------------

export function renderRunKnowledge(projection: RunKnowledgeProjection): string {
  if (projection.kind !== 'ready') {
    return `Run ${projection.runId}: no completed handoff is recorded, so its knowledge cannot be read.`
  }
  const lines = [
    `Run ${projection.runId} knowledge · build ${String(projection.buildOrdinal)} · store ${projection.knowledgeStore}`
      + ` · curation ${projection.curation.status}`,
  ]
  const records = new Set<string>()
  for (const step of projection.steps) {
    const served = [
      ...step.served.channel1.map((line) => `brief ${line.id}`),
      ...step.served.channel2.map((line) => `read ${line.id}`),
      ...step.served.channel3.map((line) => `caution ${line.id}`),
    ]
    for (const line of [...step.served.channel1, ...step.served.channel2, ...step.served.channel3]) records.add(line.id)
    lines.push(`test ${String(step.testIndex)} · ${step.testId} · step ${String(step.stepIndex)} · ${step.stepText}`)
    lines.push(`  served ${served.length === 0 ? 'nothing' : served.join(' · ')}`
      + ` · ${step.trace.kind === 'answered' ? 'trace recorded' : `no trace (${step.trace.reason})`}`)
  }
  const { learned } = projection
  if (learned.changes.length > 0 || learned.canaryAttributions.length > 0) lines.push('Learned:')
  for (const change of learned.changes) {
    records.add(change.recordId)
    lines.push(`  ${change.change} ${change.recordId} @${String(change.atOrdinal)}`)
  }
  for (const canary of learned.canaryAttributions) {
    lines.push(`  canary ${canary.recordId} ${canary.outcome} · test ${String(canary.testIndex)} step ${String(canary.stepIndex)}`)
  }
  const first = [...records][0]
  if (first !== undefined) lines.push('', `Next: agent-qa knowledge show ${first}`)
  return lines.join('\n')
}

// ---- Registration ---------------------------------------------------------------------------------

export function registerRunReadCommands(command: Command): void {
  command.command('list')
    .description('List completed runs, newest finished first, each naming its tests')
    .addOption(new Option('--verdict <verdict>', 'only runs with this aggregate verdict').choices([...RUN_VERDICTS]))
    .option('--test <text>', 'only runs with a test of this exact id or whose title contains this text', parseFilterText)
    .option('--target <name>', 'only runs that recorded this target', parseFilterText)
    .option('--since <time>', 'only runs that finished at or after this RFC3339 time (with offset)', parseSinceTimestamp)
    .option('--limit <n>', `at most this many runs (1-${String(RUNS_LIST_MAX_LIMIT)}, default 20)`, parseLimit)
    .option('--json', 'print the runs.list result unchanged')
    .action(async (options: ListOptions, cmd: Command) => {
      await withHost('list', cmd, async (host) => {
        const input = listInput(options)
        const rows = await invokeFunction(host.registry, RUNS_LIST_FUNCTION_ID, input, CLI_FUNCTION_CALLER) as RunSummary[]
        if (options.json === true) emitJson(rows)
        else console.log(renderRunList(rows, Object.keys(input).length > 0))
      })
    })

  command.command('overview <runId>')
    .description('Map one completed run: tests, steps, and the address of everything recorded')
    .option('--json', 'print the runs.overview result unchanged')
    .action(async (runId: string, options: { json?: boolean }, cmd: Command) => {
      await withHost('overview', cmd, async (host) => {
        const overview = await invokeFunction(host.registry, RUNS_OVERVIEW_FUNCTION_ID, { runId },
          CLI_FUNCTION_CALLER) as RunOverviewProjection
        if (options.json === true) emitJson(overview)
        else console.log(renderRunOverview(overview))
      })
    })

  command.command('knowledge <runId>')
    .description('Show what one run used and learned from the knowledge store')
    .option('--json', 'print the runs.knowledge result unchanged')
    .action(async (runId: string, options: { json?: boolean }, cmd: Command) => {
      await withHost('knowledge', cmd, async (host) => {
        const projection = await invokeFunction(host.registry, RUNS_KNOWLEDGE_FUNCTION_ID, { runId },
          CLI_FUNCTION_CALLER) as RunKnowledgeProjection
        if (options.json === true) emitJson(projection)
        else console.log(renderRunKnowledge(projection))
        if (projection.kind !== 'ready') {
          console.error(`agent-qa runs knowledge: no completed run recorded for id: ${runId}`
            + ' — run `agent-qa runs list` to see completed run ids')
          process.exitCode = 1
        }
      })
    })
}
