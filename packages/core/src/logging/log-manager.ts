import { randomUUID } from 'node:crypto'
import { LOG_LEVEL_PRIORITY } from './types.js'
import type { LogLevel, LogSource, LogEntry, LogStorage, ScopedLogger } from './types.js'
import { formatLogEntry } from './cli-formatter.js'
import { type SecretRedactor } from '@vostride/agent-qa-runner'
import { redactAuthStateValue } from '../auth-state/redaction.js'

export class LogManager {
  private buffer: LogEntry[] = []
  private currentStepId: string | null = null
  private runId: string
  private runIdSet = false
  private readonly displayLevel: LogLevel
  private readonly storage?: LogStorage
  private readonly ndjson: boolean
  private redactor?: SecretRedactor

  constructor(opts: {
    runId?: string
    displayLevel: LogLevel
    storage?: LogStorage
    ndjson?: boolean
    redactor?: SecretRedactor
  }) {
    this.runId = opts.runId ?? ''
    this.runIdSet = !!opts.runId
    this.displayLevel = opts.displayLevel
    this.storage = opts.storage
    this.ndjson = opts.ndjson ?? false
    this.redactor = opts.redactor
  }

  setRedactor(redactor: SecretRedactor | undefined): void {
    this.redactor = redactor
  }

  log(
    level: Exclude<LogLevel, 'silent'>,
    source: LogSource,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      id: randomUUID(),
      stepId: this.currentStepId,
      runId: this.runId,
      level,
      source,
      message: redactAuthStateValue(message, { secretRedactor: this.redactor }),
      data: redactAuthStateValue(data ?? {}, { secretRedactor: this.redactor }),
      timestamp: new Date().toISOString(),
    }
    this.buffer.push(entry)

    if (this.shouldDisplay(level)) {
      process.stderr.write(formatLogEntry(entry) + '\n')
    }

    if (this.ndjson) {
      this.emitNdjson(entry)
    }
  }

  private shouldDisplay(entryLevel: Exclude<LogLevel, 'silent'>): boolean {
    if (this.displayLevel === 'silent') return false
    return LOG_LEVEL_PRIORITY[entryLevel] <= LOG_LEVEL_PRIORITY[this.displayLevel]
  }

  /**
   * The SECOND writer on the `AGENT_QA_EVENT:` stdout channel — the first is the CLI's
   * `reporters/wire-reporter.ts`, which prints run-event envelopes on the same prefix. Both are
   * armed by `AGENT_QA_LIVE_EVENTS=true` (this one indirectly: `commands/run.ts` passes
   * `ndjson: process.env.AGENT_QA_LIVE_EVENTS === 'true'`), both are off by default, and nothing in
   * the product sets that variable. Entries are already redacted above, and are printed verbatim.
   * A supported opt-in; the user-facing contract for both writers is the CLI README's
   * "Live events on stdout (opt-in)". Do not change this line shape without mirroring it there.
   */
  private emitNdjson(entry: LogEntry): void {
    process.stdout.write(
      `AGENT_QA_EVENT:${JSON.stringify({ type: 'log', ...entry })}\n`,
    )
  }

  setCurrentStep(stepId: string): void {
    this.currentStepId = stepId
  }

  clearCurrentStep(): void {
    this.currentStepId = null
  }

  setRunId(runId: string): void {
    this.runId = runId
    this.runIdSet = true
    for (const entry of this.buffer) {
      entry.runId = runId
    }
  }

  flush(): void {
    if (this.storage && this.buffer.length > 0) {
      if (!this.runIdSet) {
        this.buffer = []
        return
      }
      this.storage.insertLogs(this.buffer)
    }
    this.buffer = []
  }

  getBuffer(): LogEntry[] {
    return [...this.buffer]
  }

  createScopedLogger(source: LogSource): ScopedLogger {
    return {
      debug: (msg: string, data?: Record<string, unknown>) =>
        this.log('debug', source, msg, data),
      info: (msg: string, data?: Record<string, unknown>) =>
        this.log('info', source, msg, data),
      warn: (msg: string, data?: Record<string, unknown>) =>
        this.log('warn', source, msg, data),
      error: (msg: string, data?: Record<string, unknown>) =>
        this.log('error', source, msg, data),
    }
  }
}
