export { mapPromptLeaves } from './egress/map-prompt-leaves'
export { createMaskingMiddleware } from './egress/masking-middleware'
// 2026-10-01 (432-19, D-15/D-16): risk classification and the tier order stay because eval scores
// side effects with them. The execution policy gate, its ask ladder and its confirm and
// standing-approval ports are deleted; the execution context and its resolver stay.
// 2026-10-15 (441-33, D-12/D-15): the masking context, the guardrails, the hook registrar and the
// audit port are deleted; only declared values are masked, by createMaskingMiddleware.
export { classifyRisk, TIER_ORDER } from './policy/risk-classifier'
export {
  getActiveExecutionContext,
  resolveExecutionContext,
  setActiveExecutionContextResolver,
} from './policy/execution-context'
export {
  APP_OBSERVED_DATA_CLOSE,
  APP_OBSERVED_DATA_OPEN,
  wrapAppObservedData,
} from './serving/data-delimiters'
export type { ProviderRequestParams } from './egress/map-prompt-leaves'
export type {
  ExecutionContextResolver,
  ExecutionContextSignals,
} from './policy/execution-context'
