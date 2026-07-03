import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_RUNNER_PACKAGE_NAME = '@vostride/agent-qa-runner'
export const AGENT_QA_RUNNER_PACKAGE_DIR = 'packages/runner'
export const AGENT_QA_RUNNER_PACKAGE_CLASSES = ['providerNeutral', 'storageNeutral'] as const
export const AGENT_QA_RUNNER_ALLOWED_RESPONSIBILITIES = [
  'provider-neutral and storage-neutral platform-adapter port contracts for runner execution',
  'run-artifact, reporter-event, and trace type contracts for the runner execution boundary',
  'read-only L2 knowledge-hint reader contract with no mutation surface',
  'pure screen-state construction — the shared builder that assembles adapter observe output into schema screen contracts',
] as const
export const AGENT_QA_RUNNER_FORBIDDEN_RESPONSIBILITIES = [
  'filesystem, database, or process access',
  'provider invocation ownership',
  'local runtime persistence',
  'concrete platform-adapter or store implementations',
] as const
export const AGENT_QA_RUNNER_EXTERNAL_DEPENDENCIES = [] as const
export const AGENT_QA_RUNNER_INTERNAL_DEPENDENCIES = ['@vostride/agent-qa-schema'] as const

export const AGENT_QA_RUNNER_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_RUNNER_PACKAGE_NAME,
  packageDir: AGENT_QA_RUNNER_PACKAGE_DIR,
  packageClasses: AGENT_QA_RUNNER_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_RUNNER_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_RUNNER_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_RUNNER_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_RUNNER_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
