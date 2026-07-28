export type {
  AuthoringReadPort,
  KnowledgePort,
  ToolsPort,
  PersistencePort,
  ApprovalsPort,
  ClockPort,
} from './ports/index.js'

// 384 FUNC-01 — the typed function layer.
//
// `invokeFunction` is the ONLY exported way to run a capability, and it always crosses
// the policy gate. `FunctionSpec` (declaration + implementation), the spec-level
// `invoke`, the registry internals, and `createRegistryFromSpecs` are all deliberately
// absent from this barrel: exporting any of them would hand a surface a dispatch path
// that skips the gate (T-384-01). The arch barrel assertion pins this exact export set.
export { createFunctionRegistry, DuplicateFunctionIdError } from './functions/registry.js'
export type { CreateFunctionRegistryOptions, FunctionRegistry } from './functions/registry.js'
export {
  invokeFunction,
  FunctionDeniedError,
  FunctionInputError,
  FunctionNotBoundError,
  FunctionScopeError,
  UnknownFunctionError,
} from './functions/invoke.js'
export type {
  ConfigReaderPort,
  FunctionBindingStatus,
  FunctionDeclaration,
  FunctionDeps,
  FunctionResultKind,
  FunctionStream,
  KnowledgeReaderPort,
  ReplayedRunEvent,
  RunsReaderPort,
} from './functions/spec.js'
// Caller-facing refusals a surface may legitimately catch and report. Op-level errors live
// with the op that throws them; only the error CLASS crosses the barrel, never the spec.
export { RunNotFoundError } from './functions/ops/runs-get.js'
export { StreamReplayFloorError } from './functions/ops/runs-events.js'

// The human display boundary (v48 masking discipline): surfaces render function-layer
// results as prose, and prose is the sole unmasking surface.
//
// What that boundary does TODAY, stated before the reason it is published. It is a no-op.
// The two CLI surfaces this phase built — `renderStream` and `emitHuman`, in
// packages/cli/src/commands/fn.ts:107-146 — each construct a FRESH masking context and
// register nothing in it, and the only `.register(` call in non-test CLI source is in
// commands/run.ts:949, on an unrelated path. An empty context has nothing to substitute
// back, so unmasking is currently the identity function on every surface built here and
// disposing it clears nothing. Wiring a run-scoped context into human rendering is Phase
// 386's, with its daemon and live surfaces.
//
// The helpers are published now because 386's wiring must not have to widen the firewall to
// happen. The FUNC-02 surface allow-list is exactly {agent, schema} and D-01 forbids new
// code from ever joining the legacy ledger, so a surface reaching the safety package
// directly would be a firewall violation with no legal repair; re-exporting the two helpers
// here is what keeps that later wiring an ordinary, non-breaking change. This is research
// Open Question 1, resolved as Pitfall 4 option (a) — STAGED, not currently load-bearing.
//
// They are safe to publish on this barrel precisely because they are NOT dispatch: neither
// one can resolve, gate, or run a capability, so re-exporting them opens no path around
// `invokeFunction` (T-384-01). Both belong to the pinned export set the plan-07 barrel
// assertion freezes.
export { createMaskingContext, unmaskForHumanOutput } from '@vostride/agent-qa-safety'
