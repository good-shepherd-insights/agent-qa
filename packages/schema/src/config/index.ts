export type { PlatformBase, TimeoutConfig } from './base'
export { platformBase, platformBaseShape, timeoutConfigSchema } from './base'
// 2026-09-26, 429-01 D-19: the field-merge write DTO PATCH /api/config parses; 429-04 D-09/D-24
// adds the reveal and Undo DTOs beside it.
export type {
  ConfigActionRefusal,
  ConfigChange,
  ConfigNamedArray,
  ConfigPathSegment,
  ConfigRevealRequest,
  ConfigRevealResult,
  ConfigUndoRequest,
  ConfigUndoResult,
  ConfigWriteIssue,
  ConfigWriteOp,
  ConfigWriteRefusal,
  ConfigWriteRequest,
  ConfigWriteResult,
} from './config-write'
// 2026-09-27, 429-44 WR-01: the page write door's denied roots and path policy.
export type { ConfigWriteDeniedRoot } from './config-write'
export {
  CONFIG_ACTION_REFUSALS,
  CONFIG_NAMED_ARRAYS,
  CONFIG_REVISION_ABSENT,
  CONFIG_WRITE_DENIED_ROOTS,
  CONFIG_WRITE_OPS,
  CONFIG_WRITE_REFUSALS,
  ConfigChangeSchema,
  ConfigPathSegmentSchema,
  ConfigRevealRequestSchema,
  ConfigUndoRequestSchema,
  ConfigWriteRequestSchema,
  isPageWritableConfigPath,
} from './config-write'
// 2026-09-26, 429-03 D-08: the one masking map every config surface shares, and the schema's
// leaf list derived from it.
export type { ConfigLeafPattern, MaskingClass } from './masking'
export {
  CONFIG_MASKING_MAP,
  CONFIG_SCHEMA_LEAVES,
  classifyConfigPath,
  configLeafOwner,
  isConfigSchemaPath,
  MASKING_CLASSES,
} from './masking'
// 432 D-18: the production refusal's one sentence, shared by the run core and the live editor.
export {
  ALLOW_PRODUCTION_OPT_IN,
  buildProductionRefusal,
  distinctInFirstOccurrenceOrder,
} from './production'
export type { BrowserConfig } from './browser'
export { appStateSchema, browserConfigSchema, viewportSchema } from './browser'
export type { DeviceConfig } from './device'
export { deviceConfigSchema } from './device'
export type { McpStdioGrant, McpTokenEntry } from './mcp'
export { McpStdioGrantSchema, McpTokenEntrySchema } from './mcp'
// 402-01 D-05/D-06: the run service's credential declaration. Same refs-only idiom as the MCP
// entry above; what an entry grants is a TrustScope rather than a FunctionScope set, because the
// remote door's capability is fixed at composition and only the trust varies per holder.
export type { RunServiceTokenEntry } from './run-service'
export { RunServiceTokenEntrySchema } from './run-service'
export type { RemoteDeviceConfig } from './remote-device'
export { remoteDeviceSchema } from './remote-device'
export type {
  AndroidPlatformConfig,
  IosPlatformConfig,
  PlatformConfig,
  WebAuthStateConfig,
  WebPlatformConfig,
} from './platform-config'
export { platformConfigSchema } from './platform-config'
export type {
  EffectiveWorkersInput,
  Use,
  UseAndroid,
  UseConcurrency,
  UseIos,
  UseWeb,
  UseWebAuthState,
} from './use'
export { DEFAULT_PARALLEL_WORKERS, resolveEffectiveWorkers, useSchema } from './use'
