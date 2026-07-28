// The function-layer contract types (Phase 384, FUNC-01 / D-08 / D-09 / D-14 / D-15).
//
// `FunctionDeclaration` is the public, capability-free VIEW of an op: everything a
// surface needs to discover, describe, and project the capability (MCP tool listings,
// the 397 golden snapshot, the `agent-qa fn --list` catalog) and nothing that runs it.
// `FunctionSpec` adds the implementation and NEVER leaves this directory — the package
// barrel exports the declaration type only, so no surface can acquire a dispatch path
// that skips `invokeFunction`'s gate call (T-384-01).

import type { z } from 'zod'

import type {
  CompletedRunHandoff,
  FunctionScope,
  RiskActionDescriptor,
} from '@vostride/agent-qa-schema'

/**
 * How an op returns its result (D-08). `stream` is minted here as vocabulary; the
 * async-iterable + `lastEventId` replay implementation lands with the event-stream op.
 */
export type FunctionResultKind = 'unary' | 'stream'

/**
 * Whether the op's implementation is bound in THIS composition (D-09). A declared-but-
 * unbound op is a visible state, never a silent gap: coverage checks must treat
 * `unbound` as covered-but-unbound rather than as an absent capability.
 */
export type FunctionBindingStatus = 'bound' | 'unbound'

/**
 * The public description of one registered capability.
 *
 * `id` is dot-namespaced `domain.verb` (D-15) over the fixed domain taxonomy
 * (tests · runs · memory · analysis · eval · gates · config · agent).
 */
export interface FunctionDeclaration<Input = unknown, Output = unknown> {
  id: string
  /** One-line human description; rendered by catalogs and `agent-qa fn --list`. */
  summary: string
  /** Capability scopes a caller's grants must cover. Enforced in `invokeFunction`. */
  requiredScopes: readonly FunctionScope[]
  resultKind: FunctionResultKind
  bindingStatus: FunctionBindingStatus
  /** Runtime input contract (D-14); also the JSON-Schema projection source. */
  input: z.ZodType<Input>
  /** Runtime output contract (D-14); unary results are validated against it. */
  output: z.ZodType<Output>
  /** The descriptor this op projects into for the policy gate. */
  risk: RiskActionDescriptor
}

/**
 * INTERNAL: declaration plus implementation. Deliberately absent from the package
 * barrel — exporting this type (or any helper taking one and running it) would hand a
 * surface a private power, which is precisely what the function layer abolishes.
 */
export interface FunctionSpec<Input = unknown, Output = unknown>
  extends FunctionDeclaration<Input, Output> {
  invoke(input: Input, deps: FunctionDeps): Promise<Output>
}

/**
 * Injected read port over the completed runs recorded for a project.
 *
 * `packages/agent` is `storageNeutral`: no host builtin is importable here. Every byte of run
 * state arrives through this port, built at the composition root over the concrete
 * `runner-local` handoff store.
 */
export interface RunsReaderPort {
  /** Every completed run this project can load. Missing run storage yields `[]`. */
  list(): Promise<readonly CompletedRunHandoff[]>
}

/**
 * The injected-dependency record every op implementation receives. Ops are pure
 * functions of (validated input, deps) — they never reach for a host API.
 */
export interface FunctionDeps {
  runs: RunsReaderPort
}
