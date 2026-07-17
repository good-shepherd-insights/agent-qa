import { join } from 'node:path'

import { resolveKnowledgeRoot } from '@vostride/agent-qa-core'
import {
  drainQueue,
  openKnowledgeReader,
  type OpenServingKnowledgeReaderConfig,
} from '@vostride/agent-qa-knowledge-local'
import type { KnowledgeHintReader } from '@vostride/agent-qa-runner'
import {
  HANDOFF_FILE,
  RUNS_SUBDIR,
  loadCompletedRunHandoff,
  slugBranch,
} from '@vostride/agent-qa-runner-local'
import type { AuditSink } from '@vostride/agent-qa-safety'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import type {
  GuardrailPolicy,
  MaskingContext,
} from '@vostride/agent-qa-schema'

import {
  buildCuratorAuthor,
  type BuildCuratorAuthorDependencies,
} from './curator-author.js'
import { emitCanaryOutcomes } from './emit-canary-outcomes.js'
import { emitCurationCandidates } from './emit-candidates.js'

export type CurationTailModelDeps = Pick<
  BuildCuratorAuthorDependencies,
  'profile' | 'auth'
>

export interface CurationTailLogger {
  warn(message: string): void
}

export interface CurationTailOperations {
  loadCompletedRunHandoff: typeof loadCompletedRunHandoff
  resolveKnowledgeRoot: typeof resolveKnowledgeRoot
  runSafetyScope: typeof runSafetyScope
  emitCurationCandidates: typeof emitCurationCandidates
  openKnowledgeReader(config: OpenServingKnowledgeReaderConfig): KnowledgeHintReader
  emitCanaryOutcomes: typeof emitCanaryOutcomes
  buildCuratorAuthor: typeof buildCuratorAuthor
  drainQueue: typeof drainQueue
}

export interface RunCurationTailOptions {
  runId: string
  /** Absolute `.agent-qa` runtime root shared by the run handoff and curation audit. */
  agentQaRoot: string
  knowledgeConfig: { dir: string }
  configDir: string
  auditSink: AuditSink
  maskingContext?: MaskingContext
  /** The exact already-resolved planner profile and auth used by the run. */
  modelDeps?: CurationTailModelDeps
  policy: GuardrailPolicy
  signal?: AbortSignal
  log: CurationTailLogger
  /** Focused test seam. Production callers omit it. */
  operations?: Partial<CurationTailOperations>
}

function defaultOperations(): CurationTailOperations {
  return {
    loadCompletedRunHandoff,
    resolveKnowledgeRoot,
    runSafetyScope,
    emitCurationCandidates,
    openKnowledgeReader,
    emitCanaryOutcomes,
    buildCuratorAuthor,
    drainQueue,
  }
}

/**
 * Run the post-verdict curation fold. The caller fixes its exit code before awaiting this function;
 * every failure is logged here and intentionally resolves so learning can never change the verdict.
 */
export async function runCurationTail(opts: RunCurationTailOptions): Promise<void> {
  const operations: CurationTailOperations = {
    ...defaultOperations(),
    ...opts.operations,
  }
  const runDir = join(opts.agentQaRoot, RUNS_SUBDIR, slugBranch(opts.runId))
  let handoffLoaded = false

  try {
    const handoff = operations.loadCompletedRunHandoff(join(runDir, HANDOFF_FILE))
    handoffLoaded = true

    // Phase 374 deliberately left this composition seam unwired. The Curator tail is its first
    // runtime caller and resolves the validated repo-relative root exactly once at the boundary.
    const knowledgeRoot = operations.resolveKnowledgeRoot(
      opts.knowledgeConfig,
      opts.configDir,
    )

    await operations.runSafetyScope(
      {
        maskingContext: opts.maskingContext,
        auditSink: opts.auditSink,
        // SAFE-01: posture is run truth persisted in the handoff, never an ambient re-detection.
        executionContext: handoff.executionContext,
      },
      async () => {
        operations.emitCurationCandidates({
          handoff,
          runDir,
          knowledgeRoot,
          policy: opts.policy,
        })
        // D-20: 378 D-01's post-verdict projection is applied twice. The candidate and canary
        // queue drops share this scope and crash boundary; diverging their semantics is a bug.
        const reader = operations.openKnowledgeReader({ knowledgeRoot })
        operations.emitCanaryOutcomes({
          handoff,
          knowledgeRoot,
          runDir,
          emit: reader.emitCanaryOutcome.bind(reader),
        })
        const author =
          opts.modelDeps === undefined
            ? async () => ({
                kind: 'fallback-required' as const,
                reason: 'no-model' as const,
              })
            : operations.buildCuratorAuthor(opts.modelDeps)
        await operations.drainQueue({
          knowledgeRoot,
          auditBaseDir: opts.agentQaRoot,
          author,
          executionContext: handoff.executionContext,
          policy: opts.policy,
          ...(opts.signal === undefined ? {} : { signal: opts.signal }),
        })
      },
    )
  } catch {
    if (!handoffLoaded) {
      opts.log.warn(
        'Skipping post-verdict knowledge curation: the completed run handoff is missing or malformed.',
      )
      return
    }
    opts.log.warn(
      'Post-verdict knowledge curation incomplete; it will resume on the next run.',
    )
  }
}

export interface RunVerdictFirstCurationTailOptions {
  /** The complete verdict-derived process code, fixed before the tail begins. */
  exitCode: number
  detach: boolean
  runTail(): Promise<void>
  /** Defensive call-site boundary; runCurationTail itself already never rejects. */
  onUnexpectedError?(error: unknown): void
}

/** Await the optional tail without permitting it to replace the already-fixed verdict code. */
export async function runVerdictFirstCurationTail(
  opts: RunVerdictFirstCurationTailOptions,
): Promise<number> {
  if (opts.detach) return opts.exitCode
  try {
    await opts.runTail()
  } catch (error) {
    opts.onUnexpectedError?.(error)
  }
  return opts.exitCode
}
