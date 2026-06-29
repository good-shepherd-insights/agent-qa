import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_AGENT_LOCAL_PACKAGE_NAME = '@vostride/agent-qa-agent-local'
export const AGENT_QA_AGENT_LOCAL_PACKAGE_DIR = 'packages/agent-local'
export const AGENT_QA_AGENT_LOCAL_PACKAGE_CLASSES = ['storageImplementation'] as const
export const AGENT_QA_AGENT_LOCAL_ALLOWED_RESPONSIBILITIES = [
  'local agent persistence-store implementation for jobs, checkpoints, conversations, approvals, and patches',
  'filesystem access for local agent persistence stores',
  'sqlite access for local agent persistence stores',
] as const
export const AGENT_QA_AGENT_LOCAL_FORBIDDEN_RESPONSIBILITIES = [
  'provider invocation ownership',
  'platform-adapter execution',
  'agent decision or planning logic',
  'knowledge curation semantics',
] as const
export const AGENT_QA_AGENT_LOCAL_EXTERNAL_DEPENDENCIES = [] as const
export const AGENT_QA_AGENT_LOCAL_INTERNAL_DEPENDENCIES = ['@vostride/agent-qa-agent'] as const

export const AGENT_QA_AGENT_LOCAL_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_AGENT_LOCAL_PACKAGE_NAME,
  packageDir: AGENT_QA_AGENT_LOCAL_PACKAGE_DIR,
  packageClasses: AGENT_QA_AGENT_LOCAL_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_AGENT_LOCAL_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_AGENT_LOCAL_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_AGENT_LOCAL_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_AGENT_LOCAL_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
