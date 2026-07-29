// Per-kind declarations for the agent job queue (Phase 385, D-09 skeleton).
//
// A kind cannot be registered without saying whether it checkpoints, WHICH checkpoints it
// publishes, which successors it may chain to, and how many attempts it gets. That is not
// documentation: the engine reads every one of those fields, so a kind whose declaration
// lies about its checkpoints refuses at the publish call rather than producing a job whose
// recovery behaviour nobody can predict. It is also what lets a later harness iterate the
// registry — kinds x declared checkpoints — instead of maintaining its own list that can
// silently fall behind.
//
// Phase-385 plan 01 registers exactly one fixture kind. Full declaration validation and
// the six real kinds arrive with the registry plan.

import type { Job, JobKind } from '@vostride/agent-qa-schema'

/** What a handler is handed. Checkpoint publication is a capability, never an import. */
export interface JobHandlerContext {
  readonly job: Job
  publishCheckpoint(checkpointId: string, value: unknown): Promise<void>
}

/**
 * A successor the handler's deterministic tail asks for (D-17).
 *
 * The TOPOLOGY is declared once, on the kind; the INSTANCES are returned by the handler.
 * That split is what makes an outcome-dependent chain ordinary data rather than a special
 * case, while still keeping the whole graph auditable in one place.
 */
export interface JobSuccessorRequest {
  readonly kind: JobKind
  readonly payload: unknown
  readonly idempotencyKey: string
}

export interface JobHandlerOutcome {
  readonly next?: readonly JobSuccessorRequest[]
}

export type JobHandler = (context: JobHandlerContext) => Promise<JobHandlerOutcome>

export interface JobKindDeclaration {
  readonly kind: JobKind
  /** `false` means the kind resumes NOTHING after a crash — chat's posture (JOBQ-04). */
  readonly checkpointed: boolean
  /** The complete set of checkpoint ids this kind may publish, in schedule order. */
  readonly checkpointSchedule: readonly string[]
  readonly allowedSuccessors: readonly JobKind[]
  readonly maxAttempts: number
  readonly handler: JobHandler
}

/** Thrown at construction when two declarations claim the same kind — never last-wins. */
export class DuplicateJobKindError extends Error {
  override readonly name = 'DuplicateJobKindError'

  constructor(readonly jobKind: JobKind) {
    super(`Duplicate agent job kind: ${jobKind}`)
  }
}

/** Thrown when the engine is asked to act on a kind no declaration covers. */
export class UnknownJobKindError extends Error {
  override readonly name = 'UnknownJobKindError'

  constructor(readonly jobKind: string) {
    super(
      `Unknown agent job kind: ${jobKind}. A kind must be declared before it can be ` +
        'enqueued or run, so an undeclared kind cannot reach a handler at all.',
    )
  }
}

export interface JobKindRegistry {
  /** Declarations in kind order, so any registry-driven harness is order-stable. */
  list(): readonly JobKindDeclaration[]
  get(kind: JobKind): JobKindDeclaration | undefined
  /** `get`, but refusing rather than returning `undefined` for an undeclared kind. */
  require(kind: JobKind): JobKindDeclaration
}

export function createJobKindRegistry(
  declarations: readonly JobKindDeclaration[],
): JobKindRegistry {
  const byKind = new Map<JobKind, JobKindDeclaration>()
  for (const declaration of declarations) {
    if (byKind.has(declaration.kind)) {
      throw new DuplicateJobKindError(declaration.kind)
    }
    byKind.set(declaration.kind, Object.freeze({ ...declaration }))
  }

  const sorted = [...byKind.values()].sort((left, right) =>
    left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0,
  )

  return {
    list: () => sorted,
    get: (kind) => byKind.get(kind),
    require: (kind) => {
      const declaration = byKind.get(kind)
      if (declaration === undefined) {
        throw new UnknownJobKindError(kind)
      }
      return declaration
    },
  }
}
