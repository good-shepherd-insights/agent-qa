import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_AGENT_PACKAGE_NAME = '@vostride/agent-qa-agent'
export const AGENT_QA_AGENT_PACKAGE_DIR = 'packages/agent'
export const AGENT_QA_AGENT_PACKAGE_CLASSES = ['providerNeutral', 'storageNeutral'] as const
export const AGENT_QA_AGENT_ALLOWED_RESPONSIBILITIES = [
  'provider-neutral and storage-neutral QA-agent abstract-port shell for future agent boundary contracts',
] as const
export const AGENT_QA_AGENT_FORBIDDEN_RESPONSIBILITIES = [
  'filesystem, database, or process access',
  'provider invocation ownership',
  'local runtime persistence',
  'concrete platform-adapter implementations',
  'concrete store implementations',
] as const
export const AGENT_QA_AGENT_EXTERNAL_DEPENDENCIES = [] as const
export const AGENT_QA_AGENT_INTERNAL_DEPENDENCIES = [] as const

export const AGENT_QA_AGENT_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_AGENT_PACKAGE_NAME,
  packageDir: AGENT_QA_AGENT_PACKAGE_DIR,
  packageClasses: AGENT_QA_AGENT_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_AGENT_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_AGENT_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_AGENT_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_AGENT_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
