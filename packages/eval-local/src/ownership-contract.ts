import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_EVAL_LOCAL_PACKAGE_NAME = '@vostride/agent-qa-eval-local'
export const AGENT_QA_EVAL_LOCAL_PACKAGE_DIR = 'packages/eval-local'
export const AGENT_QA_EVAL_LOCAL_PACKAGE_CLASSES = ['storageImplementation'] as const
export const AGENT_QA_EVAL_LOCAL_ALLOWED_RESPONSIBILITIES = [
  'all eval filesystem IO behind the neutral handoff and artifact read ports',
  'handoff and artifact reads composed over runner-local stores',
  'cassette bundle writes under the runtime workdir staging root',
] as const
export const AGENT_QA_EVAL_LOCAL_FORBIDDEN_RESPONSIBILITIES = [
  'provider invocation ownership',
  'agent decision or planning logic',
  'platform-adapter execution',
  'cassette extraction, scoring, or projection logic owned by eval core',
] as const
export const AGENT_QA_EVAL_LOCAL_EXTERNAL_DEPENDENCIES = [] as const
export const AGENT_QA_EVAL_LOCAL_INTERNAL_DEPENDENCIES = [
  '@vostride/agent-qa-eval',
] as const

export const AGENT_QA_EVAL_LOCAL_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_EVAL_LOCAL_PACKAGE_NAME,
  packageDir: AGENT_QA_EVAL_LOCAL_PACKAGE_DIR,
  packageClasses: AGENT_QA_EVAL_LOCAL_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_EVAL_LOCAL_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_EVAL_LOCAL_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_EVAL_LOCAL_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_EVAL_LOCAL_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
