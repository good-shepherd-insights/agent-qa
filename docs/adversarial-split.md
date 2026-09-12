# Adversarial split

The `adversarial` corpus split holds derived decisions: a natural seed's surface perturbed by a
frozen table, or an accessible name authored by a model that was asked to write bait. The gold
never moves — a derived case asks whether the same correct decision survives a hostile surface.
Nothing here is an empirical safety claim. This guide records Phase 422 decisions D-01–D-20.

A refresh is proposed by a job and committed by a person. The curator stages bytes under the
local audit directory and writes nothing a git-tracked root can see; `agent-qa eval adversarial
--admit --batch <digest>` is the only production caller of `refreshAdversarialSplit`, and one
admission is one reviewed batch.

## Staging, review and admission (D-01, D-02, D-04)

Staging derives concrete bytes and scans them. It is safe to run repeatedly:

```sh
agent-qa --config agent-qa.config.yaml eval adversarial --dry-run
agent-qa --config agent-qa.config.yaml eval adversarial --product default
agent-qa --config agent-qa.config.yaml eval adversarial --product default --json
```

`--dry-run` derives, scans and reports without writing anything at all — no staging directory,
no durable reservation and no provider call. A plain stage writes one batch and prints the
digest to hand back:

```
batch 3f9c…                    (64 lower-hex)
review .agent-qa/eval/adversarial/default/3f9c…, then admit with: eval adversarial --admit --batch 3f9c…
```

Review the exact bytes that will be committed, not a rendering of them. A batch is a directory:

```
.agent-qa/eval/adversarial/<product>/<batchDigest>/
  manifest.json          product, batchDigest, tableVersion, tableHash, stagedAt, cases[]
  case-0000/cassette.json  the derived LeafCassette, exactly as it will be committed
  case-0000/label.json     the cloned label record with its derivedFrom marker
  case-0000/entry.json     the corpus entry with split: 'adversarial' and its generator block
  case-0001/…
```

`manifest.json` pins each case by three text hashes plus the seed's provenance, so a byte edited
after review cannot be admitted: admission recomputes them and answers
`refused: staging-integrity` without starting a write. There is no partial trust — one altered
case refuses the batch.

Admission is explicit and names one digest. It never picks a batch, and it derives nothing:

```sh
agent-qa --config agent-qa.config.yaml eval adversarial --admit --batch 3f9c… --dry-run
agent-qa --config agent-qa.config.yaml eval adversarial --admit --batch 3f9c…
```

`--admit` without `--batch` refuses (`admit-requires-batch`); `--batch` without `--admit` is a
usage error; `--max-seeds` and `--max-probe-calls` with `--admit` are usage errors rather than
ignored flags, because admission derives and authors nothing and a silently ignored budget is
worse than a refused one. An unknown digest is `refused: batch-not-found`. A missing or
unreadable committed root is `refused: no-eval-root` / `refused: corpus-unavailable`.

Seeds are natural, proof-backed leaf cassettes with a resolvable gold anchor, read through
eval-local's `/reader` — never the private held-out split. One variant per `(seed, mutator)`,
with the in-table choice drawn from a PRNG keyed by `sha256(seedCassetteId ‖ mutator ‖
tableVersion)`: two runs over one corpus produce byte-identical cases and identical ids. A
derived id is `sha256hex(canonicalJson({ base, kind, mutator, tableVersion }))`, and it is the
dedupe key across staging and the committed root — a seed whose id is already staged or
committed reports `already-derived` and the verb answers `nothing-derived`.

Idempotence covers the cases a refresh does not derive as well as the ones it does. Every
declared family is accounted for exactly once per seed: derived, or explained by one of
`seed-malformed`, `not-natural`, `brief-not-proof-backed`, `gold-anchor-absent`,
`gold-anchor-unresolved`, `seed-label-absent`, `target-name-empty`, `cap-exceeded`,
`mutator-not-generated`, `no-table-entry-applies`, `benign-surface-absent`,
`hostile-identity-unchanged` or `already-derived`. A benign family that has no distractor
surface to land on reports `benign-surface-absent` rather than perturbing the gold target.

## Reading the numbers a refresh prints

Four counts are printed separately and are not summable:

| Line | Meaning |
| --- | --- |
| `staged <id>` | a reviewable case in this batch |
| `admitted <id>` | bytes that actually landed in the committed root |
| `unchanged <id>` | already committed byte-identically; moved no digest (D-04) |
| `remaining <id>` | reviewed and not yet committed — nonzero only on a partial admission |

`refused <id>: <detector> <action>` is a guardrail decision (below). `settled refusal` is a
refusal an earlier refresh already decided under this policy: disclosed, never re-asserted.
`skipped <id>: <reason>` is a staging-side integrity skip — `blob-unresolvable`,
`blob-hash-mismatch`, `text-hash-mismatch`, `manifest-digest-mismatch`,
`path-identity-mismatch`, `seed-label-unavailable`, `seed-provenance-mismatch` or
`committed-conflict`. `committed-conflict` means the id exists with *different* bytes: history
wins and nothing is overwritten.

`seeds considered`, `deferred` and `eligible` disclose the cap's effect. Deferred seeds are
counted and wait for the next refresh; they are never dropped.

When writes began and some reviewed cases did not land, the verb says so and leaves the batch in
place with the re-run command. The correct response is to resolve the reported filesystem issue
and re-run the same `--admit --batch`, not to re-stage.

## The loaded guardrail policy, and what a refusal is (D-03)

Generation-time scanning and the admission checkpoint are the *same* call —
`assertCommittedEgressSafe` on channel `eval-adversarial`, with the host's **loaded** policy.
Neither leg defaults a policy, so a host that tightens its policy between staging and admission
binds at admission on bytes staged under the old setting. Three documents are scanned per case:
the cassette's scan view, the label record and the corpus entry. The corpus entry carries the
authoring model's configured id, so a credential embedded in a model id is scanned with
everything else.

With the shipped default `injectionShape: route`, an injection-shaped name is **audited and
committed**: a row lands in `.agent-qa/eval/audit/adversarial/<product>/guardrail_audit.jsonl`
with `channel: eval-adversarial…`, `detector: injectionShape`, `action: route`. `route` is the
signal, not a refusal — the whole point of an injection probe is that it reaches replay as data.

A `block`, or a non-user `redact` hit (secrets, card-shaped digit runs, emails), is a typed
refusal row `{ cassetteId, seedCassetteId, generator, detector, action }` on the staging report.
It is never a thrown error and never becomes a cassette. An operator whose policy sets
`injectionShape: 'block'` refuses the injection family wholesale, and the report says which
detector did it.

**A guardrail block is never a regression, and it reaches the gate by two different routes.**
Both exit **2**; neither can reach exit 1, which is reserved for a measured regression against a
comparable baseline.

| Where the block happens | What is recorded | What `eval gate` says |
| --- | --- | --- |
| Loading a committed adversarial cassette (a guard rejection) | the `guard-failed` **replay refusal** | `refusal-population-differs` → exit 2 |
| During replay, when the request-hook guardrail throws | a **harness error**, counted in `harnessErrorCount` | `harness-errors` → exit 2 |

The second route is worth stating plainly because it is easy to describe wrongly: a
`GuardrailBlockError` raised by the provider request hook is not classified as a replay refusal
at all. It propagates out of the planning turn, is classified as infrastructure, and is tallied
as a harness error — so a host looking for `guard-failed` after a blocked replay will not find
one. The safety property (Pitfall 15: a refused or blocked probe is never counted as a
regression) holds on both routes; the vocabulary does not. If `eval gate` exits 2, read which
reason it names before reading anything about quality.

## Caps, and where each one came from (D-04, D-11, D-14, D-18)

Four recorded defaults, each printed beside the source that set it (`default`, `config` or
`flag`) so a default can be told from a choice:

| Constant | Value | Bounds | Override |
| --- | --- | --- | --- |
| `ADVERSARIAL_DEFAULT_MAX_SEEDS_PER_REFRESH` | 8 | novel seeds one refresh derives from | `eval.adversarial.maxSeedsPerRefresh`, `--max-seeds` |
| `ADVERSARIAL_DEFAULT_MAX_PROBE_CALLS` | 4 | provider calls one refresh may make | `eval.adversarial.maxProbeCalls`, `--max-probe-calls` |
| `PROPOSE_DEFAULT_MAX_GATE1_PER_JOB` | 4 | Gate-1 calls one proposal job may spend | `eval.gate1.maxPerJob` (no flag) |
| `ATTR_DEFAULT_MAX_MISDIRECTION_CHECKS` | 4 | circularity checks one run's tail may run | none today |

None of these is a measured threshold; each is a stated budget with a stated rationale. Eight
seeds is a **review** budget — eleven families derive at most one variant each, so eight seeds is
at most 88 cases in front of a person who must read injection-shaped text before it reaches a
git-tracked root. The probe cap is deliberately independent of it: deterministic seeds cost CPU,
authored probes cost money no later run recovers. It counts **calls**, not tokens, because a
provider that reports no usage yields zero tokens and an unreported token must never read as
free. `eval.adversarial` and `eval.gate1` are strict, positive-integer-only blocks: `0` is a
config error rather than a silent fall back to the default.

`eval.gate1.maxPerJob` has no CLI flag on purpose. The bound is charged durably per job and read
back by a resumed attempt, so a per-invocation flag could change between the attempt that spent
it and the attempt that has to honour what was spent. `ATTR_DEFAULT_MAX_MISDIRECTION_CHECKS` has
no config key at all in this milestone; excess records record `not-run: cap-exceeded`.

## Immutable generations, and what a bump does (D-08)

Tables are frozen code objects with a pinned hash. Editing a table without bumping
`ADVERSARIAL_TABLE_VERSION` fails the pinned-hash bump guard. The version and hash are stamped on
every derived entry and printed by the verb:

```
tables v2 e98c576592b28ed06ab528f6fe40bac8a311cf49473e0fbb3fd2ac76395020a8
```

A bump changes every derived id, so a refresh stages a **new generation** while the previous
generation's committed entries stay committed and keep gating. Retiring a generation is corpus
rotation — deferred (ROOT-FUT-01) and a reviewed git act, not something any verb does. The probe
prompt is pinned the same way: `ADVERSARIAL_PROMPT_VERSION` is 1 and its frozen text is hash-
covered; changing the prompt bumps the version and mints a new probe generation rather than
re-authoring the old one.

The census discloses the mix when — and only when — a product actually holds a committed
adversarial member:

```sh
agent-qa --config agent-qa.config.yaml eval census --json
```

```
default adversarial generation: total=7 provenance=… tableVersions=… mutators=… promptVersions=… authoringModels=…
```

A line of zeros would tell a reader a refresh happened and yielded nothing, so the line is
absent instead. `perSplit.adversarial` in `eval report` follows the same rule.

## LLM probes, the capability gate and disclosed self-authorship (D-09, D-10, D-11, D-12)

Probes are authored only behind a capability check that makes **zero** provider calls. Capable
means at least one configured, credentialed judge entry (`eval.judge` / `eval.judges` — no new
config key) that is family-disjoint from the replay profile's planner: a probe author from the
planner's own family is the self-preference the judge law forbids. Otherwise the refresh records
a typed gap from a closed set and derives the deterministic families anyway:

| `no-probe-model` reason | Meaning |
| --- | --- |
| `panel-not-configured` | no judge pool declared |
| `no-credential` | declared, but no local credential resolves |
| `single-family-host` | declared and credentialed, but no member is disjoint from the planner |

```
no probe model: single-family-host (deterministic families are unaffected)
probe calls 0/4 (default); reported tokens 0 in, 0 out
```

The gap line is printed whenever the capability was consulted and answered no. An empty probe
list with **no** gap line is a host that simply had nothing new to author — the two are not the
same fact, and the line exists so they cannot be confused.

Credential presence is not remote validity. The preflight observes local credentials and local
family arithmetic; it never authenticates.

One probe per `(seed, kind, promptVersion)`, capped, never regenerated. The identity is
`sha256hex(canonicalJson({ base, kind, promptVersion, authoringModelId, text }))` but the
**idempotence key** is the tuple, so a seed that already has a staged or committed probe for that
tuple is skipped and no second question is bought. Every authored entry stamps
`authoringModel { id, family }` and `promptVersion`.

Spend is durable before it is spent. A reservation is written to disk *before* the provider is
contacted, and the CLI author binding refuses any call that does not already hold one. The
derived state has three words and no word for "in progress":

| `ProbeReservationStatus` | On disk | Meaning |
| --- | --- | --- |
| `unattempted` | no charge | nothing was bought for this tuple |
| `interrupted` | a charge, no answer | charged and stays charged; not re-authored |
| `completed` | a charge and an answer | re-derivable for free from the recorded text |

There is deliberately no in-progress word: a tuple a live attempt is inside looks identical on
disk to one a dead attempt left behind, and the honest reading of both is a charge with no
answer. **An interrupted probe is not retried.** There is no way to know whether the lost
response was generated, and re-authoring would buy one question twice. `probe tuples not
authored` reports `tuple-interrupted`, `tuple-already-decided` and `probe-cap-exceeded`
separately. A provider that returned no usage sets `usageKnown: false`; its tokens are left
absent rather than written as zero.

An authored response that yields no cassette is a typed `probe refused` row —
`seed-request-mismatch`, `request-prompt-stale`, `probe-text-empty`, `probe-text-too-long`,
`probe-text-not-a-name`, `probe-usage-invalid` or `probe-identity-unchanged`. A response that
reaches a cassette is scanned on the same channel with the same loaded policy as every
deterministic case; a probe is the one case in this pipeline whose text was written by a model
just asked to author bait, so scanning it through a gentler path would invert the priority.

**The configured judge may author probes aimed at itself, and this is disclosed rather than
prevented.** A probe perturbs only the surface — the gold stays the seed's — and the judge is
measured on whether it still settles correctly. A judge that fools itself is a finding. Because
that is true only while the number stays visible, `eval calibrate --judge-panel` reports the
judge-targeted subset separately:

```sh
agent-qa --config agent-qa.config.yaml eval calibrate --judge-panel --json
```

The `judgeTargeted` block has three states and they must not be collapsed:

- **absent** — the artifact predates the field. It says nothing about bait, and reading it as
  "no bait" is a false clean.
- `source: 'unavailable'` — the caller could not read the committed adversarial population.
- `source: 'resolved'` with `judgeTargeted: 0` — a **measured** zero. This is the only arm that
  licenses "no judge-targeted bait entered this population".

`selfAuthored` is the circularity number: judge-targeted members written by a model on the panel
being measured. `metadataUnavailable` counts members whose generator could not be resolved and is
never folded into a zero. `observedInCalibration` is how many judge-targeted members actually
reached the measured independent-gold population, which is a different question from how many
exist.

## The chain, inline Gate 1 and the staged remainder (D-13, D-14, D-15)

`propose-improvements` is `curate-memory`'s always-chained successor. The post-run chain now has
three ids — `{ analyzeRun, curateMemory, proposeImprovements }` — each derived from its
predecessor, so `chainJobIdsForRun` still names every job from the run id alone. The job kind set
stays five. A run with nothing to do completes with zero work recorded; a permanently failed
proposal halts the chain rather than un-doing a committed fold.

The stage runs Gate 1 inline through the bound `runReplayGate` port under the pump's writer lease,
capped per job. Ungated means `status: candidate`, leaf kind, and no standing Gate-1 receipt for
the *current* corpus digest — a `receipt-stale` line counts as ungated; a standing `fail` or
`abstain` does not, and re-gating on the same digest is never done. Procedure and policy
candidates are `kind-excluded`. Order is this fold's candidates first, then older ungated
candidates in the product by creation ordinal. Candidates past the cap stay
`gate1-receipt-required`, are counted, and are picked up by the next run or by `eval replay-gate`.

The chain-terminal line reports the stage. Every clause distinguishes absent from zero:

```
proposals: not recorded                         the row carries no proposal stage at all
proposals: done (staged not recorded, …)        the stage ran; no staging port was bound
proposals: done (staged 2, skipped 1, …)        a measured count
proposals: failed                               the stage ran and did not finish
```

and the Gate-1 clause likewise: `Gate-1 not recorded`, `Gate-1 unreadable`, `Gate-1 not bound`,
or `Gate-1 <disposition>: ungated remaining N[, screened N][, interrupted N]`. `ungated
remaining` prints even when it is zero, because the zero is the difference between "the cap left
work behind" and "the cap admitted everything eligible" — which is exactly what decides whether
to run `eval replay-gate` by hand. No candidate id, digest, authored text or verbatim `reason`
string reaches this line; only closed words and array lengths.

`propose-improvements` emits no progress chip. Its progress is durable on the
`proposals-authored` checkpoint and disclosed on the one chain-terminal line, so a chip would be
a third spelling of a fact two surfaces already carry.

`doctor` carries the same three facts in Learning mode, each from its own source:

```sh
agent-qa --config agent-qa.config.yaml doctor
```

```
…; adversarial: <probe gap>; staged 7 in 1 batch(es) over 1 product(s); refreshes 1 (derived 7, refused 0, inapplicable 4, cap-deferred 0); circularity backing: …
```

A staging root holding no batch reads `staged not recorded`, never `staged 0`. A staging store
this build found and could not read reads `staged unreadable` and fails the row — a diagnostic
that swallowed a tampered store into `not recorded` would report healthy about a subsystem it
could not read. The probe-gap clause is resolved **live**, from the current config, because the
gap is persisted nowhere; it therefore states the gap this host has now, which can differ from
the gap the last staged refresh recorded.

## The circularity guard (D-17, D-18, D-20)

A verdict gains two additive-optional evidence fields. `memoryOnPath` is computed by **code** from
the served brief on the cited steps — candidate records, or lower-trust actives flagged
`servedAsCanary` — and is never authored by the model. `misdirectionRuledOut` carries the
arbiter's result: `{ crossCheck: 'flipped' | 'held' | 'inconclusive' | 'not-run', recordId?,
reason?, samples? }`.

`memoryMisdirectionRuledOut` keeps its name and its meaning: it is the **model's declared claim**,
and the author prompt still asks for it. The two new fields are the evidence, and
`validateRunAnalysis` is the guard — with `memoryOnPath` non-empty on a gated host, a
no-trust-change class (`app_bug`, `flake`, `environment`, `config_error`) is accepted only when
`misdirectionRuledOut.crossCheck === 'held'`. The `Verdict` union stays at eight classes; a type
test pins it.

The arbiter runs in the CLI post-run tail, **before** `analyze-run` is enqueued, over each
candidate or low-trust record served on a failing verified step. Its result travels as data on
the payload and the handoff sidecar; the handler stamps the fields and the validator enforces
them. Per result on a gated host:

| Cross-check | Consequence |
| --- | --- |
| `held` | misdirection ruled out; the authored class stands |
| `flipped` | the record caused the failure: attribution is carried, a no-trust-change class is refused, `unknown` with attribution is the floor, and the canary emitter reads the step as `exercised-harmed` — a `contradicted` outcome event and a Gate-2 `fail` receipt — **whatever class the model wrote** |
| `inconclusive` / `not-run` | `unknown`, with `misdirectionRuledOut` disclosing why; no trust motion and the record stays where it is |

There is no ninth class. `flipped` moves trust regardless of the model's answer; the author is
re-invoked once with the arbiter result in its diet, and a persistent no-trust-change answer
degrades to the floor.

### BYOM, and what this milestone did not deliver (D-19)

D-19's design is: with no eval root the tail records `misdirectionRuledOut: { crossCheck:
'not-run', reason: 'no-eval-root' }`, the validator accepts the model's declared boolean exactly
as before, and the verdict discloses `backing: declared-only` so learning stays un-stalled and
the system says it is blunter. A present-but-broken root is `not-run: posture-unavailable` and
earns no exemption.

**The recording half shipped; the validator exemption did not reach production.** The tail writes
the posture durably to `misdirection-posture.json` before the analysis enqueue, but no shipped
composition binds `PostRunJobCapabilities.readMisdirectionRootPosture`, so the analysis handler
falls to its fail-closed `'eval-root'` default on every run. A BYOM host is therefore held to the
*stricter* gated rule rather than the intended exemption. Nothing is mis-stated to an operator:
both disclosures render the **applied** backing and name the recorded posture beside it when the
two disagree —

```
circularity guard: eval-root (fail-closed; recorded no-eval-root unread — no host binds the posture)
circularity backing: fail-closed eval-root (no host binds the recorded posture)
```

— rather than printing `declared-only` off a posture the verdict never received. Binding the
reader flips a fail-closed default to open and is owned by the phase that can verify it against a
real BYOM run; see the Phase 422 reconciliation notes in `.planning/REQUIREMENTS.md`.

## The retired-kind quarantine (D-16)

A job row whose `kind` is not in this build's vocabulary is landed permanently with conclusion
`unreadable_kind` and its attempt spent, instead of throwing inside the claim transaction. The
queue drains, `attempts` advances, and the jobs behind it run. `job.ts` keeps its fail-closed
`z.enum` parse; `AGENT_JOB_STORE_USER_VERSION` is unchanged, so a real history survives rather
than the whole database being refused.

## What an admission costs, and what it does not rewrite

Admission moves the corpus digest, and a moved digest stales standing measurements. The verb
discloses them and hands back the command; it rewrites nothing:

```
standing receipts that will read receipt-stale: 3
<candidateId> gate gate1 pass
the noise floor and any designated baseline were measured against the previous digest; neither is rewritten here
re-measure the floor: agent-qa --config '…' eval floor
```

Silently re-measuring against the corpus just changed would destroy the only evidence that the
change mattered. Gate-3 receipts carry no corpus digest and are never swept in. `staleReceipts:
null` means writes began and the final digest could not be read — the one genuinely unknown case;
an unmoved digest stales nothing and reports an empty list.

After admitting, re-measure before comparing:

```sh
agent-qa --config agent-qa.config.yaml eval census --json
agent-qa --config agent-qa.config.yaml eval floor --commit --json
agent-qa --config agent-qa.config.yaml eval replay --source committed --json
agent-qa --config agent-qa.config.yaml eval report --source committed --commit --baseline --json
agent-qa --config agent-qa.config.yaml eval gate --json
```

## Local audit anatomy

Everything the curator writes is local audit data under `.agent-qa/`. Nothing under it is
committed by any job:

```
.agent-qa/eval/adversarial/<product>/<batchDigest>/        reviewable batches
.agent-qa/eval/adversarial-state/                          refresh records and settled tuples
.agent-qa/eval/adversarial-probes/                         probe reservations and completions
.agent-qa/eval/audit/adversarial/<product>/                the eval-adversarial guardrail audit
.agent-qa/eval/audit/adversarial-probe/<product>/          the probe authoring audit
.agent-qa/eval/audit/seed/adversarial/                     admission's seeding output
```

`scripts/413-eval-root-hygiene.sh` (`pnpm run validate:eval-root-hygiene`) scans the whole
committed root, so admitted adversarial entries and cassettes are covered by construction rather
than by a directory list. `packages/arch/src/__tests__/422-no-eval-writer.test.ts` under
`pnpm run validate:arch` proves no eval-root or adversarial-staging writer is reachable from
`agent-local` or `knowledge-local`.

## What this documentation does and does not establish

**Everything above describes shipped contracts proven by fixtures and fake models.** No live
provider call, no live replay and no live corpus admission backs any statement here. Phase 422's
screenings are substitutions at the eval-session seam; a removal gate that is internally
consistent is not a proof of provenance.

At the time of writing, no real adversarial generation has been committed to any root: the demo
corpus holds zero adversarial entries, and the probe arm on the currently configured demo host
is the `single-family-host` capability gap. The measured-floor, census and calibration numbers
described here are shapes, not observations. ADV-01–ADV-04 and ATTR-03 remain open pending
configured-host acceptance, and D-19's validator exemption is recorded above as undelivered.
