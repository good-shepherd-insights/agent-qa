import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_RUNNER_LOCAL_PACKAGE_NAME = '@vostride/agent-qa-runner-local'
export const AGENT_QA_RUNNER_LOCAL_PACKAGE_DIR = 'packages/runner-local'
export const AGENT_QA_RUNNER_LOCAL_PACKAGE_CLASSES = ['storageImplementation'] as const
export const AGENT_QA_RUNNER_LOCAL_ALLOWED_RESPONSIBILITIES = [
  'local filesystem action-plan cache store behind the runner ActionPlanCache port',
  'git-branch + default/protected-branch detection for cache namespacing',
  'branch write-skip policy evaluation for the cache store',
  'local filesystem JSONL run-event log behind the runner EventLogPort',
  'local filesystem completed-run handoff store behind the runner HandoffStorePort',
  'project-local per-product buildOrdinal counter persistence',
] as const
export const AGENT_QA_RUNNER_LOCAL_FORBIDDEN_RESPONSIBILITIES = [
  'cache-key assembly or hashing semantics',
  'cacheable/non-cacheable classification logic',
  'agent decision or planning logic',
] as const
export const AGENT_QA_RUNNER_LOCAL_EXTERNAL_DEPENDENCIES = [] as const
export const AGENT_QA_RUNNER_LOCAL_INTERNAL_DEPENDENCIES = [
  '@vostride/agent-qa-runner',
  '@vostride/agent-qa-schema',
] as const

export const AGENT_QA_RUNNER_LOCAL_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_RUNNER_LOCAL_PACKAGE_NAME,
  packageDir: AGENT_QA_RUNNER_LOCAL_PACKAGE_DIR,
  packageClasses: AGENT_QA_RUNNER_LOCAL_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_RUNNER_LOCAL_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_RUNNER_LOCAL_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_RUNNER_LOCAL_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_RUNNER_LOCAL_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
