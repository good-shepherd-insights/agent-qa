export const AGENT_QA_SCHEMA_PACKAGE_NAME = '@vostride/agent-qa-schema'
export const AGENT_QA_SCHEMA_PACKAGE_DIR = 'packages/schema'
export const AGENT_QA_SCHEMA_PACKAGE_CLASSES = [
  'browserSafe',
  'providerNeutral',
  'storageNeutral',
] as const
export const AGENT_QA_SCHEMA_ALLOWED_RESPONSIBILITIES = [
  'browser-safe, provider-neutral, storage-neutral type, DTO, and validator contracts',
  'pure constants and serializable value-object contracts shared by downstream packages',
] as const
export const AGENT_QA_SCHEMA_FORBIDDEN_RESPONSIBILITIES = [
  'filesystem, database, or process access',
  'provider invocation ownership',
  'runner execution side effects',
  'local runtime persistence',
] as const
export const AGENT_QA_SCHEMA_DEPENDENCIES = ['@vostride/agent-qa-ids', 'zod'] as const

export type AgentQaSchemaPackageClass = typeof AGENT_QA_SCHEMA_PACKAGE_CLASSES[number]
export type AgentQaSchemaDependency = typeof AGENT_QA_SCHEMA_DEPENDENCIES[number]

export interface AgentQaSchemaOwnershipContract {
  packageName: typeof AGENT_QA_SCHEMA_PACKAGE_NAME
  packageDir: typeof AGENT_QA_SCHEMA_PACKAGE_DIR
  packageClasses: readonly AgentQaSchemaPackageClass[]
  allowedResponsibilities: readonly string[]
  forbiddenResponsibilities: readonly string[]
  dependencies: readonly AgentQaSchemaDependency[]
}

export const AGENT_QA_SCHEMA_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_SCHEMA_PACKAGE_NAME,
  packageDir: AGENT_QA_SCHEMA_PACKAGE_DIR,
  packageClasses: AGENT_QA_SCHEMA_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_SCHEMA_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_SCHEMA_FORBIDDEN_RESPONSIBILITIES,
  dependencies: AGENT_QA_SCHEMA_DEPENDENCIES,
} as const satisfies AgentQaSchemaOwnershipContract
