import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_MODEL_PACKAGE_NAME = '@vostride/agent-qa-model'
export const AGENT_QA_MODEL_PACKAGE_DIR = 'packages/model'
export const AGENT_QA_MODEL_PACKAGE_CLASSES = ['modelOwner', 'storageNeutral'] as const
export const AGENT_QA_MODEL_ALLOWED_RESPONSIBILITIES = [
  'provider SDK adapters, provider registry ownership, and profile-to-LanguageModel adapters',
  'central language-model middleware for model-owner package boundaries',
  'provider-neutral token-accounting, deterministic message-degrade, and log-compaction substrate over AI SDK ModelMessage[]',
] as const
export const AGENT_QA_MODEL_FORBIDDEN_RESPONSIBILITIES = [
  'filesystem, database, or process access',
  'runner execution side effects',
  'browser-only DTO ownership',
  'local runtime persistence',
] as const
export const AGENT_QA_MODEL_EXTERNAL_DEPENDENCIES = [
  'ai',
  '@ai-sdk/openai',
  '@ai-sdk/anthropic',
  '@ai-sdk/google',
  '@ai-sdk/provider',
] as const
export const AGENT_QA_MODEL_INTERNAL_DEPENDENCIES = [
  '@vostride/agent-qa-schema',
  '@vostride/agent-qa-safety',
] as const

export const AGENT_QA_MODEL_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_MODEL_PACKAGE_NAME,
  packageDir: AGENT_QA_MODEL_PACKAGE_DIR,
  packageClasses: AGENT_QA_MODEL_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_MODEL_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_MODEL_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_MODEL_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_MODEL_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
