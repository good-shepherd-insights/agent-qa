import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_IDS_PACKAGE_NAME = '@vostride/agent-qa-ids'
export const AGENT_QA_IDS_PACKAGE_DIR = 'packages/ids'
export const AGENT_QA_IDS_PACKAGE_CLASSES = ['util'] as const
export const AGENT_QA_IDS_ALLOWED_RESPONSIBILITIES = [
  'canonical persistent ID helpers for tests, suites, hooks, and artifacts',
] as const
export const AGENT_QA_IDS_FORBIDDEN_RESPONSIBILITIES = [
  'host/storage/provider access',
  'non-trivial dependencies beyond id-agent',
] as const
export const AGENT_QA_IDS_EXTERNAL_DEPENDENCIES = ['id-agent'] as const
export const AGENT_QA_IDS_INTERNAL_DEPENDENCIES = [] as const

export const AGENT_QA_IDS_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_IDS_PACKAGE_NAME,
  packageDir: AGENT_QA_IDS_PACKAGE_DIR,
  packageClasses: AGENT_QA_IDS_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_IDS_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_IDS_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_IDS_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_IDS_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
