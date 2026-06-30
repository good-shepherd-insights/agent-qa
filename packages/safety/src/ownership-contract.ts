import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_SAFETY_PACKAGE_NAME = '@vostride/agent-qa-safety'
export const AGENT_QA_SAFETY_PACKAGE_DIR = 'packages/safety'
export const AGENT_QA_SAFETY_PACKAGE_CLASSES = ['providerNeutral', 'storageNeutral'] as const
export const AGENT_QA_SAFETY_ALLOWED_RESPONSIBILITIES = [
  'provider-neutral and storage-neutral execution-safety core contracts and seams',
  'interception-hook framework contracts for safety engines without provider invocation ownership',
  'egress-scan and audit storage port contracts that keep concrete storage behind adapters',
] as const
export const AGENT_QA_SAFETY_FORBIDDEN_RESPONSIBILITIES = [
  'filesystem, database, or process access',
  'provider invocation ownership or model SDK ownership',
  'concrete audit writer or guardrail-config loader implementations',
  'direct dependency on storageImplementation safety adapters',
] as const
export const AGENT_QA_SAFETY_EXTERNAL_DEPENDENCIES = [] as const
export const AGENT_QA_SAFETY_INTERNAL_DEPENDENCIES = ['@vostride/agent-qa-schema'] as const

export const AGENT_QA_SAFETY_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_SAFETY_PACKAGE_NAME,
  packageDir: AGENT_QA_SAFETY_PACKAGE_DIR,
  packageClasses: AGENT_QA_SAFETY_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_SAFETY_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_SAFETY_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_SAFETY_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_SAFETY_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
