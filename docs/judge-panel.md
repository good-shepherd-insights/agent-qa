# Judge panel

The optional tier-4 judge settles element or value equivalence that deterministic replay
cannot settle. Declare the judges explicitly; agent-qa never assembles a panel from the
registry or from available credentials. Disjoint-family majority is a decision rule, not
an empirical correctness guarantee. This guide records Phase 421 decisions D-01–D-16.

## Declaration and eligibility (D-01–D-04, D-09–D-12)

Use registry entry names in the strict eval block. This example assumes `judge-a` and
`judge-b` already name suitable entries in `registry.llms`:

```yaml
eval:
  judges: [judge-a, judge-b]
```

`eval.judge: judge-a` remains the single-judge form. Setting both `judge` and `judges`
is a typed config refusal, even when one list is empty. An absent/empty declaration means
no judge; one entry follows the direct single-judge path. More than three entries refuses
instead of truncating. Aliases resolving to the same model do not create independence.
There is no configurable pooling mode or planner/judge-family override field.

`--judge <name>` is repeatable on `eval replay`, `eval gate` and `eval replay-gate`.
The supplied flags replace the entire configured declaration:

```sh
agent-qa --config agent-qa.config.yaml eval replay --source committed --judge judge-a --judge judge-b
agent-qa --config agent-qa.config.yaml eval gate --judge judge-a --judge judge-b --json
agent-qa --config agent-qa.config.yaml eval replay-gate <candidateId> --judge judge-a --judge judge-b --dry-run --json
```

These commands can spend on replay/judging; `--dry-run` on replay-gate suppresses receipt
recording, not model calls. `eval floor`, `eval report` and `eval calibrate --judge-panel`
use the selected config and have no `--judge` flag.

Eligibility resolves family sets from the actual replay profile's model ID, every judge's
model ID and each source cassette's recorded receipt ID. A present but unknown ID refuses;
a genuinely absent recorded ID stays absent. Every judge must be disjoint from the replay
model, the recorded model when present, and every other judge. Any collision refuses the
whole declaration: no pruning, deduplication into a smaller panel, or automatic replacement.
The batch can still run deterministic scoring; unresolved ties record
`not-invoked` / `no-eligible-judge`, naming member families and an offending pair when known.
Gate 1 uses `replay-diff` with `same-family-refused` and `judge.eligibility: no-eligible-judge`.

The boundary-anchored longest-token base family map is unchanged. Additive lineage entries
are exactly `deepseek-r1-distill-llama` → `{deepseek, llama}` and
`deepseek-r1-distill-qwen` → `{deepseek, qwen}`. They only forbid more pairings; provider
names cannot establish model independence. This law and the frozen prompt/rubric/defaults
are hash-covered by judge version 2. `contracts/judge-config.v1.json` remains historical;
`contracts/judge-config.v2.json` is a separate immutable projection.

`eval.judgeAllowSameFamily` is ignored with a notice for a composite panel. No composite
identity carries `familyOverride`. The direct/singleton path retains its disclosed legacy
override meaning for replay/report; Gate 1 still refuses it. A singleton is never described
as independent panel consensus.

## Identity, cold profiles and pooling (D-02, D-04–D-08)

A composite ID is `panel:` plus code-point-sorted, individually URI-escaped model IDs
joined with `+`. Its identity contains `panelSize`, canonical `members` with IDs/families,
the combined family display and `judgeVersion: 2`. Scores, Gate-1 receipts and cache keys
carry that identity. A singleton has the plain single-judge block, without `panelSize`
or composite members; direct/singleton equivalence is at the same constitution version.
A mixed single/panel batch is `mixed-judge-identity`, not a synthesized comparator.

Changing the panel, planner, profile fingerprint or judge version changes the profile key.
The new profile needs its own measured floor and designated baseline; Gate 1's cache starts
cold. With the desired panel in the selected config, the operator workflow is:

```sh
agent-qa --config agent-qa.config.yaml eval floor --commit --json
agent-qa --config agent-qa.config.yaml eval replay --source committed --json
agent-qa --config agent-qa.config.yaml eval report --source committed --commit --baseline --json
agent-qa --config agent-qa.config.yaml eval gate --json
```

Inspect each outcome before proceeding. A zero floor requires `--explanation <text>`;
floor defaults remain three repeats, seeds `11,29` and bootstrap seed `7`. Baseline and
floor publication preserve write-once history. Without comparable profile-specific inputs,
`eval gate` returns exit 2 (`incomparable`/inconclusive), never a pass. For a saved report,
`eval gate --report <batchKey> --json` performs the comparison with zero model calls.
Panels bind through N copies of the existing judge binding in replay, floor, release gate,
both replay-gate arms, the CLI one-shot drain, daemon host and production Gate-1 bridge.
The categorical Gate-1 zero-tolerance collateral-harm law is unchanged.

Binary `max` means **strict majority of settled members**, with at least two settled.
Abstainers do not vote; errors remain errors rather than votes or implicit dissent.
Two-to-one settles; one-to-one and two-to-two abstain `panel-disagreement`; fewer than
two settled abstains `below-quorum`. Confidence is the minimum among majority members;
the existing high-only, swap-agreement threshold applies separately to every member.
Every member outcome and usage remains auditable; honest zero tie counters stay zero.

`avg` is reserved: finite numeric scores in `[0,1]` have pinned arithmetic-mean vectors,
but there is no live scored judge question or numeric confidence estimate. `unsure` is
never turned into a midpoint. Members run sequentially, each with two sequential swapped
requests. The recorded `maxPanelMembers: 3` rationale is a small three-family panel with
at most six calls **per comparison**. A no-consensus decision can examine up to three
distinct candidates, so its bound is eighteen calls, not six per decision.

## Forced calibration and denominators (D-13–D-16)

```sh
agent-qa --config agent-qa.config.yaml eval calibrate --judge-panel --json
agent-qa --config agent-qa.config.yaml eval calibrate --judge-panel --min-n 20 --json
agent-qa --config agent-qa.config.yaml eval calibrate --judge-panel --commit --json
agent-qa --config agent-qa.config.yaml eval calibrate --judge-panel --commit --replace --json
```

Unlike label calibration, a judge-panel **preview can incur bounded model calls and local
audit writes**. It asks one existing element-equivalence question (or value-equivalence
when the element question is unavailable) for each admitted executable gold decision,
even when deterministic tiers already settled. It does not replay the planner to invent
the candidate. The latest governing private held-out Gate-3 gold, the exactly joined
saved replay candidate, and independent truth are separate inputs. Corrected user marks
supply executable gold; confirmed-bug marks use their confirmed action. Gold without a
usable action, missing/foreign/stale/ambiguous replay or identity evidence is counted in
typed skip diagnostics. A source decision is counted once, not once per member or gold copy.

Saved calibration evidence comes from floor/gate runs and uses their `declared` seed
policy, including when `eval.seed` is absent. For each source decision, automatic selection
prefers floor over gate, then the lowest numeric **global schedule index**. The default
floor schedule is `r0-seed11`, `r1-seed11`, `r2-seed11`, `r3-seed29`: all four runs are
guarded, and the first supplies one observation. Different actions in distinct schedule
slots are legitimate repeat variation; selection never ranks outcome, agreement, truth or
directory modification time. Repeats do not increase independent `n`.

Each directory seed must match its publication seed. Duplicate publications, multiple
seeds claiming one index, unknown floor entries, and malformed/foreign present evidence
refuse rather than silently falling back to gate. Explicit library `replayRunRoots` selection
retains exact-one admission. Calibration, doctor, reports and artifact rereads share this
reader and its rule; chosen replay/report paths and exact digests remain in `selectedInputs`.
Replacing chosen evidence invalidates the artifact until explicitly measured and published
again. This fixed first-observation sample is reproducible, not a best-of-repeats estimate.

Truth is recomputed with the judge-free production full-match predicate. A grounded exact
correction can establish truth when it satisfies the other full-match conditions; a
remaining tie stays `truth-unresolved`. The panel's answer never supplies its own truth.
Before binding each observation, the whole panel is checked again against the **actual
recorded receipt**, so a preflight success cannot bypass per-row family/lineage exclusion.
Calls use `bindJudgePanel` inside fresh safety scopes and the invocation's local audit dir.

The artifact separates `selected`, `admitted`, `eligible`, `attempted`, `eligibilityRefused`,
`evidenceSkipped`, `truthComparable` and `unresolvedTruth`. Pooled agreement's `n` counts
only independently truth-comparable, pooled-settled decisions. Each member has its own
settled/truth-comparable denominator. Abstention rate uses attempted decisions; errors are
counted separately. Member disagreement uses pairs for which both members settled, even
if external truth remains unresolved; its aggregate denominator is paired observations.
Refusals are selection data, not measured abstention. Zero denominators emit no rate or
Wilson interval. Counts and nonzero-denominator estimates can still be disclosed below
the minimum while status remains `uncalibrated`.

`JUDGE_CALIBRATION_MIN_N = 20` is independent of `LABEL_CALIBRATION_MIN_GOLD`. Its recorded
rationale is a useful Wilson interval over independent decisions, not population accuracy.
`--min-n` accepts a safe integer at least 2 and stamps `minNSource: flag`; omission stamps
`default`. `--min-gold` is for label calibration only; mixing it with `--judge-panel`, or
using `--min-n` alone, refuses. `calibrated` means pooled `n` met that effective minimum.
Agreement/Wilson 95% intervals, per-member tallies, abstention/disagreement and actual usage
are separate disclosures. Probe call bound is attempted decisions × members × 2.

**These are measurements on selected operator marks, not an unbiased estimate of all
production traffic.** Fake fixtures prove arithmetic and behavior, not empirical accuracy.
No real calibrated artifact was produced by Phase 421 execution; JUDGE-FUT-01 remains open
unless a valid real calibrated artifact is separately established at phase acceptance.

## Capability gaps, publication and inspection (D-14–D-16)

Preflight requires an explicit declaration of at least two locally credentialed, pairwise
disjoint members. It does no remote authentication or model call. The closed gap reasons
are `panel-not-configured`, `no-credential` and `single-family-host`; safe entry diagnostics
explain missing/unauthenticated credentials, unresolved entries, unknown families or collisions.
Credential presence does not prove remote validity. No auto-assembly or provider setup occurs.
The current demo has `eval: {}`: its outcome is `panel-not-configured`, even if a Claude
credential is added. Declaration, independence, per-row eligibility and usable gold are
additional requirements; a credential alone cannot make calibration run.

| Invocation/outcome | Committed artifact behavior |
| --- | --- |
| Preview | No committed calibration write; an eligible probe can spend and audit locally. |
| Absent/empty/singleton declaration, including `--commit --replace` | Successful `panel-not-configured`, zero calls, `artifactDisposition: not-created`; no fabricated composite key/path and no committed write. |
| Genuine composite, including an identity-bearing credential/family gap | `--commit` uses the checked publication contract; a gap has zero probes and no agreement estimate. Complete admissible evidence is still required. |
| Identical admissible artifact | `unchanged`; preserves bytes. |
| Divergent artifact | `write-conflict` unless `--commit --replace` explicitly authorizes replacement. |
| `--replace` without `--commit` | Refused. |
| Invalid, drifting, busy, unsafe or unavailable evidence/destination | Typed refusal/conflict; inspect the result, do not treat it as calibrated. |

Publication uses `agent-qa-eval/reports/judge-calibration/<slug(profileKey)>.json`, separately
from `labels/calibration.json`. The slug is only a locator: admission checks the full profile,
canonical member identity, constitution, gold/corpus/replay/evidence digests, minimum and its
source, counts and arithmetic. Every committed write crosses `assertCommittedEgressSafe`
on the existing `eval-report` channel, with checked lock/input/destination ownership and
atomic publication. Invocation audit paths do not alter canonical artifact bytes.

New composite reports copy guarded calibration disclosure: `calibrated`, `uncalibrated`
or `capability-gap`. Absent/refused current artifacts read `uncalibrated n=0 (unavailable)`;
renderers never recompute estimates. Single-judge reports omit the panel calibration block.
Old committed reports remain readable and byte-identical. A later artifact replacement does
not revise those copied historical values; regenerating divergent committed report bytes
still conflicts. Baseline designation can select already-committed history separately.

`agent-qa --config agent-qa.config.yaml doctor` appends panel member/family and calibration
status to Learning-mode disclosure even before a panel floor or knowledge root exists.
No declaration reports the gap; a singleton gets no panel suffix. Doctor reads current
checked evidence and credential presence without probing models or repairing artifacts.
Inspect the selected config's committed root and matching saved replay inputs read-only;
preserve history, resolve the reported access/identity/drift issue, then preview explicitly.
Neither doctor nor floor publication manufactures calibration. Publishing a reviewed
replacement remains the separate operator command above.
