import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_EVAL_LOCAL_PACKAGE_NAME = '@vostride/agent-qa-eval-local'
export const AGENT_QA_EVAL_LOCAL_PACKAGE_DIR = 'packages/eval-local'
export const AGENT_QA_EVAL_LOCAL_PACKAGE_CLASSES = ['storageImplementation'] as const
export const AGENT_QA_EVAL_LOCAL_ALLOWED_RESPONSIBILITIES = [
  'all eval filesystem IO behind the neutral handoff and artifact read ports',
  'handoff and artifact reads composed over runner-local stores',
  'cassette bundle writes under the runtime workdir staging root',
  // Phase 368 D-04/D-05/D-06: the ONE sanctioned replay-composition helper (runCassetteReplay)
  // binding createModel egress + a temp-0 LLMPlanner (368-01 nonActionTools seam) + runSafetyScope
  // (empty-seeded MaskingContext + replay-scoped JsonlAuditSink) + optional replay-record
  // persistence. This deliberately makes eval-local the SECOND package (after cli) importing both
  // model and runner; Phase 372's CLI wraps exactly this helper.
  'the single sanctioned replay-composition helper wiring createModel + LLMPlanner + runSafetyScope',
] as const
export const AGENT_QA_EVAL_LOCAL_FORBIDDEN_RESPONSIBILITIES = [
  // The composition carve-out is narrow: provider invocation is permitted ONLY through the single
  // sanctioned replay-composition helper's one createModel call site; any other provider invocation
  // ownership remains forbidden.
  'provider invocation ownership beyond the single sanctioned replay-composition helper',
  // Likewise, replay invokes the real unmodified LLMPlanner inside that one helper — bespoke
  // planner, prompt assembly, or grounding logic remains forbidden.
  'agent decision or planning logic beyond invoking the unmodified planner in that one helper',
  'platform-adapter execution',
  'cassette extraction, scoring, or projection logic owned by eval core',
] as const
export const AGENT_QA_EVAL_LOCAL_EXTERNAL_DEPENDENCIES = [] as const
export const AGENT_QA_EVAL_LOCAL_INTERNAL_DEPENDENCIES = [
  '@vostride/agent-qa-eval',
  '@vostride/agent-qa-model',
  '@vostride/agent-qa-runner',
  '@vostride/agent-qa-runner-local',
  '@vostride/agent-qa-safety',
  '@vostride/agent-qa-safety-local',
  '@vostride/agent-qa-schema',
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
