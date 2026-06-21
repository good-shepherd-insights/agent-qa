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

export { asRef, type Ref, type Point, type BoundingBox } from './primitives/index'

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
