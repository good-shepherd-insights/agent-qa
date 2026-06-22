export {
  AGENT_QA_SCHEMA_ALLOWED_RESPONSIBILITIES,
  AGENT_QA_SCHEMA_DEPENDENCIES,
  AGENT_QA_SCHEMA_FORBIDDEN_RESPONSIBILITIES,
  AGENT_QA_SCHEMA_OWNERSHIP_CONTRACT,
  AGENT_QA_SCHEMA_PACKAGE_CLASSES,
  AGENT_QA_SCHEMA_PACKAGE_DIR,
  AGENT_QA_SCHEMA_PACKAGE_NAME,
  type AgentQaSchemaDependency,
  type AgentQaSchemaOwnershipContract,
  type AgentQaSchemaPackageClass,
} from './ownership-contract'

export { asRef, type Ref, type Point, type BoundingBox, type Viewport } from './primitives/index'

export type {
  Action,
  CrossPlatformAction,
  MobileAction,
  Platform,
  RefTargeted,
  TabSelector,
  WebAction,
} from './action/index'
export type { ActionExecutor, ActionsFor } from './action/adapter'
export type { ActionAnnotation, ActionResult } from './result/index'
export { normalizeAccessibleName } from './screen/index'
export type { ElementBounds, ScrollContext } from './screen/index'
export type { ElementInfo, ElementState, ElementLabels, ElementHierarchy } from './screen/index'
export type { ScreenState } from './screen/index'
export type { ScreenStateMetadata, ScreenStateMetadataBase } from './screen/index'
export type { ModelCapabilities } from './capability/index'
export type {
  AndroidPlatformConfig,
  BrowserConfig,
  DeviceConfig,
  IosPlatformConfig,
  PlatformBase,
  PlatformConfig,
  RemoteDeviceConfig,
  TimeoutConfig,
  Use,
  UseAndroid,
  UseIos,
  UseWeb,
  UseWebAuthState,
  WebAuthStateConfig,
  WebPlatformConfig,
} from './config/index'
export {
  appStateSchema,
  browserConfigSchema,
  deviceConfigSchema,
  platformBase,
  platformConfigSchema,
  remoteDeviceSchema,
  timeoutConfigSchema,
  useSchema,
  viewportSchema,
} from './config/index'
