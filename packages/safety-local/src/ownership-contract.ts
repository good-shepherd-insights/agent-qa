import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_SAFETY_LOCAL_PACKAGE_NAME = '@vostride/agent-qa-safety-local'
export const AGENT_QA_SAFETY_LOCAL_PACKAGE_DIR = 'packages/safety-local'
export const AGENT_QA_SAFETY_LOCAL_PACKAGE_CLASSES = ['storageImplementation'] as const
export const AGENT_QA_SAFETY_LOCAL_ALLOWED_RESPONSIBILITIES = [
  'local JSONL audit writer implementation behind the safety AuditSink port',
  'local guardrail configuration loader implementation for execution safety',
  'filesystem access for local safety audit and guardrail configuration adapters',
  'local AsyncLocalStorage run-scope binding behind the safety masking-context resolver seam',
  'host execution-context detection behind the safety resolver seam',
] as const
export const AGENT_QA_SAFETY_LOCAL_FORBIDDEN_RESPONSIBILITIES = [
  'provider invocation ownership',
  'execution-safety policy decision logic',
  'masking or guardrail detection semantics',
  'agent decision or planning logic',
] as const
export const AGENT_QA_SAFETY_LOCAL_EXTERNAL_DEPENDENCIES = [] as const
export const AGENT_QA_SAFETY_LOCAL_INTERNAL_DEPENDENCIES = [
  '@vostride/agent-qa-safety',
  '@vostride/agent-qa-schema',
] as const

export const AGENT_QA_SAFETY_LOCAL_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_SAFETY_LOCAL_PACKAGE_NAME,
  packageDir: AGENT_QA_SAFETY_LOCAL_PACKAGE_DIR,
  packageClasses: AGENT_QA_SAFETY_LOCAL_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_SAFETY_LOCAL_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_SAFETY_LOCAL_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_SAFETY_LOCAL_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_SAFETY_LOCAL_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
