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
// These two helpers are re-exported here — research Open Question 1, resolved as Pitfall 4
// option (a) — because the FUNC-02 surface allow-list is exactly {agent, schema}. A surface
// that had to reach the safety package directly in order to unmask what it prints would be
// an unfixable firewall violation raised by the very phase that builds the firewall, and
// D-01 forbids new code ever joining the legacy ledger.
//
// They are safe to publish on this barrel precisely because they are NOT dispatch: neither
// one can resolve, gate, or run a capability, so re-exporting them opens no path around
// `invokeFunction` (T-384-01). Both belong to the pinned export set the plan-07 barrel
// assertion freezes.
export { createMaskingContext, unmaskForHumanOutput } from '@vostride/agent-qa-safety'
