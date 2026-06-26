export const AGENT_QA_MODEL_PACKAGE_NAME = '@vostride/agent-qa-model'
export const AGENT_QA_MODEL_PACKAGE_DIR = 'packages/model'
export const AGENT_QA_MODEL_PACKAGE_CLASSES = ['modelOwner', 'storageNeutral'] as const
export const AGENT_QA_MODEL_ALLOWED_RESPONSIBILITIES = [
  'provider SDK adapters, provider registry ownership, and profile-to-LanguageModel adapters',
  'central language-model middleware for model-owner package boundaries',
] as const
export const AGENT_QA_MODEL_FORBIDDEN_RESPONSIBILITIES = [
  'filesystem, database, or process access',
  'runner execution side effects',
  'browser-only DTO ownership',
  'local runtime persistence',
] as const
export const AGENT_QA_MODEL_DEPENDENCIES = [
  'ai',
  '@ai-sdk/openai',
  '@ai-sdk/anthropic',
  '@ai-sdk/google',
  '@ai-sdk/provider',
  '@vostride/agent-qa-schema',
] as const

export type AgentQaModelPackageClass = typeof AGENT_QA_MODEL_PACKAGE_CLASSES[number]
export type AgentQaModelDependency = typeof AGENT_QA_MODEL_DEPENDENCIES[number]

export interface AgentQaModelOwnershipContract {
  packageName: typeof AGENT_QA_MODEL_PACKAGE_NAME
  packageDir: typeof AGENT_QA_MODEL_PACKAGE_DIR
  packageClasses: readonly AgentQaModelPackageClass[]
  allowedResponsibilities: readonly string[]
  forbiddenResponsibilities: readonly string[]
  dependencies: readonly AgentQaModelDependency[]
}

export const AGENT_QA_MODEL_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_MODEL_PACKAGE_NAME,
  packageDir: AGENT_QA_MODEL_PACKAGE_DIR,
  packageClasses: AGENT_QA_MODEL_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_MODEL_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_MODEL_FORBIDDEN_RESPONSIBILITIES,
  dependencies: AGENT_QA_MODEL_DEPENDENCIES,
} as const satisfies AgentQaModelOwnershipContract
