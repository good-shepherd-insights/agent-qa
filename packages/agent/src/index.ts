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
// results as prose, and prose is the sole unmasking surface. Re-exported here so a
// surface never needs a direct safety import to unmask what it prints.
export { createMaskingContext, unmaskForHumanOutput } from '@vostride/agent-qa-safety'
