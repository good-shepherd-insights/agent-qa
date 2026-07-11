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
  // Phase 369 D-13: per-cassette score persistence — score.json written BESIDE its replay.json in
  // the same slugged cassette dir, FILE-scoped overwrite (never a dir recreate: Pitfall 5) so the
  // composition's record-then-score ordering keeps both files alive across re-runs (OQ-2).
  // Serialization only: every score and diff arrives computed from eval core (F9) — the
  // forbidden-scoring clause below stays true.
  'per-cassette score and diff persistence beside replay records',
  // Phase 369 D-13/D-14: batch-report persistence — the aggregated EvalBatchReport as its own
  // artifact under eval/reports/, keyed by the deterministic replay-batch key. Uncommitted runtime
  // staging beside eval/replays; committed placement is Phase 371/372's concern.
  'aggregated eval batch-report persistence under the runtime staging root',
  // Phase 370 D-05/D-06: the tier-4 judge leg — bindJudgePort routes every judge call through
  // createModel (the pinned-last mask/guardrail middleware stack, JUDGE-03) at temperature 0,
  // maxRetries 0, one structured Output.object verdict per order-tagged request, parsed against
  // a closed zod schema with typed call-error degradation (the port never throws, D-11). Prompt
  // content arrives fully built from eval core (D-15) — the binding transports, never assembles.
  // Invoked only inside the single sanctioned replay-composition helper's flow (370-07 composes
  // it); the forbidden provider-invocation clause below still holds.
  'the tier-4 judge-port binding through createModel inside the sanctioned replay-composition flow',
  // Phase 371 ROOT-01/D-15/D-17: the write-once committed eval-root store under agent-qa-eval/ —
  // scaffolded gitignore covering every blobs/ dir, schemaVersion root marker, per-segment slugged
  // paths, byte-compare idempotence, typed write-conflict refusal; content policy (the
  // committed-egress checkpoint) lives in the seeding composition helper, never here.
  'the write-once committed eval-root store scaffolding and refusing under agent-qa-eval/',
  // Phase 371 D-14/D-16 (ROOT-02): the ONE sanctioned corpus-seeding composition helper
  // (seedCommittedCorpus) executing eval-core SeedingPlans — every committed text write through
  // assertCommittedEgressSafe (fail-closed, JsonlAuditSink-audited, channel 'eval-seeding'),
  // per-case atomic refusal on block or write-conflict, batch never aborts; blob bytes bypass
  // the checkpoint and land only under ignore-covered blobs/ paths (D-15). Selection and
  // labeling stay in eval core — this helper executes, never decides. 372's CLI wraps exactly
  // this function.
  'the single sanctioned corpus-seeding composition helper writing the committed eval root through the egress checkpoint',
  // Phase 372 G2/D-02/D-08: the read legs inverting the replay-record, score, and cassette-bundle
  // write legs — loadReplayRecord/loadScoreRecord mirror the loader's typed-refusal posture (every
  // read/parse failure is a returned ReplayRefusal, absence of score.json is typed, never a
  // throw), plus deterministic sorted sweep enumeration (ENOENT ⇒ empty) so every CLI verb sweeps
  // staged trees and the report verb rebuilds its inputs integrity-checked from disk.
  'replay-record, score, and staged-bundle read legs with typed refusals and sweep enumeration',
  // Phase 372 D-13 (BASE-02): commitEvalReport — the baseline report commits beside the corpus
  // and contracts that produced it, one dir per batchKey; every byte through
  // assertCommittedEgressSafe (fail-closed, JsonlAuditSink-audited, channel 'eval-report'),
  // JSON + markdown as ONE atomic checkpoint unit, write-once (identical regen ⇒ 'unchanged',
  // divergent bytes ⇒ typed 'write-conflict', never an overwrite).
  'the single egress-checked committed-report writer placing report JSON and markdown under reports/ write-once',
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
export const AGENT_QA_EVAL_LOCAL_EXTERNAL_DEPENDENCIES = ['ai', 'zod'] as const
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
