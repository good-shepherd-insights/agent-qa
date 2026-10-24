import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_RUNNER_PACKAGE_NAME = '@vostride/agent-qa-runner'
export const AGENT_QA_RUNNER_PACKAGE_DIR = 'packages/runner'
export const AGENT_QA_RUNNER_PACKAGE_CLASSES = ['providerNeutral', 'storageNeutral'] as const
export const AGENT_QA_RUNNER_ALLOWED_RESPONSIBILITIES = [
  'provider-neutral and storage-neutral platform-adapter port contracts for runner execution',
  'run-artifact, reporter-event, and trace type contracts for the runner execution boundary',
  'read-only L2 knowledge-hint reader contract with no mutation surface',
  'pure screen-state construction — the shared builder that assembles adapter observe output into schema screen contracts',
  'the step-execution loop state machine (observe → plan → execute → verify → self-heal) and its neutral loop ports (cache, screenshot compressor, secret) re-derived into runner',
  'the planned-actions-as-tools registry and planning-turn orchestration over an injected LanguageModel handle via the neutral orchestration SDK',
  'evidence recording (SubActionEvidence/StepEvidence, §A8) produced by construction as the loop runs',
] as const
export const AGENT_QA_RUNNER_FORBIDDEN_RESPONSIBILITIES = [
  'filesystem, database, or process access',
  'provider resolution or provider-SDK (@ai-sdk/*) ownership — the loop orchestrates an injected LanguageModel handle via the neutral `ai` SDK, but never resolves or binds providers; model remains the sole modelOwner',
  'local runtime persistence',
  'concrete platform-adapter or store implementations',
] as const
export const AGENT_QA_RUNNER_EXTERNAL_DEPENDENCIES = ['ai', 'zod'] as const
export const AGENT_QA_RUNNER_INTERNAL_DEPENDENCIES = ['@vostride/agent-qa-safety', '@vostride/agent-qa-schema'] as const

export const AGENT_QA_RUNNER_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_RUNNER_PACKAGE_NAME,
  packageDir: AGENT_QA_RUNNER_PACKAGE_DIR,
  packageClasses: AGENT_QA_RUNNER_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_RUNNER_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_RUNNER_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_RUNNER_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_RUNNER_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
