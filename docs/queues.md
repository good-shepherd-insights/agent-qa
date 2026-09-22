# The Three Queues

AgentQA runs three queues. They were built in different milestones, for different work, on
different storage, and the word "queue" on its own no longer identifies any of them. This page is
the naming of record.

Wherever all three are listed — help text, logs, docs — they are listed in this order:

| | run queue | curation queue | agent job queue |
|---|---|---|---|
| **What it queues** | test executions | knowledge curation work produced by a run | durable background agent jobs |
| **Introduced** | v1 | v51 | v52 (Phase 385) |
| **Lifecycle owner** | the dashboard server's `JobQueue`, with a concurrency-slot dispatcher | the writer lease — one drainer at a time | the agent job engine (`agent`), driven by a host that holds a fencing epoch |
| **Storage medium** | the dashboard database | files under `<knowledgeRoot>/memory/queue/` (`queued/`, `claimed/`, `jobs/`) | sqlite at `.agent-qa/agent-jobs.db` for lifecycle, plus one checkpoint file per publish under `.agent-qa/agent-jobs/checkpoints/<jobId>/` |
| **CLI surface** | `agent-qa queue list`, `agent-qa queue cancel` | none of its own; drained at the tail of a run, with related maintenance under `agent-qa knowledge maintain` | `agent-qa agent-jobs list`, `agent-qa agent-jobs pump --only <kind>`, `agent-qa agent-jobs cancel <jobId>`, `agent-qa agent-jobs requeue <jobId>` |

## run queue

The original test-execution queue. Every run trigger — dashboard, webhook, CLI, API — enqueues
here, and the dashboard server dispatches into a fixed number of concurrency slots. `agent-qa queue`
manages this queue and only this queue.

The command keeps its unqualified name. Renaming a shipped command to make a docs page tidier costs
every user their muscle memory and every script its invocation; what changed instead is what the
command *says*. Re-deriving or retiring the v1 run-invocation surface belongs to the run-invocation
work, not to a naming pass.

## curation queue

What a run leaves behind for the knowledge store: candidates emitted during execution, then
authored, bundled and committed into memory. It is a filesystem queue by design — the same medium
as the artifacts it produces — and it is drained under the writer lease, so exactly one process
mutates knowledge at a time. There is no `agent-qa curation-queue` command; draining happens at the
tail of a run.

## agent job queue

The durable, restart-safe background-job substrate: the six agent job kinds, per-kind checkpoints,
bounded retry, declared chaining, cooperative cancel, and crash recovery that never re-invokes the
model. Job lifecycle rows live in sqlite; each checkpoint is published as its own file so that a
checkpoint is durable in the same medium as the side effect it guards.

`agent-qa daemon` is the resident drainer: a standing host adopts a fencing epoch and pumps every
kind in arrival order. `agent-qa agent-jobs pump --only <kind>` is the other drain — in-process,
holding the writer lease for its whole run, and composed so that every declared kind except the one
named is unclaimable, so a host can run one kind and leave the rest queued untouched (413 D-04 /
D-06: `analyze-run` per campaign leg, with the `curate-memory` successor it enqueues held back for
the disposal step, which lists it with `agent-qa agent-jobs list` and discards it with
`agent-qa agent-jobs cancel <jobId>`).

`agent-qa agent-jobs requeue <jobId>` returns a `done`, `failed` or `cancelled` row to `queued` with
its attempts reset and everything its last attempt recorded forgotten in ALL THREE durable media —
the checkpoint rows, the checkpoint files, and the chain-terminal notification that attempt minted
for the run the job's payload names. The forget is the point, not a tidy-up. A resumed job reads the latest checkpoint
it recorded across attempts, so a reset that kept them would replay whatever the previous attempt
claimed to have authored: that is exactly how 19 `analyze-run` rows in the Phase 413 campaign
reported `completed` while writing no analysis at all, and a status-only requeue would have
reproduced it. Anything not terminal answers `not-terminal` and moves nothing — a queued or claimed
row belongs to a drainer, and resetting its attempt count out from under a running handler is the
two-writers-under-one-fence case the fence exists to exclude. The row keeps its id and its
`(kind, idempotency key)` pair, so the successor it re-chains on the next run dedupes onto the
existing slot through the unique index instead of doubling it. The verb does not pump: the operator
runs `agent-qa agent-jobs pump --only <kind>` next, so the forget and the re-run stay two steps.

The store stamps its schema version into `agent-jobs.db` and refuses a database stamped at any other
version. It never migrates one. Version 4 (Phase 425) added the jobs table's `started_at` column, so
an `agent-jobs.db` written at version 3 is refused by name (`JobStoreSchemaVersionError`), and the
message gives the remedy: clear agent job queue state, meaning delete `.agent-qa/agent-jobs.db`
(with its `-wal` and `-shm` files) and its checkpoint directory `.agent-qa/agent-jobs/checkpoints/`,
then re-enqueue. Until someone does, everything that opens or reads the store refuses too. That
covers `agent-qa daemon` and the other hosts that open the agent job queue. It also covers the
post-processing read behind the dashboard's stage indicators, which answers a
`job_store_schema_version` refusal instead of chip words. And it covers `agent-qa digest`, because
the digest calls that same read.

Clearing costs the agent job queue's own history and nothing outside it. A run whose job rows are
gone reads `pending` for both analysis and curation, because an absent row projects to `pending`. It
also loses its `stageDetails` (and with them the stage timing), its chain-terminal notification with
the curated counts, and the curation snapshot recorded in the checkpoints. Recorded runs, their
completed-run handoffs, their evidence and `analysis.json` verdicts, and committed knowledge all
live outside the agent job queue, and clearing it leaves them untouched.

What a stage of the post-run chain *became* is a different question from how it drained, and it is
answered off these same rows rather than off whichever drain produced them.
[Reading stage outcomes](#reading-stage-outcomes) below is where that question lives:
`agent-qa digest` for the run digest, `analysis.get` for the verdicts.

## Reading stage outcomes

A stage's outcome is a projection of the durable agent job row, never of the chip event a drain
happened to push while somebody had a socket open. `runs.postprocessing` is the single producer: it
reads the agent job queue's rows and answers the two chip words — `analysis` and `curation`, each
one of `pending · running · done · failed`. That split is deliberate. A pushed frame is a
convenience for a socket that happens to be open; the row is what a person who closed their laptop
and came back is owed, and both have to say the same thing.

Beside the two words the read carries what the rows actually recorded. `stageDetails` holds, per
stage and only where the row recorded it, `attempts`, `createdAt`, `claimedAt`, `startedAt`,
`updatedAt`, `conclusionKind` and the masked `lastFailureKind` / `lastFailureReason`; the chip-less
proposals stage appears there too. The claim is the lease a drainer holds now and is gone from every
settled row; the start is when the work first began, and it outlives the lease. The persisted curation snapshot travels with its five buckets — `added`,
`confirmed`, `superseded`, `deprecated`, `proposed` — and the chain's terminal notification appears
once the chain wrote its one row, not before.

A benchmark or a gate run never reaches the agent job queue at all: the post-verdict step enqueues
nothing for it, so there is no chain to report on. Such a run answers an `exclusion` fact instead —
a field on the read op, present iff the run's durable record carries the gate-run or
outcome-excluded marker, and carrying `gate-run` or `outcome-excluded` as its reason. It is a
sibling of the four chip words and never a fifth one, and it is never inferred from missing rows: a
chain polled a second after its verdict has no rows either, and calling that an exclusion would
tell a user their run was dropped. The dashboard's stage indicators and the cards they open render
these fields and nothing else.

There are two doors onto the same facts outside the dashboard, and the first is the run digest.
`agent-qa digest <runId>` prints the digest op's own rendered lines — the `chain —` line carrying
the two chip words, the verdict clusters for a run that has them, and the proposals minted this run
with the counts beside them. Omit the id and it digests the most recently finished run; `--json`
emits the structured digest instead of its lines. The command composes nothing of its own, so every
surface that shows a digest is showing these same bytes.

The second door is `analysis.get`, for the verdicts themselves. Invoke it the way any registry
capability is invoked — `agent-qa fn analysis.get --input '{"runId":"<runId>"}' --json` — and it
answers the resolved verdicts, the rendered sentences and the failure clusters that the dashboard's
verdict block paints. It is the single producer of all three, so a sentence read on a run page and
the same sentence read here are one rendering rather than two that agree until one of them changes.

Knowing where a field comes from is what lets a reader tell a recorded absence from a value. The
chip words and every `stageDetails` field come from the agent job row; the curated counts and the
chain outcome come from the terminal notification the chain wrote; and the exclusion comes from the
run's own completed-run handoff, the same document the enqueue skip reads. A field none of those
three recorded is simply absent from the answer — never a zero, and never a word invented to fill
the slot.

## What is deliberately *not* renamed

Two collisions survive on purpose, and both are load-bearing to know about.

**The schema kernel's `Job`, `JobKind` and `JobId` belong to the agent job queue.** They are shipped
kernel vocabulary. Renaming them would break every consumer to satisfy a naming requirement that
never asked for it, so they keep their names — and the agent job queue is the one that owns them.

**The curation queue's internal "job" vocabulary predates the agent job queue.** `jobState`,
`jobsRoot`, `memory/queue/jobs/` and the rest are v51 internals. They are not renamed: the blast
radius is disproportionate to a naming requirement, and no user reads those identifiers. If the
collision ever causes real confusion in practice, that is the moment to revisit it — not before.

The v1 run queue's implementation class is also called `JobQueue`. Same reasoning: it is internal,
it is v1, and only what an operator reads carries the qualifier.

## The rule this page enforces

The `agent` qualifier appears in every user-facing string, log line, doc sentence and stored
artifact name belonging to the agent job queue — hence `agent-jobs.db` and `agent-jobs/checkpoints/`
rather than `jobs.db` and `checkpoints/`. Symmetrically, the v1 queue is called the *run* queue
wherever a user reads it. A message that says bare "queue" or bare "job" where one specific queue is
meant is a defect: an operator told to "clear queue state" cannot tell which of three states to
clear.

`packages/cli/src/commands/__tests__/queue-help.test.ts` enforces the rule for `agent-qa queue`'s
help output. It does not snapshot the text — a snapshot of whatever exists passes forever. It
asserts a relation: every singular occurrence of "queue" in the help must carry one of the three
qualifiers, and the set of qualifiers found must be exactly those three, so both an unqualified
"queue" and a collapse of two queues onto one name turn it red.
