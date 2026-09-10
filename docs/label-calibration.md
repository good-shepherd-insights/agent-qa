# Label calibration

`agent-qa eval calibrate` measures noisy labels against the latest operator marks,
previews refreshed self-heal weights, and optionally publishes one complete generation.
It makes no model calls. Run it explicitly after reviewing the local committed corpus.

```sh
agent-qa --config agent-qa.config.yaml eval calibrate
agent-qa --config agent-qa.config.yaml eval calibrate --json
agent-qa --config agent-qa.config.yaml eval calibrate --commit --json
agent-qa --config agent-qa.config.yaml eval calibrate --commit --replace --json
```

The default minimum is **20 independent marked source decisions per noisy channel**, across
products. `--min-gold <n>` accepts a safe integer of at least 2 and records the override
as `minGold: { value: n, source: 'cli' }`; the default records `source: 'default'`.
Below the minimum, a channel is `uncalibrated` and emits no prior. Empty gold sets are
valid and disclose zero counts, without a precision number or an invented perfect score.

| Option | Behavior |
| --- | --- |
| No write option | Preview only; preserves the complete workspace byte tree, including audit and lock files. Candidate text is checked for egress safety before disclosure. |
| `--commit` | Publish `agent-qa-eval/labels/calibration.json` and any required immutable label revisions. |
| Same input and options again | Return `unchanged`, `refreshedCount: 0`, and preserve existing bytes. |
| Changed input or options without `--replace` | Return `write-conflict`; preserve the active artifact and labels. |
| `--commit --replace` | Explicitly replace the calibration marker after staging complete revisions. |
| `--replace` alone | Refuse; replacement requires an explicit commit. |
| `--json` | Emit the result DTO, including artifact, outcome and refresh count. |

Gold is produced by the existing `runs mark` flow. For example, a `false-pass` mark
can preserve an authored correction in both the `user-mark` and `overturned-verdict`
gold records. Their shared `provenance.sourceCassetteId` counts once when measuring
the noisy source. The newest mark at an address governs even when it produces no gold.
Gold channels report `precision: 'by-construction'`; they are never scored against themselves.

## What the numbers mean

`recorded-verdict` and `self-heal-pair` disclose precision, their own `n`/`n_gold`, and
a Wilson 95% interval when the minimum is met. The artifact also discloses verifier
false-pass/false-fail measurements and the coarse app-bug classifier comparison, separately
for deterministic and analyze-run producers. Classifier agreement is a member-level,
producer-specific binary measurement; it is not an exact root-cause-class score.

**This is precision on operator-selected committed marks.** Operators choose what to mark,
so it is not an unbiased estimate for all runtime traffic. Fixture tests establish the
arithmetic and storage behavior, not production precision.

Self-heal weights use the product's committed logical self-heal steps whose **failed**
member observed the same screen-state hash. Canonical action equality determines `k`
within that population `n`:

```text
weight = verdictFactor × tierFactor × (k + 2) / (n + 3)
```

The recorded factors are provisional: verdict factors are user-gold 1, stable-pass silver
0.8, unverified 0.5; capability factors are full 1, degraded 0.75, floor 0.5. A single
matching observation with both full factors yields 0.75, not certainty. Capability is
derived from the recovering planner's recorded identity. These factors are evidence
discounts, not empirically measured recovery probabilities or operator configuration knobs.
The record persists the weight, inputs, factor provenance, and corpus/evidence digests.

An original deterministic flake, environment, or timeout failure quarantines a rerun's
silver selection and supersedes an exactly linked original silver label. Other or absent
original classifications permit silver with rerun provenance. Eligible rerun self-heal
pairs still contribute to the SOFT population. No rerun automatically becomes gold.

## Publication and host adoption

The artifact identifies the gold set, corpus, evidence, complete target revision list,
and content-derived generation. Revisions are append-only; only the final marker swap
activates the new selection. An interrupted replacement leaves the prior generation
readable until the swap. After the swap, the new generation is complete. A failure reported
after that boundary can therefore be followed by an `unchanged` retry. Inactive orphan
revisions never win by directory order. Concurrent writers and input drift return a
conflict/retry outcome; retry the identical command after the other operation finishes.
Path and egress refusals preserve authoritative files.

Only noisy channels emit neutral `OriginClass` priors: `recorded-verdict` maps to
`agent-verified`, and `self-heal-pair` maps to `agent-observed`. `user` and `import` retain
their defaults. With provisional mass `m = alpha0 + beta0`, calibration uses
`alpha = precision × m`, `beta = (1 − precision) × m`. The values remain finite and
nonnegative, including precision 0 and 1, with positive unchanged total mass. For example,
the `(2, 1)` prior at precision 0.9 becomes `(2.7, 0.3)`. No smoothing or confidence-bound
substitution is applied. The evidence-incomplete and serving-attribution discounts remain
provisional and uncalibrated.

A host captures the validated prior table once when composed. Compose a new host (or
restart the long-lived host) to adopt a replacement. Existing hosts retain their captured
table. Index projections carry the effective prior identity; an old host falls back to
its matching scan when a shared index has been rebuilt for a newer table. Calibration
changes trust means without changing bundle evidence, event counters or lifecycle.
Malformed calibration is an explicit refusal, not a silent provisional fallback.

`doctor`'s Learning row shows channel counts and `goldDigest current | stale | unavailable`,
plus `trust priors: provisional` or `trust priors: calibrated@<generation> (...)`.
Chain terminal and partial/handoff summaries disclose the same host snapshot. Doctor is
read-only and never refreshes a stale artifact.

## Reports and gates

Reports retain first-attempt accuracy and per-decision cost, and add source-grained
verifier false-pass, raw and weighted recovery, calibration disclosure, and four split
cells: natural, held-out/shared, held-out/private, and adversarial. All cells are present;
absent denominators and historical fields remain explicitly unavailable. Batch false-pass
uses the batch's recorded-PASS source population; calibration uses selected marked sources.
Those denominators can differ even within one operator workflow.

Weighted recovery is `sum(weight × recovered) / sum(weight)` over eligible positive pairs.
The report discloses `weightSum` and `pairsWithoutWeight`; legacy missing weights use the
recorded provisional mean. Persisted zero is a real zero, not missing data.

`eval gate` compares each profile only to its own baseline. Eleven disclosure rows cover
false-pass, raw/weighted recovery, four per-decision cost values, and four split accuracies.
These rows do not change release exits. Missing historical fields yield `not-comparable`.
Gate 1 retains categorical zero tolerance for collateral harm; a harmed receipt discloses
its persisted `softWeight` without discounting the harm.

Regenerating a committed pre-calibration report adds fields and therefore returns the
existing write-once `write-conflict`. It never overwrites the historical report, markdown,
or decision sidecar. An explicit baseline designation can select existing committed history
without regenerating its bytes. Fixture acceptance exercises these paths without replacing
an operator baseline or spending on a provider.
