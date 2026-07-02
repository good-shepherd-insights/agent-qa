import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_SAFETY_PACKAGE_NAME = '@vostride/agent-qa-safety'
export const AGENT_QA_SAFETY_PACKAGE_DIR = 'packages/safety'
export const AGENT_QA_SAFETY_PACKAGE_CLASSES = ['providerNeutral', 'storageNeutral'] as const
export const AGENT_QA_SAFETY_ALLOWED_RESPONSIBILITIES = [
  'provider-neutral and storage-neutral safety hook framework contracts',
  'egress-scan and policy seam contracts for execution safety engines',
  'storage-neutral audit sink port for execution and guardrail audit rows',
  'run-scoped reversible masking context with stable per-run placeholders',
  'provider-request egress masking hook, neutral run-scope resolver seam, and known-value seeding',
  'deterministic egress guardrail detector and scan engine',
  'guardrail policy load boundary (parse-or-throw, fail closed)',
  'buffering streaming egress guardrail scan with block-to-redact promotion',
  'reusable fail-closed committed-egress pre-write checkpoint with audited user-authored override',
] as const
export const AGENT_QA_SAFETY_FORBIDDEN_RESPONSIBILITIES = [
  'filesystem, database, or process access',
  'provider invocation ownership',
  'concrete audit writer or guardrail config-loader implementations',
  'local runtime persistence',
] as const
export const AGENT_QA_SAFETY_EXTERNAL_DEPENDENCIES = ['ai'] as const
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
