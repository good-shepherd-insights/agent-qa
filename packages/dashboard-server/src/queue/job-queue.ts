import { EventEmitter } from 'node:events'
import { cpus } from 'node:os'
import type { RunAttributes } from '@vostride/agent-qa-core'
import type { RunArtifactKind } from '@vostride/agent-qa-schema'
import { isRunTriggerConfirmScope } from '../chat/confirm-registry.js'
import type { DashboardDatabase, RunRow } from '../db/database.js'

interface EnqueueOptions {
  name: string
  filePath?: string
  kind?: RunArtifactKind
  attributes?: RunAttributes
  priority?: number
  platform?: string
  testFileContent?: string
  modelName?: string
  llmProvider?: string
  metadata?: Record<string, unknown>
  parallel?: boolean
}

export class JobQueue extends EventEmitter {
  private db: DashboardDatabase
  private pollInterval: ReturnType<typeof setInterval> | null = null
  private isProcessing = false
  private concurrency: number
  private activeCount = 0
  private activePlatforms = new Set<string>()
  private activeRuns = new Map<string, { platform: string }>()

  constructor(opts: { db: DashboardDatabase; concurrency?: number }) {
    super()
    this.db = opts.db
    this.concurrency = opts.concurrency ?? cpus().length
  }

  start(intervalMs = 1000): void {
    this.pollInterval = setInterval(() => this.processNext(), intervalMs)
    this.on('enqueued', () => this.processNext())
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval)
      this.pollInterval = null
    }
    this.removeAllListeners('enqueued')
  }

  enqueue(opts: EnqueueOptions): string {
    // THE BELT, AT THE ONE WRITER BOTH DOORS GO THROUGH (401-23, T-401-G24).
    //
    // The primary control is the allowlist at `/api/queue/enqueue`, which does not admit
    // `confirmScope` as a client-writable key at all. This is the assertion that survives the next
    // writer: a confirm scope names WHICH BROWSER a run's question is delivered to, so a value this
    // server did not mint is an address into somebody else's dialog. `/api/runs/trigger` validates
    // its own; anything else reaching the persisted row must too, or the guarantee is one route's
    // discipline rather than a property of the queue.
    const confirmScope = opts.metadata?.['confirmScope']
    if (confirmScope !== undefined
      && (typeof confirmScope !== 'string' || !isRunTriggerConfirmScope(confirmScope))) {
      throw new TypeError('confirmScope must be a confirm scope minted by this server')
    }
    const runId = this.db.insertPendingRun({
      name: opts.name,
      filePath: opts.filePath,
      attributes: opts.attributes,
      priority: opts.priority ?? 0,
      platform: opts.platform,
      testFileContent: opts.testFileContent,
      modelName: opts.modelName,
      llmProvider: opts.llmProvider,
      metadata: opts.metadata,
      parallel: opts.parallel,
    })
    this.db.insertRunArtifact({
      runId,
      kind: opts.kind ?? 'test',
      payload: {
        runtime: {
          platform: opts.platform ?? 'web',
          queued: true,
        },
        source: {
          name: opts.name,
          filePath: opts.filePath ?? null,
          loadStatus: 'queued',
        },
        metadata: {
          ...opts.metadata,
          attributes: opts.attributes ?? {},
        },
      },
    })
    this.emit('enqueued', runId)
    return runId
  }

  processNext(): void {
    if (this.isProcessing) return
    this.isProcessing = true
    try {
      while (true) {
        const next = this.findNextEligible()
        if (!next) break

        const isParallel = Boolean(next.parallel)
        const platform = next.platform ?? 'web'
        const isMobile = platform === 'ios' || platform === 'android'

        this.activeCount++
        if (isMobile) this.activePlatforms.add(platform)
        this.activeRuns.set(next.id, { platform })

        this.db.updateRunStatus(next.id, 'running')
        this.db.updateRun(next.id, { startedAt: new Date().toISOString() })
        this.emit('execute', next)

        // Sequential jobs get exclusive access — stop filling slots after dequeue
        if (!isParallel && !isMobile) break
      }
    } finally {
      this.isProcessing = false
    }
  }

  onSlotFreed(runId: string): void {
    const info = this.activeRuns.get(runId)
    if (!info) return
    this.activeCount--
    if (info.platform === 'ios' || info.platform === 'android') {
      this.activePlatforms.delete(info.platform)
    }
    this.activeRuns.delete(runId)
    this.processNext()
  }

  getActiveCount(): number {
    return this.activeCount
  }

  getConcurrency(): number {
    return this.concurrency
  }

  cancel(runId: string): boolean {
    const run = this.db.getRun(runId)
    if (!run) return false
    const now = new Date().toISOString()
    if (run.status === 'pending') {
      this.db.updateRun(runId, { status: 'cancelled', endedAt: now })
      this.db.finalizeRunArtifact(runId, {
        errors: [{ code: 'cancelled', phase: 'queue', message: 'Run cancelled before execution' }],
        runtime: { status: 'cancelled' },
      })
      return true
    }
    if (run.status === 'running') {
      this.db.updateRun(runId, { status: 'cancelled', endedAt: now })
      try {
        const artifact = this.db.getRunArtifact(runId)
        if (artifact && !artifact.finalizedAt) {
          this.db.finalizeRunArtifact(runId, {
            errors: [{ code: 'cancelled', phase: 'queue', message: 'Run cancellation requested' }],
            runtime: { status: 'cancelled' },
          })
        }
      } catch { /* cancellation still proceeds */ }
      this.emit('cancel-running', runId)
      return true
    }
    return false
  }

  // 2026-08-24 (Phase 402 plan 09, D-11): THE CHILD-RUN CANCELLATION FAN-OUT IS DELETED WITH THE
  // MODEL THAT MINTED ITS CHILDREN.
  //
  // ~19 lines stood here walking the run's child rows and cancelling each member row. Under
  // the one-run model a parallel suite is ONE run row with member handles (402-04) — nothing writes
  // the run row's parent-link column any more (405-07 then deleted the column outright), so the
  // walk could only ever have read an empty list while reading as live cancellation policy.
  // Cancelling the run cancels the run.
  //
  // WHAT THIS DOES NOT TOUCH: `parallel` below. D-11 keeps the queue's parallel flag as CROSS-RUN
  // concurrency of INDEPENDENT jobs, which is what `findNextEligible` has always used it for. What
  // was deleted is parallel-SUITE semantics, not the queue's ability to run two unrelated jobs.
  //
  // HISTORICAL ROWS: a pre-402 suite run still lists its members on the read side (see
  // DELETION-INVENTORY.md); cancelling such a run now leaves those member
  // rows in whatever state their own process left them.

  private findNextEligible(): RunRow | undefined {
    if (this.activeCount >= this.concurrency) return undefined

    const pending = this.db.getPendingRuns()
    for (const run of pending) {
      const isParallel = Boolean(run.parallel)
      const platform = run.platform ?? 'web'
      const isMobile = platform === 'ios' || platform === 'android'

      if (isMobile) {
        // Mobile: needs a slot AND its platform not already active
        // parallel flag is ignored — mobile tests serialize per platform via device mutex
        if (this.activePlatforms.has(platform)) continue
        return run
      }

      if (!isParallel) {
        // Sequential web: needs ALL slots free (exclusive access)
        if (this.activeCount > 0) continue
        return run
      }

      // Parallel web: just needs an available slot
      return run
    }

    return undefined
  }
}
