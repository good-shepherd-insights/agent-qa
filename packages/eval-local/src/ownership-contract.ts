import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_EVAL_LOCAL_PACKAGE_NAME = '@vostride/agent-qa-eval-local'
export const AGENT_QA_EVAL_LOCAL_PACKAGE_DIR = 'packages/eval-local'
export const AGENT_QA_EVAL_LOCAL_PACKAGE_CLASSES = ['storageImplementation'] as const
export const AGENT_QA_EVAL_LOCAL_ALLOWED_RESPONSIBILITIES = [
  'operator-only label calibration publication through eval-report egress, complete target authorization and guarded label evidence reads',
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
  // bindJudgePanel composes N existing bindJudgePort handles at this same factory site.
  // Replay, Gate 1 and operator calibration invoke them only inside runSafetyScope;
  // this exception does not authorize another factory or general provider invocation.
  'the tier-4 judge-port binding through createModel, including bindJudgePanel as N existing bindings during replay, Gate 1 and operator calibration inside runSafetyScope',
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
  // Phase 413 D-15/D-19/D-20 (ROOT-05/ROOT-11): the committed census and per-profile baseline
  // pointer join the reports/ family under the SAME 'eval-report' checkpoint channel — never a
  // new channel — and the same write-once refusal (identical regen ⇒ 'unchanged', a key already
  // pointing elsewhere ⇒ 'write-conflict', so moving a baseline stays a reviewed git edit). The
  // pointer writer additionally consults eval core's ONE comparator predicate BEFORE any write,
  // so a same-family-judged report is refused rather than designated. Paired with the read leg
  // that loads the committed root back for derivation; every derivation stays in eval core.
  'the write-once committed census and baseline-pointer writers under agent-qa-eval/reports/ behind the eval-report checkpoint, and the committed-root read leg',
  // Phase 415 D-04/D-16: per-profile floors and the report's optional decisions part share
  // eval-report. The per-repeat reports stay local because every whole-corpus replay shares
  // the designated baseline's batchKey; committing another body would be a write-conflict.
  // Retargeted sweep/assembly and the gate/floor compositions bind the existing ports;
  // measurement, scoring and verdict derivations remain in eval core.
  'the write-once noise-floor artefact writer under agent-qa-eval/reports/noise-floor/ and the decisions.json third part of the report commit, both behind the eval-report checkpoint — never a third channel; the per-repeat retargeted replay sweep and batch assembly; the gate-side release-gate and floor compositions over the committed-root read leg',
  // Phase 414 D-02/D-05/D-15 (ROOT-07/ROOT-08/ROOT-10): the partition manifest and the run
  // exclusion are two more committed documents, so they join the SEEDING family under the SAME
  // 'eval-seeding' checkpoint channel seedCommittedCorpus already owns — never a third channel,
  // for the reason D-15 gave on the report side: a new channel is a new policy surface no
  // reviewed policy covers. Both are write-once (a manifest whose salt or fractions disagree
  // with the committed one ⇒ 'write-conflict', because changing them re-partitions a corpus that
  // has already been gated against; an exclusion compares runExclusionCore so a later backfill
  // block never reads as a new decision). Neither writer mints a salt — it arrives as data from
  // the seed verb. Beside them, the gate-side posture composition folds the committed-root read
  // leg and the manifests into eval core's pure readGatePosture; the derivation stays in eval
  // core, and the symbol lives on the MAIN entry because private held-out entries gate (D-09)
  // and the proposer's reader port must never count them.
  'the write-once partition-manifest and run-exclusion writers under agent-qa-eval/contracts/ and agent-qa-eval/exclusions/ behind the eval-seeding checkpoint, and the gate-side posture composition over the committed-root read leg',
  // Phase 414 D-18/D-19/D-20 (ROOT-10 SC5): the proposer-side /reader subpath — a SECOND package
  // entry, published beside the main one for the reason knowledge-local's reader entry exists:
  // an entry is the only boundary a rule can key on. The main entry is the GATE side (the root as
  // an fs path, the seeding and exclusion writers, the baseline pointer, the posture); this one
  // opens nothing, writes nothing and holds no lease — it reads the committed root once and hands
  // back the visibility-filtered slice. Its return types CANNOT carry a private held-out entry,
  // its cassette or its label, and a private cassetteId answers byte-identically to an id that
  // does not exist, so the port leaks neither the content nor the EXISTENCE of the unseen set.
  // Filtering only: the visibility predicate is eval core's, and no derivation happens here.
  'the proposer-side /reader subpath — visibility-filtered reads over the committed root whose return types cannot carry a private held-out entry, its cassette or its label',
  // Phase 422 D-01/D-02/D-03 (ADV-01/ADV-03/ADV-04): adversarial STORAGE, in two halves that
  // must not be confused. (1) Staging is LOCAL AUDIT DATA under
  // `.agent-qa/eval/adversarial/<product>/<batchDigest>` — the 418 D-21 feedback layout, same
  // write-once temporary-then-rename publication, same guarded path checks — holding the
  // derived cassette, its cloned standalone label and its corpus entry as the exact reviewable
  // bytes, pinned by content address in a batch manifest. Blob bytes are VALIDATED against the
  // seed's committed blobs and never copied into staging. (2) Admission is the operator's act
  // alone: `refreshAdversarialSplit` rechecks the same bytes on the `eval-adversarial` channel
  // under the policy loaded AT ADMISSION and then delegates every committed write to the
  // existing single sanctioned seeding helper — it opens no second writer and mints no third
  // channel. Generation, eligibility, target selection and the label clone are eval core's;
  // this composition executes and stores, never decides. The provider-invocation clause above
  // is UNAMENDED: nothing in the adversarial path constructs a model.
  'the adversarial batch staging store under .agent-qa/eval/adversarial/ and the operator-only admission recheck on the eval-adversarial channel, delegating committed writes to the single sanctioned seeding helper',
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
