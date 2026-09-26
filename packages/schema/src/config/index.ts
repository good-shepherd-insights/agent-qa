export type { PlatformBase, TimeoutConfig } from './base'
export { platformBase, platformBaseShape, timeoutConfigSchema } from './base'
// 2026-09-26, 429-01 D-19: the field-merge write DTO PATCH /api/config parses.
export type {
  ConfigChange,
  ConfigNamedArray,
  ConfigPathSegment,
  ConfigWriteIssue,
  ConfigWriteOp,
  ConfigWriteRefusal,
  ConfigWriteRequest,
  ConfigWriteResult,
} from './config-write'
export {
  CONFIG_NAMED_ARRAYS,
  CONFIG_REVISION_ABSENT,
  CONFIG_WRITE_OPS,
  CONFIG_WRITE_REFUSALS,
  ConfigChangeSchema,
  ConfigPathSegmentSchema,
  ConfigWriteRequestSchema,
} from './config-write'
// 2026-09-26, 429-03 D-08: the one masking map every config surface shares, and the schema's
// leaf list derived from it.
export type { ConfigLeafPattern, MaskingClass } from './masking'
export {
  CONFIG_MASKING_MAP,
  CONFIG_SCHEMA_LEAVES,
  classifyConfigPath,
  configLeafOwner,
  MASKING_CLASSES,
} from './masking'
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
