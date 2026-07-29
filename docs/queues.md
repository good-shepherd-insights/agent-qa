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
| **CLI surface** | `agent-qa queue list`, `agent-qa queue cancel` | none of its own; drained at the tail of a run, with related maintenance under `agent-qa knowledge maintain` | none yet — the daemon and job ops are later phases |

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

Nothing in the CLI drives it yet. Phase 385 ships the engine, the store and the composition root;
the daemon that drains it, and the job operations that expose it, arrive in later phases.

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
