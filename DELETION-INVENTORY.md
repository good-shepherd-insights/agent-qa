# DELETION-INVENTORY

A dated register of things this repository deliberately DELETED, and — just as important — of the
things it deliberately RETAINED beside them so that data written by the deleted machinery keeps
parsing and keeps rendering.

Each section is owned by the plan that wrote it. A later plan extends this file with a new dated
section; it does not rewrite an existing one.

---

## 2026-08-24 — the suite-parent / child-run model (Phase 402 plan 09, D-11)

**Owner's ruling, verbatim (402-CONTEXT.md D-11):** *"remove everything that's not required. Better
to cleanup now than maintain tumors."*

**What "required" means here, and who decided it.** Not judgment — a census. Two predicates of
deliberately different shape were run over the shipped sources and the running system, and every
site either of them discovered appears in the tables below with exactly one disposition. The census
is executable: `packages/dashboard-server/src/__tests__/suite-parent-debris-census.test.ts` holds
the frozen register these tables are generated from, and reds if the tree drifts from it in either
direction — a debris site that is not registered, or a registered site that is not there.

### The two predicates, and why they are not one predicate twice

Phase 402 has defeated four separate instrument shapes: a symbol grep satisfied by an import line
(402-01, 402-03), a source assertion satisfied by its own file (WINDOWS #253, #257), a fold from a
DECLARED binding rather than from what answered (#251), and a behavioural differential blind to a
byte-identical private copy (#257). Two greps with different regexes would have been a fifth.

- **Predicate A — lexical.** Reads source TEXT. Walks `packages/<pkg>/src` for every package that
  HAS one (discovered from disk, never a pinned list), excluding `dist`, `node_modules`, `__tests__`
  and `*.test.ts`. Keys each hit as `file | token | trimmed-source-line`, which survives line-number
  drift. Sees comments, type literals, and a renamed-file copy. Blind to a RENAMED symbol and to
  behaviour.
- **Predicate B — structural.** Reads no source text at all. Seeds two databases identical in every
  byte except one fact — whether the member rows' `parent_run_id` points at the parent — then walks
  the WHOLE `DashboardDatabase` and `JobQueue` prototypes (`Object.getOwnPropertyNames`, every
  member, eight argument tuples each), drives the run route corpus, and drives every production
  channel. A member whose observable output or database effect differs between the two databases
  reads the parent link, under any name, in any file, however spelled.

**They found different things, which is the point.** Predicate A found the `suite-parent` /
`suite-child` kind mints, the `cancelChildRuns` fan-out, and the type breadth. Predicate B found
**ten additional link-reading database members** that name no debris token at all and that predicate
A is structurally incapable of seeing — every `parent_run_id IS NULL` top-level-run filter in raw
SQL (`getRuns`, `getRunsBySuiteId(+Count)`, `getRunsByTestName(+Count)`, `getStats`,
`getSuiteTrends`, `getTestTrends`, `getInsightsBreakdown`, `listRunsForInsights`) plus
`deleteRun`'s recursive `run_tree` cascade. It also found a producer predicate A could not see: the
`AGENT_QA_PARENT_RUN_ID` retry-correlation mode of the dashboard ingest, which spells no debris
token and had been producer-less since 401-07 retired the machinery that set the variable.

**How I know the discovery was complete, rather than asserting it.** Four controls ship with the
census, each one closing a way a census can be green at rest:

1. *Universe control.* The scan enumerates `packages/*` from disk, and asserts that **every package
   that has a `src/` directory contributed at least one scanned file** (1,201 files at time of
   writing). A glob that silently narrowed — the 401-10 failure — reds here rather than passing with
   a smaller denominator.
2. *Known-positive control.* The extractor is run over a synthetic source carrying planted tokens
   and must find exactly them. A broken extractor cannot read as "nothing to find".
3. *Exclusion control.* The excluded `__tests__` region is scanned separately and must be
   NON-EMPTY — proving the exclusion is what hides those matches, not a broken glob — and none of
   its hits may appear in the production scan.
4. *Non-vacuity controls.* The two seeded databases must be byte-identical apart from the link
   (asserted), and the route corpus must contain routes that DO differ (asserted `> 2`).

**The honest limit.** The route corpus is DECLARED, not discovered: `routes.ts` is a long `if`-chain
with no enumerable route table. Two things keep that from being the fold-from-a-declaration failure
402-07 measured — `routes.ts` issues no SQL of its own (verified: zero `prepare(`/`SELECT` in the
file), so every parent-link read it can make must go through the database surface predicate B
enumerates TOTALLY; and the corpus carries its own non-vacuity assertion. A route outside the corpus
that reads the link would still be caught by predicate A at its call site.

### What was deleted

1. **The queue's child-run cancellation fan-out** (`job-queue.ts` `cancelChildRuns` + both call
   sites). Cancelling a run no longer walks a child list.
2. **The parent-kind enqueue mints** on `POST /api/queue/enqueue` and `POST /api/runs/trigger`. An
   enqueued suite run is minted as an ordinary run artifact.
3. **The dashboard ingest's suite mode** — the live producer. It created a `suite-parent` artifact
   for the run plus one `suite-child` row per member carrying `parent_run_id`. A parallel suite is
   now ONE run row with member handles (402-04's handle addressing), per D-11.
4. **The dashboard ingest's retry mode**, producer-less since 401-07 (D-12) retired
   `AGENT_QA_PARENT_RUN_ID`. "Anything the one-run model leaves producer-less goes too" (D-11).
5. **The run-close suite fold and the startup orphan-cleanup skip** in `server.ts`, both of which
   derived a parent's fate from children that no longer exist. Same shape, same site, and the same
   reasoning as 401-07's retry-child retirement.
6. **The CLI's suite parent-kind mint and its SIGINT child-cancel fan-out**, plus the now
   unreachable `'suite-parent' | 'suite-child'` breadth on `buildRunArtifactContext`'s local kind
   parameter.

### What was RETAINED, and why

- **`RunArtifactKind`'s `'suite-parent'` and `'suite-child'` union members** — in
  `packages/schema/src/run/run-artifact.ts` (canonical), `packages/dashboard-ui/src/lib/api.ts` (the
  UI's copy), and the `run_artifacts.kind` CHECK constraint in `db/schema.ts`. This follows the
  396-01 D-10 precedent: **D-11 deletes the PRODUCERS of the value, not the value.** Every operator
  database holds rows carrying these kinds; the run-detail artifact tab renders `artifact.kind`
  verbatim as a badge, so a union that no longer admits the value stops type-checking at the render
  site, and a narrowed CHECK constraint would additionally require a table-rebuild migration on
  every existing database.
- **`runs.parent_run_id`, its index, and every read of it.** The column keeps its historical values
  and simply stops receiving new ones. All ten `parent_run_id IS NULL` filters predicate B found are
  top-level-run predicates that keep working unchanged; `deleteRun`'s recursive cascade must survive
  or the historical rows this census orphans become undeletable through the UI.
- **`getRunsByParent` and `getRunArtifactBundle`'s child section**, and the four route reads that
  serve them (`GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/artifact`,
  `GET /api/runs/:id/execution-logs`), together with the `RESPONSE_SAFE_RUN_READ_METHODS` allowlist
  membership and metadata-scrubbing override that guard them. **Historical rows are not orphaned
  silently:** a pre-402 suite parent still lists its members in the run list and the run detail, and
  a census cell drives exactly that against a seeded operator-shaped database.
- **`use.parallel` on the job queue** as CROSS-RUN concurrency of INDEPENDENT jobs
  (`findNextEligible`). D-11 permits this explicitly: what is deleted is parallel-SUITE semantics,
  not the queue's ability to run two unrelated jobs at once.

### What degrades, stated plainly

A suite started from the dashboard now produces **one** run row instead of a parent plus one row per
member. Until 405 rebuilds the run detail on 402-04's per-member handles, the dashboard shows a
suite run's steps on the single run row rather than split per member, and the run list shows no
member expansion for NEW suite runs (historical ones still expand). The artifact `kind` for such a
run is `'test'`; the run row's `suite_id` and the artifact's own `source.kind: 'suite'` snapshot
still identify it as a suite, so nothing a reader needs is lost — only the parenthood claim, which
is exactly the claim that no longer has referents. This is a deliberate D-11 cost, not an oversight.

### Not resolved here

**WINDOWS #238 stays OPEN.** `use.parallel` still carries two meanings: the dashboard job queue's
cross-run eligibility flag (`findNextEligible`, read via `readConfigUseParallel` /
`readSuiteYamlParallel`) and, since 402-03, within-run member concurrency. D-11 sanctions the queue
meaning, so the debris deletion does not touch either producer and therefore does not resolve the
ambiguity. Splitting or renaming the key is a config-schema change, out of this plan's scope.

### The register

Generated from the frozen literal in `suite-parent-debris-census.test.ts` — that file is the source
of truth, this table is its rendering. `Before` is the tree as 402-08 left it; `After` is the tree
this plan produced.

### Sites — predicate A (lexical)

| # | File | Token | Source line | Before | After | Disposition | Rationale |
|---|------|-------|-------------|--------|-------|-------------|-----------|
| 1 | `packages/cli/src/commands/run.ts` | `getRunsByParent` | `const children = activeSuiteDb.getRunsByParent(run.id)` | 1 | 0 | **DELETE** | CLI SIGINT child-cancellation fan-out. Under the one-run model the suite run IS the row the sweep already cancels; there are no children to fan out to. |
| 2 | `packages/cli/src/commands/run.ts` | `suite-child` | `kind: 'test' \| 'suite-parent' \| 'suite-child'` | 1 | 0 | **DELETE** | Same local parameter breadth (the suite-child arm of the same literal). |
| 3 | `packages/cli/src/commands/run.ts` | `suite-child` | `}) as { artifact: Record<string, unknown> & { kind: 'test' \| 'suite-parent' \| 'suite-child' } }` | 1 | 0 | **DELETE** | Same local cast breadth (the suite-child arm). |
| 4 | `packages/cli/src/commands/run.ts` | `suite-child` | `}): { artifact: Record<string, unknown> & { kind: 'test' \| 'suite-parent' \| 'suite-child' } } {` | 1 | 0 | **DELETE** | Same local return-type breadth (the suite-child arm). |
| 5 | `packages/cli/src/commands/run.ts` | `suite-parent` | `kind: 'suite-parent',` | 1 | 0 | **DELETE** | The CLI-side parent-kind mint on the suite run artifact document. A kind claiming parenthood over rows nothing creates is exactly the label D-11 forbids. |
| 6 | `packages/cli/src/commands/run.ts` | `suite-parent` | `kind: 'test' \| 'suite-parent' \| 'suite-child'` | 1 | 0 | **DELETE** | Local parameter breadth on buildRunArtifactContext. With the mint gone both call sites pass 'test'; the surviving arms are unreachable breadth, not the retained schema union. |
| 7 | `packages/cli/src/commands/run.ts` | `suite-parent` | `}) as { artifact: Record<string, unknown> & { kind: 'test' \| 'suite-parent' \| 'suite-child' } }` | 1 | 0 | **DELETE** | Local cast breadth on buildRunArtifactContext. |
| 8 | `packages/cli/src/commands/run.ts` | `suite-parent` | `}): { artifact: Record<string, unknown> & { kind: 'test' \| 'suite-parent' \| 'suite-child' } } {` | 1 | 0 | **DELETE** | Local return-type breadth on buildRunArtifactContext. |
| 9 | `packages/dashboard-server/src/queue/job-queue.ts` | `cancelChildRuns` | `private cancelChildRuns(parentRunId: string, endedAt: string): void {` | 1 | 0 | **DELETE** | The child-run cancellation fan-out named in D-11. |
| 10 | `packages/dashboard-server/src/queue/job-queue.ts` | `cancelChildRuns` | `this.cancelChildRuns(runId, now)` | 2 | 0 | **DELETE** | Both call sites of the fan-out (pending-cancel and running-cancel arms). |
| 11 | `packages/dashboard-server/src/queue/job-queue.ts` | `getRunsByParent` | `for (const child of this.db.getRunsByParent(parentRunId)) {` | 1 | 0 | **DELETE** | The fan-out body; goes with the method. |
| 12 | `packages/dashboard-server/src/reporter/dashboard-subscriber.ts` | `suite-child` | `insertArtifact(id, 'suite-child')` | 1 | 0 | **DELETE** | The ingest child-row artifact mint, written per suite member alongside a run row carrying parent_run_id. Deleted with the suite ingest mode itself. |
| 13 | `packages/dashboard-server/src/reporter/dashboard-subscriber.ts` | `suite-parent` | `const kind: RunArtifactKind = mode === 'suite' ? 'suite-parent' : 'test'` | 1 | 0 | **DELETE** | The ingest parent-kind mint. This module is the LIVE producer of new parent/child run records — the dashboard suite door still reaches it — so the truth "no producer survives" is false while it stands. |
| 14 | `packages/dashboard-server/src/server/routes.ts` | `suite-parent` | `kind: isSuite ? 'suite-parent' : 'test',` | 1 | 0 | **DELETE** | The same mint on POST /api/runs/trigger — the door the dashboard UI actually uses. |
| 15 | `packages/dashboard-server/src/server/routes.ts` | `suite-parent` | `kind: isSuiteFile ? 'suite-parent' : 'test',` | 1 | 0 | **DELETE** | The parent-kind mint on POST /api/queue/enqueue named in D-11. |
| 16 | `packages/dashboard-server/src/server/server.ts` | `getRunsByParent` | `const children = db.getRunsByParent(run.id)` | 1 | 0 | **DELETE** | Startup orphan-cleanup skip: leaves a suite parent stuck in `running` when a child still reads `running`. After a restart nothing is running, and with no child producer the skip can only strand historical rows in a state no process will ever finish. |
| 17 | `packages/dashboard-server/src/server/server.ts` | `getRunsByParent` | `const children = db.getRunsByParent(runId)` | 1 | 0 | **DELETE** | Run-close suite fold: derives the parent row's status from its children. With no child producer this can only ever read an empty list, so it is dead code reading as live policy — the same shape 401-07 retired for retry children at this exact site. |
| 18 | `packages/dashboard-server/src/server/server.ts` | `getRunsByParent` | `const updatedChildren = db.getRunsByParent(runId)` | 1 | 0 | **DELETE** | The second half of the same fold (re-read after forcing incomplete children). |
| 19 | `packages/cli/src/commands/run.ts` | `suite-parent` | `// single-test analog of Plan 10's suite-parent parallel drop under the one-RunSession law).` | 1 | 1 | **KEEP** | Historical prose. A comment naming a retirement that already happened is a record, not a producer; deleting it would erase the reason a later reader needs. |
| 20 | `packages/dashboard-server/src/db/database.ts` | `getRunsByParent` | `const children = this.getRunsByParent(runId).map((run) => ({` | 1 | 1 | **KEEP** | getRunArtifactBundle's child section, served by GET /api/runs/:id/artifact. Historical-row read. The one-run model produces no new children, but operator databases hold rows written before 402 and the pre-405 run list / run detail must keep rendering them. |
| 21 | `packages/dashboard-server/src/db/database.ts` | `getRunsByParent` | `getRunsByParent(parentRunId: string): RunRow[] {` | 1 | 1 | **KEEP** | The declaration of the historical read the run list and run detail serve. Historical-row read. The one-run model produces no new children, but operator databases hold rows written before 402 and the pre-405 run list / run detail must keep rendering them. |
| 22 | `packages/dashboard-server/src/db/schema.ts` | `suite-child` | `kind TEXT NOT NULL CHECK(kind IN ('test', 'suite-parent', 'suite-child', 'unknown')),` | 1 | 1 | **KEEP** | Same CHECK constraint (the suite-child arm). |
| 23 | `packages/dashboard-server/src/db/schema.ts` | `suite-parent` | `kind TEXT NOT NULL CHECK(kind IN ('test', 'suite-parent', 'suite-child', 'unknown')),` | 1 | 1 | **KEEP** | RETAINED union member (396-01 D-10 precedent): existing run_artifacts rows carry these kinds and must keep parsing. Deleting the value orphans every historical row. Narrowing the CHECK would additionally require a table rebuild migration on every operator database. |
| 24 | `packages/dashboard-server/src/server/routes.ts` | `getRunsByParent` | `'getRunsByParent',` | 1 | 1 | **KEEP** | RESPONSE_SAFE_RUN_READ_METHODS membership. The 401-23 allowlist asserts SET EQUALITY with the database's run reads at construction; dropping the name while the method survives throws at router build. |
| 25 | `packages/dashboard-server/src/server/routes.ts` | `getRunsByParent` | `const attempts = db.getRunsByParent(id)` | 1 | 1 | **KEEP** | GET /api/runs/:id — the run-DETAIL read. Historical-row read. The one-run model produces no new children, but operator databases hold rows written before 402 and the pre-405 run list / run detail must keep rendering them. |
| 26 | `packages/dashboard-server/src/server/routes.ts` | `getRunsByParent` | `const childRuns = db.getRunsByParent(id)` | 1 | 1 | **KEEP** | GET /api/runs/:id/execution-logs aggregates a historical suite's member logs. Historical-row read. The one-run model produces no new children, but operator databases hold rows written before 402 and the pre-405 run list / run detail must keep rendering them. |
| 27 | `packages/dashboard-server/src/server/routes.ts` | `getRunsByParent` | `const tests = db.getRunsByParent(id)` | 1 | 1 | **KEEP** | GET /api/runs/:id member list for a historical suite parent. Historical-row read. The one-run model produces no new children, but operator databases hold rows written before 402 and the pre-405 run list / run detail must keep rendering them. |
| 28 | `packages/dashboard-server/src/server/routes.ts` | `getRunsByParent` | `const tests = db.getRunsByParent(run.id).map(test => enrichRunRow(test, targetPlatforms))` | 1 | 1 | **KEEP** | GET /api/runs — the run-LIST read. Historical-row read. The one-run model produces no new children, but operator databases hold rows written before 402 and the pre-405 run list / run detail must keep rendering them. |
| 29 | `packages/dashboard-server/src/server/routes.ts` | `getRunsByParent` | `getRunsByParent: { value: (parentRunId: string) => scrubRows(db.getRunsByParent(parentRunId)) },` | 1 | 1 | **KEEP** | The metadata-scrubbing override for the same read. A surviving read that lost its scrub would leak server-derived run metadata (401-23). |
| 30 | `packages/dashboard-ui/src/lib/api.ts` | `suite-child` | `export type RunArtifactKind = 'test' \| 'suite-parent' \| 'suite-child' \| 'unknown'` | 1 | 1 | **KEEP** | Same UI-side union (the suite-child arm). |
| 31 | `packages/dashboard-ui/src/lib/api.ts` | `suite-parent` | `export type RunArtifactKind = 'test' \| 'suite-parent' \| 'suite-child' \| 'unknown'` | 1 | 1 | **KEEP** | RETAINED union member (396-01 D-10 precedent): existing run_artifacts rows carry these kinds and must keep parsing. Deleting the value orphans every historical row. The UI renders this value verbatim as the artifact badge, so a historical row whose kind the type does not admit stops type-checking at the render site. |
| 32 | `packages/schema/src/run/run-artifact.ts` | `suite-child` | `export type RunArtifactKind = 'test' \| 'suite-parent' \| 'suite-child' \| 'unknown'` | 1 | 1 | **KEEP** | Same canonical union (the suite-child arm). |
| 33 | `packages/schema/src/run/run-artifact.ts` | `suite-parent` | `export type RunArtifactKind = 'test' \| 'suite-parent' \| 'suite-child' \| 'unknown'` | 1 | 1 | **KEEP** | RETAINED union member (396-01 D-10 precedent): existing run_artifacts rows carry these kinds and must keep parsing. Deleting the value orphans every historical row. This is the canonical union; the D-11 ruling deletes the PRODUCERS of the value, not the value. |

### Surfaces — predicate B (structural, behaviour-observed)

| # | Surface | Kind | Disposition | Registered sites | Rationale |
|---|---------|------|-------------|------------------|-----------|
| 1 | `ingest:createDashboardRunIngest retry correlation` | producer | **DELETE** | _(reached only in raw SQL / by composition — no debris token)_ | Already producer-less before this plan — 401-07 (D-12) retired the machinery that set AGENT_QA_PARENT_RUN_ID, so nothing can reach this mode. "Anything the one-run model leaves producer-less goes too" (D-11). Predicate A never saw it (it spells no debris token); predicate B found it by producing a linked row. |
| 2 | `ingest:createDashboardRunIngest suite correlation` | producer | **DELETE** | `dashboard-subscriber.ts :: suite-parent const kind: RunArtifactKind = mode === 'suite' ? 'suite-parent' : 'test'`<br>`dashboard-subscriber.ts :: suite-child insertArtifact(id, 'suite-child')` | The live producer of new parent/child run records: a parent row of kind suite-parent plus one linked child row per member. A parallel suite is ONE run row with member handles (D-11). |
| 3 | `route:POST /api/queue/enqueue (suite file)` | producer | **DELETE** | `routes.ts :: suite-parent kind: isSuiteFile ? 'suite-parent' : 'test',` | The parent-kind mint D-11 names. |
| 4 | `route:POST /api/runs/trigger (suite file)` | producer | **DELETE** | `routes.ts :: suite-parent kind: isSuite ? 'suite-parent' : 'test',` | The same mint on the door the dashboard UI uses. |
| 5 | `queue:cancel` | reader | **DELETE** | `job-queue.ts :: cancelChildRuns this.cancelChildRuns(runId, now)`<br>`job-queue.ts :: cancelChildRuns private cancelChildRuns(parentRunId: string, endedAt: string): void {`<br>`job-queue.ts :: getRunsByParent for (const child of this.db.getRunsByParent(parentRunId)) {` | The child-cancellation fan-out D-11 names. Its link-reading effect is what the queue walk observes; after the deletion cancelling a parent leaves historical members untouched. |
| 6 | `route:POST /api/runs/:id/cancel` | reader | **DELETE** | `job-queue.ts :: cancelChildRuns this.cancelChildRuns(runId, now)` | The HTTP door onto queue:cancel. It stays a route; what goes is its link-reading effect. |
| 7 | `db:deleteRun` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | The recursive `run_tree` cascade. Deleting a historical suite parent must still delete its members, or the rows this census orphans become undeletable through the UI. Reads the link in raw SQL, which is why predicate A never saw it and predicate B did. |
| 8 | `db:getInsightsBreakdown` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | Insights breakdowns; its suite/platform dimensions split on the link. A `parent_run_id IS NULL` top-level-run filter in raw SQL. Predicate A is structurally blind to these — they name no debris token — and predicate B found all ten by differential. KEEP, and required: a child row admitted as a top-level run would double-count every historical suite in the list, the counts and the trend series. |
| 9 | `db:getRunArtifactBundle` | reader | **KEEP** | `database.ts :: getRunsByParent const children = this.getRunsByParent(runId).map((run) => ({` | Historical-row read. The one-run model produces no new children, but operator databases hold rows written before 402 and the pre-405 run list / run detail must keep rendering them. Served by GET /api/runs/:id/artifact. |
| 10 | `db:getRuns` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | The run-list query itself: `parent_run_id IS NULL` is its first condition. A `parent_run_id IS NULL` top-level-run filter in raw SQL. Predicate A is structurally blind to these — they name no debris token — and predicate B found all ten by differential. KEEP, and required: a child row admitted as a top-level run would double-count every historical suite in the list, the counts and the trend series. |
| 11 | `db:getRunsByParent` | reader | **KEEP** | `database.ts :: getRunsByParent getRunsByParent(parentRunId: string): RunRow[] {` | Historical-row read. The one-run model produces no new children, but operator databases hold rows written before 402 and the pre-405 run list / run detail must keep rendering them. |
| 12 | `db:getRunsBySuiteId` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | Suite drill-down listing. A `parent_run_id IS NULL` top-level-run filter in raw SQL. Predicate A is structurally blind to these — they name no debris token — and predicate B found all ten by differential. KEEP, and required: a child row admitted as a top-level run would double-count every historical suite in the list, the counts and the trend series. |
| 13 | `db:getRunsBySuiteIdCount` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | The paging total for the same listing. A `parent_run_id IS NULL` top-level-run filter in raw SQL. Predicate A is structurally blind to these — they name no debris token — and predicate B found all ten by differential. KEEP, and required: a child row admitted as a top-level run would double-count every historical suite in the list, the counts and the trend series. |
| 14 | `db:getRunsByTestName` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | Test-history listing. A `parent_run_id IS NULL` top-level-run filter in raw SQL. Predicate A is structurally blind to these — they name no debris token — and predicate B found all ten by differential. KEEP, and required: a child row admitted as a top-level run would double-count every historical suite in the list, the counts and the trend series. |
| 15 | `db:getRunsByTestNameCount` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | The paging total for the same listing. A `parent_run_id IS NULL` top-level-run filter in raw SQL. Predicate A is structurally blind to these — they name no debris token — and predicate B found all ten by differential. KEEP, and required: a child row admitted as a top-level run would double-count every historical suite in the list, the counts and the trend series. |
| 16 | `db:getStats` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | Dashboard headline counters. A `parent_run_id IS NULL` top-level-run filter in raw SQL. Predicate A is structurally blind to these — they name no debris token — and predicate B found all ten by differential. KEEP, and required: a child row admitted as a top-level run would double-count every historical suite in the list, the counts and the trend series. |
| 17 | `db:getSuiteTrends` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | Suite trend series. A `parent_run_id IS NULL` top-level-run filter in raw SQL. Predicate A is structurally blind to these — they name no debris token — and predicate B found all ten by differential. KEEP, and required: a child row admitted as a top-level run would double-count every historical suite in the list, the counts and the trend series. |
| 18 | `db:getTestTrends` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | Test trend series. A `parent_run_id IS NULL` top-level-run filter in raw SQL. Predicate A is structurally blind to these — they name no debris token — and predicate B found all ten by differential. KEEP, and required: a child row admitted as a top-level run would double-count every historical suite in the list, the counts and the trend series. |
| 19 | `db:listRunsForInsights` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | The private row source getInsightsBreakdown folds; on the prototype, so the walk reaches it directly. A `parent_run_id IS NULL` top-level-run filter in raw SQL. Predicate A is structurally blind to these — they name no debris token — and predicate B found all ten by differential. KEEP, and required: a child row admitted as a top-level run would double-count every historical suite in the list, the counts and the trend series. |
| 20 | `route:DELETE /api/runs/:id` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | Serves db:deleteRun and inherits its disposition. |
| 21 | `route:GET /api/runs` | reader | **KEEP** | `routes.ts :: getRunsByParent const tests = db.getRunsByParent(run.id).map(test => enrichRunRow(test, targetPlatforms))` | Historical-row read. The one-run model produces no new children, but operator databases hold rows written before 402 and the pre-405 run list / run detail must keep rendering them. |
| 22 | `route:GET /api/runs/:id` | reader | **KEEP** | `routes.ts :: getRunsByParent const attempts = db.getRunsByParent(id)`<br>`routes.ts :: getRunsByParent const tests = db.getRunsByParent(id)` | Historical-row read. The one-run model produces no new children, but operator databases hold rows written before 402 and the pre-405 run list / run detail must keep rendering them. |
| 23 | `route:GET /api/runs/:id/artifact` | reader | **KEEP** | _(reached only in raw SQL / by composition — no debris token)_ | Serves getRunArtifactBundle, whose child section is registered above. |
| 24 | `route:GET /api/runs/:id/execution-logs` | reader | **KEEP** | `routes.ts :: getRunsByParent const childRuns = db.getRunsByParent(id)` | Historical-row read. The one-run model produces no new children, but operator databases hold rows written before 402 and the pre-405 run list / run detail must keep rendering them. |
---

### Operational notes for the next reader

**A debris token inside a retirement comment reds the lexical arm.** Predicate A reads source TEXT,
so the dated notes this plan left where the deleted code used to stand cannot spell
`getRunsByParent` / `cancelChildRuns` / `suite-parent` / `suite-child`. Three of them did on the
first pass and the census caught all three. They were REWORDED rather than registered: adding this
plan's own explanatory prose to the register would inflate the denominator with text the register
exists to describe. Same class as WINDOWS #241 (prose tripping a source scan), and the same
resolution — reword the prose, do not widen the guard.

**Where the census does NOT reach, stated so nobody infers otherwise.**

- The legacy `/api/execution/events` projection (`dashboard-ui/src/lib/live-timeline.ts`, ~30
  `parentRunId` references, plus `ExecutionLiveIdentity.parentRunId` in `lib/api.ts`) is untouched.
  It is a live-event projection, not a run-record read, no dashboard-server module puts
  `parentRunId` on those events, and 405 rebuilds it. The 405 build-order pin 402-08 recorded holds.
- Predicate B's route corpus is declared (see "The honest limit" above).
- Nothing here measures the dashboard END TO END — a real browser driving a real suite through the
  changed ingest. The claim proven is at the API and database layer: no producer mints a
  parent/child record, and an operator-shaped database still renders through the shipped routes.

### Gate at the time of writing (2026-08-24)

`pnpm build` · `pnpm test --force` · `pnpm validate:arch` · the conformance suite on the rebuilt
dist. Every workspace package green; the ONE red is the pre-existing `tools/embedding-bench`
`tau-lex` receipt failure, which predates this phase and is untouched by it.

---

## 2026-08-27 — the v1 run projection, the path-addressed artifacts and the legacy live feed (Phase 405 plan 07, D-02 / D-03 / D-14 / D-19 / D-20)

**Owner's ruling, verbatim (405-CONTEXT.md D-02):** *"hard cut, no migration etc, as there are no
users and users need to delete the existing run date so you do what's right also bump the version to
v2 for the DDLs etc"*

**The predicate, unchanged from 402-09's:** "required" = a PRODUCER on the shipped in-process core
AND a READER on the rebuilt page. Anything scoring zero on either leaves with its readers. What
changed is not the instrument but the ground: 405-01 rewrote the dashboard subscriber on the bus's
own payload types, which left three whole tables and five `runs` columns with no writer at all.

### What was deleted

| Item | Producer measured | Reader measured | Disposition |
|---|---|---|---|
| the v1 wide step table, the reasoning-trace table, the log table, and their eight indexes | none since 405-01 | none once the read arms below went | **DELETE** |
| the repository members over them — the step insert/readers, the trace pair, the log pair, the per-run step delete, the captured-variable-name reader, the accessibility summary and its private config probe, the three row mappers | — | — | **DELETE** |
| the run row's recording-path column and its `RunRow` field | none at all | none (D-14: no ref producer mints a recording, so the honest state is no surface) | **DELETE** |
| the run row's parent-link, attempt-ordinal and two retry columns, their index, the child reader, the retry-info writer, and the recursive delete cascade | none since 402-09 | none | **DELETE** |
| `RunArtifactBundle.children` and the `children` key on `GET /api/runs/:id/artifact` | — | structurally empty | **DELETE** |
| every `parent_run_id IS NULL` top-level filter (twelve sites, raw SQL) | — | — | **DELETE** — see the disposition change below |
| the `run_artifacts.kind` CHECK's two suite kinds | only `'test'` minted | — | **NARROW** to `('test','unknown')` |
| `db/run-id-migration.ts`, its test and its barrel export | no production caller since it was written | — | **DELETE** |
| the two path-addressed artifact routes, the containment resolver, the served-path verdict, its refusal helper, the run-deletion filesystem sweep, and the screenshots/videos dir wiring | — | — | **DELETE** (D-14) |
| the superseded read arms — the step list, the per-step reasoning trace, the log page, the accessibility summary, the captured-variable suggestion | — | superseded by `runs.detail` | **DELETE** (D-03) |
| the legacy `/api/execution/events` SSE arm, the live-event type, the backend's per-run replay buffers and counters, the push helper, the second event emission, and the synthetic `run-start` / `run-complete` bookends | — | none since 405-03 | **DELETE** (D-19) |

### What was RETAINED, and the measurement that kept it

| Item | Producer | Reader | Disposition |
|---|---|---|---|
| `token_events`, `/api/token-events/stats`, the live-editor ws route | the live-editor ws handler (`server.ts`) — it executes IN-PROCESS and never used the retired spawn | the insights page | **KEEP** — D-20's census verdict, measured rather than assumed |
| `execution_logs` and its two handle columns | the subscriber's `hookFinished` arm | the hook panel | **KEEP** |
| the construction-data `runs` columns (metadata, environment, priority, parallel, test-file content, model name, provider) | the queue/enqueue and settle writes | the runs list and insights | **KEEP** — written by the composition, never bus-projected, so outside the "no producer on the bus" clause |
| `runs.error_log` | `server.ts`'s run-settled handler | the run list's error posture | **KEEP** |
| `RunArtifactKind`'s two suite members in `packages/schema` and `dashboard-ui/lib/api.ts` | none | the UI's artifact badge switches on the value | **KEEP as unreachable breadth** — the STORE refuses them now; narrowing a union a render site switches on is 405-11's edit |

### The disposition that changed, and why it could only change now

402-09 kept every parent-link reader on ONE argument: the one-run model produced no new children,
but an operator's database still held rows written before it, and the run list and run detail had to
keep rendering them. That argument had a lifetime. D-02 ends it — v2 is a hard cut, and a database
stamped at any older version is REFUSED BY NAME on open rather than migrated. There is no such thing
as a pre-405 row in a database this build will open, so a read that exists to render one reads a
shape that cannot be present, and a filter that excludes one filters nothing.

The same argument retires 402-09's T-402-29 mitigation ("historical rows still render"). It is moot
rather than abandoned, and the census file says so in the terms the mitigation was written in: two
cells now assert the refusal by name and the store's refusal of the two retired artifact kinds.

### What happened to predicate B

**Its discriminator was deleted, so the differential is retired and replaced by a structural claim.**
Predicate B worked by seeding two byte-identical databases differing in exactly one fact — whether a
member row pointed at its parent — and walking every prototype member and every run route against
both. That is why the twelve raw-SQL filters and the delete cascade were found at all: predicate A
cannot see a query. With the column gone there is no second database to seed, and a differential run
over an absent discriminator can only ever report "no difference" — precisely the vacuous instrument
the census exists to refuse. Keeping it would have meant keeping the column alive so its own test
could still run.

What replaces it is stronger for the claim it now has to make. The differential proved "these
members read the link"; the successor proves "no member CAN read it", at the storage layer: the
table has no such column, and the store refuses the two artifact kinds the parent/child model
minted. A reader reintroduced under any name would have to reintroduce the column first, and that
reds before any behaviour is written.

### Operational notes for the next reader

**A debris token inside a retirement comment still reds the lexical arm.** Every dated note this
plan left where deleted code stood was written to avoid spelling a scanned token, and the cells that
DO have to name one build it from two halves (`'ste' + 'ps'`) so an assertion cannot satisfy the
inventory by matching itself. Same class as WINDOWS #241, same resolution.

**Two pins over the retired feed were inverted rather than deleted.** `routes.test.ts` asserted the
legacy SSE route was PRESENT (the phase-225 guardrail's way of saying live state lives on the wire,
not in the schema) — it now asserts its absence. `routes.run-stream.test.ts`'s known-positive control
for "the predicate can see frame formatting" was that same handler; it moved to
`run-service/run-service-routes.ts`, which is where the frames are actually written.

**Where this census does NOT reach.** The dashboard UI still imports the four-member
`RunArtifactKind` and still carries the retired path/step field names; 405-11 owns that half. The
`agent-qa dashboard` binary is not started end to end by anything here — 405-12 owns that.

### Gate at the time of writing (2026-08-27)

`pnpm typecheck` (44/44) · the whole `@vostride/agent-qa-dashboard` suite (48 files, 950 passed,
1 skipped) · the four CLI run-door suites · `pnpm validate:arch` (43 cells). The standing red is
`tools/embedding-bench` `tau-lex`, which predates this phase and is untouched by it.

---

## 2026-08-28 — the register closes: the v1 run-detail projection, the path artifacts and the legacy execution feed (Phase 405 plan 13, D-02 / D-14 / D-19 / D-20 / D-21)

**This section does not delete anything.** Plans 01–12 did the deleting and 07 wrote the section
above for the server half. This one is the phase's CLOSING register: it states what the whole of
405 removed, what it deliberately kept and the measurement that decided each, and it names the
instruments that will notice if any of it comes back. Per D-21 the acceptance for the deletions is
**a grep-clean inventory plus mutation-measured closed-shape cells** — the 404 D-04 idiom —
because a green suite cannot see a removed member returning: every assertion that a shape CONTAINS
what it should is satisfied by a shape that contains more.

### How this inventory is measured

| Instrument | What it claims | Where |
|---|---|---|
| the lexical inventory | 22 retired needles have ZERO occurrences across every package's production `src` tree (`.ts`/`.tsx`; `__tests__`, `*.test.*`, `*.test-d.*`, `dist`, `node_modules` excluded) — **comments count as hits** | `packages/dashboard-server/src/__tests__/405-debris-deleted.test.ts` |
| the DDL closed shape | the joined version-2 migration carries no healing / recording-path / reasoning / parent-link / v1-table declaration, and DOES declare the five tables the census kept (`run_members`, `run_steps`, `run_sub_actions`, `token_events`, `execution_logs` — the second half is what stops the cell passing over an empty migration) | same file |
| the UI closed shape | `RunDetailSubAction` is exactly the ten payload fields; `DisplayStep` declares no member naming a screenshot, healing capture, video or path; no run-detail component reaches the markup sink in CODE | `packages/dashboard-ui/src/lib/__tests__/run-detail-shape.test.ts` |
| the analytics closed shape | the completion shape's key set, by EQUALITY, on both completion members | `packages/analytics/src/__tests__/events.test.ts` |
| the mutation bar | each of the four above is proven to RED by re-adding the thing it forbids | `scripts/405-debris-mutation.sh` (`pnpm validate:debris-mutation`) |

**Comments count as hits, and that is the point rather than a rough edge.** The inventory's promise
is "this string is not in the shipped tree", not "no code calls it". A retirement note that spells
the token it retired is indistinguishable, to any later grep, from the reappearance the register
exists to forbid — and this phase was caught by exactly that three times (405-03 in rewire
commentary, 405-04 in a pin, 405-07 twice in test prose, fixed in `271f67c5`). Every cell that must
name a retired token therefore builds it from two halves, and the inventory cell asserts the
property over **its own bytes** so it cannot be satisfied by matching itself.

**The one exception, stated so it is not mistaken for an oversight: this file.** `DELETION-INVENTORY.md`
is not under any package's `src`, and it names retired tokens literally because a register whose
entries cannot be searched for is not a register.

### What phase 405 deleted

| Item | Producer measured | Reader on the rebuilt page | Disposition | Plan |
|---|---|---|---|---|
| the v1 wide `steps` table, `reasoning_traces`, `logs` and their eight indexes, with every repository member over them | none since the subscriber was rebuilt on the bus payloads (405-01) | none once the superseded read arms went | **DELETE** | 405-07 |
| the superseded read arms — `/steps`, `/steps/:n/reasoning`, `/logs`, `/accessibility`, the captured-variable suggestion | — | superseded by `runs.detail` | **DELETE** (D-03) | 405-07 |
| `runs.video_path`, `runs.parent_run_id`, `attempt_number`, `retry_count`, `max_retries` + `idx_runs_parent`, and their `RunRow` fields | none (video: none ever; the other four: none since 402-09) | none | **DELETE** | 405-07 |
| the two path-addressed artifact routes, `resolveArtifactPath`, the served-path verdict, its refusal helper, the run-deletion filesystem sweep and the screenshots/videos dir wiring | — | refs only | **DELETE** (D-14) | 405-07 |
| the legacy `/api/execution/events` SSE arm, `LiveExecutionEvent`, `getBufferedEvents`, the per-run replay buffers and counters, the push helper, the second emission and the synthetic `run-start`/`run-complete` bookends | — | none since 405-03 | **DELETE** (D-19) | 405-03 (UI half), 405-07 (server half) |
| the `useExecutionEvents` hook, `subscribeToExecutionEvents` and `lib/live-timeline.ts` | — | — | **DELETE** (D-19/D-20) | 405-03 |
| the v1 UI step shape — `StepRow`'s recording-path fields, `SubActionData`, `lib/artifact-media.ts`, `fetchStepReasoning` — and `RunArtifactKind`'s two suite members in both packages | — | — | **DELETE / NARROW** | 405-11 |
| `db/run-id-migration.ts`, its test and its barrel export | no production caller since it was written | — | **DELETE** | 405-07 |
| the analytics `healing_attempt_count` property | none (v49 settled that the `healed` step status and `selfHealOccurred` are the two real healing facts) | — | **DELETE** | 405-04 |
| the analytics `parent_run_id` property | none anywhere in the package — 402-09 put one run row per run, 405-07 then deleted the column it named, so it could only ever have travelled as `undefined` | — | **DELETE** | 405-13 |

### What was RETAINED, and the measurement that kept it

| Item | Producer measured | Reader measured | Disposition |
|---|---|---|---|
| `token_events`, `/api/token-events/stats`, `/api/live-editor/ws` | the live-editor ws handler in `server/server.ts` — it executes IN-PROCESS via core `executeStep` and never used the retired child-process spawn | the insights page (`pages/insights.tsx`) | **KEEP** — D-20's census verdict, measured |
| `execution_logs` (+ 405-01's `test_index` / `step_index`) | the subscriber's `hookFinished` arm | the hook panel | **KEEP** |
| `runs.error_log` | `server.ts`'s run-settled handler | the run list's error posture | **KEEP** |
| the construction-data `runs` columns — `metadata`, `environment`, `priority`, `parallel`, `test_file_content`, `model_name`, `llm_provider` | the queue/enqueue and settle writes | the runs list and insights | **KEEP** — written by the composition, never bus-projected, so outside D-02's "no producer on the bus" clause |
| `LivePhase` | the live editor's own phase stream | `groupPhasesIntoSubActions`, the two live step cards | **KEEP** — only its HOME moved (out of the retired hook, into `lib/display-step.ts` beside its consumer) |
| the `subActionsData` wire key | `dashboard-server`'s live-editor ws handler | exactly one named boundary in the UI: `liveSubActionsOf` in `hooks/use-live-editor.ts` | **KEEP** — see the scope note below |

### D-20's census verdict, with the measurement

D-20 asked whether the live editor was dead machinery that should go with the retired spawn, or a
live surface whose only fault was importing a retired hook. It is the second, and the count is what
decided it rather than judgment:

- **Importers of `useExecutionEvents`: two — the hook module itself and its own test.** Nothing else
  in the tree called it.
- **Importers of `LivePhase`: five, and every one of them type-only** — `use-live-editor.ts`,
  `live-step-card.tsx`, `live-editable-step-card.tsx`, `lib/display-step.ts` and
  `display-step.test.ts`. A type-only import is not a dependency on the retired transport.
- **The editor's execution path never touched the spawn:** it runs through core `executeStep`
  in-process.
- **`token_events` has one writer and one reader, both live:** the ws handler in `server/server.ts`
  writes, `pages/insights.tsx` reads.

⇒ the editor STAYS, `token_events` stays in the v2 DDL, `/api/live-editor/ws` stays, and only the
hook import was replaced. Rejected: leaving it untouched by fiat (an unmeasured keep), and deleting
it outright (an unmeasured delete).

### The `runs` column census

The table 405-07 measured, reproduced here as the closing record — a later reader looking for "why
does `runs` still have a `parallel` column" should find the answer in the register, not in a plan.

| Column | Producer | Reader | Disposition |
|---|---|---|---|
| `video_path` | none | none (D-14: no ref producer mints a recording, so the honest state is no column) | DELETE |
| `parent_run_id`, `attempt_number`, `retry_count`, `max_retries` | none since 402-09 | none | DELETE |
| `metadata`, `environment`, `priority`, `parallel`, `test_file_content`, `model_name`, `llm_provider` | queue/enqueue + settle | runs list, insights | KEEP |
| `error_log` | `server.ts` run-settled | run list error posture | KEEP |
| `detail` (new, 405-01) | the bus fold | the rebuilt run-detail page | the successor |

The three v1 projection TABLES were replaced rather than merely dropped: `run_members` (one row per
member handle, from `testStarted`/`testFinished`), `run_steps` (the whole `stepFinalized` payload,
with the token columns NULLABLE and never `DEFAULT 0`) and `run_sub_actions` (the whole
`subActionRecorded` payload). `runs.detail` is what the page reads; those three are what fills it.

### Run deletion leaves the run directory alone (405-05, D-14 discretion)

`DELETE /api/runs/:id` removes the dashboard's rows by `ON DELETE CASCADE` and **touches no file
under `.agent-qa/runs/`**. The path-based cleanup went with the path-based addressing. This is a
deliberate decision recorded as data, not a gap: the bus event log under `runs/<slug>/` is the run's
own record (401 D-04), the post-run jobs read evidence blobs by sha, and the dashboard PROJECTS that
record rather than owning it. A projection that deletes its source on eviction is not a projection.

### Scope note — `subActionsData` is not in the inventory, and why

405-11 reported the retired-needle grep over `packages/dashboard-ui/src` clean except two lines in
`hooks/use-live-editor.ts` — the `LiveSubAction` field type and the read inside `liveSubActionsOf`
— and recorded it as its Deviation 9 rather than letting it pass. **Adjudicated here as a KEEP,
with the measurement.**

`subActionsData` is the **live-editor socket's wire key**, produced today by `dashboard-server`'s ws
handler on the other side of a package boundary. It is not debris: it has a live producer and a live
reader. D-14 is about run-detail ARTIFACT addressing, and D-21's needle list is the retired
run-detail/live-feed vocabulary — this name is neither. Renaming another package's wire contract
from the consumer is a different change with a different blast radius, and it is not what this
inventory measures.

What 405-11 did do is the right shape and is why one name is tolerable: the wire key is spelled at
**exactly one boundary** (`liveSubActionsOf`), and everything downstream holds `LiveSubAction`.
Scattering nine reads of it through the UI would have kept the retired vocabulary alive by accident;
renaming the UI's own field away from the wire's would have hidden where the boundary is.

So the inventory's scope is narrowed here **explicitly and with a reason**, rather than by the cell
quietly not listing the needle. If the wire key is ever renamed, this row is the record of what it
was called and why it survived 405.

### Where this register does NOT reach

**The `403-09` "untouched until 405" remark CONTEXT.md names was not found.** A search for the
phrase and for `403-09` across every package `src` tree and `spec/` returns no such remark — the
three `until 405` hits are unrelated dated notes (`step-name-pills.test.tsx`,
`sub-action-tree-item.tsx`, `run-detail.tsx`), each already correct, and every `403-09` hit is a
threat id or a cross-reference. Recorded as **not found** rather than silently skipped, so a later
reader does not go looking for an edit that was never needed.

**`runs-table.tsx` and `run-navbar.tsx` still branch on `run.parentRunId`.** The camelCase UI field
survives on `lib/api.ts`'s `RunRow`, and with the column deleted it is now always absent — so
`run.suiteId != null && run.parentRunId == null` is a suite test that has quietly become
`run.suiteId != null`. It is NOT a D-21 needle (the needle is the snake_case column, which is gone)
and no 405 plan owns it. Filed in `deferred-items.md` rather than swept in here, because deleting a
branch a suite-parent row used to take is a decision about what the runs list shows, not a deletion
of debris.

### Gate at the time of writing (2026-08-28)

`pnpm typecheck` (44/44) · `pnpm validate:arch` (43 cells) · the whole `@vostride/agent-qa-dashboard`
suite · the whole `@vostride/agent-qa-dashboard-ui` suite · the whole `@vostride/agent-qa-analytics`
suite · `pnpm validate:debris-mutation` (four legs, each reddening its named cell, every subject
restored byte-identically) and its neutered self-test fatal on green. The standing red is
`tools/embedding-bench` `tau-lex`, which predates this phase (377) and is untouched by it.

---

## 2026-09-02 — the Issue-slot cleanup (Phases 409–412, CLSR-01..05)

**This section deletes nothing.** Phases 409, 410 and 411 did the deleting, and each of them
hand-measured every closed-shape cell it left behind — one mutation ledger per phase, one row per
cell, every exit code read from the process. Phase 412 added no deletion and no behaviour: it
merged the three census cells into one, turned the three ledgers into a script that re-runs them,
swept the prose the deletions falsified, reconciled `.planning` and `spec/v2`, and wrote this. This
is the milestone's CLOSING register. It records the verdicts those ledgers reached; it does not
re-reach them, and it adds no new deletion or retention ruling of its own.

Per D-13 the acceptance is **a grep-clean inventory plus mutation-measured closed-shape cells**,
which is the 404/405 idiom: a green suite cannot see a removed member returning, because every
assertion that a shape CONTAINS what it should is satisfied by a shape that contains more.

### The ruling

> **agent-qa is not a bug tracker and does not integrate with one.**

> **When nothing is configured, nothing is filed — and no proposal is minted either.** The
> record-and-surface `FindingProposal` that v52 shipped as the engine's placeholder goes too.

Both verbatim from `spec/v2/issue-engine-removal.md` §1 (the owner's decision of 2026-08-25). The
same section declines a tracker integration outright — "considered and **declined as a scope
multiplier**. Nothing is planned in its place."

> there are no users of this version so no backward compatibility etc.

The owner, 2026-09-02, in the Phase 412 discussion; recorded as D-15's context in
`.planning/phases/412-closure-the-census-the-mutation-bar-the-register-the-reconci/412-CONTEXT.md`.
It is quoted here because it is the reason nothing in this milestone carries a compatibility
shim: what left, left outright.

### How this inventory is measured

| Instrument | What it claims | Where |
|---|---|---|
| the merged census | 38 inventory entries over three path-ruled universes — 35 global, one production-scoped, two funnel-scoped — have ZERO occurrences across every workspace package's `src`, tests and comments included. 31 of the 38 are the union the three phases measured (409's nine, 410's seven, 411's fifteen); the other seven are the spellings Phase 412's own prose sweep retired (the five D-15 needles, with the scaffolded shelf pinned in three byte-distinct forms because the scaffold spelled it inside a template literal). Fifteen entries carry a `clsr01` flag and a dedicated cell counts that flag at exactly fifteen: `triage-issues`, `triageIssues`, `issues-drafted`, `ANALYZE_RUN_PRODUCED_SUCCESSORS`, `POST_RUN_CHAIN_KINDS`, `IssueDelta`, `IssueId`, `asIssueId`, the `BUG` entity kind, `BUG-`, `agentqa://bug`, `reserved-kind`, `BugAddressingNotAvailable`, `FindingProposal`, `FindingFailurePoint`. The production-scoped quoted status literal is NOT one of the fifteen — CLSR-01 states it as a separate clause — and carries no flag. **A comment is a hit like any other occurrence.** | `packages/arch/src/__tests__/412-issue-slot-deleted.test.ts` (`pnpm validate:arch`) |
| the by-name positive control | asserts BOTH halves of D-03 rather than documenting either: the sorted set of NON-production files spelling the quoted retired status literal equals exactly `schema/src/__tests__/run-notification-migration.test.ts` and `agent-local/src/__tests__/post-processing-status.test.ts` — and the third site CLSR-01 excludes, `cli/src/__tests__/conformance/domain-list.ts`, spells the marker only **as a bare key, not the quoted literal**. So D-03's "three sites still spell the literal" is two spellers plus one key, and a reader of D-03 is not misled. A fourth speller REDs the control instead of hiding behind an exclusion list; production scope stays a path rule that names no file. | same file |
| the mutation bar — plants | one leg per package root discovered from disk (23 today, `PLANT ROOTS 23`): a one-line file spelling exactly one needle is dropped into a real package, the census must RED, and the RED must NAME that package's own file. Twelve plant lines rotate by root ordinal, so coverage of the needle table and coverage of the package tree are proven by one loop. | `scripts/412-issue-slot-mutation.sh` legs `P-<pkg>` (`pnpm validate:issue-slot-mutation`) |
| the mutation bar — scoped controls | `C-01` plants the quoted status literal OUTSIDE production (410 Row 8 half (b)) and only the by-name control REDs while the production cell stays green; `C-02` plants the side-counter key at a funnel-rule path (411 Row 10, leg IN) and only the funnel cell REDs. | same script, legs `C-01`, `C-02` |
| the mutation bar — the 409 legs | `J-01` ← 409 Row 1 (JOBK-01, a sixth kind on the enqueue contract; **schema rebuilt only** — the agent must not be rebuilt under a six-member union, because a DTS build failure is not a red cell); `J-02` ← 409 Row 2 (JOBK-02, a second declared successor); `J-03a`/`J-03b`/`J-03c` ← 409 Row 3 (JOBK-03, one mutation read at three distances: agent, agent-local, cli); `V-01` ← 409 Row 4 (the surviving `Delta` union's `never` bar — see the VOCB-01 row below); `V-02` ← 409 Row 5 (the `DELTA_KINDS` cast, the runtime wall beside Row 4); `V-03` ← 409 Rows 10–13 (the whole-vocabulary readmission). | same script |
| the mutation bar — the 410 legs | `E-01` ← 410 Row 1 (ENTY-03, the sixth kind in the `ENTITY_KINDS` array); `E-02`/`E-03`/`E-04` ← 410 Rows 2–4 (the same kind smuggled onto all five `satisfies`-total tables through an `Object.assign(… as Record<string, unknown>, …)` cast); `E-05` ← 410 Row 5 (the retired no-match resolution reason); `E-06` ← 410 Row 6 (the retired corpus category). Each of the three cast legs runs `pnpm --filter @vostride/agent-qa-schema typecheck` **while the cast is live** and requires exit 0 — 410 D-02's claim that the type wall cannot see a cast-widened table, measured on every run rather than remembered, with its own FATAL if a future `tsc` ever learns to see it. | same script |
| the mutation bar — the 411 legs | `W-01` ← 411 Row 1 (WTST-09, the runtime exact-list pin) and `W-01t` ← the same row's ALLOWED second instrument (the schema typecheck, which that ledger predicted at 0 and MEASURED at 2 — the prediction was wrong in the safe direction, so the correction rides its own leg); `W-02` ← 411 Row 2 (the loop-outcome vocabulary); `W-03` ← 411 Row 3 (WTST-11, a put re-added on the stopped arm, schema rebuilt before the mutated run and again before the restored one); `W-04` ← 411 Row 4 and `W-05` ← 411 Row 5 (the two `keyof` pins); `W-06` ← 411 Row 8 (the funnel `keyof` pin). A `.test-d.ts` REDs as ONE FAILED SUITE, matched on the suite line plus a `❯ <file>:<line>:<col>` pointer and a `TypeCheckError` block count — never on a test title, because a failed type suite has none. | same script |
| the rows the bar does NOT encode | named with their reason and their standing instrument, because a bar that silently drops a row measures less than it claims. **410 Rows 9–11** (the three dist-crossing readmissions) are skipped by D-06 — each needs a whole-package rebuild chain to measure what `E-01` already REDs at its source. **409 Rows 6–8** (the eleventh crash point, the poison job's bound, the `consolidate` bound cell) are skipped: they measure engine bounds rather than a set that got smaller. **411 Rows 6–7** keep `pnpm validate:router-mutation` as their instrument — re-encoding them here would give one property two owners. | `pnpm validate:router-mutation` for 411 Rows 6–7 |
| VOCB-01, as it was actually measured | the requirement is carried by `V-03`, the whole-vocabulary readmission: under it the schema still COMPILES (the leg's coherence gate proves `typecheck` exit 0 before the instrument runs) and the census REDs exactly the four cells that name the deleted vocabulary. `V-01` does NOT carry VOCB-01 — `packages/schema/src/delta/delta.ts` is byte-identical across the whole deletion, so what its retained `never` bars guard is the SURVIVING six-arm union against a future widening. The criterion's "via `typecheck`" names that second instrument. **The requirement is therefore measured as two instruments, and this row says which one carries it.** D-05's wording — "five `git show 9b0c3459:<path>` restores" — is applied as FOUR restores plus a three-line barrel hunk, because `packages/schema/src/index.ts` moved under 410 and 411: a whole-file restore would readmit 411's deleted finding schemas and drop the stop-arm exports, which is a blast radius rather than a measurement. The deviation is recorded in the script's own `# LEG INDEX` block, which is this table's transcription source. | `scripts/412-issue-slot-mutation.sh` legs `V-03` / `V-01` |
| the bar's own self-test | `ISSUE_SLOT_SELFTEST=neutered` makes `apply_mutation` a no-op, so every leg stays green and the script must then exit NON-ZERO with `FATAL: the suite stayed green under the mutation`. A gate nobody has seen fire is a comment; this one has been seen to fire. CLSR-02's bare `SELFTEST=neutered` is shorthand — the real knob is spelled `ISSUE_SLOT_SELFTEST=neutered`, script-prefixed so chained scripts cannot collide (D-08). | same script |
| the asymmetry, recorded rather than closed | 409's note (h): the job-kind half of the bar is STRUCTURAL — a sorted-literal `toEqual` REDs under any spelling — while the delta/id half is LEXICAL, nine exact tokens. A readmission under RENAMED tokens therefore passes every instrument this milestone owns. The structural pin that would close it (`expectTypeOf<keyof typeof ids>()` against the two surviving casts) is a new cell, and this phase encodes rather than invents; it is deferred, not done, and this row is where a later reader finds that out. | — |

**Comments count as hits, and that is the point of the design rather than a rough edge in it.** The
inventory's promise is "this string is not in the shipped tree", not "no code reads it". A
retirement note that spells the token it retired is indistinguishable, to any later grep, from the
reappearance the register exists to forbid. Every needle is therefore built from two halves so the
census file cannot satisfy its own inventory, a last cell asserts that property over the file's own
bytes, and every dated note this milestone wrote names the CONCEPT and never the token — which is
why 409–412 left 35 dated "— see `DELETION-INVENTORY.md`" lines in `packages/*/src` pointing here
instead of restating what left.

**The one exception, stated so it is not mistaken for an oversight: this file.**
`DELETION-INVENTORY.md` sits at the repository root, outside every package's `src`, and it names
retired tokens literally because a register whose entries cannot be searched for is not a register.
The same reasoning covers `scripts/`, which is also outside the census — see the frozen 404 script's
two rows under "What was RETAINED".

### What was deleted

**Both ends of the derivation, stated so it can be re-run.** Baseline `9b0c3459` — the last commit
before Phase 409. Closing HEAD `63740043` (`agent-qa`, branch `version-0.2`), the commit that closed
the mutation bar and the last code commit of the milestone; the super-repo stood at `8902de62`. The
lists below are DERIVED from `git -C agent-qa diff 9b0c3459..63740043`, keyed by token, not
transcribed from any plan summary: 42 commits, 112 files, +3259/−1381, with exactly one file deleted
(`packages/schema/src/delta/issue-delta.ts`) and eight added. The "pre-deletion hits" column is that
token's occurrence count in the census's own universe (`packages/*/src`, `.ts`/`.tsx`, tests and
comments included) measured at `9b0c3459`; the "source in the diff" column is where the deletions
landed, with the per-file count in parentheses. **Where the two columns agree the derivation is
self-checking** — the baseline count and the diff's deletion count are computed by different means
and match token for token, with one recorded exception noted under Phase 411.

#### Phase 409 — the job-kind layer and the type vocabulary

Deleted by commits `6f7f3d93`..`fa314aa4`. Ledger:
`.planning/phases/409-the-job-kind-layer-the-type-vocabulary/409-MUTATION-LEDGER.md`.

| Token / file / line | Pre-deletion hits (census) | Source in the diff | Ledger row |
|---|---|---|---|
| `triage-issues` — the reserved sixth job kind | 30 | `agent/src/jobs/kinds.ts` (6) · `agent/src/jobs/__tests__/real-kinds.test.ts` (5) · `agent/src/jobs/chain-identity.ts` (4) · `agent/src/jobs/__tests__/engine-semantics.test.ts` (4) · `agent-local/src/__tests__/kill-matrix/kill-matrix.test.ts` (3) · `agent-local/src/__tests__/kill-matrix/kill-matrix-adversarial.test.ts` (3) · `schema/src/job/job.ts` (2) · `agent/src/jobs/__tests__/kind-registry.test.ts` (2) · `cli/src/curation/post-run-chip-emitter.ts` (1) | Rows 1 / 2 (JOBK-01, JOBK-02) |
| `issues-drafted` — the reserved kind's checkpoint id | 4 | `agent/src/jobs/kinds.ts` (2) · `agent-local/src/__tests__/kill-matrix/kill-matrix.test.ts` (2) | Row 1 (JOBK-01) |
| `ANALYZE_RUN_PRODUCED_SUCCESSORS` — the produced-successors constant | 3 | `agent/src/jobs/kinds.ts` (3) | Row 2 (JOBK-02) — 388 D-04's declared/produced split collapsed with it; the survivor is `ANALYZE_RUN_SUCCESSORS` |
| `triageIssues` — the third derived chain id key | 8 | `agent-local/src/__tests__/chain-terminal-notify.test.ts` (3) · `agent/src/jobs/chain-identity.ts` (2) · `cli/src/curation/post-run-tail.ts` (1) · `cli/src/__tests__/post-run-enqueue-idempotency.test.ts` (1) · `agent/src/jobs/engine.ts` (1) | Row 3 (JOBK-03), read at three distances by legs `J-03a`/`b`/`c` |
| `POST_RUN_CHAIN_KINDS` — the never-imported chain-kinds list | 1 | `agent/src/jobs/chain-identity.ts` (1) | Row 2; the survivor is `POST_RUN_CHAIN_TERMINAL_KINDS`. `spec/v2/issue-engine-removal.md` §4 called this row `CHAIN_KINDS`, an identifier that never existed — corrected in place by D-21, see Reconciliation |
| `IssueDelta` — the second delta vocabulary (`export type IssueDelta = FileIssue \| RecordOccurrence \| Reopen \| ProposeResolve \| Merge \| Noop`) | 14 | `schema/src/__tests__/delta.test-d.ts` (8) · `schema/src/__tests__/seam-root.test-d.ts` (3) · `schema/src/index.ts` (1) · `schema/src/delta/issue-delta.ts` (1) · `schema/src/delta/index.ts` (1) | Rows 10 / 13 (VOCB-01) |
| `issue-delta` — that vocabulary's module specifier | 2 | `schema/src/delta/index.ts` (1) · `schema/src/__tests__/delta.test-d.ts` (1) | Row 13 (VOCB-01). The cell matches file CONTENT only, so it measures "no file IMPORTS the module by name" and is not a file-existence pin — the ledger records that limit and Rows 10/11 are what catch an orphaned readmission |
| **the file** `packages/schema/src/delta/issue-delta.ts` — the milestone's one deleted file (39 lines) | — | deleted whole; `git show 9b0c3459:packages/schema/src/delta/issue-delta.ts` is the byte authority the `V-03` leg restores from | Rows 10–13 |
| `IssueId` — the third id brand (`export type IssueId = string & { readonly [issueIdBrand]: 'IssueId' }`) | 23 | `schema/src/__tests__/delta.test-d.ts` (7) · `schema/src/delta/issue-delta.ts` (6) · `schema/src/__tests__/seam-root.test-d.ts` (4) · `schema/src/index.ts` (2) · `schema/src/ids/record-id.ts` (2) · `schema/src/ids/index.ts` (2) | Row 11 (VOCB-02). The brand's private `unique symbol` declaration is caught by NONE of the needles — it is spelled with a lower-case initial and the scan is case-sensitive — so the census pins the EXPORTED brand and its cast, not the symbol they are built from. A symbol-only readmission is inert and is recorded here as out of scope |
| `asIssueId` — that brand's cast helper (`export const asIssueId = (value: string): IssueId => value as IssueId`) | 5 | `schema/src/__tests__/seam-root.test-d.ts` (2) · `schema/src/index.ts` (1) · `schema/src/ids/record-id.ts` (1) · `schema/src/ids/index.ts` (1) | Row 12 (VOCB-02) — the RUNTIME half; the brand is a type and disappears at build, the cast is an exported value and would reappear in `dist` |

Also deleted, and not needles because they carry no retired token: the barrel re-export lines
`export { asRecordId, asIssueId, asEvidenceToken } from './record-id'` and
`export type { RecordId, IssueId, EvidenceToken } from './record-id'` narrowed to two brands each,
and the `Issue` auto-accept membership line in `packages/schema/src/safety/protected-classes.ts`
(one line, commit `25da3174`). Two brands survive: `RecordId` and `EvidenceToken`.

#### Phase 410 — the BUG entity kind

Deleted by commits `4629de35`..`f46a4338`. Ledger:
`.planning/phases/410-the-bug-entity-kind/410-MUTATION-LEDGER.md`.

| Token / file / line | Pre-deletion hits (census) | Source in the diff | Ledger row |
|---|---|---|---|
| the retired entity kind, word-bounded (`ENTITY_KINDS` went from `['TST', 'RUN', 'BUG', 'MEM', 'POL', 'TGT']` to five) | 74 | 21 files, widest first: `knowledge-local/src/resolver/__tests__/fixtures/entity-corpus.ts` (10) · `schema/src/entity/entity-card.ts` (5) · `knowledge-local/src/resolver/resolve.ts` (5) · `knowledge-local/src/addressing/ledger.ts` (5) · `dashboard-ui/src/__tests__/fixtures/entity-cards.ts` (5) · `dashboard-ui/src/__tests__/entity-card.test.ts` (5) · `agent/src/functions/entity-cards/__tests__/card-actions.test.ts` (5) · `knowledge-local/src/resolver/__tests__/resolve-tier-a.test.ts` (4) · `knowledge-local/src/addressing/__tests__/ledger.test.ts` (4) · `schema/src/entity/kinds.ts` (3) · `knowledge-local/src/resolver/__tests__/corpus.test.ts` (3) · `cli/src/__tests__/conformance/scenario-table.ts` (3) · `agent/src/analysis/__tests__/cluster.test.ts` (3) · six files at 2 · two files at 1 | Row 1 (ENTY-03), with Rows 2–4 for the five `satisfies`-total tables |
| `BUG-` — the retired short-ID prefix | 25 | `knowledge-local/src/resolver/__tests__/fixtures/entity-corpus.ts` (6) · `knowledge-local/src/addressing/ledger.ts` (4) · `knowledge-local/src/resolver/__tests__/resolve-tier-a.test.ts` (3) · `dashboard-ui/src/__tests__/fixtures/entity-cards.ts` (3) · `agent/src/analysis/__tests__/cluster.test.ts` (3) · `agent/src/analysis/cluster.ts` (2) · four files at 1 | Rows 1 / 5 |
| `agentqa://bug` — the retired URI scheme | 4 | `mcp/src/__tests__/resources.test.ts` (1) · `knowledge-local/src/resolver/__tests__/resolve-tier-a.test.ts` (1) · `knowledge-local/src/resolver/__tests__/fixtures/entity-corpus.ts` (1) · `dashboard-ui/src/__tests__/fixtures/entity-cards.ts` (1) | Rows 1 / 9 (the mcp half is one of the three dist-crossing rows the bar skips) |
| `reserved-kind` — the retired no-match resolution reason | 13 | `knowledge-local/src/resolver/__tests__/fixtures/entity-corpus.ts` (7) · `knowledge-local/src/resolver/resolve.ts` (3) · `knowledge-local/src/resolver/__tests__/resolve-tier-a.test.ts` (2) · `schema/src/entity/resolution.ts` (1) | Row 5 |
| `BugAddressingNotAvailableError` — the retired mint refusal | 6 | `knowledge-local/src/addressing/ledger.ts` (3) · `knowledge-local/src/addressing/__tests__/ledger.test.ts` (2) · `knowledge-local/src/index.ts` (1) | Row 1; its law is the numbered gap `ledger.test.ts` now names in its header (law 4) |
| `BUG_CARD` — the retired dashboard fixture | 6 | `dashboard-ui/src/__tests__/entity-card.test.ts` (4) · `dashboard-ui/src/__tests__/fixtures/entity-cards.ts` (2) | Row 11 (skipped by the bar; `E-01` REDs at the source) |
| `'reserved'` — the retired status literal, in PRODUCTION | 1 | `schema/src/entity/entity-card.ts` (1, the line `BUG: ['reserved'],` in `ENTITY_STATUSES`) | Row 3; measured today by the production-scoped cell, whose other half is the by-name control |
| `CORPUS_RESERVED_BUG_MACHINE_IDS`, `BUG_CARD` and the retired corpus category rows | counted above | `knowledge-local/src/resolver/__tests__/fixtures/entity-corpus.ts`, `dashboard-ui/src/__tests__/fixtures/entity-cards.ts` | Row 6 (leg `E-06`) |

#### Phase 411 — write_test's app-broken branch

Deleted by commits `a4c679a3`..`428fd902`. Ledger:
`.planning/phases/411-write-test-s-app-broken-branch-report-the-verdict-and-stop/411-MUTATION-LEDGER.md`.

| Token / file / line | Pre-deletion hits (census) | Source in the diff | Ledger row |
|---|---|---|---|
| `'finding'` — the retired proposal kind literal (`PROPOSAL_KINDS` went from four to three) | 58 | 21 files, widest first: `agent/src/authoring/router.ts` (8) · `agent/src/authoring/__tests__/router.test.ts` (6) · `schema/src/__tests__/proposal-envelope.test.ts` (5) · `knowledge-local/src/review/__tests__/authoring-proposals-store.test.ts` (5) · `agent/src/authoring/loop.ts` (5) · `agent/src/authoring/__tests__/repair-fence.test.ts` (4) · three files at 3 · six files at 2 · six files at 1 | Row 1 (WTST-09), legs `W-01` and `W-01t` |
| `FindingProposalV1Schema` / `FindingProposalV1` — the retired proposal schema family | 21 | `knowledge-local/src/review/__tests__/authoring-proposals-store.test.ts` (4) · `agent/src/authoring/loop.ts` (4) · `schema/src/proposal/inbox-ops.ts` (2) · `schema/src/proposal/envelope.ts` (2) · `schema/src/index.ts` (2) · `schema/src/authoring/proposal-arms.ts` (2) · `schema/src/authoring/index.ts` (2) · `agent/src/authoring/__tests__/repair-abandonment-proposal.test.ts` (2) · `schema/src/authoring/suite-stability.ts` (1) | Row 1 |
| `FindingFailurePointSchema` / `FindingFailurePoint` — the retired failure-point schema | 7 | `schema/src/authoring/proposal-arms.ts` (3) · `schema/src/index.ts` (2) · `schema/src/authoring/index.ts` (2) | Row 1 |
| `FindingRoute` — the retired route interface (`PostVerifyRoute` narrowed to the stop route) | 25 | `agent/src/authoring/__tests__/router.test-d.ts` (13) · `agent/src/authoring/router.ts` (5) · `agent/src/authoring/loop.ts` (5) · `agent/src/authoring/repair.ts` (1) · `agent/src/authoring/__tests__/repair-abandonment-proposal.test.ts` (1) | Row 4 (leg `W-04`, the `StopRoute` `keyof` pin) |
| `RouterFindingSignalClass` and `ROUTER_EVIDENCE_CHANNELS` / `RouterEvidenceChannel` | 8 (signal class) | `agent/src/authoring/__tests__/router.test-d.ts` (5) · `agent/src/authoring/router.ts` (3) | Row 4 |
| `routeRepairOrFinding` — the retired router entry point | 28 | `agent/src/authoring/__tests__/router.test.ts` (10) · `agent/src/authoring/loop.ts` (4) · `agent/src/authoring/__tests__/router.test-d.ts` (3) · `agent/src/authoring/router.ts` (2) · four `__tests__` files at 2 · `schema/src/authoring/proposal-arms.ts` (1) | Row 4; the survivor is the stop route, and `repair-abandonment-proposal.test.ts` was renamed `repair-abandonment-stop.test.ts` in the same commit |
| `findingRoute` / `findingProposal` / `findingEvidenceFor` — the retired route helper stem, loop carrier and evidence helper | 4 / 5 / 3 | `agent/src/authoring/router.ts` and `loop.ts` (helper and carrier); `router.ts` (3, the evidence helper) | Rows 4 / 5 |
| `findingDirectionRows` — the retired corpus key | 3 | `agent/src/authoring/__tests__/router.test.ts` (3), plus one deletion in `agent/src/authoring/__tests__/fixtures/router-corpus/expectations.json` | Row 4. **This is the one token whose two columns differ (3 vs 4), and the reason is recorded rather than reconciled away:** the fourth deletion is in a `.json` fixture, which is outside the census's `.ts`/`.tsx` universe. The census measures four fewer file types than the diff does, and that is by design |
| `ROUTE_FOR_KIND.finding` — the retired accept route key | 1 | `agent/src/functions/ops/proposals-accept.ts` (1) | Row 1 |
| `finding on ` — the retired digest line | 1 | `agent/src/functions/ops/runs-digest.ts` (1) | Row 1 |
| `finding-branch` — the retired cell-title stem | 2 | `agent/src/authoring/__tests__/repair-fence.test.ts` (2) | Row 1 |
| `sideCounters.findings` — the retired side-counter access, FUNNEL-scoped | 2 | `schema/src/authoring/funnel.ts` (2) | Row 8 (leg `W-06`) |
| `findings:` — the retired side-counter key, FUNNEL-scoped | 10 | `schema/src/authoring/__tests__/funnel.test.ts` (5) · `schema/src/authoring/funnel.ts` (3) · `agent/src/functions/__tests__/authoring-funnel-get.test.ts` (1) · `agent/src/authoring/__tests__/funnel-projection.test.ts` (1) | Row 8. Both funnel needles are scoped by a PATH RULE because those two words are ordinary English elsewhere in the tree; a global needle would accuse twenty homonyms this milestone does not own |

Also deleted in 411, and not needles: the `stopped` arm's `proposal` payload on
`AuthoringLoopOutcome` (`AUTHORING_LOOP_OUTCOMES` went from five members to four), the finding
branch of `authoring.draft.write`'s op projection, and six digest rows in the golden capability
ledger that moved with the retired proposal arm (`3bfd3e61`).

### What was RETAINED, and why

Per D-13 this is prose plus the instruments table above, not a second census. No "still there"
presence assertion is added over any retained item: a frozen literal pinning ~12 retained names
would move on every refactor, and it would measure prose rather than the deletion. Each row states
what, where, why it was kept, and what pins it — and where a ledger already ruled the item, the
ruling is transcribed rather than re-reached.

#### beside 409

| Item | Where (file:line) | Why kept | What pins it |
|---|---|---|---|
| the two v1 `RunNotification` migration fixtures, which still spell the quoted retired status literal | `schema/src/__tests__/run-notification-migration.test.ts:37` · `agent-local/src/__tests__/post-processing-status.test.ts:378` | they are the migrate-older walk's INPUT, not debris — deleting them deletes the v1→v2 migration proof. Excluded from CLSR-01 by name (`REQUIREMENTS.md` Out of Scope) | the by-name positive control asserts this exact pair and nothing else, and mutation leg `C-01` proves a third non-production speller REDs it |
| `POST_RUN_CHAIN_TERMINAL_KINDS` | `agent/src/jobs/chain-identity.ts:36` | the survivor of the chain-kinds pair; it does not contain the deleted `POST_RUN_CHAIN_KINDS` as a substring, so the census's needle is not a false positive on it | the 409 D-03 equivalence cell — "the terminal list equals the derived kind set" — measured by leg `J-03a` |
| `ANALYZE_RUN_SUCCESSORS` | `agent/src/jobs/kinds.ts:166` (`['curate-memory']`), read at `:153`, `:580`, `:675`, `:680` | the survivor of 388 D-04's declared/produced split, which collapsed when the only kind the two lists disagreed about left. Declared = produced now, and one list is the honest shape | leg `J-02` (409 Row 2) — a second declared successor REDs the real-kinds, engine-semantics and kind-registry cells by name |
| the two `never` bars on the surviving `Delta` union | `schema/src/__tests__/delta.test-d.ts:76` · `schema/src/__tests__/seam-root.test-d.ts:93` | 409 corrected its own attribution after verification: `delta.ts` is byte-identical across the whole deletion, so these bars never guarded the deleted vocabulary. What they guard is the SURVIVING six-arm union against a future widening, which is real and worth keeping under an honest label | leg `V-01` (409 Row 4), `pnpm --filter @vostride/agent-qa-schema typecheck`, exit 2 with the diagnostic at `delta.test-d.ts(76,55)` |
| the two surviving id brands, `RecordId` and `EvidenceToken`, and their casts | `schema/src/ids/record-id.ts`, `schema/src/ids/index.ts` | only the third brand left; the pair that addresses records and evidence tokens is untouched | the census's four VOCB cells RED only on the third brand's return (leg `V-03`) |

#### beside 410

| Item | Where (file:line) | Why kept | What pins it |
|---|---|---|---|
| the eight-class `Verdict` union | `schema/src/verdict/verdict.ts:40-51` (`VERDICT_CLASSES`), `:60-` (the union) | untouched by decision — memory trust and A3 flake routing still switch on it; only the issue-candidacy consumer left. The verdict class `app_bug` at `:42` is a different spelling from the retired entity kind and is never in this milestone's needle set | `REQUIREMENTS.md` Out of Scope; `issue-engine-removal.md` §1's closing paragraph. The census's kind needle is word-bounded and case-sensitive, so `app_bug` cannot match it |
| A3 flake detection / quarantine | `knowledge-local/src/quarantine/detection.ts` (`QUARANTINE_ESCALATE_THRESHOLD = 3` at `:106`) | stays exactly as shipped in v52 Phase 390 — the sliding-window recurrence over the derived run-outcome projection and the committed `quarantine.jsonl`. Only the citations moved (see Reconciliation) | its own suite, 72 cells, green at the gate |
| `buildOrdinal` on the handoff | `schema/src/handoff/completed-run-handoff.ts:13`, `schema/src/reader/reader-inputs.ts:42` | memory decay and the build-pinned permalink key still read it; only the reopen-signal reading left | `REQUIREMENTS.md` Out of Scope; no needle names it |
| the `analysis` chip and the two-chip set | `schema/src/notification/post-processing-status.ts:9` (Phase 404's dated line) and `:44` | Phase 404's half, already shipped and mutation-proven by `scripts/404-chip-teardown-mutation.sh`. This milestone touches no chip, no bus event and no dashboard page | the frozen 404 script (`pnpm validate:chip-teardown-mutation`) |
| the `file-bug-report` Class A skill | `spec/v2/skills.md` §3.1 (`:262`) and §7.3 (`:548`) — no code under `packages/*/src` | retained and reworded in the removal ledger's §3: it renders a bug report for a human to paste into *their* tracker. A text-rendering playbook is not a filing mechanism | `REQUIREMENTS.md` Out of Scope; nothing in the census names it |

#### beside 411

| Item | Where (file:line) | Why kept | What pins it |
|---|---|---|---|
| `RunEvidenceRef` | declared `schema/src/authoring/proposal-arms.ts:100` (schema) / `:110` (type); consumers `schema/src/functions/authoring.ts:20,241` and `agent/src/authoring/router.ts:69,172,301,303` | 411 D-07's verdict, verbatim: *retained — coordinate type of `authoring.draft.write`'s `stop.evidenceRefs`; consumers: the op output schema and the router.* | the stop arm's own cells; leg `W-03` (411 Row 3, WTST-11) REDs if a put returns to the stopped arm |
| the surviving three proposal kinds and the four-member `AUTHORING_LOOP_OUTCOMES` | `schema/src/proposal/envelope.ts`, `schema/src/functions/authoring.ts` | only the finding arm and the fifth outcome left; the narrowed sets are the shipped shapes | legs `W-01` / `W-01t` (411 Row 1) and `W-02` (411 Row 2), each on an exact-list pin |
| the funnel's surviving side counter (`dedupRefusals`) and its `keyof` pin | `schema/src/authoring/funnel.ts` | one counter survives the pair; the pin is what makes the survivor's key set closed | leg `W-06` (411 Row 8) — an optional key added beside it REDs `funnel.test-d.ts:41:56` as one failed suite |

#### beside all three — the frozen sibling script

| Item | Where (file:line) | Why kept | What pins it |
|---|---|---|---|
| `scripts/404-chip-teardown-mutation.sh`, byte-identical to `9b0c3459` | `:115` carries a pre-409 cell title inside `ALLOWED_M1` — "asks the port for exactly the three ids chainJobIdsForRun derives", which is now two; `:322-326` is the G-leg's EXCLUDED-BY-NAME prose, whose lines spell the reserved sixth job kind, the retired entity kind, the retired resolution reason and (at `:329`) the third chain id key | 409 D-10: the 404 script is FROZEN — read, never edited. Both spots are inert: `:115` is an ALLOWED entry for a leg whose cell title moved, and `:322-326` is a comment naming what that script deliberately does not measure. Editing a frozen script to tidy prose would break the one property a freeze buys | `git diff --quiet 9b0c3459 -- scripts/404-chip-teardown-mutation.sh` at every gate, plus the same diff against `428fd902` for all five sibling mutation scripts. **Both sit under `scripts/`, outside the census, which is exactly why they need a register entry rather than a grep.** |

### What degrades, stated plainly

**Nothing degrades in behaviour, and that is a measured claim rather than a hope.** No tracker
adapter, port, config key, MCP tool or dashboard page for issues ever existed — the removal ledger's
§4 opens by saying so, and Phase 412's runtime-state inventory re-checked every category: no live
service config, no OS-registered state, no renamed secret or environment variable. The reserved slot
was declared and never filled: its job kind was minted, its chain id derived and its chip key
reserved, but no row was ever written to it, so removing the slot removed nothing a user could
observe. The only surfaces that moved are prose: what a scaffolded README promises, what a growth
rule anticipates, and what a docstring cites.

**One consequence is known, dated and out of scope, and it is named here rather than left to a
green suite to imply.** The retired sixth job kind can still be on disk in a store a 385-era build
wrote, and Phase 409's narrowing turned that row into a poison job. The measured mechanism, from
`.planning/todos/pending/409-retired-job-kind-row-poisons-the-queue.md`:

- The comment 409 deleted from `agent/src/jobs/kinds.ts` says the row can exist, in its own words
  (`git show 9b0c3459:packages/agent/src/jobs/kinds.ts`, lines 136-141): the shipped 385 version
  mapped over the DECLARATION rather than the produced set, "which meant a dead analysis was the one
  case that enqueued a triage job". So any store written by a 385-era build that ever had an
  analysis fail permanently holds such a row.
- `agent-local/src/store/sqlite-job-store.ts:245-250` — `selectClaimable` is kind-agnostic and
  orders by `created_at ASC, id ASC`. The legacy row is the OLDEST, so it is offered first on
  every tick.
- `:512` spends the attempt at the claim; `:518` calls `rowToJob`, which calls `jobSchema.parse`,
  whose `kind` is now `z.enum(jobKindValues)` over five members. **ZodError.**
- `:343` — all of that runs inside `inTransaction` (`BEGIN IMMEDIATE`, `ROLLBACK` on throw), so the
  claim is UNDONE: `attempts` stays 0, `status` stays `queued`, `claimed_at` stays NULL.
- `AGENT_JOB_STORE_USER_VERSION` is **3** (`sqlite-job-store.ts:70`) and Phase 409 did not bump it.
  The module's own doctrine at `:55` is "stamp and hard-fail, never migrate" — designed for exactly
  a database written by another build — but 409 changed the READABLE VOCABULARY without touching the
  version the gate keys on, so the gate stays silent on precisely the database it exists to refuse.
- `ClaimNextOptions.excludeKinds` cannot route around it either: the parameter is
  `readonly JobKind[]`, so a caller cannot even name the retired kind.

⇒ the row is an unlandable poison job at the head of a GLOBAL FIFO, and the D-18 attempt bound can
never fire for it because the attempt is never spent. **Not fixed here.** This milestone adds no
behaviour, and both viable fixes are behaviour at the store level: bump the store's user version so
the open refuses a wider-vocabulary database, or quarantine an out-of-vocabulary `kind` in
`rowToJob` or in the claimable predicate so the queue drains. **Owner: the phase that owns job-store
durability and `AGENT_JOB_STORE_USER_VERSION`.** **Pointer:**
`.planning/todos/pending/409-retired-job-kind-row-poisons-the-queue.md`, filed 2026-09-01 at
severity high, which also records that a fix written above the store is dead code for this defect —
the store throws during the claim, so the engine never receives the job at all.

### The instruments that notice a return

- **`pnpm validate:arch`** — the merged census plus `validate-arch.test.ts`. This is the standing
  lexical instrument and it runs in CI as part of the workspace's `turbo test`, so a re-added token
  in any package's `src` REDs by name on the commit that adds it.
- **`pnpm validate:issue-slot-mutation`** — the bar that proves the census and the closed-shape
  cells are not decoration. It is NOT in CI: no `validate:*-mutation` script is, and adding the
  family is a workspace-wide decision this phase does not own (recorded as deferred, not skipped).
  It is a release-gate and phase-gate instrument, run by hand.
- **`pnpm validate:router-mutation`** — the 394 script, which remains the instrument for 411 Rows
  6–7. Those two legs are deliberately not re-encoded in the 412 bar; one property, one owner.

### Reconciliation

D-19 owes one shipped, greppable record of what was verified in `.planning` and `spec/v2` — a
search recorded WITH its result, in the shape of the 2026-08-28 section's "Where this register does
NOT reach". Nothing under `.planning/` was edited by this milestone's reconciliation: the docs half
had already landed in `341dfceb`, and the work was to VERIFY it and record the verification.

**(a) `PROJECT.md`'s six "Issue lifecycle engine" pointers, by line, with their dated corrections.**
`grep -n "Issue lifecycle engine" .planning/PROJECT.md` reports `15 47 65 66 78 104` (and `230`,
`785`, `811`, `1217`, which mention the engine as history and are outside D-19's six).

| Line | The dated correction it carries |
|---|---|
| `:15` | the re-purposing sentence: "Its *Issues* slot was re-purposed on 2026-08-25 when the owner removed the Issue lifecycle engine from v2: agent-qa is not a bug tracker and does not integrate with one … (`spec/v2/issue-engine-removal.md`)." |
| `:47` | *(2026-08-25: the engine was removed from v2 by owner decision — `spec/v2/issue-engine-removal.md`; Phase 404 took the chip-side half, and the slot is torn out by **v54 Issue-slot cleanup**)* |
| `:65` | "…with the `triage-issues` slot reserved for the Issue lifecycle engine *(slot retired 2026-08-25 → v54 Issue-slot cleanup)*." |
| `:66` | A3 flake detection "(pulled forward 2026-07-28 from the Issue lifecycle engine) … No issue store required." — frozen historical attribution, correctly left uncorrected |
| `:78` | *(2026-08-25: engine removed from v2 — `spec/v2/issue-engine-removal.md`; the reserved slot and the record-and-surface `FindingProposalV1` arm are torn out by v54 Issue-slot cleanup; stage ⑤ app-broken = report the verdict and stop)* |
| `:104` | "the `issues/` engine → Issue lifecycle engine *(removed from v2 2026-08-25; there is no `issues/` shelf — `knowledge-store.md` §3.2)*" |

Source: `341dfceb` — `docs: start milestone v54 Issue-slot cleanup`, 2026-09-01, `PROJECT.md +41/−11`
and `STATE.md +30/−16`, those two files and no others. `git diff --quiet HEAD -- .planning/PROJECT.md
.planning/ROADMAP.md .planning/STATE.md` exited 0 at the reconciliation commit: verified, not
re-edited.

**(b) The D-18 grep, and its empty result.** Run from the super-repo root:

```
grep -nE "v54 Issues|milestone: Issues|Current milestone: Issues|Issues milestone" .planning/ROADMAP.md .planning/STATE.md
```

**Result: empty, exit status 1.** No output line of any kind. The pass state IS the empty result
read as exit 1 from the process — the check asserts `[ $? -eq 1 ]` rather than testing for absent
text, so an accidental grep success cannot be mistaken for a pass. `STATE.md`'s front matter
corroborates: `milestone: v54`, `milestone_name: Issue-slot cleanup`.

The alternation is deliberately shaped on milestone-NAME forms only, because the historical
2026-07-28 re-sequencing quote `M4 → M5 → Issues → M3 → M6 → M7 → MC` is frozen history — the record
of how the decision was made, not a claim about today's milestone name. It is asserted by count and
left byte-identical: **5 occurrences in `.planning/PROJECT.md`** (lines 15, 34, 57, 230, 1217) and
**1 in `.planning/ROADMAP.md`** (line 20). Re-spelling it would have destroyed the evidence the
reconciliation exists to preserve.

**(c) The four `spec/v2` edits, by file and section — and why four, not three.** CLSR-05 named
three; a fourth was added because 409's ledger note (f) found that the 2026-08-25 audit had named
identifiers which never existed. All four landed as dated one-line edits in super-repo commit
`e7542495`, with per-file deletion caps (2 / 1 / 2) proving no unrelated line moved under them.

| # | File · section | The edit |
|---|---|---|
| 1 | `test-authoring.md` §6, gate 5 (`:243`) | `load-bearing (§10).` → `` load-bearing (§10 — withdrawn 2026-08-25, see `issue-engine-removal.md` §2). `` — the gate's mutant-kill analog no longer dead-ends at a section that was withdrawn out from under it; the pointer lands on the removal ledger's §2 row for `test-authoring.md` |
| 2 | `test-authoring.md` §7 heading (`:251`) | "— or file a finding" → "**— or stop on a finding**", with one italic dated line beneath it recording the owner ruling. The heading now agrees with its own body two paragraphs down, which already said "Nothing is filed and no proposal is minted" |
| 3 | `runner.md` §6 (`:404`) | `Post-processing (analysis, curation, flake)` → `Post-processing (analysis, curation)` with the dated note that flake is a verdict value A3 consumes, not a job. Post-processing is two jobs, matching `live-view.md` §4.1's chip set |
| 4 | `issue-engine-removal.md` §4 (`:70-71`) — **the fourth, D-21** | `JOB_KINDS` → *(the real identifiers are `jobKindValues` / `JobKind`, `packages/schema/src/job/job.ts`)*; `CHAIN_KINDS` → *(`POST_RUN_CHAIN_KINDS`, deleted; survivor `POST_RUN_CHAIN_TERMINAL_KINDS`)*. Both confirmed against the tree: `job.ts:8` and `:59` carry the real names, and `POST_RUN_CHAIN_KINDS` returns zero hits anywhere. An audit row that names an identifier which never existed is a two-hop dead end for the next reader, which is why it was corrected in place rather than left as written |

**(d) The CLSR-04 sweep record.** Fourteen prose sites across eleven files were rewritten so the
tree's counts and citations describe the tree that ships, in three commits (`90686e16`, `aee3114c`,
`49b38a6a`) plus the identifier-shaped sweep's three (`b71a861b`, `23bcb342`, `ad2ab58d`).

*The dated correction to CLSR-04, which the requirement's own wording invited.* CLSR-04 speaks of
the `issues/` shelf, and the tree contains a second, unrelated `issues` spelling: the GitHub support
URL `https://github.com/vostride/agent-qa/issues/new` in `dashboard-ui/src/lib/support-links.ts`
and its two tests. **That is a homonym excluded by the needle's CONSTRUCTION, not by a by-name
filter** — the shelf needles are the backticked shelf spelling, its template-escaped twin and the
spoken phrase "issues/ shelf", and a URL path segment matches none of the three. No file is named
anywhere in the census to achieve that, which is what keeps 410 D-04's path-rule doctrine intact:
the moment an inventory carries a by-name exclusion it stops measuring and starts asserting. The
support link was verified untouched (`git diff --quiet` exit 0) and is deliberately not re-pointed
— altering a user-facing surface for a census's convenience is the wrong trade.

*The verifying grep's form.* It is a fixed-string grep, because two of the needles differ from each
other by exactly one backslash:

```
grep -rnF -e 'issue-curation' -e 'issues-write' -e 'issues/`' -e 'issues/\`' -e 'issues/ shelf' \
          -e 'filed issues' -e 'Issue milestone' packages/*/src
```

The fourth `-e` is the TEMPLATE-ESCAPED shelf spelling, which is how `cli/src/commands/init.ts:570`
carried it — inside a template literal, where each delimiter takes a backslash. A plain-delimiter
needle cannot see the escaped form and vice versa, so a single spelling would have left the site
that actually existed unmeasured. Measured at `428fd902`, before the sweep: `issue-curation` 4,
`issues-write` 8, the escaped shelf 1, `filed issues` 1, `Issue milestone` 2 — and the
plain-backticked shelf and the spoken phrase **0 each**, which is the evidence for pinning the shelf
in three forms rather than one. All seven now return nothing.

*The stale-count hand list, swept by file:line.* These are COUNTS the deletions falsified, not
tokens; a count cannot be a needle, so this list is a plan-time hand list and its closure is a grep
for the eight superseded phrases, which exits 1.

| # | Site (post-edit) | Before → after |
|---|---|---|
| 1 | `agent/src/index.ts:660-661,663` | "the same three rows" → "the same two rows"; "returns three strings" → "returns two strings" (the paragraph re-wrapped so the pinned phrase lands contiguous) |
| 2 | `agent/src/functions/ops/runs-post-processing.ts:3-5` | the third-derived-id sentence → the chain derives exactly the two ids the chips read, with Phase 404's chip-set line kept at `:3` |
| 3 | `schema/src/notification/post-processing-status.ts:13-16` | "the JOB-KIND layer is deliberately NOT touched here … wait for the Issue-slot cleanup milestone" → the chip side stopped reading the third id then, and the job-kind layer has since followed |
| 4 | `agent-local/src/store/sqlite-job-store.ts:438,442-444` | "lets the reserved triage slot have an id and no row" → "lets a candidate have an id and no row" — the candidates-vs-members rule now stands on its own merit |
| 5 | `agent-local/src/__tests__/kill-matrix/harness.ts:13` | "The six shipped declarations" → "The five shipped declarations" |
| 6 | `agent-local/src/__tests__/kill-matrix/kill-matrix-adversarial.test.ts:31` | "on top of plan 06's 32" → "on top of plan 06's 26"; the legs themselves untouched |
| 7 | `agent/src/functions/entity-cards/key-facts.ts:12` | "a seventh kind is a type error here" → "a sixth kind is a type error here" |
| 8 | `dashboard-ui/src/chat/entity-card.tsx:83` | "seventh kind is a compile error here" → "sixth kind is a compile error here" |
| 9 | `knowledge-local/src/resolver/__tests__/resolve-tier-a.test.ts:4` | "Four of the cases are about inputs" → "Three of the cases…" (confirmed against the list beneath) |
| 10 | `knowledge-local/src/addressing/__tests__/ledger.test.ts:4-6` | the "Four laws" sentence gains a parenthetical naming the gap — numbered 1, 2, 3 and 5, law 4 having left with this milestone. The banners stay numbered 1/2/3/5: renumbering would churn case titles this milestone does not own |
| 11 | `cli/src/__tests__/post-run-gate-run-exclusion.test.ts:33-38` | "when the engine lands it must read `excludedFromOutcomes` … the placeholder for that fifth exclusion leg" → a dated note saying the engine that note reserved a contract for has left and **no fifth leg is owed**. Kept as prose rather than an `it.skip`, which would claim coverage of a mechanism that does not exist |

Eight dated `2026-09-02 (Phase 412)` lines were added across those sites. Across the whole milestone
`packages/*/src` now carries **35** dated notes from Phases 409–412 (409: 13, 410: 3, 411: 8, 412:
11), of which 24 lines in 23 files spell the pointer phrase "— see `DELETION-INVENTORY.md`" and the
rest wrap it onto a following line. Every one names a concept this section carries.

*Sites VERIFIED, not re-edited — the ordering claim as a measurement.* Four sites an earlier phase
had already corrected were proven byte-identical to `428fd902` (`git diff --quiet` exit 0) rather
than re-touched, which is what makes "412 owns only the remainder" a measurement instead of a
promise: `agent/src/functions/spec.ts` (`:823-824`, `:855-860` — two 2026-09-01 Phase 409 notes and
"`ChainJobIds` is two-wide"), `agent/src/ports/job-store.ts:220-223` ("derives BOTH of the chain's
ids", no reserved slot), `agent/src/jobs/record-llm-authorship.ts:24-29` ("five kinds … five chances
to get it wrong"), and `schema/src/verdict/verdict.ts:70,72` (already clean — only the surviving
`(§A9 routing)` citation).

*Sites found BEYOND D-17's three lists, recorded rather than silently swept or silently left.*

| Site | What it is | Disposition |
|---|---|---|
| `knowledge-local/src/quarantine/__tests__/detection.test.ts:165` | the test title `pins issue-curation §7.3 and …`, coupled to a docstring the sweep was rewriting | swept in the same commit as the prose it pins — a source-prose pin and the prose it pins must never be committed apart |
| `cli/src/__tests__/conformance/adjudications.test.ts:84` | a doc comment citing "tomorrow's `issues-write`", beside the two cells D-16 re-pins | swept; the control fixture now mints `zzz-write`, scope-shaped and outside the union BY CONSTRUCTION, so the control keeps its non-tautology without keeping a needle alive in a test |
| `cli/src/__tests__/post-run-gate-run-exclusion.test.ts:33-38` | a reserved consumer contract "for when the engine lands" | folded as a dated note (row 11 above). No `Issue engine` needle was added: it would collide with `post-processing-status.ts:10`'s legitimate 2026-08-25 history line |
| `agent/src/index.ts:654` | "// 385 plan 04 — the six real kinds. A composition root registers THESE" — genuinely stale present tense (`jobs/kinds.ts:736` says "exactly the five real kinds") | **Recorded, not swept, and ruled here: a prose defect with an owner, not debris.** It spells no needle, no instrument REDs on it, and sweeping it inside 412-03 would have been a twelfth unrecorded edit in the plan whose SUMMARY is this record's own source. It is named here so the next reader finds it in the register rather than rediscovering it; the next pass over the agent barrel's prose owns it |
| `arch/src/lint/agent-barrel.ts:45` | "385 plan 04 REMOVES that refusal and adds the six real kinds" | **Recorded and ruled INERT.** The sentence narrates what Phase 385 plan 04 *did*, and six was correct then. It is historical narration, not a claim about the shipped tree — the same class as the frozen 404 script's `:115` ALLOWED title, which 409's note (a) deliberately left alone. No edit is owed |
| `knowledge-local/src/quarantine/detection.ts:98` | the docstring now cites "`memory.md` §9.5's locked trigger, **verbatim**", and §9.5 does not carry that sentence verbatim | **Recorded as a wording mismatch with an owner, not closed here.** D-17 rules §9.5 the surviving rule and the sweep cited it as ruled rather than inventing another section. The two agree in SHAPE — a locked N=3 within an M=5 window, ratified 2026-07-03 — over different subjects: §9.5 counts supersessions per memory anchor and says it "mirrors the issue thrash-guard"; `detection.ts` counts fingerprint recurrences per test. Three closures are available to whoever owns the quarantine prose next: amend §9.5 to carry the fingerprint sentence, drop `verbatim` from the docstring, or state the mirror relationship explicitly. This register picks none of them — choosing would be a new ruling, and the register records |
| `knowledge-local/src/quarantine/detection.ts:85` and `identity.ts:7` | bare `§7.3` references with no owning document named | **Recorded, not swept.** Neither spells a CLSR-04 needle and neither is on any D-17 list, so no instrument sees them; after `:98`'s rewrite they read as bare section numbers whose owning document is no longer named in the file. Same owner as the row above |

*`docs/`, `skills/` and `README.md`.* Measured clean of all fifteen CLSR-01 names and all seven
sweep spellings on 2026-09-02, and re-measured at the gate below.

### Gate at the time of writing (2026-09-02)

Run on 2026-09-02 from `agent-qa/` at `b4ff1add` — the tree of the closing code HEAD `63740043`
plus this section's own two commits, which touch `DELETION-INVENTORY.md` and nothing else. Super-repo
`8902de62`. Every exit code below was read from the process, never inferred from output text, and no
command was run through a pipe that could swallow it.

| Command | Observed | Exit |
|---|---|---|
| `pnpm typecheck --force` | 44 successful, 44 total; 0 cached — the `--force` is what stops turbo replaying a stale green, and no leg ever uses the root typecheck as an instrument | **0** · 36.0 s |
| `pnpm --filter @vostride/agent-qa-schema test` | Test Files 125 passed (125) · Tests 1310 passed (1310) | **0** · 5.4 s |
| `pnpm --filter @vostride/agent-qa-agent test` | Test Files 99 passed (99) · Tests 1657 passed (1657) | **0** · 8.7 s |
| `pnpm --filter @vostride/agent-qa-mcp test` | Test Files 18 passed (18) · Tests 372 passed (372) | **0** · 4.1 s |
| `pnpm --filter @vostride/agent-qa-arch test` | Test Files 15 passed (15) · Tests 218 passed (218) | **0** · 5.8 s |
| `pnpm build --force` | 22 successful, 22 total; 0 cached. Run IMMEDIATELY before the cli suite, which compares `dist` mtimes and reds on a stale artifact — the 409/410/411 gates each learned this the same way | **0** · 21.8 s |
| `pnpm --filter agent-qa test` (the cli conformance suite) | Test Files 203 passed (203) · Tests 2878 passed, 18 skipped (2896). The 18 skips are pre-existing and conditional — `.live.test.ts` suites gated on an env var and `it.skipIf(platform === 'win32')` guards — and none is in a file this milestone touched | **0** · 182.2 s |
| `pnpm validate:arch` | Test Files 2 passed (2) · Tests 89 passed (89) — `validate-arch.test.ts` plus the merged census, which is 46 of the 89. Census universe at this gate: 23 package roots, 2492 scanned files, 1251 production files, 6 funnel files | **0** · 6.3 s |
| `pnpm validate:issue-slot-mutation` | `PREFLIGHT OK (18 instruments)` · `PLANT ROOTS 23` · `LEGS 46` (23 plant roots + 23 named legs, the count asserted against roots recomputed from disk) · `PASS` · zero `FATAL` lines · every subject sha256-identical to `HEAD` after the run | **0** · 435.8 s |
| `ISSUE_SLOT_SELFTEST=neutered bash scripts/412-issue-slot-mutation.sh` | `FATAL: the suite stayed green under the mutation — leg P-agent-local measures nothing`. The gate has been seen to fire on the closing tree, which is the only thing that makes the 46 green legs mean anything | **1** (non-zero, as required) · 45.3 s |
| `pnpm validate:router-mutation` | `394-router-mutation: PASS`, subject byte-identical before and after — the standing instrument for 411 Rows 6–7, which the 412 bar deliberately does not re-encode | **0** · 24.0 s |
| `pnpm validate:funnel-mutation` | `PASS — the acceptance-failure flag is proven able to fire, and proven to disappear under …` | **0** · 3.9 s |
| the fifteen CLSR-01 greps over `packages/*/src` (`.ts`/`.tsx`, tests and comments included) | `triage-issues`, `triageIssues`, `issues-drafted`, `IssueDelta`, `IssueId`, `asIssueId`, `FindingProposal`, `FindingFailurePoint`, `BUG-`, `agentqa://bug`, `reserved-kind`, `BugAddressingNotAvailable`, `ANALYZE_RUN_PRODUCED_SUCCESSORS`, `POST_RUN_CHAIN_KINDS` — zero hits each; and the entity-kind needle re-run as the census spells it, lookbehind and all, over the same 2492 files — zero hits | **1** each (grep's no-match code, read from the process) |
| the production-scoped quoted status literal | `grep -rn "'reserved'" packages/*/src` minus the `__tests__` segment and the `.test`/`.test-d` suffixes — zero hits. The two retained migration fixtures and the domain-list marker key are outside production by the path rule, not by a name | **1** |
| the CLSR-04 identifier-shaped grep (`grep -rnF`, seven `-e` needles including both shelf spellings) | zero hits across `packages/*/src` | **1** |
| the CLSR-04 stale-count grep (eight superseded phrases) | zero hits across `packages/*/src` | **1** |
| `docs/`, `skills/`, `README.md` | re-measured clean at this gate for the sweep spellings AND for all fifteen CLSR-01 names | **1** each |
| the D-18 grep over `.planning/ROADMAP.md` and `.planning/STATE.md` (super-repo root) | empty — no output line of any kind | **1** |
| the four `spec/v2` edits | `or stop on a finding` 1 · `withdrawn 2026-08-25, see` 1 · `(analysis, curation)` in `runner.md` 1 · `jobKindValues` and `POST_RUN_CHAIN_TERMINAL_KINDS` in `issue-engine-removal.md` 1 each | **0** each |
| `git diff --quiet 428fd902 -- <the five sibling mutation scripts>` | unchanged: `404-chip-teardown-mutation.sh`, `394-router-mutation.sh`, `394-funnel-mutation.sh`, `399.1-render-mutation.sh`, `405-debris-mutation.sh`. Re-checked across all 36 scripts: every one is byte-identical to `428fd902` except `412-issue-slot-mutation.sh`, which this milestone wrote | **0** |
| `git diff --quiet 9b0c3459 -- scripts/404-chip-teardown-mutation.sh` | unchanged since before Phase 409 — the freeze 409 D-10 asked for, held across four phases | **0** |
| the "— see `DELETION-INVENTORY.md`" pointers | 24 lines in 23 files carry the pointer phrase; 35 dated notes from Phases 409–412 point here in all (409: 13, 410: 3, 411: 8, 412: 11). Each was hand-read against this section: every concept they name — the reserved sixth job kind, the declared/produced split, the third derived chain id, the second delta vocabulary, the third id brand, the sixth entity kind, its law in the addressing ledger, the retired proposal arm, the anticipated scope door, the bug-repro anchoring gate, the retired curation spec's citations — has a subsection here | — |

**The clean claim is SCOPED, and its exclusions are named rather than implied.**
`git status --porcelain` over `packages/schema`, `packages/agent`, `packages/agent-local`,
`packages/arch`, `packages/cli/src`, `packages/knowledge-local/src/{quarantine,resolver,addressing}`,
`packages/dashboard-ui/src`, `packages/mcp`, `scripts`, `package.json` and this file prints nothing,
before and after the mutation bar; no `412-plant.ts` survives either run. A BARE `git status` does
not print nothing, and saying so is the honest form of the claim: this working tree carries
pre-existing, unrelated, in-flight work that predates the milestone and that no plan in it touched —
in `agent-qa`, `.gitattributes`, `.github/workflows/embedding-bench.yml`,
`packages/knowledge-local/src/embedder-acquire.ts`, `embedder-native.ts` and their two tests,
`tools/embedding-bench/**`, and an untracked `packages/cli/agent-qa-knowledge/`; in the super-repo,
deleted `demo/init/.agent-qa/**` fixtures, a modified `.planning/state.json`, unrelated edits to
`spec/v2/GSD-MILESTONES.md`, `spec/v2/README.md` and `spec/v3/README.md`, and untracked `spec/v2.1/`.
Every commit in Phases 409–412 staged its files by explicit path; no `git add -A`, no `git add .`,
no `git commit -a`. The super-repo's own scoped status over the three edited `spec/v2` files and
over `PROJECT.md` / `ROADMAP.md` is likewise empty.

**The standing pre-existing red, named so the green above is not read as more than it is.**
`tools/embedding-bench`'s `tau-lex` failure predates this milestone (it is recorded as standing at
the 2026-08-27 and 2026-08-28 gates) and is untouched by it. It was NOT re-measured here: that
package's tree carries the uncommitted in-flight work listed above, so any run there would measure
someone else's work in progress rather than the shipped tree — which is exactly the kind of claim
this register exists not to make.

**Toolchain:** node 24.15.0 · pnpm 10.6.1 · vitest 4.1.5 · tsc 6.0.3 · bash 3.2.57(1) (arm64
apple-darwin25). The mutation script is written to the bash 3.2 subset — indexed arrays and `i % n`
rotation, no associative arrays, no `mapfile` — because that is what `/bin/bash` is on this platform
and a script that needs a newer shell is a gate that will not run.

## 2026-09-15 — Phase 423 reconciliation: the first additive migration returns nothing retired (Phase 423 plan 25, D-08)

<!-- RECONCILIATION-423:start -->
Dated 2026-09-15. Phase 423 deleted nothing from this register and restored nothing it retired. It is recorded here because D-08 is the first time the dashboard database admits a migration after the 405 hard cut, and a reader of the 2026-08-27 and 2026-08-28 sections needs to know the register still holds.

What changed, stated exactly (evidence: 423-05-SUMMARY.md, cells `MIGRATION-FRESH`, `MIGRATION-V2-HISTORY`, `MIGRATION-ROLLBACK` and `EVID-V2-HISTORY`): `SCHEMA_VERSION` is 3; exactly v2 gains four nullable TEXT columns (`run_steps.evidence_json`, `variable_snapshot_json`, `model_usage_json` and `run_sub_actions.evidence_state_json`) in one transaction; a fresh database is created at v3 directly; v1 and every other nonzero version are still refused by name. The column spellings avoid every retired needle.

What was preserved: no retired v1 DDL, table, column or path-addressed artifact route returned, and no second evidence source beside the v2 contracts was added. The `405-debris-deleted` fence, updated only for the version pin in 423-05, stayed green, and the 405 run-detail, debris and failure-banner mutation legs plus the 412 issue-slot and 404 chip-teardown legs passed serially on the restored build in `validate:423-read-contracts` on 2026-09-15 (GATE-423-COMPLETE, agent-qa head `9ab15aa44`). The debris gate's leg D anchor and cell name were re-spelled for the v3 columns first; the first full run had found that leg unable to apply its patch.

Out of this register: the typed evidence documents are new sha-addressed artifacts under the existing immutable content-addressed route; they are not a return of the path-addressed artifacts this register retired.
<!-- RECONCILIATION-423:end -->

## 2026-09-16 — the 404 chip-teardown freeze: an owner-accepted exception, and its new baseline (Phase 423 plan 46)

This section extends the register; it rewrites nothing. The 2026-09-02 entry above still reads
`scripts/404-chip-teardown-mutation.sh`, byte-identical to `9b0c3459`, and names
`git diff --quiet 9b0c3459 -- scripts/404-chip-teardown-mutation.sh` as its check at every gate.
**That diff no longer passes, and it has not passed since `9ab15aa44`.** The statement above stays
as written because it was true when it was written and because a register that quietly re-baselines
itself is not a register.

**The owner accepted the exception on 2026-09-16.** Their words, verbatim: *"Both, but you decide
what's recommended"*, over the two policy exceptions 423-VERIFICATION.md carried; the recommendation
to accept both was the orchestrator's, recorded as the orchestrator's. Why acceptance is the honest
verdict rather than a revert: the freeze was protecting a property that had already been lost.
`422-07` (`878fe5f7a`) appended the proposals spread after `curation`, so the M3 leg's perl anchor
matched nothing and the leg passed **without mutating anything** — and a leg that measures nothing
is not a preserved measurement. `423-25` (`9ab15aa44`) re-spelled that anchor onto the writer's
current tail and updated the M3 cell names, which is what put the leg back to measuring.

**The new baseline, and what still holds.** From `9ab15aa44` the script is frozen again on the same
409 D-10 terms — read, never edited for prose — and the check is
`git diff --quiet 9ab15aa44 -- scripts/404-chip-teardown-mutation.sh`. The five sibling mutation
scripts keep their own `428fd902` baseline, untouched by this. Nothing automated enforced the
`9b0c3459` spelling (no test or script greps that baseline for this file), so what drifted was the
register's accuracy, not a gate: the 423 acceptance gate exercises the script at step
`mut-chip-teardown`, and `validate:423-read-contracts` ran it green on the restored build at
`9ab15aa44` (recorded in the 2026-09-15 section above).

| Check | Reads | Expected |
|---|---|---|
| `git diff --quiet 9ab15aa44 -- scripts/404-chip-teardown-mutation.sh` | the frozen script since 423-25 | **0** |
| `git diff --quiet 9b0c3459 -- scripts/404-chip-teardown-mutation.sh` | the pre-423-25 spelling | **non-zero, expected** — superseded by the row above |

## 2026-09-21 — Phase 424: one evidence reader, member recording refs and one player

This section appends to the register; it does not change any earlier deletion or baseline. Recording bytes use the existing immutable sha-addressed artifact route. No path-addressed video route, `runs.video_path` column, retention policy or GC returns.

| Removed contract | Fence that detects its return |
|---|---|
| Dashboard accessibility summary helper and dead route call | `405-debris-deleted.test.ts` needles `fetchAccessibility` + `Summary` and `)}/access` + `ibility`; `run-detail.evidence.test.tsx` exercises the typed artifact read and load failures. |
| `TestResult.videoPath` and runner `getVideoPath` probe | Source census: `rg -n 'videoPath|getVideoPath' packages/runner/src/result.ts packages/runner/src/run/member-runner.ts` must have no matches. Member recording lifecycle cells in `424-recording-member.test.ts` prove explicit member entries instead. |
| Web context `recordVideo` wiring and videos-directory resolver | Source censuses: `rg -n 'recordVideo|getVideoPath|videosDir|resolveVideosDir' packages/web/src/adapter.ts packages/web/src/farm-adapter.ts` and `rg -n 'resolveDashboardVideoDir|VIDEOS_DIR' packages/cli/src/commands/run.ts packages/cli/src/commands/recording-setting.ts` must have no matches. The pre-existing path-addressed video-route and run-level video-column needles remain in `405-debris-deleted.test.ts`; `424-recording.screencast.test.ts` proves finalization before artifact persistence and `REC-STAGING-NOT-LEGACY-DIR` pins the CLI staging location. |
| `RunArtifactRuntimeSnapshot.videoPath` | Source census: `rg -n 'videoPath' packages/schema/src/run/run-artifact.ts` must have no matches; member recording schema/runtime/type cells live in `424-recording-contracts.test.ts` and its test-d twin. |
| Drawer Attributes and Screenshot tabs | `artifact-drawer.test.tsx` pins the remaining tabs and Attributes absence; `artifact-drawer.screenshot.test.tsx` pins no Screenshot tab. Screenshot citations now select the playhead or open the dedicated lightbox; the unchanged failure-view gate exercises the retargeted citation cells. |
| Seventh `data-evidence-state` value, `incomplete` | `EVIDENCE-STATE-SIX-VALUES` in `evidence-state-census.test.ts` scans all production UI literals; `C424-STATES-EXACT` runtime/type walls and playback P03 prove the closed set. Incomplete evidence retains its inline label through the shared unavailable state. |

WINDOWS 285's constant ARIA stub is fixed by Plan 09: `ARIA-READS-SUB-ACTION` reads the selected sha-addressed document as masked text; `TAB-LOAD-FAILURE-ARIA` proves retry and never-empty behavior. Historical empty documents are not silently substituted for failed loads.

SC1's added run-detail mutation proof is P01/P02/P22 in `scripts/424-playback-mutation.sh`; phase-range git log and diff confirm `scripts/405-run-detail-mutation.sh` and its inventory are unchanged. Database option A refuses unreleased v2 and retains only the locked v3-to-v4 additive step. No old section's historical v2-to-v3 account is rewritten.

## 2026-09-28 — Phase 430: Dashboard Chat removal (PXH-SURF-01..03)

This section appends to the register; it rewrites no earlier section and moves no earlier
baseline. Phase 430 deleted the dashboard's Chat: the page, the panel, the browser transport, the
server's five `/api/chat/*` routes and the door composition behind them. It kept what run detail,
the Run button and mark approval still use, under their old names with narrower shapes. The
section follows the 2026-09-02 shape (D-12) and adds the one thing no earlier section carries: the
persisted values the narrowed contract governs (SC4).

### The ruling

> do what ever you fell but the goal is to drop all and simplify things

The owner, verbatim, in the 2026-09-28 Phase 430 discussion (recorded as D-06's ruling in
`.planning/phases/430-dashboard-chat-removal/430-CONTEXT.md`, and applied to every fork in the
phase: when a choice was open, deleting won over keeping, and doing less now won over renaming
what Phase 432 deletes anyway).

> The interactive CLI chat/one-shot ask commands are not removed by this milestone unless separate
> usage evidence and an explicit decision say so.

The milestone's creation decision of 2026-09-14, verbatim from `spec/v2/product-experience-hardening.md`
§3.8 (PXH-SURF-02), carried in `.planning/REQUIREMENTS.md` Out of Scope as "Kept by owner decision
2026-09-14 absent usage evidence" and as SURF-CLI-CHAT-FUT-01. It is why everything CLI chat and
`ask` read survives this section: the turn engine, the schema's `chat/` contracts, the session
store and the `chat` job kind.

**D-02 answered the research's open `/api/chat/*` question: the whole server door is deleted, not
only the browser transport.** The only production caller of those routes was the browser
transport being deleted (the CLI never called them over HTTP, and MCP never referenced them), and
a live invocation door without a roster row is exactly what `roster.ts`'s 2026-08-16 registration
note forbids. Keeping them as a headless API was offered and declined. A deleted route answers
the router's generic 404, the `routes.ts` precedent for deleted routes: not redirected, not
stubbed.

### How this inventory is measured

| Instrument | What it claims | Where |
|---|---|---|
| the census | 67 removed names, each refused as a two-half raw-text needle, have ZERO occurrences across three path-ruled universes: `dashboard-ui/src` (531 files, 301 production at rest), `dashboard-server/src` (132 files, 53 production) and the door composition file `cli/src/commands/dashboard.ts`. Comments count. Ten named cells hold it honest: `UNIVERSE-LOWER-BOUNDS`, `NO-FILE-UNDER-THE-UI-CHAT-DIRECTORY` with its synthetic `CHAT-DIRECTORY-RULE-CONTROL`, `TOLERATED-NAMES-PRESENT` (14 kept names, each present in one universe's production source), `TOLERATED-NAMES-NOT-NEEDLES`, `DASHBOARD-UI-DECLARES-NO-MARKDOWN-PARSER`, `PLANTED-POSITIVE`, `COMMENTS-COUNT`, `SPLIT-SPELLING-ACCOUNTED` and `SELF-MATCH`. 77 cells in all. | `packages/arch/src/__tests__/430-dashboard-chat-deleted.test.ts` (`pnpm validate:arch`) |
| the 430 mutation gate | 23 legs, `R01`..`R23`, on the shared 423 engine: each plants one removed member back into its real subject and requires the cell named before the run to go RED, then restores the subject byte-identically. Seven instruments (schema 6 cells, dashboard-server 11, dashboard-ui 54, parity 60, cli 34, agent-local 2, census 77), each count measured from a fresh Vitest JSON report. No leg crosses into a built `dist`. Ends `CHAT_REMOVAL_MUTATION_OK`. | `scripts/430-chat-removal-mutation.sh` (`pnpm run validate:430-chat-removal-mutation`) |
| its selftest | the hand-written R01..R23 inventory (claims, subjects, reds), both `package.json` registration strings, a neutered leg that must FATAL after a green child, a dirty subject that must be refused, and restore-and-rebuild on fatal, SIGINT, SIGTERM and SIGHUP. 32 checks. | `scripts/430-chat-removal-mutation-selftest.sh` (`pnpm run validate:430-chat-removal-mutation-selftest`) |
| the closed-set cells (runtime key set beside the type) | `C430-CHAT-ROUTE-TABLE-EXACT` (the two run-confirm rows, and `ChatRouteHandlerName` equal to `'runConfirm' \| 'runConfirmChannel'`), `C430-AGENT-HOST-MEMBERS-EXACT` (`AGENT_HOST_MEMBERS`, declared with `satisfies`, equal to `keyof AgentHost` both ways, and the five removed members `never`), `C430-REMEDY-MEMBERSHIPS-EXACT`, `C430-REMEDY-SURFACES-EXACT` and `C430-DASHBOARD-PROJECTION-EMPTY` (each a runtime and a `.test-d.ts` half), `C430-NO-SESSION-SURFACE-OPTION` (one per composition package), `C430-DELETED-CHAT-ROUTES-SHARED-404` (five cells: 404, `{ error: 'Not found' }` and `Access-Control-Allow-Origin: *`, the header that tells the shared arm from a returning chat router) and `C430-RUN-CONFIRM-PREFIX-STILL-ROUTED`. The roster's exact-list cell "pins the roster at the four surfaces that exist today", `MODULE_FOR_DOOR`'s cell (5) and the unmask roll-call's enrollment cell are the older containers, re-pinned. | `dashboard-server/src/__tests__/430-chat-closed-sets.test.ts` and `.test-d.ts`, `430-chat-routes-deleted.test.ts`; `schema/src/safety/__tests__/430-remedy-memberships.test.ts` and `.test-d.ts`; `agent-local` and `cli` `src/composition/__tests__/430-no-session-surface-option.test-d.ts`; `cli/src/__tests__/conformance/parity.test.ts`, `proposal-author-attribution.test.ts`, `unmask-boundary-rollcall.test.ts` |
| the absence cells | `NO-CHAT-ROUTE` (`/chat` is not declared and lands on Runs), `SHELL-CHILDREN-EXACT` (the shell's four children, no launcher), `SIDEBAR-NAV-EXACT` (the six-item primary nav), `PALETTE-PAGES-EXACT` (the six palette pages), `TOUR-HAS-NO-CHAT-STEP`, `NO-CARD-MODULE` and `NO-CARD-EXPORT` (no chat directory, and the route module exports only the route map and its two resolvers), `DENIAL-REASON-ONLY` and `DENIAL-NOTHING-INVENTED` (a dashboard refusal is its reason, whatever remedies the wire carries). Against the BUILT bundle in real Chromium: `NO-CHAT-IN-SHIPPED-BUNDLE`, `NO-CHAT-MOUNT-ON-ANY-PAGE` and `NO-CHAT-REMEDY-SENTENCES-IN-BUNDLE` (with a known-answer control, so an empty scan cannot pass). Against the spawned binary: process survival's s5 (a deleted chat path answers the shared 404 and the process keeps serving). | `dashboard-ui/src/components/__tests__/{update-banner,app-sidebar,command-palette,product-tour}.test.tsx`, `dashboard-ui/src/__tests__/entity-card.test.ts`, `dashboard-ui/src/components/run-detail/__tests__/denial-block.test.tsx`; `cli/src/__tests__/conformance/dashboard-dom.test.ts` and `dashboard-process-survival.test.ts` |
| the dashboard-era session cells | `DASHBOARD-ERA-SESSION-LISTED` and `DASHBOARD-ERA-SESSION-REOPENS`: a committed session file whose header carries `"surface":"dashboard"` is listed by `agent-qa chat --list` and reopened by `--session <id>`, and the sessions directory holds exactly the seeded files, byte-identical, afterwards | `cli/src/__tests__/chat-command.test.ts` over `cli/src/__tests__/fixtures/chat-dashboard-era.jsonl` |

**This file names retired tokens literally, as the 2026-09-02 section explains for the whole
register.** `DELETION-INVENTORY.md` sits outside every census universe. Inside them, tests spell a
removed name only as two halves, so the census cannot satisfy its own inventory; the one test that
spelled a whole needle in its first half (`denial-block.test.tsx:72`) was re-split by 430-12.

### What was deleted

**Both ends of the derivation, stated so it can be re-run.** Baseline `bc9c7e315b1636f73ce068a822abc0d980100182`,
the parent of Phase 430's first agent-qa commit (`35cb451ae`, 430-01), as `430-01-SUMMARY.md`
records it. Closing HEAD `d40a867ccd005b3cd24a0be91ca75a118b60b096` (`agent-qa`, branch
`version-0.2`), the last code commit of the phase and agent-qa HEAD before this section's commit.
The lists below are DERIVED from `git -C agent-qa diff bc9c7e315..d40a867cc` (`--stat`,
`--diff-filter=D`, `--diff-filter=A` and the per-file hunks), keyed by token, not transcribed from
any plan summary: 52 commits, 99 files, +3029/−9688, 17 files deleted and 15 added. The "hits"
column counts the token's occurrences over `packages/*/src` (`.ts`/`.tsx`, tests and comments
included) as `hits/files`, at the baseline and at the closing HEAD, each measured with
`git grep -F -c` at that revision.

#### Files deleted

| File | Lines at baseline | Deleting commit | What carries its claims now |
|---|---|---|---|
| `dashboard-ui/src/pages/chat.tsx` | 24 | `524c7cb59` (430-06) | `NO-CHAT-ROUTE`, `NO-CHAT-IN-SHIPPED-BUNDLE`, the census |
| `dashboard-ui/src/components/chat-panel.tsx` (panel and launcher) | 71 | `524c7cb59` (430-06) | `SHELL-CHILDREN-EXACT`, `NO-CHAT-MOUNT-ON-ANY-PAGE`, the census |
| `dashboard-ui/src/chat/chat-transcript.tsx` | 458 | `df5146f30` (430-07) | `NO-CARD-MODULE`, the census |
| `dashboard-ui/src/chat/chat-session-context.tsx` | 115 | `486548429` (430-07) | the same |
| `dashboard-ui/src/chat/use-chat-turn.ts` | 409 | `486548429` (430-07) | the same |
| `dashboard-ui/src/chat/confirm-bubble.tsx` | 111 | `486548429` (430-07) | the same |
| `dashboard-ui/src/chat/receipt-row.tsx` | 114 | `486548429` (430-07) | the same |
| `dashboard-ui/src/chat/chat-markdown.tsx` | 143 | `486548429` (430-07) | the same, plus the two parser-import needles (D-05) |
| `dashboard-ui/src/chat/entity-card.tsx` | 327 | `231108c58` (430-07) | `NO-CARD-MODULE`, `NO-CARD-EXPORT`, the census |
| `dashboard-ui/src/components/observation-markdown.tsx` (already importer-less) | 39 | `177167710` (430-08) | the census, `DASHBOARD-UI-DECLARES-NO-MARKDOWN-PARSER` |
| `dashboard-ui/src/__tests__/chat-transcript.test.tsx` | 609 | `df5146f30` (430-07) | its DenialBlock cells moved in 430-01, its mount cells became `SHELL-CHILDREN-EXACT` and the bundle cells in 430-06, and the rest is carried by `NO-CARD-MODULE` and the census, family by family, as `430-07-SUMMARY.md` tabulates |
| `dashboard-ui/src/__tests__/fixtures/entity-cards.ts` | 307 | `231108c58` (430-07) | its only reader was the card render; the MCP half's per-kind coverage stays in `entity-card-parity.test.ts` |
| `cli/src/__tests__/conformance/hostile-markdown-fixture.ts` | 155 | `6ac417cbb` (430-06) | none needed: no renderer is left to guard (D-05) |
| `cli/src/__tests__/dashboard-chat-door.test.ts` | 1036 | `0671ed3ec` (430-09) | its surviving claims moved to `dashboard-door-host.test.ts` (430-03); the rest by `C430-DELETED-CHAT-ROUTES-SHARED-404`, `C430-CHAT-ROUTE-TABLE-EXACT` and the census |
| `cli/src/__tests__/dashboard-confirm-bridge.test.ts` | 1360 | `0671ed3ec` (430-09) | `run-trigger-confirm.test.ts` (DENY ON SILENCE, ALLOW, ALWAYS, CHANNEL VANISH, NO LIVE CHANNEL); `C430-NO-SESSION-SURFACE-OPTION` for the session-surface tag; door security 6a-6i and 6g for the answer route's cross-origin posture |
| `cli/src/__tests__/dashboard-denial-prose.test.ts` | 186 | `0671ed3ec` (430-09) | `run-mark-browser.e2e.test.ts`, `dashboard-run-mark.test.ts`, `DENIAL-REASON-ONLY` |
| `cli/src/__tests__/conformance/dashboard-anchors.test.ts` | 563 | `efc30c681` (430-20) | `C430-DELETED-CHAT-ROUTES-SHARED-404`, process survival s5, the census |

The ten production files are 1,811 lines (the whole `dashboard-ui/src/chat/` directory, the page,
the panel and the orphaned renderer). The directory itself is gone with its last file.

#### Routes deleted

| Route | Dispatch stopped | Handler deleted |
|---|---|---|
| `POST /api/chat/turn`, `POST /api/chat/confirm`, `GET /api/chat/capabilities`, `GET /api/chat/catalog`, `GET /api/chat/sessions/:id/events` | `4511077cb` (430-20): `routes.ts` dispatches `/api/run-confirm/` alone, still ahead of `cors()` | `b22137ddc` (430-09): `handleTurn`, `handleConfirm`, `handleCatalog`, `handleCapabilities` and the session-events arm, with the replay window |
| the `/chat` UI route, its lazy page, the sidebar item and `routes.chat` | `524c7cb59` and `c9e2a4ea0` (430-06) | the same commits |

#### Exports removed

| Token | Where it was exported | Hits (baseline → closing) | Commit |
|---|---|---|---|
| `CHAT_ROUTE_PREFIX`, `CHAT_TURN_ROUTE`, `CHAT_CAPABILITIES_ROUTE`, `CHAT_CATALOG_ROUTE`, `CHAT_CONFIRM_ROUTE`, `CHAT_SESSION_EVENTS_TEMPLATE` | `dashboard-server` barrel (`server/index.ts`) and `chat/chat-routes.ts` | 5/4, 8/4, 7/4, 5/3, 6/3, 5/3 → 0 each | `b22137ddc` (430-09) |
| `CHAT_STREAM_BOUNDS`, `recordStreamedEvent`, type `SessionStreamWindow` (the 512-event, 32-session replay window) | the same | 4/3, 11/4, 9/4 → 0 each | `b22137ddc` (430-09) |
| types `ChatTurnFold`, `ChatTurnResponse`, `AgentResultFold`, `AgentDeclarationRow` (and the unexported `AgentClauseVerdict`) | `dashboard-server` barrel and `chat/host.ts` | 8/5, 37/8, 6/3, 5/3, 2/1 → 0 each | `8789670a4` (430-10) |
| `postChatTurn`, `answerChatConfirm`, `subscribeToChatSessionEvents`, `fetchChatCapabilityCatalog`, types `ChatCapabilityRow`, `ChatCapabilityCatalog` and the browser mirrors of `ChatTurnFold` / `ChatTurnResponse` | `dashboard-ui/src/lib/api.ts` | 3/2, 3/2, 3/2, 5/4, 8/3, 7/4 → 0 each | `e7b3c2d43` (430-19) |
| `openRunConfirmChannel`'s `onPresent` member and its presence-frame listener | `dashboard-ui/src/lib/api.ts` | `chat_present` 7/5 → 2/1 (the server registry still emits the frame; see RETAINED) | `e7b3c2d43` (430-19) |
| `SessionEventFanOut`, `createSessionEventFanOut` | `cli/src/commands/dashboard.ts` | 4/1, 2/1 → 0 each | `0cbd5efda` (430-10) |
| `dashboardSurfaceAdapter`, `withDashboardDoor`, `enumerateDashboardOpIds`, `driveDashboardLines`, `driveDashboardDispatch`, the `SurfaceStray` kind `'dashboard-listed-op'` | `cli/src/__tests__/conformance/adapters.ts`, `surface-dispatch.ts` | 3/2, 2/1, 3/1, 5/2, 5/2, 2/1 → 0 each | `b8397f27d` (430-05) |

#### Members removed

| Token | Container (kept, narrowed) | Hits (baseline → closing) | Commit |
|---|---|---|---|
| `agentAskFunctionId`, `listDeclarations`, `onSessionEvent`, `readCapabilityCatalog` | `AgentHost` (`dashboard-server/src/chat/host.ts`) | 17/13, 16/15, 21/18, 3/3 → 0 each | optional in `107e6c726` (430-17), fakes shed in `5cc496649`, `49f0e7c0d`, `03ed1fd14` (430-17, 430-21), deleted in `8789670a4` (430-10) |
| `foldFunctionResult` | the same | 52/24 → 30/10: every remaining hit is the agent package's own fold and its readers (`agent/src/functions`, the turn engine, `agent-local`'s composition, CLI chat's `commands/chat.ts`, the arch barrel lint), all outside the three universes | the same |
| the `sessionEvents` parameter and the five chat members of the returned host | `composeDashboardAgentHost` | — | `0cbd5efda` (430-10) |
| `sessionSurface`, `mintingSurface`, the chat-model spread (`chatModel`, `chatModelFor`, `chatAccounting`), `chatPresent`, `observeSessionEvent` | `composeDashboardDoor`'s `composeCliLocalAgent` input | — | `0cbd5efda` (observeSessionEvent), `449836a05` (the rest) (430-10, 430-11) |
| `chatModel` and the `resolveCliChatCapabilities` call | `DashboardDoorInput` and the dashboard command | `resolveCliChatCapabilities` 18/11 → 16/10: CLI chat and `ask` keep it | `449836a05` (430-11) |
| `sessionSurface` | `ComposeLocalAgentInput` (agent-local) and `ComposeCliLocalAgentInput` (cli) | 7/3 → 2/2: the two remaining hits are the never-bars that forbid it | `97be25ec0` (430-11) |
| `remedies` prop, `DASHBOARD_REMEDY_TEXT` and both chat-worded sentences | `DenialBlock` | `DASHBOARD_REMEDY_TEXT` 2/1 → 0 | `407cd46ed` (430-04) |
| `'dashboard'` in `answer-confirm` and `session-pin-final` | `GATE_REMEDY_SURFACES_BY_KIND` (`schema/src/safety/remedies.ts`) | — | `f94f8a172` (430-15) |
| the `dashboard` row | `SURFACE_ROSTER` (`cli/src/__tests__/conformance/roster.ts`), now `['chat','mcp','fn','run-service']` | — | `b8397f27d` (430-05) |
| the `dashboard` entry | `MODULE_FOR_DOOR` (`proposal-author-attribution.test.ts`) | — | `29e3037e7` (430-05) |
| sinks `dashboard:chat-turn-response`, `dashboard:chat-sse-frame`, `machine:dashboard-chat-replay-window` | the unmask roll-call's `SURFACE_ROLLCALL` | — | `9acadfeca` (430-09) |
| rows turn, confirm, capabilities, catalog, sessionEvents; `ChatRouteRow.pattern`, `ChatRouteMatch.params`, `ChatRouter.openStreamCount`; `CHAT_SESSION_EVENTS_PATTERN`, `CHAT_STREAM_REPLAY_LIMIT`, `CHAT_STREAM_SESSION_LIMIT`, `ChatTurnRequestSchema`, `ChatConfirmRequestSchema` | `CHAT_ROUTE_TABLE`, `ChatRouteHandlerName` and `createChatRouter` (`chat-routes.ts`, 1041 → 490 lines) | `CHAT_SESSION_EVENTS_PATTERN` 2/1, `CHAT_STREAM_REPLAY_LIMIT` 3/1, `CHAT_STREAM_SESSION_LIMIT` 3/1 → 0 each | `b22137ddc` (430-09) |
| the lazy `ChatPage`, `<ChatPanel />`, the `ChatSessionProvider` wrapper | `app.tsx` (with `RunConfirmHost` kept inside `ProductTourProvider`) | `ChatSessionProvider` 10/4, `ChatPanel` 4/3, `ChatPage` 7/4 → 0 each | `524c7cb59` (430-06) |

#### The dependency removed

`marked` `18.0.3` left `dashboard-ui/package.json` and the ownership contract's
`AGENT_QA_DASHBOARD_UI_EXTERNAL_DEPENDENCIES` in one commit, `177167710` (430-08), with the
`.markdown-preview` stylesheet block. `pnpm install --offline` removed exactly three lockfile
entries: the `packages/dashboard-ui` importer's `marked`, `packages > marked@18.0.3` and
`snapshots > marked@18.0.3`. `marked@14.0.0` stays in the lockfile as `monaco-editor`'s own
dependency; nothing in `dashboard-ui/src` imports a markdown parser.

#### Test cells deleted inside kept files

- `dashboard-door-security.test.ts` 7a (the session-id route's decode guard) and 7b-i (the turn's
  fold guard): `9acadfeca` (430-09). Carried by `C430-DELETED-CHAT-ROUTES-SHARED-404`, process
  survival s5 and the `AgentHost` never-bar. 6a-6i, 6g, 7b-ii, 7c and 7d were re-driven onto
  `POST /api/run-confirm/answer` first (`cfeb9c20e`, `3b129472c`, 430-16).
- `parity.test.ts`'s three dashboard-door cells and the source-sweep guards that named the door:
  `b8397f27d` (430-05). Carried by the exact-list roster cell and the census.
- `dashboard-dom.test.ts`'s transcript, card, two-mount and hostile-markdown cells: `6ac417cbb`
  (430-06), 980 → 327 lines. Carried by the three bundle absence cells and the census.
- `entity-card.test.ts`'s 29 card-render cells: `df5146f30` and `231108c58` (430-07). Carried by
  `NO-CARD-MODULE`, `NO-CARD-EXPORT` and the census; its nine route-map cells survive.

### What was RETAINED, and why

Each row states what, where, why it was kept, and what pins it. No "still there" presence
assertion was added for any of them beyond `TOLERATED-NAMES-PRESENT`, which exists to keep the
census's exception list honest rather than to freeze these names.

| Item | Where (file:line at `d40a867cc`) | Why kept | What pins it |
|---|---|---|---|
| `AgentHost`, narrowed to sixteen members | `dashboard-server/src/chat/host.ts:56`; `AGENT_HOST_MEMBERS` at `:236` | the whole host seam of run detail, analysis, knowledge, marks, post-processing and the run-confirm pair (400 D-01's in-process host still stands) | `C430-AGENT-HOST-MEMBERS-EXACT`, runtime and type; mutation leg `R11` |
| the confirm registry | `dashboard-server/src/chat/confirm-registry.ts:246` (`createConfirmRegistry`) | one registry serves run-trigger and mark confirms; only the chat use left. Phase 432 deletes the rest | `run-trigger-confirm.test.ts`, the Run button and mark browser cells |
| `DenialBlock`, reason-only | `dashboard-ui/src/components/run-detail/denial-block.tsx:4` | run detail renders a mark refusal through it; it moved out of the chat module (430-01) and lost its remedy lines (430-04, D-06) | `DENIAL-REASON-ONLY`, `DENIAL-NOTHING-INVENTED`; legs `R14`, `R15` |
| `entityRefRoute` with its route map (`ENTITY_KIND_ROUTES`, `entityRouteFor`, the compile-time partition check) | `dashboard-ui/src/lib/entity-routes.ts:22`, `:39`, `:44` | the Knowledge tab links `agentqa://` references through it (430-02) | `ENTITY-REF-ROUTE-RESOLVES`, `ENTITY-ROUTES-MODULE-SHAPE`, `NO-CARD-EXPORT` |
| the chat-named confirm types: `ChatConfirmAnswer`, `ChatConfirmRequestFrame`, `ChatConfirmResolvedFrame`, `CONFIRM_ANSWER_VOCABULARY` (UI); `CHAT_CONFIRM_ANSWERS`, `ChatConfirmChannelFrame` (server) | `dashboard-ui/src/lib/api.ts:1642-1652`; `confirm-registry.ts:105`, `:148` | they type the run and mark confirms; renaming what 432 deletes is churn | `TOLERATED-NAMES-PRESENT` |
| `createChatRouter` and `CHAT_ROUTE_TABLE`, narrowed to `POST /api/run-confirm/answer` and `GET /api/run-confirm/channel` | `dashboard-server/src/chat/chat-routes.ts:93`, `:313`; dispatched at `server/routes.ts:1936` | the Run button's confirm pair lives here until Phase 432 deletes it (REQUIREMENTS note 56) | `C430-CHAT-ROUTE-TABLE-EXACT`, `C430-RUN-CONFIRM-PREFIX-STILL-ROUTED`, door security 6a-6i and 6g; legs `R06`-`R08` |
| the presence frame (`chat_present`) and `present()` in the registry | `confirm-registry.ts:157`, `:357` | still reached on run-trigger and mark scopes by the confirm factory's accept-always failure messages; the browser no longer listens (430-19). Covered by the census's `dashboard-server/src/chat/` path exception | Phase 432 |
| `CLAUSE_RECEIPT_STATUSES` | `schema/src/chat/turn-receipts.ts:37` | lost its only consumer outside the schema (`use-chat-turn.ts`) but stays the runtime key set beside `ClauseReceiptStatus`, and still backs `AgentAskResult`'s receipt-status enum (`schema/src/chat/agent-ask.ts:23`) | the schema's chat vocabulary cells |
| the schema's `chat/` contracts | `schema/src/chat/` (`agent-ask.ts`, `session-events.ts`, `session-log-port.ts`, `turn-receipts.ts`, `pin-overlay.ts`, `scenario-expectation.ts`) | CLI chat and `ask` use every one of them; no `schema/src/chat/**` type died (SC3 is met by the door-only DTOs above) | outside the census by D-11 |
| `DASHBOARD_FUNCTION_CALLER` (`surface: 'dashboard'`) and the commit-author map's `dashboard` entry | `cli/src/commands/dashboard.ts:123`; `cli/src/composition/local-agent-host.ts:2282` | the dashboard is still a caller: run detail reads and marks through the host, and the Run button starts runs | `TOLERATED-NAMES-PRESENT`; `proposal-author-attribution.test.ts` cell (1) |
| `conformance/spawned-chat.ts` | `cli/src/__tests__/conformance/spawned-chat.ts` (837 lines, 42 importers) | a shared spawn fixture for dashboard, live and run-service suites, despite its name | its importers |
| `composeDashboardDoor` and `composeDashboardAgentHost`, narrowed | `cli/src/commands/dashboard.ts:734`, `:156` | not door-only (RESEARCH P1): they compose the dashboard's whole `LocalAgentHost`, the run trigger, marks, the run-service door and the co-hosted MCP registry | `TOLERATED-NAMES-PRESENT`; about 30 non-chat suites |
| `overlayDashboardBaseUrl` | `cli/src/commands/dashboard.ts:296` | not door-only (RESEARCH P5): it wraps the config reader of the host whose registry the co-hosted MCP endpoint serves, so MCP cards carry a url. D-01's line deleting D-16's overlay with the door therefore does not apply | the four card-url cells and the bound-origin cells moved to `dashboard-door-host.test.ts` (430-03) |
| the posture machinery: the asking-session frame, `askingSessionOf`, the `enterAskingSession` parameter, `watchedAndInFlight`, `reachableByChannelAlone`, `resolveExecutionContext` | `cli/src/commands/dashboard.ts:136`, `:395`, `:429`, `:807` | the gate posture Phase 432 removes (RESEARCH Open Question 2, 430-10); behaviour unchanged, each site carries a dated 430 note | `run-trigger-confirm.test.ts` "THE CONVERSATION RULE IS UNTOUCHED" |
| `'dashboard'` in `GATE_REMEDY_SURFACES`, declared empty | `schema/src/safety/remedies.ts:74` | the `run-service` precedent: removing it breaks compile at two server projections and a safety cell for no gain, and 432 deletes the layer (430-15) | `C430-REMEDY-SURFACES-EXACT`, `C430-DASHBOARD-PROJECTION-EMPTY`; legs `R12`, `R13` |
| the session log's own `surface` option and the reader's header guard | `agent-local/src/session/jsonl-session-log.ts:234`, `:335`; `schema/src/chat/session-events.ts:67` | the store's API, not the composition's: `session-surface-tag.test.ts` writes reader-compat fixtures through it, and the reader must keep accepting `surface: 'dashboard'` headers (D-08) | `session-surface-tag.test.ts`, `DASHBOARD-ERA-SESSION-LISTED` |
| `mintingSurface`, `observeSessionEvent`, `chatPresent` and the chat-model options on both compositions | `agent-local/src/composition/compose-local-agent.ts:2077`; `cli/src/composition/local-agent-host.ts` | `agent-qa chat` and `ask` set them; only the dashboard door's writers went | `C430-NO-SESSION-SURFACE-OPTION`'s kept-options half |

### What degrades, stated plainly

- **A person can no longer converse with the agent in the browser.** No page, panel or launcher
  exists, and nothing replaces them (product law 5; no notice, no placeholder route). CLI
  `agent-qa chat` and `ask`, and any MCP host, are where conversation happens.
- **Dashboard refusals carry no remedy hint.** A denied mark shows its neutral reason and nothing
  else. The gate still mints remedies; the CLI and chat surfaces still render theirs.
- **Dashboard-era sessions are reachable only through CLI chat.** `agent-qa chat --list`,
  `--continue` and `--session <id>` list and reopen them; the dashboard shows none of them.
- **The markdown link and image hardening lives only in git history.** `chat-markdown.tsx`'s
  allow-lists (`git show bc9c7e315:packages/dashboard-ui/src/chat/chat-markdown.tsx`) and their
  XSS cells went with it. A future renderer re-derives both with its own tests.
- An old `/chat` bookmark lands on Runs through the existing catch-all, with no message (D-07).

### Persisted values the narrowed contract governs

| Persisted value | Disposition | Evidence |
|---|---|---|
| Session JSONL, `.agent-qa/sessions/chat-*.jsonl`, including files whose header carries `surface: 'dashboard'` | **Left alone (D-08):** no migration, no deletion and no listing filter; the files are the user's. CLI chat lists and reopens them, reading headers only and never branching on `surface`. The header's optional `surface` field and the reader's guard stay; the only writer of `'dashboard'` (the door's `sessionSurface`) is gone, so no new file carries it. **Named, not fixed (D-09): `user_message.text` and `clause_receipt.clause` may hold typed credentials in cleartext. CLI chat keeps writing such files after this phase. Pre-430 dashboard sessions are part of that population.** The repair needs a chat-session-scoped masking context that does not exist yet; it is owned by `.planning/todos/pending/399.1-transcript-cleartext-masking.md` (v2.1 FIX-S2), which stays pending. Nothing in this phase masks, rewrites or scrubs these files. | `DASHBOARD-ERA-SESSION-LISTED`, `DASHBOARD-ERA-SESSION-REOPENS`; `C430-NO-SESSION-SURFACE-OPTION`; leg `R21` (the census) and `R22` |
| Routes | **Deleted:** `POST /api/chat/turn`, `POST /api/chat/confirm`, `GET /api/chat/capabilities`, `GET /api/chat/catalog`, `GET /api/chat/sessions/:id/events` (each now the router's generic 404 with the shared wildcard grant), and the `/chat` UI route (falls through to `/runs`). **Retained, owned by Phase 432:** `POST /api/run-confirm/answer` and `GET /api/run-confirm/channel`, in `chat-routes.ts`, dispatched ahead of `cors()`. | `C430-DELETED-CHAT-ROUTES-SHARED-404`, `NO-CHAT-ROUTE`, `NO-CHAT-IN-SHIPPED-BUNDLE`, process survival s5; `C430-RUN-CONFIRM-PREFIX-STILL-ROUTED`, `C430-CHAT-ROUTE-TABLE-EXACT`; legs `R01`, `R06`, `R07`, `R19`, `R20` |
| Config keys | **None retired.** No config key ever belonged to Chat. `services.dashboard.baseUrl` and `services.dashboard.workspace` (`core/src/schema/services-schema.ts:61`, `:65`) stay: they are 400 D-16's knob for CLI and MCP hosts' card urls, read by `mcp/src/live-link.ts` and the card producer (`agent/src/functions/entity-cards/card-context.ts:28-29`). Only the door's own self-overlay use left with the door; the overlay function itself stays for co-hosted MCP (RETAINED above). | `dashboard-door-host.test.ts` card-url cells |
| Persisted `'dashboard'` surface values | **Still readable and valid:** the session-header `surface`; proposal `origin.surface: 'dashboard'`; past `approval_decision` events. **Correction to D-08 (RESEARCH P19):** the persisted `origin.surface: 'dashboard'` values were minted only by dashboard-chat config proposals through `mintingSurface`, never by marks (mark-drafted proposals carry no surface). After 430 no writer produces new ones. *Corrected 2026-10-02 by Phase 432 (430-REVIEW WR-01; the 2026-10-02 section below, "Correction to the 2026-09-28 attribution row"): config proposals minted over the dashboard's co-hosted MCP endpoint carried `'dashboard'` too before 430, and none after it. The sentence above is kept as written.* | `proposal-author-attribution.test.ts` cell (1) (a persisted record with `origin.surface: 'dashboard'`, accepted from the CLI, is still authored as the dashboard), the dashboard-era session cells |

### The instruments that notice a return

- **`pnpm validate:arch`**: the 430 census beside `validate-arch.test.ts` and the earlier
  censuses. It runs in the workspace's `turbo test`, so a re-added name, path, file or parser
  import in the three universes REDs by name on the commit that adds it.
- **`pnpm run validate:430-chat-removal-mutation`**: the bar that proves the census and the
  closed-set and absence cells are not decoration, 23 legs, each restored byte-identically.
- **`pnpm run validate:430-chat-removal-mutation-selftest`**: proves the gate fires, that its
  written inventory matches the legs, and that both scripts stay registered. Like every
  `validate:*-mutation` script, neither is in CI; both are phase-gate instruments run by hand.
- **The closed-set cells** (`C430-*`) and **the absence cells** (`NO-CHAT-*`,
  `SIDEBAR-NAV-EXACT`, `PALETTE-PAGES-EXACT`, `SHELL-CHILDREN-EXACT`, `TOUR-HAS-NO-CHAT-STEP`,
  `NO-CARD-*`, `DENIAL-REASON-ONLY`), which run in the ordinary package suites.

### Reconciliation

The planning record carries this phase's dated notes in `.planning/REQUIREMENTS.md` § "Phase 430
reconciliation (2026-09-28)", notes 84-92: the run-confirm routes left in place (84), the
four-door roster (85), the deleted renderer with `marked` (86), SC3 met by the door-only DTOs (87),
the emptied dashboard remedy projection (88), the widened census (89), the palette and tour
clauses met by absence (90), the six WINDOWS/v2.1 dispositions (91: #192, #90 and #195 closed or
retired, #194 and #217 re-homed to Phase 432, SURF-10's dashboard `@`-mention half withdrawn), and
RESEARCH's corrections to CONTEXT premises (92). `.planning/WINDOWS.md` carries the matching
`RECONCILIATION-430` block, and `PROJECT.md`'s PXH-SURF bullet carries a dated correction. The
spec files stay read-only.

### Gate at the time of writing (2026-09-28)

Run on 2026-09-28 from `agent-qa/` on the closing HEAD `d40a867cc`, between 06:58 and 07:32 UTC, by
430-14. Each command ran once, in the order below; the exit code is the one the process returned,
read from `$?` on a redirected run, never inferred from output text. `git status --porcelain` in
agent-qa was empty before the first command and after the last. Rows 18-24 are the re-runs the
workspace suite's reds called for; they are not substitutes for row 8, which stays red.

| # | Command | Observed | Exit |
|---|---|---|---|
| 1 | `pnpm build` | 22 successful, 22 total (22 cached) | **0** |
| 2 | `pnpm turbo run build --force` | 22 successful, 22 total, 0 cached | **0** · 25 s |
| 3 | `pnpm --filter agent-qa exec vitest run` over `ask-command`, `chat-command`, `chat-confirm-wrapper`, `chat-approval-record-census`, `receipt-remedy-render`, `tty-confirm`, `conformance/parity`, `conformance/render-parity`, `conformance/help-census` (`--maxWorkers=1`) | Test Files 9 passed (9) · Tests 259 passed (259) · no type errors | **0** · 32 s |
| 4 | `pnpm --filter @vostride/agent-qa-agent test` | Test Files 115 passed (115) · Tests 1973 passed (1973) | **0** · 10 s |
| 5 | `pnpm --filter @vostride/agent-qa-agent-local test` | Test Files 57 passed (57) · Tests 625 passed, 2 skipped (627) | **0** · 36 s |
| 6 | `pnpm --filter @vostride/agent-qa-mcp test` | Test Files 18 passed (18) · Tests 377 passed (377) | **0** · 6 s |
| 7 | `pnpm --filter @vostride/agent-qa-safety test` | Test Files 36 passed (36) · Tests 387 passed (387) | **0** · 2 s |
| 8 | `pnpm test --force` | turbo stopped at `@vostride/agent-qa-mcp#test`: 8 cells `Test timed out in 5000ms` (`token-absence.test.ts` A0, A1, A2, A9, A10; `withdrawn-claim-census.test.ts` W3, W4, W5), 35 of 43 tasks succeeded, 0 cached. The same package passed whole in row 6 | **1** · 104 s |
| 9 | `pnpm typecheck` | 44 successful, 44 total (44 cached; row 20 is the uncached run) | **0** · 1 s |
| 10 | `pnpm validate:arch` | Test Files 11 passed (11) · Tests 304 passed (304), the 430 census's 77 among them | **0** · 8 s |
| 11 | `pnpm run validate:skills` | `agent-qa skills pack validation passed` | **0** |
| 12 | `pnpm run validate:publish` | `publish surface validation passed (full)`, over the narrowed `@vostride/agent-qa-dashboard` barrel | **0** · 15 s |
| 13 | `pnpm run validate:430-chat-removal-mutation` | `CHAT_REMOVAL_MUTATION_OK legs=23 named-red=23 byte-identical-restoration=15`, then `REBUILT workspace (pnpm turbo run build --force) exit=0` | **0** · 287 s |
| 14 | `pnpm build` | 22 successful, 22 total | **0** |
| 15 | `pnpm run validate:430-chat-removal-mutation-selftest` | TAP `# pass 32`, `# fail 0`; `CHAT_REMOVAL_MUTATION_OK_SELFTEST_OK legs=23 subjects=15` | **0** · 306 s |
| 16 | `pnpm build` | 22 successful, 22 total | **0** |
| 17 | `pnpm --filter agent-qa exec vitest run src/commands/__tests__/run-confirm-browser.e2e.test.ts src/commands/__tests__/run-mark-browser.e2e.test.ts --maxWorkers=1` (the Run button and inline mark approval, real Chromium over the built bundle) | Test Files 2 passed (2) · Tests 14 passed (14) | **0** · 83 s |
| 18 | `pnpm test --force` (re-run, unchanged tree) | turbo stopped at mcp again: 9 cells `Test timed out in 5000ms` (A0, A1, A2, A3, A9, A10, W3, W4, W5), 34 of 43 tasks | **1** · 120 s |
| 19 | `pnpm test --force --continue` | 46 tasks, 0 cached, 43 succeeded. Reds only in mcp (9 cells, the same two files, 5000 ms timeouts), web (5 cells, `424-recording.screencast.test.ts` REC-WEB-*, `Hook timed out in 10000ms`) and knowledge-local (1 cell, `trust-prior-projection.test.ts` "full rebuild preserves agent-verified-incomplete with absent empty and partial priors", `Test timed out in 15000ms`). Every other package green, among them cli 291 files (4123 passed, 18 skipped), dashboard-server 78 files (1406 passed, 1 skipped), dashboard-ui 230 files (2757), schema 169 files (1959), core 56 files (689), eval-local 70 files (1006) and arch 25 files (439) | **1** · 474 s |
| 20 | `pnpm turbo run typecheck --force` | 44 successful, 44 total, 0 cached | **0** · 47 s |
| 21 | `pnpm --filter @vostride/agent-qa-mcp exec vitest run src/__tests__/token-absence.test.ts src/__tests__/withdrawn-claim-census.test.ts` | Test Files 2 passed (2) · Tests 12 passed (12) | **0** · 6 s |
| 22 | `pnpm --filter @vostride/agent-qa-web exec vitest run src/__tests__/424-recording.screencast.test.ts`, then `pnpm --filter @vostride/agent-qa-web test` | 1 file, 8/8; then 15 files, 268/268 | **0**, **0** · 5 s, 100 s |
| 23 | `pnpm --filter @vostride/agent-qa-knowledge-local exec vitest run src/__tests__/trust-prior-projection.test.ts`, then `pnpm --filter @vostride/agent-qa-knowledge-local test` | 1 file, 14/14; then 166 files passed, 1 skipped, 1951 passed, 3 skipped | **0**, **0** · 22 s, 233 s |
| 24 | `pnpm --filter @vostride/agent-qa-mcp test` (after the workspace runs) | 18 files, 377/377 | **0** · 7 s |

**The workspace suite does not exit 0 on this machine, and that is recorded rather than
explained away.** Every red in rows 8, 18 and 19 is a timeout under full-workspace load, in
`packages/mcp`, `packages/web` and `packages/knowledge-local`, none of which Phase 430 touched
(`git diff --stat bc9c7e315..d40a867cc` over the three is empty). Every red file passes alone and
in its package alone (rows 21-24). They are the same cells 429-36 classified the same way (its
row 2d, REQUIREMENTS note 80). No cell was loosened and no timeout was raised.

**Cited, not re-run here.** The other gates whose subjects or instruments this phase touched ran
green in the plan that touched them, on an earlier tree, and are NOT claimed green on `d40a867cc`:
`validate:426-feedback-mutation` (430-01, 430-04; last at `b2c5c2ad4`),
`validate:423-read-sinks-mutation`, `validate:427-knowledge-mutation` and
`validate:425-header-mutation` (430-02, at `bed6de72b`), `validate:428-live-ui-mutation` (430-08,
at `7b19e5102`), `validate:428-live-contract-mutation` and `validate:429-config-contract-mutation`
(430-09 at `9acadfeca`, 430-20 at `efc30c681`), `validate:424-recording-mutation` (430-21, at
`03ed1fd14`), `validate:423-evidence-mutation` (430-10 at `0cbd5efda`, 430-11 at `db4333c9c`) and
`validate:423-feedback-read-mutation` and `validate:423-curation-mutation` (430-11, at
`db4333c9c`). The commits after those runs are 430-12's census (with one re-split test string in
`denial-block.test.tsx`) and 430-13's two scripts and their `package.json` entries.

**Toolchain:** node 24.15.0 · pnpm 10.6.1 · vitest 4.1.5 · turbo 2.9.7.

## 2026-10-02 — Phase 432: Approval and permission removal (PXH-SAFE-01..05)

This section appends to the register. It rewrites no earlier section; the one change above it is a
dated pointer added to the 2026-09-28 persisted-values row (430-REVIEW WR-01, below). Phase 432
deleted every approval prompt and every permission. Runs, marks and generated changes now apply in
the one call a person or agent makes, on every door. What it kept: production as a config
declaration, the local network boundary, masking and egress, and the readers of persisted history.
The section follows the 2026-09-28 shape and adds two things that shape does not carry: the legacy
state left on disk and never read, and the one historical reader kept with no writer.

### The ruling

> Think of it like this as a agent clicking y / n is tricky we shouldn't have those, and the same
> applies for the UI for humans too. So pls remove all such complexities and keep things simple

> drop as much as you can, keep things simple

> for the MCP and all having permissions read write etc is not worth at all. Since we are early
> having such knobs causes friction. And we should not have those at all. All intereactions should
> have all the capabilities

> let's keep it simple no token pls drop it. It makes things complicated. Also drop the scope too.
> Drop entire mcp.tokens

> out of 100 knowledge gathered there's I think < 1% chance of undo, so for that 1% change I think
> having all such guardrails is not worth it, is someone wants to undo something why can't a new
> knowledge override it?

The owner, verbatim, in the 2026-09-29 Phase 432 discussion (D-01 in
`.planning/phases/432-approval-gate-removal-provenance-and-undo/432-CONTEXT.md`, REQUIREMENTS
note 105). Where a choice was open, the version with fewer moving parts won and deleting won over
keeping. It extends the 2026-09-25 decision (REQUIREMENTS note 56) and supersedes it where they
differ: Undo, provenance labels, the hard destructive block and the tokens were all dropped.

### How this inventory is measured

| Instrument | What it claims | Where |
|---|---|---|
| the census | One named cell per removed member, `C432-RETURN-A01`..`A78`, each scanning its member's own region through a lexer that blanks comments and keeps string, template and regex literals, so dated history notes stay and a returning declaration, route, op id, tool name or prompt literal reds by name. A59/A61/A63/A65 also parse a config through the rebuilt public `AgentQaConfigSchema` (`packages/core/dist/index.js`) in an isolated Node process: the control parses, and the removed key is refused as unrecognized and not kept. A64 asks the rebuilt `dist/cli.js run --help`. Beside them: `C432-DELETED-SYMBOLS` (30 deleted module paths absent, 43 deleted export names absent from 11 barrels and from every production declaration), `C432-LEFTOVERS-UNREAD` (no production code spells a legacy grant, proposal or execution-audit path; the historical `approval_decision` reader stays with no writer) and two `C432-MUTATION-ALL-MEMBERS` cells. 100 cells, in `validate:arch`. | `packages/arch/src/__tests__/432-approval-permission-deleted.test.ts` (432-42 `c916d4c2e`, 432-43 `bc3260240`) |
| the prompt census | 21 decision-prompt and approval-surface needles over 1,437 shipped source files (raw, comments included), every built bundle and the skills, packaged skills and catalogue; readline questions only at the two named value-input sites; no browser `confirm(`; the built `cache purge`, `knowledge purge`, `knowledge rollback`, `run` and `mcp` help declare no `--force`, `--yes`, `--confirm`, trust or token option; a BOM-led CRLF multi-byte file keeps every witness and a census pass writes nothing. 74 cells. | `packages/cli/src/__tests__/432-prompt-census.test.ts` (`C432-NO-APPROVAL-PROMPTS`) |
| the door matrix | Nine doors (run, fn, ask, chat, MCP HTTP, MCP stdio, the dashboard Run control, the run service, the daemon) each run a non-production test in one call with stdin replaced by a stream that records and throws; each refuses a declared production test before any effect, naming the target and `allowProduction: true`; each runs it once only when the config opts in. The three knowledge and six config operations apply in one call each. 30 cells. | `packages/cli/src/__tests__/conformance/432-direct-parity.test.ts` (`C432-DOOR-NONPRODUCTION`) |
| the stdio and no-git cells | A tokenless spawned stdio caller sees exactly twenty tools, changes config and marks in one call each, and the next brief serves the changed record (3 cells). Config change, mark fix and authored test make no git commit in a repository, a dirty tree and no repository; a faulted mark lands its fix once on retry; a fresh project creates no grant ledger, proposal store or execution audit; sealed, malformed legacy files change no answer and stay byte- and mode-identical (6 cells). | `432-mcp-direct-stdio.test.ts` (`C432-TOKENLESS-CATALOG`, `C432-NEXT-RUN-SERVES`), `432-no-git.test.ts` (`C432-NO-GIT-COMMIT`, `C432-LEFTOVERS-UNREAD`) |
| the runtime key sets | `C432-RUNTIME-SETS`, `C432-NO-GRANT-CONTRACTS`, `C432-NO-ENVELOPE-EXPORTS`, `C432-PLAIN-REFUSAL` and `C432-DECLARATION-KEYS`: runtime sets beside their types (compile-checked exact key sets and `@ts-expect-error` lines), narrowed by each deleting plan in turn (432-09, 18, 19, 22, 39, 42). | `packages/schema/src/__tests__/432-deleted-runtime-sets.test.ts`, `432-direct-contracts.test.ts`; agent `declaration-immutability.test.ts` |
| the historical reader | `C432-HISTORICAL-READER`: a pre-432 session file carrying `approval_decision` rows still parses; no build writes one. | `packages/schema/src/chat/__tests__/chat-vocabulary.test.ts` |
| the 432 mutation gate | 94 legs keyed by mutation-map row: 78 put one removed member back where the map puts it (22 of them create a deleted module at its old path) and 16 break one retained behaviour. Each leg requires its own named assertion RED inside its own cell, restores every byte (and deletes every created module), rebuilds and passes a positive control. Ends `APPROVAL_PERMISSION_MUTATION_OK legs=94 named-red=94 byte-identical-restoration=55`. | `scripts/432-approval-permission-mutation.sh` (`pnpm run validate:432-approval-permission-mutation`) |
| its selftest and map test | The 94 id, target and RED triples spelled independently; every leg neutered (each FATALs `suite stayed green` after a green child); a dirty subject refused and left as found; fatal, SIGINT, SIGTERM and SIGHUP each restoring all 55 paths and rebuilding: 103/103. The node map test spells the map a third time and joins the three by id under five registration orders (EDGE-16): 7/7. | `scripts/432-approval-permission-mutation-selftest.sh`, `scripts/__tests__/432-mutation-map.test.cjs` |
| the inherited drivers | The nine legacy 394/395/396-06/399 drivers rebuilt on the shared 423 engine, 430 R12-R15 carried to four new cells, the 426/429/430 legs re-aimed: 12 drivers, 177/177 legs named-red, four selftests 160/160 (432-44). The five 396 MCP drivers rebuilt the same way, 397 parity and 398 catalog re-measured, the 423/427 drivers re-anchored: 10 drivers, 94/94 legs named-red (432-45). | `scripts/39{4,5,6,7,8,9}-*`, `scripts/4{23,26,27,29,30}-*`; tables in `432-44-SUMMARY.md` and `432-45-SUMMARY.md` |

**This file names retired tokens literally, as the 2026-09-02 section explains for the whole
register.** `DELETION-INVENTORY.md` sits outside every census universe; inside them, removed names
are spelled as two halves (the census's `Halves` tuples), so the census cannot satisfy its own
inventory.

### What was deleted

**Both ends of the derivation, stated so it can be re-run.** Baseline
`1158ca14261a91f239036c98366b1170ccd29099`, the parent of Phase 432's first agent-qa commit
(`e62a4d110`, 432-01). Closing HEAD `0721f61f04b47ee0bb414ab830e679bf1fc758ff` (`agent-qa`, branch
`version-0.2`), the last code commit of the phase and agent-qa HEAD before this section's commit.
The lists below are DERIVED from `git -C agent-qa diff 1158ca142..0721f61f0` (`--shortstat`,
`--diff-filter=D`, `--diff-filter=A` and `git log -S` per token), not transcribed from any plan
summary: 112 commits, every one signed (`%G?` = G); 754 files, +44666/−56532 (under `packages/`:
711 files, +39969/−51665); 56 files deleted and 32 added. The deleted files are 50 production
modules (10,404 lines) and 6 test files (3,068 lines). The "hits" columns count a token over
`packages/*/src` (`.ts`/`.tsx`) as `hits/files`, at the baseline and at the closing HEAD, measured
with `git grep -F -c` at each revision; "prod" excludes `__tests__/` and `*.test.*`. Every closing
production hit listed is a dated comment, except where the row says otherwise.

#### Files deleted

The census column says whether the path is one of `C432-DELETED-SYMBOLS`' 30 module rows. Where it
is not, the claim is carried by the named cell in the last column.

| File (under `packages/`) | Lines at baseline | Deleting commit | Census module row | Return cell / carrier |
|---|---|---|---|---|
| `safety/src/policy/gate.ts` | 419 | `39c0316cc` (432-19) | yes | `C432-RETURN-A12` (`resolveAsk`), `A13` (`evaluate`), `A14` (`baseVerdict`) |
| `safety/src/policy/gate-hook.ts` | 42 | `39c0316cc` (432-19) | yes | `A15` |
| `safety/src/policy/scope.ts` | 36 | `39c0316cc` (432-19) | yes | `C432-DELETED-SYMBOLS` |
| `safety/src/ports/policy-ports.ts` | 62 | `39c0316cc` (432-19) | yes | `A16` (`ConfirmPort`) |
| `safety-local/src/readline-confirm.ts` | 68 | `39c0316cc` (432-19) | yes | `A17` |
| `schema/src/safety/remedies.ts` | 150 | `39c0316cc` (432-19) | yes | `A69`-`A72` (one cell per remedy kind) |
| `schema/src/safety/standing-approval.ts` | 14 | `39c0316cc` (432-19) | yes | `A22` |
| `dashboard-server/src/chat/chat-routes.ts` | 490 | `18fb76a0a` (432-14) | yes | `A07` (GET channel), `A08` (POST answer) |
| `dashboard-server/src/chat/confirm-registry.ts` | 377 | `18fb76a0a` (432-14) | yes | `A11` |
| `dashboard-ui/src/components/run-confirm-dialog.tsx` | 347 | `18fb76a0a` (432-14) | yes | `A09` |
| `dashboard-ui/src/components/run-detail/feedback-approval.tsx` | 78 | `18fb76a0a` (432-14) | yes | `A10` |
| `dashboard-ui/src/lib/mark-confirm-route.ts` | 27 | `18fb76a0a` (432-14) | no | `C432-NO-APPROVAL-DIALOG` (432-14) |
| `knowledge-local/src/grants/ledger.ts` | 296 | `38b78c764` (432-18) | yes | `A20` (the `grants.jsonl` writer) |
| `knowledge-local/src/grants/reader.ts` | 99 | `38b78c764` (432-18) | yes | `A21` (the reader) |
| `knowledge-local/src/grants/operations.ts` | 334 | `38b78c764` (432-18) | no | `C432-GRANTS-UNREAD-WRITER-ABSENT`, `C432-NO-GRANT-OPS` |
| `schema/src/safety/grant-ledger.ts` | 240 | `38b78c764` (432-18) | yes | `C432-NO-GRANT-CONTRACTS` |
| `schema/src/safety/protected-classes.ts` | 60 | `38b78c764` (432-18) | yes | `A23` (`fn:proposals.accept`), `A24` (`fn:grants.revoke`) |
| `schema/src/chat/pin-overlay.ts` | 37 | `38b78c764` (432-18) | yes | `C432-PIN-ABSENT` |
| `agent/src/chat/pin-overlay.ts` | 203 | `38b78c764` (432-18) | yes | `A68` |
| `agent-local/src/composition/dispatch-grants.ts` | 163 | `38b78c764` (432-18) | yes | `C432-GRANT-DEPS-ABSENT` |
| `agent/src/functions/ops/grants-list.ts` | 77 | `38b78c764` (432-18) | no | `A18` (the id returned over a live spec) |
| `agent/src/functions/ops/grants-revoke.ts` | 88 | `38b78c764` (432-18) | no | `A19` |
| `agent/src/functions/ops/proposals-list.ts` | 71 | `54edac799` (432-17) | no | `A25` |
| `agent/src/functions/ops/proposals-show.ts` | 54 | `54edac799` (432-17) | no | `A26` |
| `agent/src/functions/ops/proposals-accept.ts` | 611 | `54edac799` (432-17) | no | `A27` |
| `agent/src/functions/ops/proposals-reject.ts` | 86 | `54edac799` (432-17) | no | `A28` |
| `agent/src/functions/ops/knowledge-proposal-apply.ts` | 86 | `54edac799` (432-17) | no | `A29` |
| `agent/src/functions/ops/config-proposal-apply.ts` | 265 | `54edac799` (432-17) | no | `A30` |
| `agent/src/functions/ops/config-undo-propose.ts` | 88 | `54edac799` (432-17) | no | `A31` |
| `cli/src/commands/proposals.ts` | 508 | `54edac799` (432-17) | yes | `A44`, `C432-NO-PROPOSAL-CLI` |
| `knowledge-local/src/review/proposals-store.ts` | 1098 | `54edac799` (432-17) | yes | `A42` |
| `knowledge-local/src/review/proposals-inbox.ts` | 131 | `54edac799` (432-17) | yes | `A43` |
| `knowledge-local/src/review/proposals-data.ts` | 237 | `54edac799` (432-17) | no | `C432-PROPOSAL-FILES-UNREAD` |
| `schema/src/proposal/envelope.ts` | 311 | `54edac799` (432-17) | yes | `A41`, `C432-NO-ENVELOPE-EXPORTS` |
| `schema/src/proposal/inbox-ops.ts` | 462 | `54edac799` (432-17) | no | `C432-NO-ENVELOPE-EXPORTS` |
| `schema/src/proposal/index.ts` | 65 | `54edac799` (432-17) | no | `C432-NO-ENVELOPE-EXPORTS` (the directory is gone with it) |
| `schema/src/config-mutation/proposal.ts` | 324 | `54edac799` (432-17) | no | `C432-DIRECT-CONTRACTS` |
| `schema/src/knowledge/proposal.ts` | 241 | `54edac799` (432-17) | no | `C432-DIRECT-CONTRACTS`, `C432-KNOWLEDGE-CHANGE-OPS` |
| `knowledge-local/src/review/gate-inconsistency.ts` | 41 | `e7fa7379a` (432-10) | no | `C432-INCONSISTENCY-HOLD` (the hold stays in `promotion-gate.ts`; mutation leg B11) |
| `knowledge-local/src/review/gate-inconsistency-read.ts` | 118 | `e7fa7379a` (432-10) | no | the same |
| `mcp/src/apply-refusal.ts` | 539 | `8310bdbad` (432-12) | yes | `C432-MCP-DIRECT-RECEIPT`, `C432-MCP-NO-ELICITATION`; 396-06 leg A3 |
| `mcp/src/visibility.ts` | 55 | `50045b34c` (432-20) | yes | `A58` |
| `cli/src/composition/mcp-token-resolution.ts` | 219 | `4e3c9760b` (432-21) | yes | `A59`, `A60` |
| `cli/src/composition/run-service-token-resolution.ts` | 186 | `4e3c9760b` (432-21) | no | `A61`, `A62` |
| `schema/src/config/mcp.ts` | 77 | `0bbd409b5` (432-22) | yes | `A59`, `A63` (through the rebuilt public parser) |
| `schema/src/config/run-service.ts` | 51 | `0bbd409b5` (432-22) | yes | `A61` (the same) |
| `schema/src/safety/grant-ops.ts` | 239 | `0bbd409b5` (432-22) | yes | `C432-RUNTIME-SETS` (`TrustScopeSchema` absent) |
| `dashboard-ui/src/components/config-manager/token-list.tsx` | 390 | `0bbd409b5` (432-22) | no | `C432-NO-TOKEN-CONTROLS`; 429 UI leg U42 |
| `schema/src/functions/function-scope.ts` | 79 | `06798dccc` (432-39) | yes | `A46` (the union), `A47`-`A52` (one cell per scope literal) |
| `schema/src/safety/trust-credential.ts` | 65 | `c916d4c2e` (432-42) | yes | `C432-DELETED-SYMBOLS`, `C432-RUNTIME-SETS` |
| test `agent/src/functions/__tests__/proposals-accept.test.ts` | 576 | `54edac799` (432-17) | — | 18 cells → `C432-NO-PROPOSAL-OPS` (`registry-invariants`: not registered, `UnknownFunctionError`) |
| test `agent/src/functions/__tests__/apply-action-classes.test.ts` | 382 | `54edac799` (432-17) | — | 8 cells: the accept verb's apply-class table went with the verb; `C432-NO-PROPOSAL-OPS` |
| test `knowledge-local/src/review/__tests__/authoring-proposals-store.test.ts` | 382 | `54edac799` (432-17) | — | 13 cells → 432-08's `C432-TEST-WRITE-*` (authored tests are written directly) and `C432-DIRECT-CONTRACTS` |
| test `schema/src/__tests__/proposal-envelope.test.ts` | 255 | `54edac799` (432-17) | — | 25 cells → `C432-NO-ENVELOPE-EXPORTS`; four claims kept under their names in `432-direct-contracts.test.ts` |
| test `cli/src/__tests__/proposals-digest-commands.test.ts` | 775 | `54edac799` (432-17) | — | renamed `digest-command.test.ts` (296 lines): the 4 digest cells and the L10 source cell kept; the 12 `proposals …` cells → `C432-NO-PROPOSAL-CLI` |
| test `knowledge-local/src/grants/__tests__/operations.test.ts` | 698 | `38b78c764` (432-18) | — | 25 cells: lease and egress claims → `C432-GRANTS-UNREAD-WRITER-ABSENT` on the direct writers |

#### Routes, commands and options deleted

| Surface | Deleting commit | Now | Cell |
|---|---|---|---|
| `POST /api/run-confirm/answer`, `GET /api/run-confirm/channel` (the last two routes of the 430 chat router) | `18fb76a0a` (432-14) | the router's generic 404 | `C432-CONFIRM-ROUTES-404`; `A07`, `A08`; 430 leg R07 re-aimed |
| `agent-qa proposals` with `list`, `show`, `accept`, `reject` and `grants list \| revoke` | `54edac799` (432-17) | unknown command; no alias (D-02) | `C432-NO-PROPOSAL-CLI`, `A44` |
| `agent-qa run --trust-session` | `fb8ba05eb` (432-13) | Commander's "unknown option" | `A64` (the rebuilt binary's `run --help`) |
| `knowledge rollback`'s y/N and `--yes`; `knowledge purge`'s repeated-id `--confirm`; `cache purge`'s y/N and `--force` | `70e2fe9ba` (432-15) | running the command is the intent | `A04`, `A05`, `A06`; `432-maintenance-direct.test.ts`, `432-cache-direct.test.ts` |
| `run`'s TTY confirm, `createTtyConfirmPort` (`fn`, `ask`, `runs mark`), CLI chat's `[y/a/N]` (`createChatConfirmPort`) | `fb8ba05eb` (432-13: unread), `ce1822027` (432-16: deleted) | no prompt | `A01`, `A02`, `A03`; `C432-NO-APPROVAL-PROMPTS` |
| CLI chat's `/pin` directive | `fb8ba05eb` (432-13) | an unhandled clause | `A67` |

#### Operations and MCP tools deleted or renamed

| Before | After | Commit | Cell |
|---|---|---|---|
| `proposals.list`, `proposals.show`, `proposals.accept`, `proposals.reject`, `knowledge.proposal.apply`, `config.proposal.apply`, `config.undo.propose` | deleted; `UnknownFunctionError` on every door | `54edac799` (432-17) | `A25`-`A31`, `C432-NO-PROPOSAL-OPS` |
| `grants.list`, `grants.revoke` | deleted (registry 46 → 44) | `38b78c764` (432-18) | `A18`, `A19`, `C432-NO-GRANT-OPS` |
| `knowledge.accept.propose`, `knowledge.reject.propose`, `knowledge.forget.propose` | `knowledge.accept`, `knowledge.reject`, `knowledge.forget`, applied in the call; no old-id alias | `8310bdbad` (432-12) | `A32`-`A34`, `C432-KNOWLEDGE-CHANGE-OPS` |
| `agent_qa_propose_knowledge_change`, `agent_qa_propose_config_change` | `agent_qa_change_knowledge`, `agent_qa_change_config` | `8310bdbad` (432-12) | `A35`, `A37`, `C432-MCP-TWENTY-TOOLS` |
| `agent_qa_apply_proposal`, `agent_qa_apply_config_proposal`, `agent_qa_list_proposals`, `agent_qa_show_proposal`; the apply confirmation round (`confirmed: true`, the elicitation) | deleted: 24 → 20 tools | `8310bdbad` (432-12) | `A36`, `A38`-`A40`, `C432-MCP-NO-ELICITATION`, `C432-TOKENLESS-CATALOG` |

Registry 53 → 44 ops (seven left with 432-17, two with 432-18); MCP 24 → 20 tools (30 ops
projected behind them, 14 unprojected); golden ledger 53 → 44 rows; capability catalogue 62 → 52
rows, 33 migration entries (the 432-45 regenerations found no diff).

#### Config keys deleted

| Key | Commit | A config still holding it | Cell |
|---|---|---|---|
| `safety` (with `trustMode`) | `0bbd409b5` (432-22) | fails with the normal strict "unrecognized key" error; no `retired-keys.ts` message (D-22) | `A65`, `C432-OLD-KEYS-STRICT` |
| `services.mcp.tokens` | `0bbd409b5` (432-22) | the same | `A59`, `C432-OLD-KEYS-STRICT` |
| `services.mcp.stdio` (with `grantConfigWrite`) | `0bbd409b5` (432-22) | the same | `A63` |
| `services.dashboard.runServiceTokens` | `0bbd409b5` (432-22) | the same | `A61` |

The strict schema has 92 leaves and the config page 88 writable controls after the removal
(`C432-CONFIG-LEAVES-92`, `C432-CONFIG-WRITABLE-88`; mutation legs B09, B10). One key was added:
top-level `allowProduction` (432-02, `03c7c6bc4`), with its masking-map leaf.

#### Members removed from kept containers

| Member | Container (kept) | Hits all (baseline → closing) | Hits prod (baseline → closing) | Commit | Cell |
|---|---|---|---|---|---|
| `requiresHumanOrigin` | `FunctionMetadata` / `FunctionSpec` / `FunctionDeclaration` (`agent/src/functions/spec.ts`) | 65/37 → 51/27 | 31/17 → 7/6 | optional `50045b34c` (432-20), deleted `06798dccc` (432-39) | `A45`, `C432-DECLARATION-KEYS` |
| `requiredScopes` | the same | 255/123 → 93/46 | 81/66 → 6/6 | `50045b34c`, `0dc867e58`..`91bae8521` (432-23..27), `06798dccc` | `A53` |
| `grantedScopes`, `safeMode`, `credential`, `sessionId` | `FunctionCaller` (`schema/src/functions/function-caller.ts`), now `surface` and `origin` | `grantedScopes` 206/123 → 114/70; `safeMode` 151/117 → 97/65 | `grantedScopes` 25/11 → 2/2; `safeMode` 14/9 → 4/3 | `50045b34c`, the 432-28..38 fixture sweeps, `06798dccc` | `A54`-`A57` |
| the scope check in `invokeFunction`, MCP's per-tool hiding | `invoke.ts`, the MCP server factory | `visibleToCaller` 41/15 → 16/11 | 20/8 → 6/4 | `50045b34c` (432-20) | `C432-ALL-OPS-AVAILABLE`, `C432-TOKENLESS-CATALOG`; 396 visibility V1/V2/V5 |
| the MCP bearer check, the run-service `verifyBearer` and the caller credential | `cli/src/commands/mcp.ts`, `dashboard-server/src/run-service/run-service-routes.ts` | — | — | `4e3c9760b` (432-21) | `A60`, `A62`, `C432-TOKENLESS-MCP-MARK` |
| `requiresFailClosed` | `safety/src/policy/execution-context.ts` (the detector stays) | 20/15 → 14/9 | 7/6 → 1/1 | `39c0316cc` (432-19) | `A66` |
| `HARD_DESTRUCTIVE_PATTERNS` and the command-token soft match | `safety/src/policy/lexicon.ts` | 2/1 → 0/0 | 2/1 → 0/0 | `39c0316cc` (432-19) | `A75` |
| `appendExecutionAudit` and the `execution_audit.jsonl` path | `JsonlAuditSink` (`safety-local/src/jsonl-audit-sink.ts`), now the guardrail append only | 139/113 → 6/5 | 9/6 → 0/0 | `39c0316cc` (432-19) | `A76`, `C432-AUDIT-UNREAD` |
| `ExecutionAuditRow` | `AuditSink` (`safety/src/ports/audit-sink.ts`) | 94/27 → 14/7 | 11/4 → 0/0 | `39c0316cc` (432-19) | `A77` |
| the remedy output branches | `cli/src/commands/receipt-line.ts`; `DenialBlock` (`dashboard-ui/.../denial-block.tsx`, emptied by 430-04) | `GATE_REMEDY_SURFACES` 25/7 → 3/2 | 9/4 → 0/0 | `39c0316cc` (432-19) | `A73`, `A74`, `C432-REMEDY-TYPES-ABSENT` |
| the product git commit (`applyConfigProposalAsOneCommit`, `applyTestDraftAsOneCommit`, the human-first preserve commit, the `Agent-QA-Proposal:` trailer, the commit-author map, `createConfigUndoSourcePort`, the dirty-tree and git-unavailable refusals) | `cli/src/composition/local-agent-host.ts` | `applyTestDraftAsOneCommit` 36/3 → 4/2 | 6/2 → 0/0 | `ce1822027` (432-16) | `A78`, `C432-NO-GIT-COMMIT` |
| `confirmScope`, `AgentHost.confirms`, `enterRunTriggerScope`, the `awaiting-approval` state, the dashboard posture machinery (`askingSessionOf`, `postureFor`, `watchedAndInFlight`, `reachableFor`, `postureOf`) | `dashboard-server`, `dashboard-ui`, `cli/src/commands/dashboard.ts` | `RunConfirmHost` 10/5 → 0/0 | — | `18fb76a0a` (432-14) | `C432-NO-APPROVAL-DIALOG`; 430 leg R08 re-aimed |
| `RiskActionDescriptor.command`/`.disclosure`, `confirmPausedMs` and the live-pause seam, `MarkDeniedError`/`MarkRefusalSchema`, per-op `disclose`/`discloses`, `TRUST_SCOPE_KEYS`/`TrustScopeKey`, the `proposals` and `grants` taxonomy rows | schema, runner, cli, dashboard-ui, agent | `confirmPausedMs` 33/14 → 8/4 | 13/6 → 1/1 | `c916d4c2e` (432-42) | `C432-LEFTOVERS-UNREAD`, `C432-RUNTIME-SETS` |
| the `propose-only` refusal in `applyReview`'s mark and policy arms; `local-headless` mapped to `drain-to-active` | `knowledge-local/src/review/apply-review.ts`, `curator/author-contract.ts` | — | — | `144a5dcdf` (432-06), `ca5983da5` (432-01) | `C432-EXPLICIT-ALL-CONTEXTS` (B04), `C432-CURATION-CONTEXT` (B05) |

The remaining closing hits are dated comments, absence assertions and the smuggled witnesses the
census counts as retained (a legacy caller field cast past the type to prove nothing reads it).
`HARD_NAME_VERBS` (2/1 prod at both ends) is not a deleted member: it is the risk classifier's name
signal, kept because eval scoring reads the tiers it feeds (D-15/D-16). `SOFT_DESTRUCTIVE_VERBS` is
retained on the same footing: `matchLexicon` still reads it as a name signal and it still drives the
`destructive` tier. Only its match over command tokens was deleted (2026-10-03, quick-261003-tsr
IN-34).

#### Claim transfers in the mutation scripts (old label → current cell)

No script was deleted or turned into a success-only stub. The per-driver tables with leg counts
are in `432-44-SUMMARY.md` and `432-45-SUMMARY.md`; the labels the mutation map asked this register
to record are:

- **430 R12-R15** (`c9991fbd0`): R12/R13 `C430-REMEDY-MEMBERSHIPS-EXACT` + `C430-DASHBOARD-PROJECTION-EMPTY`
  → `C432-430-R12-ANSWER-CONFIRM-ABSENT` / `C432-430-R13-SESSION-PIN-ABSENT`; R14 `DENIAL-REASON-ONLY`
  → `C432-430-R14-REASON-ONLY` (the old cell stays, an allowed co-red); R15 "no source or test spells
  the dashboard remedy text table" → `C432-430-R15-REMEDY-TABLE-ABSENT` (the old cell stays). R06/R08
  → `C430-CHAT-ROUTE-TABLE-EXACT` in its absence form; R07 → `C430-DELETED-CHAT-ROUTES-SHARED-404` ×5;
  R10 → "(5) no rostered door supplies a minting surface".
- **395-grant-two-sided** (`c9991fbd0`): G0 retired; MINT → G1 `C432-RETURN-A20` + G5
  config-grant-enforcement; READ → G2 `A21`, G3 `A18`, G6 `C432-NO-GRANT-OPS`; revoke → G4 `A19`.
- **396-06-credential**: C4 apply-refusal teach → `A36`; C5 declared-token seed → env seed; new C6
  `A59`, C7 `A60`, C8 `A56`.
- **399-1-fail-closed**: U/V kept (they plant into `classify.ts`, never `gate.ts`); new W1 → `A66`,
  X1 → masked-serialization X5.
- **399.1-render**: H1-H4 unchanged; new R1-R4 → `A69`-`A72`, R5 `A73`, R6 `A74`, P1
  `C432-PLAIN-REFUSAL`, P2 the refusal-line hygiene cells.
- **394-apply** M/N1/N2 → the dirty-tree and no-commit cells, new N3 `A78`; **394-apply-rollback**
  W/V/N/T/P → W1, W2, T1; **394-refinement** proposal refinement → S1/S2 `C432-TEST-REFINE-WRITTEN`;
  **395-apply-bytecompare** A1-A5 → the direct config writer's digest, no-commit, dirty-scan,
  partial-write and freshness cells.
- **429 UI** U42 `ADD-MCP-TOKEN-KEEPS-EVERY-SCOPE` → `C432-NO-TOKEN-CONTROLS`; **429 contract** C03,
  C19, C26, C37 re-spelled with measured co-reds (`0f709400c`).
- **396-visibility** (`5004782b1`): W1 "the config tools are ABSENT" → V1 "1 · a read-only caller
  sees the config tool" and V5 "4 · a config-write-only grant and a read-only grant list the same
  tools"; W2 → V2 "3 · serves a config op to a caller without the scope, with no scope refusal";
  K1 → V4 "9 · the masker the COMMAND composes hides the environment secret it was seeded with";
  K2 → V3 "9 · serves an undeclared legacy bearer like none and NEVER echoes it"; new V6 `A58`.
- **396-resources** R3 → `C432-RESOURCES-ALL-CALLERS`, new R8; **396-06** A1-A4 →
  `C432-MCP-DIRECT-RECEIPT`, `C432-MCP-NO-ELICITATION`, `C432-DELETED-SYMBOLS`; **396-mapping** M3 →
  `MCP-OPS-EXACT` over the feedback reads, new M5/M6 `C432-MCP-TWENTY-TOOLS`, M7 `A37`.
- **397-parity**: "pins the config-write listing delta…" → `C432-TOKENLESS-CATALOG: pins an EMPTY
  listing delta…`; "refuses at the GATE WALL… naming the one withheld grant" →
  `C432-ALL-OPS-AVAILABLE…`; "diverges… on exactly the human-origin capabilities" →
  `C432-NO-GRANT-OPS…`; "reaches the ask…" → "dispatches every ask-capable capability directly…";
  leg B `proposals.list` → `config.get`. **398-catalog**: new leg G → `C432-CATALOG-CURRENT`.

In-file re-spellings (a cell whose subject was deleted becomes an absence cell under its own title,
or a re-titled cell with a dated note citing the old title) are tabulated per plan in each
`432-NN-SUMMARY.md` "claim transfer" table. The coverage ledger missed co-owned files six times
(deferred 432-15 #1, 432-16 #4, 432-18 #4, 432-22 #1, 432-24 #2, 432-25 #2); each was re-spelled in
place by the plan that turned it, with its claim table in that plan's summary. No test assertion
was deleted without its claim carried.

### What was RETAINED, and why

| Item | Where (at `0721f61f0`) | Why kept | What pins it |
|---|---|---|---|
| production as a config declaration: `TargetSchema.environment` gains `production`, top-level `allowProduction: true` | `core/src/schema/registry-schema.ts`, `schema/src/config/production.ts`, the run core's pre-assembly check (`agent-local/src/composition/run-invocation-core.ts`) | law 4's audited boundary, met by an explicit refusal naming the target and the line to add (D-17/D-18); never a prompt, flag or grant | `C432-PRODUCTION-BEFORE-EFFECTS` (B01), `C432-MIXED-SUITE-PRODUCTION` (B02), `C432-EDITOR-PRODUCTION` (B03), `C432-DOOR-NONPRODUCTION` |
| `ExecutionContext` and its detector | `safety/src/policy/execution-context.ts`, safety-local | a durable field on handoffs, bus events, deltas, bundles and run DTOs; D-08's CI switch reads it | `C432-EXECUTION-CONTEXT-RETAINED`, `C432-CURATION-CONTEXT` (B05) |
| `classifyRisk`, `TIER_ORDER` and the name verbs | `safety/src/policy/` | eval scoring uses the tiers (`eval/src/match/risk.ts`) | `C432-EVAL-RISK-PARITY` |
| the guardrail audit: `AuditSink`, `JsonlAuditSink.appendGuardrailAudit`, `guardrail_audit.jsonl` | `safety/src/ports/audit-sink.ts`, `safety-local/src/jsonl-audit-sink.ts` | masking and egress are unchanged and their rows are still written | `C432-GUARDRAIL-AUDIT-RETAINED` (B16), `C432-RETAINED-SAFETY` |
| `registerFirstPartySafetyHooks`' masking and guardrail middleware | `safety/src/hooks/first-party.ts`, `model/src/registry.ts:59` | masking before guardrail, pinned by `validate:safety` | `validate:safety` (9 cells), `C432-RETAINED-SAFETY` |
| loopback binding, the dashboard's cross-site refusal, MCP's Host and Origin guards, the live-view link token | `dashboard-server/src/server/cross-site.ts`, `cli/src/commands/mcp.ts`, the run-service live link | they stop other machines and websites, and nobody configures them (D-13) | `C432-RETAINED-HOST` (B12), `-ORIGIN` (B13), `-CROSS-SITE` (B14), `-LIVE-LINK` (B15); `C432-RUN-ROUTES-CROSS-SITE` |
| the historical `approval_decision` reader | `schema/src/chat/session-events.ts` (the kind, `ChatApprovalDecisionEvent` and its exact key set) | the session guard throws on an unknown kind, so a pre-432 session file must keep parsing (430 D-08, D-22); no writer remains | `C432-HISTORICAL-READER`, `C432-LEFTOVERS-UNREAD` |
| the dashboard config Undo (429 D-24) | `dashboard-server/src/config/undo-store.ts` | it is not an approval | 429's own cells |
| `knowledge rollback` (without its prompt), `knowledge purge`, `cache purge` | `cli/src/commands/knowledge-maintain.ts`, `cache.ts` | maintenance commands; running one is the intent (D-14) | `432-maintenance-direct.test.ts`, `432-cache-direct.test.ts` |
| `FunctionRegistry.list(caller)`'s unread argument | `agent/src/functions/registry.ts` | dropping it touches 159 call sites and changes no behaviour (432-42, dated rationale) | `C432-TOKENLESS-CATALOG` and `C432-ALL-OPS-AVAILABLE` red any per-caller filter |
| `ToolProjectionKind`'s `'apply'` | `mcp/src/mapping.ts` | a published MCP value pinned by three bump-guard assertions; the mark door applies its fix in the call (432-42) | `mapping-bump-guard.test.ts` |
| the `env-var-name` masking class | `schema/src/config/masking.ts` | a shared display vocabulary and a reference kind; it gates nothing (432-42) | `C432-RUNTIME-SETS` |
| the forget receipt's field name `proposalId` (`prop_<operationId>`, `schemaVersion: 1`) | `knowledge.forget`'s `forgetReceipt` | **decided 2026-10-02 (orchestrator, 432-42 #2):** a persisted, versioned receipt; renaming it needs a schema bump, a dual reader and a public contract change at phase end, more risk than value. The id is the forget operation's receipt id and names no filed proposal | the door matrix's operations cell (no proposal store; this field excluded from the wording check with a dated note) |
| the `policyPoints` column of the conformance scenario table | `cli/src/__tests__/conformance/scenario-table.ts` | test-only; every value is the direct claim and it feeds retained cells (432-42) | `C432-REGISTRY-GOLDEN`, `C432-ALL-OPS-AVAILABLE` |

### What degrades, stated plainly

- **Nothing asks, so nothing stops a mistaken run, mark or change before it applies.** Production
  is the one refusal, and only for a target declared `environment: production`. An undeclared,
  `local` or `shared` target runs in the call on every door, CI included.
- **There is no Undo and no person/agent label** (D-09, D-10). Wrong knowledge is overridden by a
  later mark or by the knowledge change tool's forget arm; files are reverted with git. Nothing
  records who asked for a change beyond what records already stored (`originClass`, mark receipts).
- **agent-qa makes no git commits** (D-07). Config changes, test edits and new tests are plain
  uncommitted edits; `git status` and `git diff` show them.
- **Anything that can reach the local endpoints can call every operation** (D-12). The loopback
  bind, the Host/Origin guards and the cross-site refusal are what stand between a website or
  another machine and the doors. A hosted or team version needs front-door authentication first
  (forward note in REQUIREMENTS).
- **Old configs that carry a removed key stop parsing** with the normal strict error. There is no
  migration, alias or first-run notice (D-02, D-22).
- **Background curation now replaces and retires knowledge on this machine without a person** (D-08);
  CI and cloud still record those changes as proposed.

### Persisted values the narrowed contract governs

| Persisted value | Disposition | Evidence |
|---|---|---|
| `agent-qa-knowledge/grants.jsonl` | **Left untouched and never read (D-22).** No reader, writer or init probe remains (the probe that kept it git-visible went in 432-18). A malformed or unreadable ledger changes no answer and stays byte- and mode-identical. | `C432-GRANTS-UNREAD-WRITER-ABSENT`, `C432-LEFTOVERS-UNREAD` (source and runtime halves); legs `A20`, `A21` |
| `.agent-qa/proposals/*.json` (pending knowledge, config and test-draft proposals, pre-432 gate-inconsistency files) | **Left untouched and never read (D-22).** No op, verb or view opens the directory; a pre-432 proposal id answers `UnknownFunctionError`; an unreadable inbox changes nothing. The test planters `pre-432-config-proposal.ts` and `pre-432-knowledge-proposal.ts` write legacy bytes only to prove they stay unread. | `C432-PROPOSAL-FILES-UNREAD`, `C432-LEFTOVERS-UNREAD`; legs `A41`-`A43` |
| old `execution_audit.jsonl` files | **Left untouched and never read (D-17, D-22).** Nothing writes or reads the file. | `C432-AUDIT-UNREAD`, `C432-LEFTOVERS-UNREAD`; legs `A76`, `A77` |
| `approval_decision` events in `.agent-qa/sessions/chat-*.jsonl` | **Reader-only, retained (D-22).** The kind and its key set stay so pre-432 sessions parse; no build writes one. | `C432-HISTORICAL-READER` |
| `guardrail_audit.jsonl` | **Actively retained.** Masking and egress guardrail rows are still appended. | `C432-GUARDRAIL-AUDIT-RETAINED` (leg B16) |
| config keys `safety.trustMode`, `services.mcp.tokens`, `services.mcp.stdio.grantConfigWrite`, `services.dashboard.runServiceTokens` | **Refused** with the normal strict unrecognized-key error; no message added. | `C432-OLD-KEYS-STRICT`; legs `A59`, `A61`, `A63`, `A65` |
| persisted `origin.surface: 'dashboard'` on old proposal records | **Never read again**, with the rest of the proposal store (432-17). See the correction below. | `C432-PROPOSAL-FILES-UNREAD` |

The live `demo/init/agent-qa.config.yaml` lost its `services.mcp.tokens` block in the
super-repository (`fde2c636`, 432-22, the owner's 2026-10-01 decision), so the CLI tests that read
it keep parsing.

### Correction to the 2026-09-28 attribution row (430-REVIEW WR-01)

The 2026-09-28 row "Persisted `'dashboard'` surface values" says persisted `origin.surface:
'dashboard'` values "were minted only by dashboard-chat config proposals". 430-REVIEW WR-01 showed
that is incomplete: the dashboard's co-hosted MCP endpoint served the same composition's registry,
so config proposals minted over it before 430 carried `'dashboard'` too, and after 430 they carried
no surface and were committed as `agent-qa (proposed by an unrecorded surface)`. Phase 432 closes
WR-01 by deletion: 432-16 (`ce1822027`) deleted the commit and the author map, so a config change
from any door, the co-hosted endpoint included, writes the file and commits nothing, and 432-17
(`54edac799`) deleted the proposal store, so no old record is read or attributed. The stale test
comment was corrected in 432-16 (`proposal-author-attribution.test.ts` header). The old row is
kept as written, with a dated pointer here; REQUIREMENTS note 92(d) carries the same correction.

### The instruments that notice a return

- **`pnpm validate:arch`**: the 432 census beside the 430 census and the earlier ones. It runs in
  the workspace's `turbo test` (after the core and CLI builds, `turbo.json`, 432-42), so a returning
  member, route, op id, tool name, config key or prompt literal reds by name on the commit that
  adds it.
- **The prompt census, the door matrix, the stdio, no-git and runtime-set cells** run in the
  ordinary package suites.
- **`pnpm run validate:432-approval-permission-mutation`** and its **`-selftest`**: the bar that
  proves the census and the retained-behaviour cells are not decoration. Like every
  `validate:*-mutation` script, neither is in CI; both are phase-gate instruments run by hand.

### Not observed, stated as such

- **Live lanes.** `395-live-from-zero.sh`, `demo/init/scripts/drain-394-loop.sh` and the 413
  campaign were edited statically and not run (a real model, devices, writes under `demo/init`);
  `bash -n` and `C432-LIVE-CALLERS` (16/16) cover their syntax and rung 1. Unobserved, for 433.
- **A real coding-agent session** over MCP stdio/HTTP, a real dashboard click-through and a
  device/model/container-backed editor run were not performed; the deterministic fixtures above
  stand in for them and are not claimed as live observations.
- **`agent-qa-miniwob-bench`** is the owner's separate repository: untracked in the super-repository
  (`?? agent-qa-miniwob-bench/`), with its own `.git` and no commits. 432-41's two-line edit to
  `src/agent_qa_miniwob_bench/product.py` (`--trust-session` removed from `describe()`'s flags and
  from `run_goal`'s argv) is still in its working tree, uncommitted and unreviewed; the original is
  in the 432-41 session scratchpad. It is disclosed here and is not part of any agent-qa commit.
- **The 399 runbook gate** (`demo/acceptance/399/399-runbook-gate.sh`) is red at rest: its
  `RUNBOOK.md` names ops 432 deleted (deferred 432-44 #2; the owner's 399 history).

### Reconciliation

The planning record carries this phase's dated notes in `.planning/REQUIREMENTS.md` § "Phase 432
reconciliation (2026-10-02)", notes 106 onward: the per-decision notes (D-06, D-08, D-09, D-10,
D-12/D-13, D-16, D-17, D-21, D-22), law 4, the forward notes for M6, M7, MC and the hosted
version, the WR-01 correction to note 92(d), and the WINDOWS and todo dispositions.
`.planning/WINDOWS.md` carries the matching `RECONCILIATION-432` block (#130 and #134 fixed, #194
and #217 closed by deletion), `.planning/PROJECT.md` retires the v43 approvals constraint and
corrects the v56 PXH-SAFE bullets, and
`.planning/phases/432-approval-gate-removal-provenance-and-undo/432-ACCEPTANCE.md` records the
final-tree gate. The spec files stay read-only.

### Gate at the time of writing (2026-10-02)

Run on 2026-10-02 from `agent-qa/` on `b24502885` (this section's first commit: `0721f61f0` plus
`DELETION-INVENTORY.md` alone, which no test reads), by 432-46. `git status --porcelain` was empty
before the first command and after the last. Exit codes are the process's own, read from `$?`.
The commit that adds this subsection changes only this file.

| # | Command | Observed | Exit |
|---|---|---|---|
| 1 | `pnpm build` | 22 successful, 22 total (cached) | **0** |
| 2 | `pnpm --filter @vostride/agent-qa-arch exec vitest run src/__tests__/432-approval-permission-deleted.test.ts --maxWorkers=1` (task 1 verify, after row 1) | Test Files 1 passed (1) · Tests 100 passed (100) | **0** · 2 s |
| 3 | `pnpm build && pnpm test --force --concurrency=4 && pnpm typecheck --force && pnpm run validate:arch && pnpm run validate:safety`, run 1 (10:18:26Z, 1-minute load 2.9 at launch, 42.6 at the end) | build 22/22 cached; tests 45/46 tasks, 0 cached: the CLI package failed 6 cells, all with the zoom probe's own `The isolated extension found no fixture tab` (`425-header-layout-dom` ×3, `evidence-layout-dom` ×3), 4564 passed, 18 skipped; every other package as in 432-45 | **1** · 479 s |
| 4 | `pnpm --filter agent-qa exec vitest run src/__tests__/conformance/425-header-layout-dom.test.ts src/__tests__/conformance/evidence-layout-dom.test.ts --maxWorkers=1` | Test Files 2 passed (2) · Tests 9 passed (9) | **0** · 18 s |
| 5 | row 3's command, run 2 (10:28:07Z to 10:36:44Z, load 9.3 at launch) | build 22/22 cached; tests **46/46 tasks, 0 cached, 7m43.0s**; typecheck **44/44, 0 cached, 43.3 s**; `validate:arch` 12 files, 412 passed (the 432 census's 100 among them); `validate:safety` 1 file, 9 passed, no type errors | **0** · 517 s |
| 6 | `pnpm build && pnpm typecheck` (task 2 verify) | 22/22 and 44/44, both cached on the tree row 5 built and type-checked uncached | **0** |
| 7 | `pnpm build && pnpm --filter @vostride/agent-qa-mcp exec vitest run src/__tests__/431-output-contract-wire.test.ts src/__tests__/projection-fidelity.test.ts --maxWorkers=1 && pnpm typecheck` (the surviving 431 anchor) | Test Files 2 passed (2) · Tests 27 passed (27) | **0** · 5 s |
| 8 | `pnpm run validate:skills` | `agent-qa skills pack validation passed` | **0** |
| 9 | `pnpm run validate:publish` | `publish surface validation passed (full)` | **0** · 15 s |

Per package in row 5: ids 9; schema 2005; safety 281; safety-local 31; model 237; runner 1406 (+1
skipped); runner-local 168; eval 1427; eval-local 1011; core 705; agent 2093; agent-local 636 (+2
skipped); knowledge-local 1898 (+3 skipped); mcp 418; analytics 93; embedding-bench 112; android
104; ios 97; web 268; dashboard 1474 (+1 skipped); dashboard-ui 2734; arch 547; cli 4570 (+18
skipped), 310 files. Every count equals 432-45's on `0721f61f0`.

**Row 3 is recorded, not explained away.** The six cells are the Chromium layout cells already on
the load-sensitive list (deferred 432-08 #5, 432-21 #7): the isolated extension's service worker
does not yet see the tab the test opened. They passed alone (row 4) and in row 5, on the same tree.
No cell was loosened and no timeout raised.

**Cited, not re-run here.** The mutation gates ran green in the plans that own them, on earlier
trees, and are not claimed on `b24502885`: `validate:432-approval-permission-mutation` and its
selftest (432-43, `bc3260240`), the 394/395/396-06/399/426/429/430 drivers (432-44, `c9991fbd0` and
`0f709400c`), the 396/397/398/423/427 drivers, `validate:agents`, `validate:tools` and
`validate:431-discovery-imports` (432-45, `0721f61f0`). The only commit after `0721f61f0` before
row 5 is this section's first commit, which changes this file alone.

**Toolchain:** node 24.15.0 · pnpm 10.6.1 · vitest 4.1.5 · turbo 2.9.7.

## 2026-10-07 — Phase 436: harness action outcomes (HARN-01..04, D-15..D-18)

This section appends to the register and rewrites no earlier section. Phase 436 removed the generic
screen-change machinery: nothing in the runner decides success, failure, progress, a stagnation
strike, a cycle or a retry from a screen hash or a visible-content comparison any more, and the
step budget no longer refills. In their place are two monotonic per-step limits (`maxActions`,
`maxPlanningTurns`, 30 each) with a typed limit stop, and operation-specific evidence (Chromium
downloads, app clipboard writes, scroll movement signals). It kept the hashes' other jobs, settle,
screenshots and every reader of persisted history. The section follows the 2026-10-02 shape.
Dated 2026-10-07, the day the deletions landed; written by 436-13 on 2026-10-08.

### The ruling

> remove generic screen-hash/pixel-change success, failure, stagnation, cycle and retry decisions.

The owner's 2026-10-01 action-outcomes decision, verbatim from `spec/v2/browser-and-mobile-automation.md`,
specified as HARN-01..04 in `spec/v2/harness-action-outcomes.md` (moved from M6 to v2 readiness on
2026-10-05). Reconciliation 4 in `.planning/REQUIREMENTS.md` makes the old refilling key a hard cut,
consistent with V2-START-04: no alias, migration or fallback. The defaults, the router mapping and
the remaining calls were delegated ("you decide", "please decide fast") and are recorded as D-01..D-30
in `.planning/phases/436-harness-action-outcomes/436-CONTEXT.md`. D-18 sets this bar: runtime key
sets beside every narrowed type, a census cell per removed member, a persisted-values statement and
this section, with no mutation driver.

### How this inventory is measured

| Instrument | What it claims | Where |
|---|---|---|
| the census | `C436-RETURN-01`..`59`: one named cell per removed member, each scanning its member's own region (the runner loop's production source, the scroll compound and the three adapters, the agent router, the core schema objects, the masking map, the dashboard-ui source, the init scaffold) through the 432 census's lexer, which blanks comments and keeps strings, templates and regex literals. Files are read as bytes, because the scroll code once joined identities with control characters. Every needle is two halves joined at run time, and positive controls (the new keys, the new Rule 22, the meter's debits) keep each region from going stale. `C436-RETURN-CONFIG` parses a control config through the rebuilt public `AgentQaConfigSchema` (`packages/core/dist/index.js`) in an isolated Node process: the new pair parses, the old key is refused with the one plain message and nothing else. `C436-NO-IMAGE-DIFF`: no image-difference package in runner, web, android, ios or core, and no screenshot-buffer comparison in the loop. `C436-SELF-MATCH`, `C436-PLANTED-POSITIVE`, `C436-LEXER-CONTROL`, `C436-UNIVERSE-FLOORS`. 65 cells, in `validate:arch`. | `packages/arch/src/__tests__/436-harness-progress-deleted.test.ts` (436-13 `d833987b9`) |
| the runtime key sets | `C436-KEY-SETS`: hand-spelled sorted sets for the limit stop, the per-step usage, the planner limits and their 30/30 default, the run limits record (`perTest`) and the acknowledgement's `limits`, the download, clipboard and capture-availability evidence, the handoff schema version (7, unchanged), the bus projection still dropping `localEffect`; `PlannerConfigSchema` and the project and override planner keys; the written and read-only scroll outcomes; and compile-checked exact members of `PlannerConfig`, `StepContext` (`@ts-expect-error` on both removed members), `StepEvidence` and `SubActionEvidence`. 16 cells. | `packages/schema/src/__tests__/436-runtime-key-sets.test.ts`, `packages/core/src/__tests__/436-runtime-key-sets.test.ts`, `packages/runner/src/loop/__tests__/436-runtime-key-sets.test.ts`, `436-narrowed-types.test-d.ts` (436-13 `601ac1f45`) |
| the pre-change pins | `C436-PRE-CHANGE-HANDOFF` (a real handoff captured at `5e3e932a2` with `localEffect`, `stagnation` and `cycle` blocks still loads, and its 13 recomputed `screenStateHash` and decision digests are unchanged), `C436-CACHE-IDENTITY` (three cache keys byte-identical, no new hit for a different screen, screenshot refs and their sha), `C436-MODEL-CALLS` (planner and verifier calls per action do not increase). Values in `436-RECORD.md` § Before-values. | 436-01 `21de7fcc9`, `bf4cdec38` |
| the behaviour cells | Every C436 cell from 436-01 to 436-13, and the `436 D-NN` cells in existing files, by name in the 434 gate's regression list (below). | `scripts/gate/inputs/regressions.json` |

**This file names retired tokens literally**, as the 2026-09-02 section explains for the whole
register. `DELETION-INVENTORY.md` sits outside every census region; inside them, removed names are
spelled as two halves, so the census cannot satisfy its own inventory.

### What was deleted

Baseline `5e3e932a2d586f89c805a385483da1800b941fff` (434's certified tree, the parent of 436's first
agent-qa commit `21de7fcc9`). Code-closing HEAD `a2ab1651f` (`version-0.2`), the last commit before
this section. `git diff --shortstat 5e3e932a2..a2ab1651f`: 161 files changed, 11,038 insertions,
2,841 deletions; 12 files deleted, all under `packages/runner/src/loop/`.

- **The progress module** `runner/src/loop/progress/` (`index.ts`, `oracle.ts`, `classifier.ts`,
  `revisitation.ts`, `stagnation-tree.ts`; 436-03 `6a439fbe8`) and every export:
  `evaluateLocalEffect`, `toLocalEffectEvidence`, `EvaluateLocalEffectInput`, `LocalEffectResult`,
  `LocalEffectOracle`, `EffectAnchor`; `classifyStagnation`, `OBSTRUCTION_ROLES`, `LOADING_ROLES`,
  `ClassifyStagnationInput`, `StagnationAnchor`, `StagnationClass`; `StagnationTree`, `buildAnchorKey`,
  `DEFAULT_STAGNATION_CLASS_BOUND`, `DEFAULT_STAGNATION_ANCHOR_BOUND`, `StagnationAnchorIdentity`,
  `RecordNoEffectResult`, `StagnationSnapshotEntry`, `StagnationTreeOptions`; `RevisitationWindow`,
  `buildRevisitationKey`, `DEFAULT_REVISITATION_WINDOW`, `RevisitationRecord`, `RevisitationResult`,
  `RevisitationWindowOptions`. Census `C436-RETURN-01`..`27`.
- **The loop's progress state and helpers** (`index.ts`): `revisitation`, `stagnationTree`,
  `progressCarry`, `cycleBreakServed`, `cycleBreakAt`, `settledStable`; `deriveEffectAnchor`,
  `TAP_CLASS_VERBS`, `toStagnationEvidence`, `carriesMintOrAssertionMeta`; the differential effect
  check, the cycle-fail and stagnation-fail return paths, the transient-load settle re-arm and the
  remaining-budget refill (`remaining = maxSubActions`). The per-step `StepLimitMeter` replaced the
  cap (436-04 `bef4df76a`); it is built once per step and only counts up. `C436-RETURN-28`..`36`.
- **The recorder's three evidence producers** (`evidence.ts`): `attachLocalEffect`,
  `recordStagnation`, `recordCycle`, with their private fields and the finalize lines that copied
  them. `C436-RETURN-37`..`39`.
- **`StepContext.stagnation` and `StepContext.cycleBreak`** (`types.ts`). `C436-RETURN-40`, `41`.
- **The long-press-for-tap substitution ban** (`planner.ts`): `resolveActionAnchorKey`,
  `bannedSubstitutionMessage`, the pre-grounding check and the `buildAnchorKey` import.
  `C436-RETURN-42`, `43`.
- **The planner prompt's progress text** (`prompts.ts`, 436-03 `da84975cc`, the one byte re-pin
  D-26 allows): `appendStagnationBlock` and `appendCycleBreakBlock` with their two pushes; Rule 3's
  "If you have already scrolled and the screen did not change (you reached the boundary), the
  element is not on this page" sentence; Rule 8's "if an action produced no screen change … try a
  fundamentally different strategy"; the old Rule 22 heading `STAGNATION FOCUS — DO NOT WANDER`
  (Rule 22 is now `OUTCOME EVIDENCE`); Rule 13's blanket "do not retry the same action".
  `C436-RETURN-44`..`49`.
- **The router's two progress signals** (`agent/src/authoring/router.ts`, 436-06 `97c4762e1`):
  `'cycle'` and `'stagnation'` left `ROUTER_MECHANICS_SIGNALS`, and `stepMechanics` no longer pushes
  them. `C436-RETURN-50`, `51`.
- **The old planner key `use.planner.maxSubActions`** in every writer and schema object: core's
  `PlannerConfigSchema`, `UseOverrideSchema.planner` and `agent/types.ts`; runner's `PlannerConfig`
  and its `?? 50` fallback; the CLI's `?? 10` and the init scaffold's `10`; the live editor's `50`;
  the masking map's leaf; the dashboard's `20`, its copy, the planner section and the per-test
  panel (436-04, 436-07 `7d8dc413a`/`219db2c7a`/`cb389260c`, 436-08 `fcbb02f65`/`db66a67b0`). The only
  remaining spelling is the refusal in `core/src/schema/retired-keys.ts`. `C436-RETURN-52`..`56`,
  `C436-RETURN-CONFIG`.
- **The scroll compound's tree-identity comparison** (436-02 `cbb27320d`, `c9bbb308b`):
  `interimTreeIdentity`, the `current === prev` equality decisions and `anyProgress` in
  `scroll-until-visible.ts` and the three adapters' `scrollToEnd` loops, the `'no-change'` writer,
  and the retrying direction helper `runDirectionScrollWithRetry`. Movement is now proven only by
  operation signals (web offsets, Android `scrollGesture`'s boolean, the target becoming visible).
  `C436-RETURN-57`..`59`.
- **Seven test files** that pinned the deleted subsystem: `progress-oracle`, `progress-coverage`,
  `stagnation-classifier`, `stagnation-tree`, `stagnation-ban`, `revisitation`, `cycle-detection`.

### What was RETAINED, and why

| Item | Why kept (D-16, D-17) | What pins it |
|---|---|---|
| the fill re-read compound | operation-specific evidence: the field's own value (tools-and-actions §12.11) | `compound-coverage`, `C436-ACTION-PATHS` |
| toggle `desiredState` idempotency | real toggles keep state-specific behaviour; Phase 437 fixes the Android classifier | `idempotency.test.ts`, `C436-ACTION-PATHS` (the idempotent no-op) |
| the re-ground heal on ref-resolution errors | it follows an actual error, and now debits the action limit | `reground-heal.test.ts`, `C436-ACTION-PATHS` |
| web scroll offsets | the scroll movement signal on web | `C436-SCROLL`, `EXEC-02 scroll movement signals` |
| settle on two equal `screenIdentityHash` values | readiness, separate until TGT-06; it never proves success | `C436-CACHE-IDENTITY` (settle never passes a rejected step), `settle.test.ts` |
| the cache key, including the settled hash as component 8 and `stepIndex: actionIndex` | cache partitioning must not broaden (HARN-04) | `C436-CACHE-IDENTITY` |
| screenshots and visual checkpoints | required visual evidence stays available | `C436-CACHE-IDENTITY` (8 screenshot calls, decision refs and sha) |
| `screenStateHash`, evidence digests and replay identities | integrity and attribution (HARN-04) | `C436-PRE-CHANGE-HANDOFF` |
| the schema types `LocalEffectEvidence`, `StagnationEvidence`, `CycleEvidence` and their members on `SubActionEvidence` and `StepEvidence` | reader-only, so a pre-change handoff still loads (D-17); nothing writes them | `C436-PRE-CHANGE-HANDOFF`, `C436-KEY-SETS` |
| the stability gates' historical `cycle` reader | only pre-change handoffs reach it; a limit-stopped step is also indefinitive | `stability-gates.test.ts`, router corpus rows `historical-cycle`/`historical-stagnation` |
| `readScrollUntilVisibleMeta` reading `'no-change'` and `'cap'` | persisted sub-action metadata from earlier runs must still parse | `C436-KEY-SETS` (`SCROLL_OUTCOMES_READ_ONLY`) |
| `SettleResult.settled` | settle's own result shape; its only reader went with the classifier, and nothing reads it now (comment corrected in 436-13 `a2ab1651f`) | `settle.test.ts` |

### What degrades, stated plainly

- **A dead control ends at `stepFailed` or at a limit, not in stagnation.** The planner prompt asks
  for `stepFailed` naming the missing outcome after the action and one reasonable alternative; a
  planner that keeps trying stops at `maxActions` with `limitStop.requestedOutcome: 'unverified'`.
  No generic stagnation verdict is produced, and the router sends a limit stop to the stop arm
  (`indefinitive-failure`), never to repair.
- **A 50-plus-action bulk step needs configured capacity.** Nothing refills the budget; the default
  is 30 actions and 30 planning turns per step.
- **iOS scrolls report `unresolved` more often.** XCUITest returns no movement or boundary signal
  (`mobile: scroll` discards its BOOL), so a search that did not see its target ends `unresolved`
  after `maxSwipes`, and `toEnd` costs up to the cap.
- **New handoffs are larger and their evidence digests differ.** Every step now records
  `limitUsage`, so `rerunOrigin.evidenceDigest` over a new run's `StepEvidence` differs from a
  pre-change run of the same test. The digest algorithm is unchanged, and digests recomputed over the
  pre-change fixture are identical (436-01's pins).
- **Old configs that spell the old key stop parsing**, with the plain message
  `use.planner.maxSubActions was removed in v2 — it was a refilling iteration count; set
  use.planner.maxActions (default 30) and use.planner.maxPlanningTurns (default 30)`. The same
  message fires for test and suite `use` blocks.
- **Firefox, WebKit, farm and mobile sessions record download and clipboard capture `unavailable`**,
  so a requested download or copy there stays unverified (D-23).

### Persisted values the narrowed contract governs

| Persisted value | Disposition | Evidence |
|---|---|---|
| `SubActionEvidence.localEffect` in existing handoffs and run databases | **Reader-only.** The type stays; nothing writes it; the bus projection drops it; `hash-fallback` verdicts are never reinterpreted. | `C436-PRE-CHANGE-HANDOFF`, `C436-KEY-SETS` |
| `StepEvidence.stagnation`, `StepEvidence.cycle` | **Reader-only.** Old handoffs load; the router reads them as no signal; the stability gates keep their historical `cycle` reader. | `C436-PRE-CHANGE-HANDOFF`, router `436 D-14` cells, `C436-RETURN-50`/`51` |
| `metadata.scrollUntilVisible.outcome` `'no-change'` / `'cap'` | **Reader-only literals.** New runs write `found`, `not-found` or `unresolved` with `endedBy`. | `C436-KEY-SETS`, `C436-RETURN-58` |
| `use.planner.maxSubActions` in configs, tests and suites | **Refused** with the plain message (D-05, reconciliation 4). | `C436-RETURN-CONFIG`, `C436-RETIRED-PLANNER-KEY`, `C436-PLANNER-LIMITS-CONFIG` |
| `test-fixtures/demo-init/agent-qa.config.yaml` | **Re-pinned** to `maxActions: 30` and `maxPlanningTurns: 30` with its `MANIFEST.json` and pinned sha, by a dated note in `436-RECORD.md` (436-07 `219db2c7a`). | `DEMO-INIT-FIXTURE`, `promotion-posture.test.ts` |
| new optional members `StepEvidence.limitStop`, `.limitUsage`, `.operationCapture`, `SubActionEvidence.operationEvidence`, `CompletedRunHandoff.plannerLimits` and the `runs.start` acknowledgement's `limits` | **Written by new runs, optional to readers.** `CURRENT_HANDOFF_SCHEMA_VERSION` stays 7; the loader validates `plannerLimits` the way the strict wire does. No downloaded byte, path or text preview is ever stored (D-20). | `C436-KEY-SETS`, `C436-EFFECTIVE-LIMITS`, `C436-OPERATION-EVIDENCE` |

### The instruments that notice a return

- **`pnpm run validate:arch`** runs the 436 census after the 434 file; it also runs in the
  workspace's `turbo test`, so a returning export, helper, producer, prompt sentence, router signal,
  config key or identity comparison reds by name on the commit that adds it.
- **The runtime key sets** run in the schema, core and runner suites; the runner's `test-d` file runs
  under vitest's typecheck mode, so a removed `StepContext` member that returns fails its
  `@ts-expect-error` line.
- **436-01's pins** (`C436-PRE-CHANGE-HANDOFF`, `C436-CACHE-IDENTITY`, `C436-MODEL-CALLS`) red if
  cache keys, screen hashes, screenshots or model calls per action move.
- **The 434 gate** (`pnpm run gate:local`) must execute and pass every listed 436 cell. No mutation
  driver was added (D-18).

### Not observed, stated as such

- **Callers outside agent-qa that still spell the old key break on the hard cut, by design.** None is
  changed by this phase:
  - the super-repository's own `demo/init/agent-qa.config.yaml` (line 171, `maxSubActions: 10`);
  - the bench repositories' config writers: `agent-qa-android-world-bench`,
    `agent-qa-app-control-bench` and `agent-qa-miniwob-bench` (each `src/<package>/product.py`), and
    the run workspaces under `agent-qa-online-mind2web-bench/runs/`.
  The private eval set behind the external live measurement carries no `use.planner.*` key
  (435 D-08), so the Phase 439 re-measure is unaffected.
- **Live iOS was not run.** The two `C436-IOS-LIVE` cells typecheck and have never executed (WINDOWS
  #561, open); iOS scrolling is covered by mock-driver cells only. The four `C436-ANDROID-LIVE` cells
  ran and passed once on an emulator at `4a788968f` (`436-RECORD.md` § Platforms not run). All six
  are conditional entries in `scripts/gate/inputs/register.json` and count as registered skips.
- **No live model ran.** Acceptance is model-free (D-28): a scripted planner drives the real loop.
  Whether Rule 22 steers a real model to stop on a dead control is Phase 439's measurement.

### Reconciliation

Reconciliation 4 (2026-10-05) in `.planning/REQUIREMENTS.md` is this phase's: the old key is a hard
cut. No 436 change diverges from `spec/v2`, so no new reconciliation was added. The divergences from
the plans are disclosed in `.planning/phases/436-harness-action-outcomes/436-RECORD.md` § Disclosed
divergences, including three fixes made outside the plans: the recorded action interval ends with
the action (`d34233fd3`), the planner-limits record names its per-test entries `perTest`
(`07203a747`, for agent-local's strategy-config census), and Android gestures start clear of the system
gesture zones (`c14f755a9`, WINDOWS #562).

### Gate at the time of writing (2026-10-08)

Run by 436-13 from `agent-qa/` with `pnpm run gate:local -- --out <dir>`. The gate clones the
committed SHA into a fresh temporary directory, installs with the frozen lockfile and runs every
leg there. It ran on `fcb323f291e836b8ea170e660ac0ab9990bd1100`, this section's first commit: `a2ab1651f`
plus this section without this subsection, and the 293 new regression entries. The source tree was
clean (`sourceDirty: false`). The run lasted 10 min 28 s (21:44:53Z to 21:55:21Z on 2026-10-07 UTC),
with a 1-minute load of 3.2 at the start and 6.7 at the end.

| Leg | Observed | Exit |
|---|---|---|
| clone, install | fresh clone at the SHA; `pnpm install --frozen-lockfile` | 0, 0 |
| turbo build and typecheck | 46/46 tasks | **0** |
| turbo test | 23,136 passed, 0 failed, 44 skipped, every skip a registered entry | **0** |
| `validate:skills`, `validate:agents`, `validate:publish` | 4, 24 and 22 checks | **0** |
| `validate:tools` | 14 passed, the same 14 as 434's record, so no agent tool was added | **0** |
| `validate:arch` | 506 passed (441 at 434, plus the 65 cells of the 436 census) | **0** |
| `validate:safety`, `validate:431-discovery-imports`, `lint:namespace` | 9 passed; 870 imports; 3,018 files | **0** |
| node-test, conformance selftest, conformance | 153 passed; 4; 50 | **0** |
| audit (`pnpm audit --prod --json`) | 493 prod dependencies: critical 0, high 0, moderate 5, low 1. pnpm 10.6.1 exits 1 on any advisory, and the gate judges the JSON metadata (434's owner decision) | 1, judged pass |
| regressions | **333 of 333 listed cells executed and passed**: 434's 40 and Phase 436's 293 | — |
| register | 43 entries, 44 skips matched, 0 stale, 0 unlisted; the six live mobile cells were skipped as registered | — |

Verdict: `gate green: 0 finding(s)`, `record: true`, exit **0**. The commit that adds this
subsection changes only this file, which no test reads. 436-13 re-ran the gate on that commit, and
`.planning/phases/436-harness-action-outcomes/436-RECORD.md` § Gate records that run, at the
final SHA.

**Toolchain:** node 24.15.0 · pnpm 10.6.1 · turbo 2.9.7 · Chromium 149.0.7827.55 (revision 1228) ·
macOS (Darwin 27.0.0, arm64, 12 CPUs).

## 2026-10-09 — Phase 437: Android and iOS toggle and submit (V2-EXEC-05, V2-EXEC-06)

This section appends to the register and rewrites no earlier section; the 2026-10-07 Phase 436
row "Phase 437 fixes the Android classifier" stays as written. Phase 437 made one classifier decide
what a toggle is, recorded a skipped toggle tap as input that was never sent, and made every Android
fill and clear path deliver its text once, read it back honestly and submit only when asked. It kept
real toggles' desired-state idempotency, the picker's value check, `[selected]` in the planner tree
and every reader of persisted history. The section follows the 2026-10-07 shape. Dated 2026-10-09;
written by 437-14.

### The ruling

> V2-EXEC-05: An ordinary node exposing `selected` is not a toggle, and its tap is never skipped as
> already satisfied, including under `desiredState: unselected`.
>
> V2-EXEC-06: Android replace, append, clear and requested submit work correctly on the native,
> WebView and last-resort keyboard input paths.

From `.planning/REQUIREMENTS.md`, taken verbatim from `spec/v2/release-readiness.md`. The owner's
choices among the planned options and the delegated details are recorded as D-01..D-23 in
`.planning/phases/437-android-and-ios-toggle-and-submit/437-CONTEXT.md`, with two owner decisions
taken during execution on 2026-10-08: FA-1, an iOS append whose re-read never showed the appended
text is recorded unverified; FA-2, line breaks sent to a single-line field are refused before
typing. A third, fix-tap (2026-10-09), made iOS single taps hold the touch for 100 ms. D-19 keeps
agent-qa free of fixtures: its proof is model-free cells with inline snippets, a scripted planner
through the real loop and mocked drivers, plus opt-in live cells on the phones' own Settings apps.

### How this inventory is measured

| Instrument | What it claims | Where |
|---|---|---|
| the census | `C437-CENSUS`: `C437-ONE-CLASSIFIER` (the classifier and its role set are declared once, in `schema/src/screen/toggle.ts`, no other production Set or array literal is made only of toggle roles, and the comparator, the core parser and the planner-tree renderer import it), `C437-NO-SUCCESS-NOOP` (no runner result pairs `success: true` with the idempotent no-op), `C437-NO-SCRIPT-WRITE` and `C437-NO-SYNTHETIC-KEY` (no string built in `android/src` assigns a field's value or constructs or dispatches an event; strings are read from the TypeScript AST with `+` chains joined, so a comment never counts), `C437-NO-KEYS-TYPING` (no fill text reaches `driver.keys`), `C437-NO-PATH-FALLBACK` (the fill dispatch has no `try`/`catch` and calls each path once, and every `catch` in the five Android input-path methods ends the path by returning), `C437-NO-FIXTURES` (agent-qa's own `git ls-files` lists no `.apk`, `.aab`, `.apks`, `.xapk` or `.ipa`, and no path naming the phase outside `packages/*/src/**/__tests__/437-*`), with `C437-UNIVERSE-FLOORS`, `C437-PLANTED-POSITIVE` and `C437-SELF-MATCH`. Every needle is two halves joined at run time; comments are blanked by the 432 and 436 lexer. 10 cells, in `validate:arch`. Run against the pre-437 tree (`c26bdd294`), 8 of the 10 red: the six removal cells on their removed shapes, and the universe and fixture cells because the classifier file and the 437 test files did not exist yet. | `packages/arch/src/__tests__/437-mobile-input-census.test.ts` (437-14 `7d7950b8d`) |
| the runtime key sets | `C437-KEY-SETS`: the input evidence carries exactly its nine members, operation evidence gains an optional `input` array, and the handoff schema version is still 7. | `packages/schema/src/__tests__/437-input-evidence-keys.test.ts` (437-04) |
| the behaviour cells | 218 model-free cells by name in the 434 gate's regression list, each with the `437 D-NN` decision it proves: every `C437-*` cell from 437-01 to 437-09 and 437-14, and the `437 D-NN` cells in existing files (`idempotency.test.ts` Block A, `compound-coverage.test.ts`, the Android `compound.test.ts` unreadable-submit cell). | `scripts/gate/inputs/regressions.json` |
| the live cells | 10 opt-in cells on `com.android.settings` and `com.apple.Preferences` (`C437-ANDROID-LIVE` ×4, `C437-ANDROID-SECURE-LIVE` ×2, `C437-IOS-LIVE` ×4), registered as conditional not-run entries, so a skip is never a pass. | `scripts/gate/inputs/register.json` |

**This file names retired shapes literally**, as the 2026-09-02 section explains for the whole
register. `DELETION-INVENTORY.md` sits outside every census region.

### What was removed

Baseline `c26bdd294` (`version-0.2`, the parent of 437's first agent-qa commit `c9f58e4e7`).
Code-closing HEAD `26ca50c31`, the last commit before the census. `git diff --shortstat
c26bdd294..26ca50c31`: 56 files changed, 5,116 insertions, 398 deletions; no file deleted.

- **`selected` deciding a skip.** The comparator (`runner/src/compound/idempotency.ts`) read
  `state.selected` for `desiredState: selected`/`unselected` on any node, so every UiAutomator2 node
  exposing `selected` behaved as a toggle and an ordinary button was skipped as already satisfied.
  Now `isToggleElement` (`checkable="true"`, or role `switch`, `checkbox` or `radio`) gates the
  skip, and all four desired states read the checked state (437-01 `c9f58e4e7`). The parser's rule
  that never derived `checked` from a value string is gone for iOS switches, toggles and checkboxes,
  whose `1`/`0` value is now their checked state (`465b25377`), and the planner tree tags
  `[checked]` only on toggles (`2184413d5`). `C437-ONE-CLASSIFIER`.
- **The success-shaped skipped tap** `{ success: true, metadata: { idempotentNoop } }` in
  `runner/src/loop/index.ts`. A skipped tap is now `success: false` with no error and
  `idempotentNoop.inputSent: false`, still one counted action, and reaches the verifier, the
  planner's history, the legacy trace and the dashboard as "no input sent — already <state>"
  (437-02 `86d65f669`, `024e30b2a`, `b866da1cd`; 437-03 `5e3bba71f`, `ba93daff2`, `25d282b6e`).
  `C437-NO-SUCCESS-NOOP`.
- **The WebView value-writing script and its synthetic Enter** (`android/src/adapter.ts`
  `fillWebViewCompound`): a page script wrote `el.value = text` (or `prior + text`) into whatever
  `document.activeElement` was, fired `dispatchEvent(new Event("input"))`, returned success when it
  could read nothing, and submitted with `new KeyboardEvent("keydown")`/`("keyup")`. Now a W3C
  touch tap on the ref, a read-only focus probe, W3C Ctrl+A and Backspace, `mobile: type` from
  NATIVE_APP, a read-only read-back and one `mobile: pressKey 66`; a focus miss writes nothing
  (437-06 `a16048487`, `0937851b5`). `C437-NO-SCRIPT-WRITE`, `C437-NO-SYNTHETIC-KEY`.
- **The native-to-keyboard fall-through.** The fill dispatch looked up the focused element inside a
  `try` whose empty `catch` ("fall through to last resort") sent a failed native fill to the
  keyboard path, which typed the text again. The path is now chosen once, before any text is
  delivered, and a driver error ends the fill with what was delivered (437-05 `0ff53805f`).
  `C437-NO-PATH-FALLBACK`.
- **Keyboard typing through key events.** The last-resort path typed with `driver.keys([action.text])`,
  never cleared a replace, never sent a requested Enter and returned success when nothing was
  readable. It now clears by Ctrl+A then DEL through `mobile: pressKey`, types once through
  `mobile: type`, reads back from a re-found handle or records unverified, and sends a requested Enter
  once (437-07 `ff47f0368`, `0d5ea038c`). `C437-NO-KEYS-TYPING`.
- **The unreadable early returns before a requested submit** on the native, WebView and keyboard
  paths. An unreadable value is now `unverified`, and a requested Enter is still sent once; a
  mismatch or a multi-line field holds it (437-05 `8020bbf63`, 437-06, 437-07).
- **The always-successful `clearText`.** Native, keyboard and WebView clears now read the field back
  and record exact, mismatch or unverified (437-06 `0937851b5`, 437-07 `0d5ea038c`).
- **The whitespace-collapse and numbers-only fill normalization** in `compareFillReread`
  (`runner/src/compound/fill-verify.ts`). Four verdicts replace them: exact; normalized, when the
  field only inserted separators (space, U+00A0, U+202F, U+2009, `-`, `(`, `)`, `[`, `]`, `{`, `}`,
  `.`, `/`); mismatch; unverified. Merged, trimmed or lost whitespace is a mismatch on web, Android
  and iOS (437-04 `bcedf9c13`).
- **The iOS append substitution.** When an iOS append's re-read equalled the prior value, the adapter
  compared the expected text with itself and recorded it as matched. Per the owner's FA-1 decision
  of 2026-10-08 it is now recorded `unverified`, with no `fillReread` block and no `prior + typed`
  text, and a requested Return on a single-line field is still sent once (437-04 `a6cd61644`). Cell:
  `C437-FILL-IOS appends whose re-read never showed the appended text an append whose re-read
  equals the prior value is unverified (FA-1, owner 2026-10-08)` in
  `packages/ios/src/__tests__/text-input.test.ts`.

### What was RETAINED, and why

| Item | Why kept | What pins it |
|---|---|---|
| desired-state idempotency on real toggles | a switch, checkbox, radio or checkable control already in the requested state must not be flipped (V2-EXEC-05) | `idempotency.test.ts` Block A, `C437-TOGGLE-LOOP`, the live `C437-ANDROID-LIVE` and `C437-IOS-LIVE` switch cells |
| the picker's value idempotency | a picker already on the requested value is a different, value-based check (Phase 359 D-15) | `idempotency.test.ts`, `C437-NO-INPUT` (a picker no-op masks its currentState) |
| `selected` on every node and `[selected]` in the planner tree | it stays visible with no toggle meaning, so `screenIdentityHash` and the cache partition do not move (D-01) | `C437-TREE-TOGGLE`, `C437-TOGGLE-PARSE` (the hash is the same with or without lifted checked) |
| `keyevent` and `openQuickSettings` on `mobile: shell` | the tools keep their route; a refusal by secure Appium is recorded `unavailable`, never an unhandled error (D-18) | `C437-SHELL-UNAVAILABLE`, `C437-ANDROID-SECURE-LIVE` |
| the iOS unreadable early return | deferred: an unreadable iOS value still returns before Return, now recorded `unverified` (437-04) | `C437-FILL-IOS` (an unreadable re-read keeps the early return) |
| the web unreadable early return | the same deferral on web: no Enter, recorded `unverified` | `C437-FILL-WEB` |
| the WebView `tap` through a page `click()` | D-11 covers fill, clear and submit; a WebView tap still clicks the element at the ref's point through a script | not pinned by a 437 cell |
| the `fillReread { expected, actual }` block | its two string keys are what existing readers pin; it is written whenever a value was read back (secure fields carry length sentinels only) | `C437-FILL-VERDICT` (the meta keeps exactly the two string keys) |

### What degrades, stated plainly

- **A formatted value that inserts other characters fails.** A field that turns `0930` into `09:30`
  records a mismatch, because `:` is not a separator, and a field that collapses double spaces fails
  where it used to pass.
- **Single-line Android and WebView fields refuse text with line breaks** before typing (FA-2), with
  a plain error; the text is never typed with its line breaks dropped.
- **A multi-line field never gets Enter**, on any path: the submit is recorded "not sent:
  multi-line field" and the planner is told to tap the send control.
- **A skipped toggle tap no longer reads as success** anywhere. A step whose only action was a
  skipped tap passes only when the verifier sees the requested state.
- **iOS single taps take about 100 ms longer** (fix-tap), so a Settings switch knob flips.
- **On an Appium without relaxed security, `keyevent` and `openQuickSettings` do nothing** and are
  recorded `unavailable` with the reason `adb-shell-disabled`.

### Persisted values that keep reading

| Persisted value | Disposition | Evidence |
|---|---|---|
| pre-437 skipped taps: `metadata.idempotentNoop { currentState }` with `success: true` | **Read and relabelled.** `readIdempotentNoopMeta` (now in the schema package) reads the old block and the new one, and the dashboard and trace label both "no input sent". | `C437-NO-INPUT-READER`, `C437-NO-INPUT` (readIdempotentNoopMeta reads the pre-437 block), `C437-NO-INPUT-LABEL` (a pre-437 skipped tap is labelled no input sent too) |
| old iOS `fillSubmit { sent, reason }` blocks | **Read.** They still derive the input evidence. New runs add `outcome` (sent, not-sent, unavailable, failed) and an optional `detail`. | `C437-INPUT-EVIDENCE` (a pre-437 iOS submit block still derives) |
| `fillReread` blocks without a `fillVerdict` | **Read.** A pre-437 result still counts as one fill input. | `compound-coverage.test.ts` (`437 D-06` cells) |
| new optional `fillVerdict`, `fillRefusal`, `shellAction`, `idempotentNoop.inputSent` and `SubActionEvidence.operationEvidence.input` | **Written by new runs, optional to readers.** `CURRENT_HANDOFF_SCHEMA_VERSION` stays 7. The input evidence never carries the typed or read-back text. | `C437-KEY-SETS`, `C437-INPUT-EVIDENCE` |

### The instruments that notice a return

- **`pnpm run validate:arch`** runs the 437 census after the 436 file. It also runs in the
  workspace's `turbo test`, so a second classifier, a success-shaped no-op, a value-writing or
  key-event script, keyboard typing of fill text, a fall-through between input paths, or a tracked
  app package or phase fixture reds by name on the commit that adds it.
- **The 434 gate** (`pnpm run gate:local`) must execute and pass all 218 listed 437 cells. The ten
  live cells are conditional entries: when they are not run, the gate counts them as registered
  skips, never as passes. No mutation driver was added (D-19).

### Not observed, stated as such

- **Only the combinations installed on this Mac ran live** (D-23): the Pixel_10_Pro AVD (Android 17,
  API 37.1, `google_apis_ps16k` arm64-v8a) and the iPhone 18 Pro simulator (iOS 27.0), with Appium
  3.7.0, UiAutomator2 7.0.0 and XCUITest 10.25.0, on macOS 27.0.1 on an Apple M2 Pro. Other Appium
  and driver versions, API 33, x86_64 Linux and the Docker image (`docker/Dockerfile.android`
  installs Appium unpinned), physical devices and device farms are preview/unverified, never passing.
- **agent-qa's live cells drive Settings only.** The live fill and submit proof on a real app, with
  the exact text received and the submission count, is an external live measurement that agent-qa
  never reads (D-19, D-22); its result is a data point that gates nothing.
- **No live model ran** in agent-qa's cells: a scripted planner and verifier drive the real loop.
- **436's two `C436-IOS-LIVE` cells ran live for the first time** (437-09, at `26ca50c31`) and failed
  2 of 2 in their own `beforeEach`, which assigns over WebdriverIO's read-only `driver.execute`
  (WINDOWS #564, a test-only defect, deferred). Their register entries say so.

### Reconciliation

D-06 narrows `spec/v2/tools-and-actions.md` §12 item 11 (separators replace the digits-only and
whitespace-collapse rules), and D-19 and D-21 move fixtures and device proof out of agent-qa. Their
reconciliations are recorded in `.planning/REQUIREMENTS.md` by 437-16. The fix-tap change was made
by the owner's decision during 437-09 and is disclosed in that plan's summary.

### Gate at the time of writing (2026-10-09)

Run by 437-14 from `agent-qa/` with `pnpm run gate:local -- --out <dir>`. The gate clones the
committed SHA into a fresh temporary directory, installs with the frozen lockfile and runs every
leg there. It ran on `384f93b3de35004f5f2c46e4e1a7f28eede95446`, this section's first commit: the
census commit `7d7950b8d` plus this section without this subsection, and the 218 new regression
and 10 new register entries. The source tree was clean (`sourceDirty: false`). The run lasted
11 min 16 s (21:36:10Z to 21:47:27Z on 2026-10-08 UTC), with a 1-minute load of 9.7 at the start
and a 5-minute load of 17.8 at the end.

| Leg | Observed | Exit |
|---|---|---|
| clone, install | fresh clone at the SHA; `pnpm install --frozen-lockfile` | 0, 0 |
| turbo build and typecheck | 46/46 tasks | **0** |
| turbo test | 23,506 passed, 0 failed, 54 skipped, every skip a registered entry | **0** |
| `validate:skills`, `validate:agents`, `validate:publish` | 4, 24 and 22 checks | **0** |
| `validate:tools` | 14 passed, the same 14 as at `c26bdd294`, so no agent tool was added | **0** |
| `validate:arch` | 516 passed (506 at 436, plus the 10 cells of the 437 census) | **0** |
| `validate:safety`, `validate:431-discovery-imports`, `lint:namespace` | 9 passed; 873 imports; 3,037 files | **0** |
| node-test, conformance selftest, conformance | 153 passed; 4; 50 | **0** |
| audit (`pnpm audit --prod --json`) | 493 prod dependencies: critical 0, high 0, moderate 5, low 1. pnpm 10.6.1 exits 1 on any advisory, and the gate judges the JSON metadata (434's owner decision) | 1, judged pass |
| regressions | **717 of 717 listed cells executed and passed**: 434's 40, Phase 436's 459 and Phase 437's 218 | — |
| register | 53 entries, 54 skips matched, 0 stale, 0 unlisted; the ten 437 and six 436 live mobile cells were skipped as registered | — |

Verdict: `gate green: 0 finding(s)`, `record: true`, exit **0**. The commit that adds this
subsection changes only this file, which no test reads. 437-14 re-ran the validators and the gate
on that commit; `.planning/phases/437-android-and-ios-toggle-and-submit/437-14-SUMMARY.md` records
that run, at the final SHA.

**Toolchain:** node 24.15.0 · pnpm 10.6.1 · turbo 2.9.7 · Chromium 149.0.7827.55 (revision 1228) ·
macOS (Darwin 27.0.0, arm64, 12 CPUs).

### Gap closure round 1 (437-17 to 437-21, 437-25, 437-26), 2026-10-09

This subsection appends to the Phase 437 section and rewrites none of it; written by 437-21. The
owner set the round's scope on 2026-10-09 as "Gaps + fill-path bugs", and decided the secure clear
question "Mismatch if text left". The findings are those of the phase's code review (CR-nn, WR-nn).
Every commit below is in agent-qa on `version-0.2`; every cell is listed in
`scripts/gate/inputs/regressions.json` with its `437 D-NN` origin.

**What was removed**

- **The binary legacy sub-action outcome** (CR-01). The legacy trace, the live editor's data and
  every live editor surface read a skipped tap's `success: false` as a red failure. The sub-action
  outcome is now `success | failure | no-input`, and the detail, row, step card and suite row show
  "no input sent", muted. 437-17 `1858da9c8`, `2ae5e2d68`; 437-25 `05405cb48`, `2f453fdec`. Cells:
  `C437-NO-INPUT the legacy trace marks the same skipped tap planned twice no-input both times`,
  `C437-NO-INPUT-LABEL the live editor detail names a skipped tap no input sent in the muted
  colour`, `C437-NO-INPUT-LABEL the live editor row draws a skipped tap with a muted dot`.
- **Value-named and deduped WebView fields** (CR-02). The WebView observer named a field by its
  typed value and dropped a second field with the same role and name. Fields are now named by their
  labels, never by a value, and every distinct editable field is kept. 437-19 `a1cfac889`. Cells:
  `C437-WEBVIEW-OBSERVE a labelled input and a labelled textarea both reach the tree, named by their
  labels`, `C437-WEBVIEW-OBSERVE a typed value never becomes a field's name`,
  `C437-WEBVIEW-OBSERVE two empty unlabelled fields are both kept`.
- **The single-shot WebView focus probe** (WR-01, WINDOWS #568). The WebView fill and clear refused
  after one probe. They now probe up to three times, 300 ms apart, before refusing. 437-19
  `86ea180ec`. Cells: `C437-FILL-WEBVIEW a focus that lands on the second probe is typed once, with
  no refusal`, `C437-FILL-WEBVIEW a focus that never lands is refused after three probes with
  nothing typed`, `C437-FILL-WEBVIEW a WebView clear waits for focus the same way`.
- **The native path's unchecked focus target** (WR-02). A native fill or clear typed into, or
  cleared, whatever field held focus after the tap. A focused node whose bounds lie outside the
  ref's by more than 1 px is now refused `focus-elsewhere` with nothing delivered. 437-20
  `8e35f653f`, `e75c40f64`. Cells: `C437-FILL-NATIVE a fill whose tap left another field focused is
  refused with nothing typed`, `C437-CLEAR a clear whose tap left another field focused clears
  nothing`.
- **Success-only readers** (WR-03). Feedback routing, the coverage fingerprint, eval label seeding
  and soft-label population read `success === true` as "the action ran". They now read the shared
  `actionDidNotFail`, which counts a skipped tap as not failed. 437-18 `2e6bf0405`, `b178b8a8d`;
  437-26 `a40d36383`, `497821737`. Cells: `C437-NO-INPUT-READER actionDidNotFail is true for a
  success and for a skipped tap`, `C437-NO-INPUT-READERS a step whose only action was a skipped tap
  and whose verifier failed is assertion drift`, `C437-NO-INPUT-READERS a passing decision whose
  sub-action was a skipped tap is not retired as missing`.
- **The always-unverified secure clear** (WR-04). `compareFillReread` recorded every secure
  `clearText` as unverified, so a password field that still held text after the clear passed. Per
  the owner's "Mismatch if text left", a secure clear whose read-back is non-empty, masked bullets
  included, is now a mismatch whose meta and error carry only `<len:0>` and `<len:N>`. An empty or
  unreadable secure read-back stays unverified, because it proves nothing. Every Android clear path
  reaches the rule through `settleClear`. 437-21 `b3a61bf40`. Cells: `C437-FILL-VERDICT clearText
  (D-16) a secure clear that leaves text is a mismatch naming only its length (owner 2026-10-09)`,
  `C437-CLEAR a secure native clear that leaves text is a mismatch and names only its length`,
  `C437-CLEAR a secure keyboard clear that leaves text is a mismatch`, `C437-FILL-WEBVIEW a secure
  WebView clear that leaves text is a mismatch`. The listed cell `a secure clear is unverified with
  secure true` was re-spelled `a secure clear that reads back empty or unreadable is unverified
  with secure true`, origin `437 D-16` kept.
- **The iOS unreadable early return** (WR-05). The RETAINED table above lists it as deferred. By the
  owner's choice of 2026-10-09 it is removed: an iOS fill whose re-read is unreadable is recorded
  unverified and, when a submit was requested on a single-line field, sends Return once and records
  `fillSubmit { sent: true }`, as Android does (D-09, D-10). A multi-line field and a mismatch still
  send none. 437-21 `b8f608125`. Cells: `C437-FILL-IOS an unreadable re-read records unverified and
  still sends the requested Return once (WR-05, owner 2026-10-09)` (re-spelled from `an unreadable
  re-read keeps the early return and records unverified`, origin `437 D-07` kept),
  `C437-FILL-IOS an unreadable re-read in a multi-line field sends no Return and records the
  multi-line outcome`, `C437-FILL-IOS an unreadable re-read without a submit sends nothing and
  records no submit outcome`.

**What stays retained**

| Item | Why kept | What pins it |
|---|---|---|
| the web unreadable early return | outside the round's scope: an unreadable web value still sends no Enter and is recorded `unverified` | `C437-FILL-WEB an unreadable value keeps the early return (success, no Enter) and records unverified` |

**What degrades, stated plainly**

- A password field that still reads back text after `clearText` now fails the clear with a
  length-only error, on the native, keyboard and WebView paths. A field that always reports masked
  bullets after a successful clear would fail in the same way.
- An iOS fill whose value cannot be read back now sends the requested Return.

**The instruments that notice a return**

- 437-25's census cell `C437-NO-INPUT-REACHES-LIVE` in `validate:arch` reds when an outcome union,
  the legacy trace or a dashboard-ui sub-action reader goes back to success or failure only.
- The new cell families: `C437-NO-INPUT-LABEL`, `C437-NO-INPUT-READER`, `C437-NO-INPUT-READERS`,
  `C437-WEBVIEW-OBSERVE`, the `C437-FILL-WEBVIEW` poll cells, the `C437-FILL-NATIVE` and
  `C437-CLEAR` focus cells, the secure clear cells and the `C437-FILL-IOS` unreadable cells. The
  434 gate's regression list grew from 717 to 761 cells over the round; 262 carry a `437` origin.

## 2026-10-09 — Phase 438: Intended target (V2-EXEC-04)

This section appends to the register and rewrites no earlier section. Phase 438 removed every path
that chose an element by its position among look-alikes: the web resolver's `nth`, the matcher's
tiebreak, the stored cache and procedure positions, the heal's position and hierarchy tiebreak,
the planner's `ordinal` and iOS's same-type position. In their place, every element action states
the element it means beside its ref, a clear contradiction is refused before anything is sent, the
web adapter keeps the observed element through its native binding, and replay acts only on a
strictly unique match. It kept the sites that record a position without picking by it, and every
reader of persisted history. The section follows the 2026-10-09 Phase 437 shape. Dated 2026-10-09;
written by 438-14.

### The ruling

> V2-EXEC-04: The intended target is kept.
> - An action whose stated target contradicts its resolved ref is refused with a typed
>   `target-mismatch` naming both identities (AUTO-14).
> - The observed target is retained or revalidated across same-label reordering, detachment and
>   navigation rather than substituted by an `nth` match (the existing-target portion of WEB-02).
> - Live, heal, procedure-replay and cached paths never choose by ordinal. A cached hit whose
>   stored target is not unique among the current candidates, judged on the strict descriptor, is
>   a cache miss.
> - AUTO-15's ambiguity refusal is preserved and its identical-controls fixture added. A reordered
>   identical-rows fixture proves intended-target dispatch or explicit refusal, live and cached.

From `.planning/REQUIREMENTS.md`. The owner's picks among the planned options and the delegated
details are recorded as D-01..D-17 in `.planning/phases/438-intended-target/438-CONTEXT.md`:

- D-01 every element action carries a stated target (role, name, row words) beside its ref;
- D-02 a repeated label also names its row;
- D-03 refuse only on a clear contradiction: a role of another kind, a name sharing no word, row
  words not in the row, and (Claude's refinement, flagged for the owner) a differing number in
  otherwise matching names;
- D-04 the check runs on every lane: ref, descriptor and heal;
- D-05 a refusal never substitutes, is typed `target-mismatch`, names both identities redacted, is
  not debited as an action, and the re-plan is a planning turn;
- D-06 the web adapter keeps a native binding for each observed element;
- D-07 a moved element is followed after a re-check;
- D-08 a replaced element is re-found only when provably the same;
- D-09 a navigation between looking and acting is `stale-observation`, nothing sent, never healed;
- D-10 strict means the exact observed name (spacing tidied, numbers and badges kept);
- D-11 strict replay on the cache, procedure and heal paths, with a recorded cache miss;
- D-12 `ordinal` leaves the planner's target vocabulary;
- D-13 the census: no ordinal or `nth` pick remains;
- D-14 AUTO-15 is kept as it is;
- D-15 acceptance is model-free regressions in agent-qa, in 434's named-cell list;
- D-16 one opt-in live-model cell for AUTO-15;
- D-17 one external live measurement on the final SHA, which gates nothing.

D-15 keeps agent-qa free of fixtures (437 D-19): the "in-repo fixtures" are small HTML strings in
the test files, loaded in real headless Chromium, and inline iOS and Android page sources.

### How this inventory is measured

| Instrument | What it claims | Where |
|---|---|---|
| the census | `C438-CENSUS`: `C438-NO-WEB-POSITION` (web production calls no Playwright position method on an element locator, and the resolver builds no role locator), `C438-NO-MATCHER-POSITION`, `C438-NO-CACHE-POSITION` (the stored locator declares no position, `value.ts` computes none, re-grounding returns the strict match), `C438-CACHE-MISS-RECORDED` (a key hit that does not replay records its typed miss before the entry is invalidated), `C438-NO-PROCEDURE-POSITION`, `C438-NO-HEAL-POSITION`, `C438-NO-TARGET-POSITION`, `C438-NO-BINDING-POSITION`, `C438-NO-IOS-POSITION`, `C438-NO-CURATION-POSITION`, `C438-RECORD-ONLY-CLASSIFIED` (the position helper is called only at the classified record-only sites named in the file header), `C438-ROOT-AI-SNAPSHOT-ONLY` (every accessibility snapshot in the web adapters, binding helper, resolver and compounds is `:root` ai mode, so no stray snapshot unbinds the observed refs), with `C438-UNIVERSE-FLOORS`, `C438-PLANTED-POSITIVE` and `C438-SELF-MATCH`. Needles are two halves joined at run time and comments are blanked by the 432 and 436 lexer; identifiers are read per region, because the word for a position is also used for builds, turns and steps. 15 cells, in `validate:arch`. Run against the pre-438 tree (`cb485d65a`), 12 of the 15 red on their removed shapes. | `packages/arch/src/__tests__/438-ordinal-census.test.ts` (438-12 `f42d74132`) |
| the runtime key sets | `C438-KEY-SETS`: the target refusal block carries exactly its eight members and a target identity exactly role, name and row; grounding evidence gains an optional `stated`, a target descriptor an optional `row`; the binding block is exactly outcome, ref, `inputSent` and an optional heal; a cache miss reason is exactly `strict-absent`, `strict-not-unique` or `non-replayable`; the readers return undefined for anything malformed; handoffs carrying the new blocks load, and the handoff schema version is still 7. 23 cells. | `packages/schema/src/__tests__/438-key-sets.test.ts` (438-02, 438-06, 438-09) |
| the binding's ground truth | `C438-ARIA-REF-CONFORMANCE`: seven raw-Playwright cells pin the native `aria-ref` facts the binding rests on at playwright-core 1.61.0 (refs follow a re-sorted node; a default-mode or sub-locator snapshot empties the ref map; a new document resets everything; pushState keeps the document and the ref; frames; a renamed node gets a new ref). A Playwright upgrade that changes any of them reds here first. | `packages/web/src/__tests__/438-aria-ref-conformance.test.ts` (438-06 `feb4aead9`) |
| the behaviour cells | 195 model-free cells by name in the 434 gate's regression list, each with the `438 D-NN` decision it proves: every `C438-*` cell from 438-01 to 438-13 in the schema, runner, web, core, iOS, CLI and arch packages, including the census and key-set cells above. | `scripts/gate/inputs/regressions.json` (438-14 `e8cae3f51`) |
| the live cell | `C438-AUTO15-LIVE`, 2 cells: the built CLI with a real model on an inline page with two identical Okay buttons. Registered as conditional not-run entries, so a skip is never a pass. | `scripts/gate/inputs/register.json` |

**This file names retired shapes literally**, as the 2026-09-02 section explains for the whole
register. `DELETION-INVENTORY.md` sits outside every census region.

### What was removed

Baseline `cb485d65a479d1a8051ce3c4fa945f8f9b8007c6` (`version-0.2`, the parent of 438's first
agent-qa commit `6b9d19c60`). Code-closing HEAD `7025a0fc0`, the last commit before the census.
`git diff --shortstat cb485d65a..7025a0fc0`: 92 files changed, 6,165 insertions, 736 deletions; no
file deleted.

- **The position-based web resolution.** `buildRefMap` in `web/src/element-resolver.ts` kept only
  a role, a name and an `nth`, and `resolve` rebuilt `getByRole(role, { name, exact: true }).nth(nth)`
  at action time. The `nth` was counted over role plus normalized name but applied to the exact
  name, so "Invoice 946" beside "Invoice 947" resolved to nothing. Now the ref map keeps the native
  `aria-ref` handle from the `:root` ai-mode snapshot, the observation's navigation epoch and the
  observed role, exact name and row text (`web/src/binding.ts`). Before acting, the adapter
  re-checks the current identity: a moved element is followed; recycled content is
  `binding-changed`, a replaced node `binding-lost`, a removed frame `frame-detached` and a new
  document `stale-observation`, each with nothing sent (438-05 `7dcabf1a1`; 438-06 `660107311`).
  `C438-NO-WEB-POSITION`, `C438-NATIVE-BINDING the resolver defect: Invoice 946 beside Invoice 947
  is clicked`.
- **The matcher's tiebreak.** `matchDescriptor` (`runner/src/grounding/matcher.ts`) returned the
  survivor at the descriptor's ordinal before its hierarchy check. Two survivors now stay
  ambiguous with both refs; a stray position on a descriptor is never read, and the prior
  hierarchy still resolves a single parent-chain match. The gate copies only the matcher's fields
  (438-11 `3b1941ea6`). `C438-NO-MATCHER-POSITION`, `C438-MATCHER-AMBIGUITY`.
- **The stored locator's normalized name and position.** The cached locator
  (`runner/src/cache/port.ts`, `value.ts`) was `{ role, nameNormalized, ordinal }`, and
  `cache/reground.ts` re-found it by that position. It is now `{ role, name, row? }` with the exact
  observed name and the stated row words, replayed only through `strictMatch` when exactly one
  current element matches (438-08 `7994ff54d`). The cache format moved from 11 to 12
  (`runner-local/src/fs-action-cache.ts`, 438-09 `4d3e6a9c6`). `C438-NO-CACHE-POSITION`,
  `C438-STRICT-REPLAY`.
- **The heal's position and hierarchy tiebreak.** `regroundFailedRef` (`runner/src/loop/index.ts`)
  re-found a failed ref by its ordinal, with the prior hierarchy as a tiebreak. It now acts only
  when exactly one current element has the observed role, exact name and row text; a re-found
  element is judged against the stated target (path `heal`), and when nothing is provably the same
  nothing is sent and the binding block records `heal: 'absent' | 'not-unique'` (438-07
  `3d64bb89e`). `C438-NO-HEAL-POSITION`, `C438-REORDERED-ROWS`.
- **Procedure replay's position and the recovery context's positions.**
  `attemptProcedureReplayAction` passed a stored or derived ordinal to the matcher, and the
  guard-miss recovery context showed the model stored and fresh positions. Replay now matches the
  exact name and row words through `strictMatch`; the recovery context names candidates by role and
  name, and row when stored (438-10 `1454e4afb`, `a56b861fe`). The curation writers
  (`cli/src/curation/emit-candidates.ts`, `curator-author.ts`) no longer write a position into
  procedure targets; they write the exact name and the stated row words (438-10 `6794bf73b`).
  `C438-NO-PROCEDURE-POSITION`, `C438-NO-CURATION-POSITION`, `C438-PROCEDURE-STRICT`,
  `C438-RECOVERY-NO-POSITION`, `C438-PROCEDURE-WRITE`.
- **`targetSchema.ordinal`** (`runner/src/tools/actions/index.ts`, `schema/src/action/params.ts`).
  The planner's target is now `{ role, name, row? }`, closed (`.strict()`, `additionalProperties:
  false`), with the role required; a stray `ordinal` is a `schema_invalid` throw. The grounding
  error hints no longer invite an ordinal (438-04 `d780a7fbe`, `464339b52`).
  `C438-NO-TARGET-POSITION`, `C438-TARGET-SCHEMA`, `C438-HINTS`.
- **The builder and mobile binding positions.** `RefBinding` in `runner/src/screen-builder.ts`
  carried a per-screen ordinal and the mobile `RefEntry` (`core/src/mobile/types.ts`,
  `xml-parser.ts`) a position. Both are now the node index only (438-11 `d97628d73`).
  `C438-NO-BINDING-POSITION`, `C438-BUILDER-NO-POSITION`.
- **iOS's position-first text lookup.** `locateIOSTextTarget` (`ios/src/adapter.ts`) took the
  candidate at the same-type position first. It now fills only through a unique match on the
  observed bounds; two matches or none refuse the fill (438-12 `7025a0fc0`).
  `C438-NO-IOS-POSITION`, `C438-IOS-UNIQUE-BOUNDS`.
- **The gate's silent drop of a target beside a ref** (`runner/src/grounding/gate.ts`). A `target`
  sent with a `ref` was discarded. The gate now keeps the stated target per lane and the loop
  judges it before dispatch; a clear contradiction is a typed `targetRefusal` with nothing sent
  (438-01 `6b9d19c60`, `948618574`). `C438-STATED-TARGET`, `C438-STATED-TARGET-LOOP`.
- **The prompt's exactly-one rule.** "EXACTLY ONE of `ref` or `target` — NEVER both" in
  `runner/src/loop/prompts.ts`. Rules 10 and 17 now ask for the target beside every ref, and Rule
  17 keeps the no-guessing rule among identical controls; this was the phase's one re-pin of the
  byte-pinned prompt cells (438-04 `9f42cc003`). `C438-PROMPT`.
- **The silent invalidation of a cache hit that does not replay.** The exact-key hit branch of
  `runner/src/loop/index.ts` deleted a non-replaying entry and planned live with no trace. The miss
  is now recorded first, as `StepEvidence.cacheMiss.reason` with `cacheStatus: 'miss'`, then the
  entry is invalidated (438-09 `5d12015dd`). `C438-CACHE-MISS-RECORDED`, `C438-STRICT-REPLAY the
  946 miss is recorded with its reason`.

### What was RETAINED, and why

| Item | Why kept | What pins it |
|---|---|---|
| the record-only position sites: `schema/src/identity/exercised-anchors.ts`, `schema/src/screen/distilled-state-digest.ts`, `deriveFailureCautionAnchors`, the `el` recall anchor in `loop/memory-tools.ts` and the curator's `anchorSchema`, and the eval core's offline scoring identity | they record a position as identity for dedup, digests and knowledge recall, and never pick an element by it (D-13) | `C438-RECORD-ONLY-CLASSIFIED` (the position helper in `schema/src/screen/element-ordinal.ts` is called only there) |
| `elementDescription` on the element tools | kept as logging only; `target` now carries the stated identity and is what the gate checks (Claude's discretion, RESEARCH A8). Tool counts are unchanged | not pinned by a 438 cell |
| `near` | stays reserved: `spec/v2/tools-and-actions.md` §12 item 17 defines it as bounds proximity, and row words are identity for checking and replay, not a new way to search (D-02) | `C438-TARGET-SCHEMA targetSchema rejects near and selector-like keys`, `C438-HINTS near-unsupported points at name and role` |
| live grounding's loose matcher rungs | a target-only descriptor on the screen the planner saw may still match with the role ignored or by normalized substring, followed by the D-04 check; replay never uses them (D-10) | `C438-STATED-TARGET-LOOP the descriptor lane is checked after a loose rung`, `C438-STRICT-MATCH` |
| Android row text unknown | Android layout `ViewGroup`s map to `group` and are filtered out of the observation, so most Android rows have no container: the row is unknown, never a contradiction live, and a repeated label without a known row never replays | `C438-ROW-MOBILE an Android list row has unknown row text`, `C438-ROW-MOBILE a stated row on an Android button agrees with rowKnown false` |
| mobile taps at the observed bounds | deferred: Android and iOS taps still go to the centre of the observed bounds, with no native handle and no re-check before tapping. The shared runner changes (the stated-target check, no ordinal, strict replay) apply to mobile | not pinned by a 438 cell |
| `screenIdentityHash`, `serializeElement`, cache keys and `stepIndex` | the row text joins the planner tree but not the screen identity, so 436's cache-key cells stay green unedited (SC3) | `C438-ROW-TREE screenIdentityHash ignores row text`, `C436-CACHE-IDENTITY` |

### What degrades, stated plainly

- **A repeated label replays only with its row words.** A cached or procedure step whose live run
  stated no row, on a screen where its label repeats, is a recorded miss and re-plans.
- **A positional step on identical controls never replays from the cache**; it always misses and
  re-plans (D-12).
- **A changed badge or number is a miss.** "Cart (3)" stored and "Cart (4)" on screen, or "Invoice
  947" against "Invoice 946", re-plans instead of replaying.
- **Every cache entry written before format 12 is a miss once**; the cache rebuilds itself.
- **Committed procedure bodies without `name` stop replaying their targets** until they are
  re-curated. They still parse, and each target is a `descriptor-missing` guard miss that takes the
  existing recovery path.
- **A planner that states a contradicting target is refused**, including by the number rule, and
  spends a planning turn on the re-plan. A refused action is not debited.
- **A target without a role is refused by the tool schema**; a stray `ordinal` is `schema_invalid`.

### Persisted values that keep reading

| Persisted value | Disposition | Evidence |
|---|---|---|
| evidence `ordinal` on `TargetDescriptor` and `ProcedureGuardTarget` (`schema/src/screen/target-descriptor.ts`, `schema/src/knowledge/procedure-steps.ts`) | **Read, never written.** Old handoffs and committed bodies still parse; no matcher call reads the field (436 D-17's rule). | `C438-RECORD-ONLY-CLASSIFIED`, `C438-NO-PROCEDURE-POSITION`, `C438-MATCHER-AMBIGUITY a descriptor that still carries a position is ambiguous, and the position is never read` |
| committed procedure bodies without `name` (`{ role, nameNormalized, ordinal }`) | **Parse and miss.** They cannot be judged strictly, so each target is a guard miss; an unknown target key fails closed. | `C438-PROCEDURE-STRICT a legacy body still parses and misses`, `C438-RECOVERY-NO-POSITION a stored row is named, and a legacy body falls back to its normalized name` |
| cache entries of format version 11 | **Read as a miss**, with no migration (D-11). The cache is a local store behind a version. | `runner-local/src/__tests__/fs-action-cache.test.ts` (`reads a version-11 entry as a miss (438 D-11, no migration)`) |
| handoff schema version 7 with the new optional `metadata.targetRefusal`, `metadata.binding`, `grounding.stated` and `StepEvidence.cacheMiss` | **Written by new runs, optional to readers.** `CURRENT_HANDOFF_SCHEMA_VERSION` stays 7. `readTargetRefusalMeta` and `readBindingOutcomeMeta` read anything malformed as undefined, and the stated and observed identities are redacted before record. | `C438-KEY-SETS`, `C438-STATED-TARGET-LOOP both identities are redacted before record` |

### Accepted risks

- **T-438-12, a node detaching after the re-check.** A node that detaches in the milliseconds
  between the binding's re-check and the click makes the click wait the action's timeout and end as
  an ordinary failure, which the planner re-plans. The re-check makes the window small, and no wrong
  element can receive input. Not mapped to a typed outcome this phase.

### The instruments that notice a return

- **`pnpm run validate:arch`** runs the 438 census after the 437 file. It also runs in the
  workspace's `turbo test`, so a position method on a web element locator, a role locator in the
  resolver, a position tiebreak in the matcher, a stored or computed cache position, a non-replaying
  hit invalidated without a recorded miss, a position in procedure replay, the heal, the planner's
  target, a binding, the iOS lookup or a curation writer, or a non-`:root` snapshot in the web
  adapters reds by name on the commit that adds it.
- **The 434 gate** (`pnpm run gate:local`) must execute and pass all 195 listed 438 cells. The two
  live cells are conditional entries: when they are not run, the gate counts them as registered
  skips, never as passes. No mutation driver was added.

### Not observed, stated as such

- **The live-model cell ran once** (D-16), by 438-13 at agent-qa `eda7f190f`, with gpt-6.1-sol
  through openai-subscription on this Mac: 2 of 2 passed. The real planner refused "Click the okay
  button" as infeasible, naming both buttons and clicking neither, and clicked only the second for
  "Click the second okay button". One sample says the rewritten Rule 17 can hold, not that it
  always does. The cell's responding-model reader was corrected afterwards (`d048fcad6`), so that
  run did not capture the responding model id.
- **No mobile device ran.** The mobile cells are model-free, on inline iOS and Android page sources
  and mocked drivers.
- **The phase's false and correct refusals on real tests** are counted by an external live
  measurement on the final SHA (D-17), which agent-qa never reads; its result is a data point that
  gates nothing.
- **Frames.** `frame-detached` is typed and one removed-iframe cell pins it; full frame and
  out-of-process iframe coverage stays deferred.

### Reconciliation

D-11 and D-12 go further than `spec/v2/tools-and-actions.md` §12: item 7 gives the cached locator
as `role + nameNormalized (+ ordinal)`, and item 17 gives the descriptor as `{ role?, name?, near?,
ordinal? }` with the ordinal as a tiebreak and exactly one of ref or target. D-15 reads the
roadmap's "in-repo fixtures" as inline test snippets under 437 D-19. Their reconciliations are
recorded in `.planning/REQUIREMENTS.md` by 438-16.

### Gate at the time of writing (2026-10-10)

Run by 438-14 from `agent-qa/` with `pnpm run gate:local -- --out <dir>`, at turbo's default
concurrency (434 D-20). The gate clones the committed SHA into a fresh temporary directory, installs
with the frozen lockfile and runs every leg there. It ran on
`5876686db01556ea32b04eeafc4c349b6fc3a9d8`. That commit is this section without this subsection
(`e65a86ae7`), the 195 new regression cells and 2 new register entries (`e8cae3f51`), the seven
commits of quick 261010-11a that made load-sensitive cells deterministic (`30b456bfa` to
`9945644f6`), and the scrollers hook budget (`5876686db`). The source tree was clean
(`sourceDirty: false`). The run lasted 10 min 58 s (22:24:28Z to 22:35:26Z on 2026-10-09 UTC). The
1-minute load was 5.7 at the start, peaked at 72.6 during the test leg, and the 5-minute load was
16.3 at the end.

Two earlier runs at `e65a86ae7` went red on timing cells outside 438. 434 D-20 and D-21 do not
allow a pass on retry, so those cells were made deterministic, not re-run until green. Quick
261010-11a fixed eight of them without raising a time budget or loosening a limit. The ninth is the
`436-webview-scrollers` `afterAll`, whose slow step is Chromium's own `browser.close()` under full
load. By the owner's delegated decision (2026-10-10), that one hook gets 261002-tmo's 120 s hook
budget; no other hook, timeout, assertion or gate input changed.

| Leg | Observed | Exit |
|---|---|---|
| clone, install | fresh clone at the SHA; `pnpm install --frozen-lockfile` | 0, 0 |
| turbo build and typecheck | 46/46 tasks | **0** |
| turbo test | 46/46 tasks; 23,752 passed, 0 failed, 56 skipped, every skip a registered entry | **0** |
| `validate:skills`, `validate:agents`, `validate:publish` | 4, 24 and 22 checks | **0** |
| `validate:tools` | 14 passed, the same 14 as at `cb485d65a`, so no agent tool was added | **0** |
| `validate:arch` | 532 passed (517 at `cb485d65a`, plus the 15 cells of the 438 census) | **0** |
| `validate:safety`, `validate:431-discovery-imports`, `lint:namespace` | 9 passed; 879 imports; 3,065 files | **0** |
| node-test, conformance selftest, conformance | 153 passed; 4; 50 | **0** |
| audit (`pnpm audit --prod --json`) | 493 prod dependencies: critical 0, high 0, moderate 5, low 1. pnpm 10.6.1 exits 1 on any advisory, and the gate judges the JSON metadata (434's owner decision) | 1, judged pass |
| regressions | **956 of 956 listed cells executed and passed**: 434's 40, Phase 436's 459, Phase 437's 262 and Phase 438's 195 | — |
| register | 55 entries, 56 skips matched, 0 stale, 0 unlisted; the two `C438-AUTO15-LIVE` cells were skipped as registered, with 0 conditional entries run | — |

Verdict: `gate green: 0 finding(s)`, `record: true`, exit **0**. Before the gate, `pnpm build`,
`pnpm typecheck`, `validate:arch`, `validate:tools`, `validate:skills` and `validate:publish` each
exited 0 in the working tree at the same SHA. The commit that adds this subsection changes only this
file, which no test reads.

**Toolchain:** node 24.15.0 · pnpm 10.6.1 · turbo 2.9.7 · Chromium 149.0.7827.55 (revision 1228) ·
macOS (Darwin 27.0.0, arm64, 12 CPUs).

### Gap closure round 1 (438-17 to 438-23), 2026-10-10

This subsection appends to the Phase 438 section and rewrites none of it; written by 438-21. The
owner delegated the round's scope to the orchestrator on 2026-10-10: the six findings below, with
every other finding left open and listed as retained. The findings are those of the phase's code
review (CR-nn, WR-nn). Every commit below is in agent-qa on `version-0.2` and signed; every cell is
listed in `scripts/gate/inputs/regressions.json` with its `438 D-NN` origin. No listed cell was
re-spelled: every earlier 438 cell passes unedited.

**What was removed**

- **The heal's first-lane-only re-find** (CR-01). `regroundFailedRef` (`runner/src/loop/index.ts`)
  re-found, judged and patched only the first ref lane of the failed action, so a drag whose
  `toRef` was lost was re-dispatched with the stale `toRef` against the fresh observation. Now every
  lane (`ref`, `fromRef`, `toRef`) is re-found by `strictMatch` and judged on path `heal`, and every
  lane is patched before the one debit and re-dispatch. When any lane is not provably the same, or
  two lanes with different prior refs re-find one fresh element, nothing is sent and the binding
  block records `heal: 'absent' | 'not-unique'`. 438-17 `4b5cba028`, `a15261528`, gate-listed in
  `8c8ee0b39`. Cells:
  - `C438-HEAL-LANES a drag whose toRef binding is lost re-finds both lanes and drops on the re-found target`
  - `C438-HEAL-LANES a drag whose toRef is an unknown ref re-finds both lanes the same way`
  - `C438-HEAL-LANES a stated toTarget that contradicts the re-found drop target is refused on the heal path`
  - `C438-HEAL-LANES a drop target that is not provably the same refuses the heal and nothing is re-dispatched`
  - `C438-HEAL-LANES two lanes that re-find one element refuse the heal`
- **The heal grounding block's unmasked identities and uncapped row** (WR-01). The heal block
  redacted the name only and wrote the whole prior row text. Its role, name and row now pass the
  loop's scrub like the live block (secret redaction, then masking), and the row is capped at 200
  characters (`OBSERVED_ROW_CAP`). 438-17 `4864ae363`, `a524fde5e`, gate-listed in `8c8ee0b39`.
  Cells:
  - `C438-HEAL-EVIDENCE the heal grounding block is masked like the live block`
  - `C438-HEAL-EVIDENCE the heal grounding block caps the prior row text at 200 characters`
- **The parser's kept-lines-only ancestor stack** (CR-02). `parseAriaSnapshot`
  (`web/src/observer.ts`) held only kept lines on its ancestor stack, so the text and controls of a
  later sibling container that the tree drops were folded into, and parented under, the preceding
  row. Every matched line now bounds its subtree: a dropped line still takes a place on the stack,
  and fold and parent go to the nearest kept entry among the line's true ancestors. 438-19
  `f9594392b`, `61743d363`, gate-listed in `62269190e`. Cells:
  - `C438-ROW-PARSE a later sibling container's text and controls never fold into the preceding row`
  - `C438-ROW-PARSE in real Chromium a control after the list has no row and the last row keeps only its own text`
  - `C438-ROW-PARSE a stated row with a sibling container's words is refused on the last row's button`
  - `C438-ROW-PARSE an iframe after a list is parented under no row`
  - `C438-ROW-PARSE a table after a heading, a button and a navigation is parented under none of them`
- **A row container with no row of its own** (WR-04). `rowContainerOf`
  (`runner/src/grounding/row-text.ts`) looked only at ancestors, so a clicked `listitem`, `row`,
  `article` or `treeitem` had an unknown row and any stated row agreed. A row container is now its
  own row, then the cell fallback, each rung looking at the element itself first. The judge, strict
  replay, the cache locator's row and the web binding read the same definition. 438-20
  `4069ceae6`, `5901a2839`, gate-listed in `9e370ddb7`. Cells:
  - `C438-ROW-TEXT a row container is its own row: a listitem's row is its own text and descendants`
  - `C438-ROW-TEXT a cell with no row container above it is its own row`
  - `C438-ROW-TEXT the judge refuses a listitem stated with another row's words`
  - `C438-STATED-ROW a listitem ref stated with another row's words is refused`
  - `C438-STATED-ROW a listitem ref stated with its own row words is clicked`
- **The multiset number rule and the split thousands** (WR-03, within D-03). `numbersDiffer`
  (`runner/src/grounding/stated-target.ts`) required equal number multisets and split `$1,234.50`
  into three numbers, so "Invoice 947" stated against "Invoice 947 due 2026-10-31", and "Pay
  $1234.50" against "Pay $1,234.50", were refused. Now only a stated number absent from the
  element's name refuses. Numbers are read after NFKC, with a thousands separator (`,` or `_`
  between a digit and exactly three digits) ignored. 438-20 `c3e5b7143`, `030accb50`, gate-listed
  in `9e370ddb7`. Cells:
  - `C438-JUDGE "Invoice 947" vs "Invoice 947 due 2026-10-31" agrees (every stated number is observed)`
  - `C438-JUDGE "Pay $1234.50" vs "Pay $1,234.50" agrees (a thousands separator is ignored)`
  - `C438-JUDGE "Pay $1,234.50" vs "Pay $1,235.50" is a name-number contradiction`
  - `C438-JUDGE "Rows 1,2" vs "Rows 12" is a name-number contradiction (only a thousands separator is ignored)`
  - `C438-STATED-TARGET "Pay $1234.50" stated against "Pay $1,234.50" is clicked`
- **Unescaped row text in the planner tree** (WR-02, T-438-04). `runner/src/screen-builder.ts`
  rendered row text inside quotes without escaping, so app text could close the quote and forge a
  ref, a flag or a line. Row text is now rendered as a JSON string; text with no quote, backslash or
  control character renders as before. 438-20 `565ebace2`, `c077e5ac3`, gate-listed in
  `9e370ddb7`. Cells:
  - `C438-ROW-TREE a row text that closes its quote cannot forge a tree line`
  - `C438-ROW-TREE a backslash in row text renders escaped`

**What stays retained**

| Item | Why kept | Where recorded |
|---|---|---|
| element names in the planner tree keep their `"…"` quoting, unescaped | WR-02's recipe also covers names, but the round's scope names row text only; a planner lured to a forged ref still states an identity that is judged against the real element | `438-REVIEW.md` WR-02; the 438-20 summary |
| WINDOWS #570: a scroll's container ref gets only the document check, not the role, name and row re-check | outside the round's scope | `.planning/WINDOWS.md` #570 (438-05) |
| the vacuous cache `hit`: a step that records a miss and then records no sub-action folds to `hit` and hides `cacheMiss` | outside the round's scope; no cell reaches it, and `C438-CACHE-MISS-RECORDED` reads the hit branch, not `finalize` | `438-RECORD.md` § SC3 (438-09) |
| WR-05: row text is identity in the binding and the heal, so a row whose text changes blocks every dispatch inside it | outside the round's scope; 438-19 and 438-20 change what a row holds, not that it is identity | `438-REVIEW.md` WR-05 |
| WR-06: a committed procedure body masks `name` and keeps the raw `nameNormalized`, and a masked name never replays | outside the round's scope | `438-REVIEW.md` WR-06 |
| WR-07: a web element without a native ref is shown with a ref but cannot be dispatched | outside the round's scope; no wrong element receives input | `438-REVIEW.md` WR-07 |
| WR-08: the external measurement's refusal counter drops binding refusals whose heal never ran | outside agent-qa and outside the round's scope | `438-REVIEW.md` WR-08 |
| WR-09: `ElementInfo.text` is written raw into every handoff's `stateBefore`, though its doc says it is never serialized | outside the round's scope; since 438-19 it holds only the element's own subtree | `438-REVIEW.md` WR-09 |
| IN-01: iOS rows render no `text:`, though the prompt points the planner at it | outside the round's scope | `438-REVIEW.md` IN-01 |
| IN-02: `TargetIdentity` and `TargetMismatchReason` are defined twice | outside the round's scope | `438-REVIEW.md` IN-02 |
| IN-03: snapshot hygiene is not in one place | outside the round's scope | `438-REVIEW.md` IN-03 |
| IN-04: the heal note's wording and the action debit rule | outside the round's scope; the note's text is unchanged | `438-REVIEW.md` IN-04 |
| IN-05: the descriptor lane drops `row`, so a target-only repeated label is always ambiguous | outside the round's scope | `438-REVIEW.md` IN-05 |
| IN-06: `tau-lex.ts` imports `fts-match.ts` with a top-level `await` | outside the round's scope; a tool, not a package | `438-REVIEW.md` IN-06 |
| IN-07: quick-task test fixtures depend on ordering, and some waits are unbounded | outside the round's scope | `438-REVIEW.md` IN-07 |
| IN-08: the external measurement's summary cites defaults at an older SHA | outside agent-qa and outside the round's scope | `438-REVIEW.md` IN-08 |
| curation does not check a stated row against the observed row | curation may not import the runner's row helpers; it fails safe, as a body that misses into recovery, never a wrong dispatch | `438-RECORD.md` § Still open (438-10) |
| the eval package's offline adversarial generator finds a control by position | allow-listed by `C438-RECORD-ONLY-CLASSIFIED`; no live, heal, procedure-replay or cached path imports it | `438-RECORD.md` (438-12) |
| the live AUTO-15 run's responding model id | not captured by that run; the reader was fixed in `d048fcad6` and the run was not repeated | `438-RECORD.md` § Live AUTO-15 run (438-13) |

**What degrades, stated plainly**

- **A heal of a multi-lane action refuses when any lane is not provably the same.** A drag that the
  first-lane heal would have re-dispatched now sends nothing and re-plans.
- **A clicked row container binds and checks on its own row text.** A change in that text between
  looking and acting reads `binding-changed`, with nothing sent.
- **Real web pages' tree indentation changes where a control follows a non-kept container**, because
  the control is no longer parented under the preceding row. The `screenStateHash` of such a page
  changes; its `screenIdentityHash` and cache keys do not.
- **A stored cache locator or procedure target whose row words came from a neighbouring container
  now misses.** It is a recorded miss and a re-plan, never a wrong replay; no cache-format bump is
  needed.
- **A stated number absent from the element's name still refuses**, so "Invoice 947" against
  "Invoice 946" and "Pay $1,234.50" against "Pay $1,235.50" re-plan.

**The instruments that notice a return**

- The new cell families `C438-HEAL-LANES` and `C438-HEAL-EVIDENCE` red when a heal re-finds, judges
  or patches fewer than every lane, or records an identity unmasked or a row uncapped.
- The new `C438-ROW-PARSE` cells red when a dropped container's text or controls join the preceding
  row again; the new `C438-ROW-TEXT` and `C438-STATED-ROW` cells when a row container loses its own
  row; the new `C438-JUDGE` and `C438-STATED-TARGET` cells when the number rule returns to multiset
  equality or splits a thousands separator; the new `C438-ROW-TREE` cells when row text reaches the
  tree unescaped.
- The census cell `C438-NO-HEAL-POSITION`, unchanged, still reds on a position in the heal.
- The 434 gate's regression list grew from 956 to 980 cells over the round (7 from 438-17, 5 from
  438-19, 12 from 438-20); 219 carry a `438` origin.

**Gate**

The round's record gate run measures agent-qa HEAD after this subsection lands, and its result is
recorded with the phase's planning record, not in this file. So no docs-only commit separates the
measured SHA from the final SHA, unlike 438-14's run, which measured `5876686db` before the commit
that added its gate subsection. After 438-21's pre-gate red, `C438-IDENTICAL-CONTROLS`' `afterEach`
got the 261002-tmo 120 s hook budget (owner-delegated, as for `5876686db`) before the record run.
The first record run, at `a14de0976`, was red on one non-listed cell, `SUITE-BROWSER-MEDIA`'s
free-playhead read (1-minute load 71), and that read was made deterministic before the record run
was taken again.

### Gap closure round 2 (438-24 to 438-28), 2026-10-10

This subsection appends to the Phase 438 section and rewrites none of it, round 1's subsection
included; written by 438-27. The owner delegated round 2's scope to the orchestrator on
2026-10-10: the four findings below, with every other finding left open and listed as retained.
The findings are those of the round-1 re-review (`438-REVIEW.md`, "Gap closure round 1
re-review", at `565fbf53d`) and the phase's re-verification: CR-03, WR-10, WR-11 and IN-10. Every
commit below is in agent-qa on `version-0.2` and signed; every cell is listed in
`scripts/gate/inputs/regressions.json`, with a `438 D-NN` origin or, for the settled-seek cells,
`434 D-20`. No listed cell was re-spelled: every earlier cell passes unedited, and the round's
diffs of earlier test files add lines only, except `SUITE-BROWSER-MEDIA`'s free-playhead block
(not a listed cell), which now arms its wait through the new helpers with its expectation
unchanged.

**What was removed**

- **A healed sub-action recorded against the pre-heal observation** (CR-03). After a heal
  re-dispatched, the loop (`runner/src/loop/index.ts`) recorded the patched action, whose refs came
  from the heal's fresh observation, next to the `stateBefore` taken before the heal. Builder refs
  are positional, so curation, the failure caution and the verifier read each ref as another
  element: a healed "Save" click curated into a body naming "Cancel", and a healed drag lost its
  drop target. Now the healed sub-action is recorded, cautioned and verified against the heal's
  fresh observation (`actedState`), re-stamped with the planner call's capture stamp. A heal that
  sends nothing, and an action that never healed, keep the pre-heal pairing, and the cache write
  is unchanged. 438-24 `59eb81592`, `5f07053e9`, `795dcee2a`, `2fffe5fb0`, `d8f09c017`,
  gate-listed in `f8167dd7d`. Cells:
  - `C438-HEAL-RECORD a healed click is recorded against the fresh observation it was sent to`
  - `C438-HEAL-RECORD a healed drag is recorded against the fresh observation on both lanes`
  - `C438-HEAL-RECORD a healed sub-action is recorded against the fresh observation with the planner call's capture stamp`
  - `C438-HEAL-RECORD a heal that sends nothing is recorded against the pre-heal observation`
  - `C438-HEAL-RECORD a healed click whose re-dispatch fails is recorded against the fresh observation`
  - `C438-HEAL-RECORD a healed click whose re-dispatch fails anchors its caution to the element acted on`
  - `C438-HEAL-RECORD the verifier of a healed click reads the action against the fresh observation`
  - `C438-HEALED-BODY a healed click's procedure body names the clicked element`
  - `C438-HEALED-BODY a healed drag's procedure body names the dragged element and the drop target`
- **A nested row container without its parent row** (WR-10). Round 1's self-first rule made a row
  container that is itself the element only its own row, so the two "Invoices" items under "2024"
  and "2025" both read "Invoices": a stated parent row was refused, and `strictMatch`, the heal and
  the cache could not tell them apart. `rowTextOf` (`runner/src/grounding/row-text.ts`) now starts
  such a container's row with its nearest enclosing row container's own line (name and folded
  text), never that container's other descendants and never a second ancestor. A control inside a
  nested row container keeps that container's row. 438-25 `d48520505`, `375c479d3`, gate-listed in
  `d309e61b0`. Cells:
  - `C438-ROW-TEXT a nested row container's row is its parent row's own line, then its own row`
  - `C438-ROW-TEXT the judge agrees with a nested treeitem stated with its parent row`
  - `C438-ROW-TEXT strictMatch tells a nested treeitem from its twin under another parent`
  - `C438-ROW-TEXT the judge refuses a nested treeitem stated with another parent's row`
  - `C438-ROW-TEXT a nested row container's row does not take a sibling row's words`
  - `C438-ROW-TEXT a control inside a nested row container reads only that container's row`
  - `C438-HEAL-LANES a nested treeitem whose binding is lost heals onto the same parent's item`
  - `C438-STRICT-REPLAY a stored nested treeitem with its parent row replays onto that parent's item`
  - `C438-STATED-ROW a nested treeitem stated with its parent row is clicked`
- **Thousands separators read by the number rule only** (WR-11). Round 1 ignored `,` and `_`
  between digits only inside `numbersDiffer`, so the shared-word and row rules still split "1,234"
  into "1" and "234", and NFKC turned U+202F and U+00A0 into a plain space. Now `wordTokens`
  (`row-text.ts`) reads a digit group split by `,`, `_`, U+202F or U+00A0, between a digit and
  exactly three digits that no further digit follows, as one number; `numberTokens`
  (`stated-target.ts`) reads `wordTokens`, and the `THOUSANDS_SEPARATOR` constant is gone. A dot
  and a plain space never group. 438-25 `cfbd51648`, `e64580c21`, gate-listed in `d309e61b0`.
  Cells:
  - `C438-ROW-TEXT wordTokens reads a digit group split by a comma, an underscore, a narrow no-break space or a no-break space as one number`
  - `C438-ROW-TEXT rowContains reads "1,234" and "1234" as one number in both directions`
  - `C438-ROW-TEXT wordTokens keeps a plain space, a dot and a short group as separators`
  - `C438-JUDGE "1234" vs "1,234" agrees (a digit group is one number)`
  - `C438-JUDGE "1,234" vs "1234" agrees`
  - `C438-JUDGE "1234" vs "1 234" with a narrow no-break space agrees`
  - `C438-JUDGE "1234" vs "1 234" with a no-break space agrees`
  - `C438-JUDGE "Weight 1.234" vs "Weight 1234" is a name-number contradiction (a dot is never a separator)`
  - `C438-STATED-TARGET "1234" stated against "1,234" is clicked`
  - `C438-STATED-ROW a row stated "Invoice 1234" against "Invoice 1,234" is clicked`
- **An unbounded, position-keyed free-playhead wait** (IN-10). `SUITE-BROWSER-MEDIA`'s settled-seek
  wait (`cli/src/__tests__/conformance/424-suite-player-dom.test.ts`) awaited a promise with no
  bound and picked the free-playhead member by its span's DOM position, so a missed seek sat until
  the 120 s cell timeout, and a point on no span armed the wait on a `'missing'` source that never
  seeks. Now `settledSeek` is bounded at 10 s and rejects with
  `no settled seek on source <sha> within 10000 ms`, the member is read from the span's
  `data-timeline-member-span`, and a point no member spans, or a member with no present recording,
  fails at once with a message. No assertion, poll or budget changed. 438-26 `660e3abaf`, `fb84ebfe9`, gate-listed in `0b2619649`. Cells:
  - `C438-SETTLED-SEEK a settled-seek wait that sees no seek on the member's source fails with a message within its bound`
  - `C438-SETTLED-SEEK the free-playhead member is read from its data-timeline-member-span attribute, not its DOM position`
  - `C438-SETTLED-SEEK a point no member spans fails with a message`

**What stays retained**

| Item | Why kept | Where recorded |
|---|---|---|
| IN-09: the heal grounding block describes only the first lane, and its attempts do not say which lane they belong to | outside the round's scope; it did not fall out of CR-03, which changes the observation a healed sub-action is recorded against, not the heal block | `438-REVIEW.md` IN-09 |
| `.` locale grouping such as `1.234,50` is not normalized | a dot is ambiguous with a decimal point; WR-11's scope is `,`, `_`, U+202F and U+00A0 | `438-REVIEW.md` WR-11; the 438-25 summary |
| the cross-member double seek: a click on the free rail first seeks to a marker's offset, so the playhead briefly shows that marker's transparent circle | product behaviour, not a test read; the free-playhead poll's end-state expectation is unchanged and tolerates nothing more than before | `438-REVIEW.md` IN-10; the phase's `deferred-items.md` (438-28) |
| element names in the planner tree keep their `"…"` quoting, unescaped | still open from round 1; the round's scope does not name it | `438-REVIEW.md` WR-02; the 438-20 summary |
| WINDOWS #570: a scroll's container ref gets only the document check, not the role, name and row re-check | still open from round 1; outside the round's scope | `.planning/WINDOWS.md` #570 (438-05) |
| the vacuous cache `hit`: a step that records a miss and then records no sub-action folds to `hit` and hides `cacheMiss` | still open from round 1; outside the round's scope | `438-RECORD.md` § SC3 (438-09) |
| WR-05: row text is identity in the binding and the heal, so a row whose text changes blocks every dispatch inside it | still open; WR-10 adds the parent row's line to what a nested row container binds on, and does not change that row text is identity | `438-REVIEW.md` WR-05 and WR-10 |
| WR-06: a committed procedure body masks `name` and keeps the raw `nameNormalized`, and a masked name never replays | still open from round 1; outside the round's scope | `438-REVIEW.md` WR-06 |
| WR-07: a web element without a native ref is shown with a ref but cannot be dispatched | still open from round 1; no wrong element receives input | `438-REVIEW.md` WR-07 |
| WR-08: the external measurement's refusal counter drops binding refusals whose heal never ran | outside agent-qa and outside the round's scope | `438-REVIEW.md` WR-08 |
| WR-09: `ElementInfo.text` is written raw into every handoff's `stateBefore`, though its doc says it is never serialized | still open from round 1; CR-03 changes which observation a healed sub-action's `stateBefore` is, not what it holds | `438-REVIEW.md` WR-09 |
| IN-01: iOS rows render no `text:`, though the prompt points the planner at it | still open from round 1 | `438-REVIEW.md` IN-01 |
| IN-02: `TargetIdentity` and `TargetMismatchReason` are defined twice | still open from round 1 | `438-REVIEW.md` IN-02 |
| IN-03: snapshot hygiene is not in one place | still open from round 1 | `438-REVIEW.md` IN-03 |
| IN-04: the heal note's wording and the action debit rule | still open from round 1; the note's text is unchanged | `438-REVIEW.md` IN-04 |
| IN-05: the descriptor lane drops `row`, so a target-only repeated label is always ambiguous | still open from round 1 | `438-REVIEW.md` IN-05 |
| IN-06: `tau-lex.ts` imports `fts-match.ts` with a top-level `await` | still open from round 1; a tool, not a package | `438-REVIEW.md` IN-06 |
| IN-07: quick-task test fixtures depend on ordering, and some waits are unbounded | still open from round 1; IN-10 bounds only the free-playhead wait | `438-REVIEW.md` IN-07 |
| IN-08: the external measurement's summary cites defaults at an older SHA | outside agent-qa and outside the round's scope | `438-REVIEW.md` IN-08 |
| curation does not check a stated row against the observed row | curation may not import the runner's row helpers; it fails safe, as a body that misses into recovery, never a wrong dispatch | `438-RECORD.md` § Still open (438-10) |
| the eval package's offline adversarial generator finds a control by position | allow-listed by `C438-RECORD-ONLY-CLASSIFIED`; no live, heal, procedure-replay or cached path imports it | `438-RECORD.md` (438-12) |
| the live AUTO-15 run's responding model id | not captured by that run; the run was not repeated | `438-RECORD.md` § Live AUTO-15 run (438-13) |

**What degrades, stated plainly**

- **A healed sub-action's `stateBefore` is the heal's fresh observation**, and so are its aria
  evidence artifact and its `screenStateHash` in the handoff, while its decision screenshot stays
  the planner's pre-heal input.
- **A nested row container binds and checks on its parent's line too.** A change in that line
  between looking and acting reads `binding-changed`, with nothing sent, and the heal needs those
  words (WR-05 stays open).
- **"1,234" now agrees with "1234" in names and rows**, and a stored row with either spelling
  replays onto the other, while replayed names stay exact.
- **Procedure bodies curated from healed steps before this round are not rewritten.** The phase is
  unreleased, and re-curation goes through the normal loop.

**The instruments that notice a return**

- The new cell families `C438-HEAL-RECORD` and `C438-HEALED-BODY` red when a healed sub-action is
  recorded, cautioned or verified against the pre-heal observation again, or its procedure body
  names an element other than the one acted on.
- The new `C438-ROW-TEXT`, `C438-HEAL-LANES`, `C438-STRICT-REPLAY` and `C438-STATED-ROW` cells for a
  nested treeitem red when a nested row container loses its parent's line or takes a sibling's
  words; the new `C438-ROW-TEXT`, `C438-JUDGE`, `C438-STATED-TARGET` and `C438-STATED-ROW` cells for
  digit groups red when any rule splits a digit group again, or a dot or a plain space starts to
  group.
- The new cell family `C438-SETTLED-SEEK` reds when the free-playhead wait loses its bound or its
  message, or picks the member by DOM position again.
- The census cell `C438-NO-HEAL-POSITION`, unchanged, still reds on a position in the heal.
- The 434 gate's regression list grew from 980 to 1011 cells over the round (9 from 438-24, 19 from
  438-25, 3 from 438-26); 247 carry a `438` origin, and the three settled-seek cells carry
  `434 D-20`.

**Gate**

The round's record gate run measures agent-qa HEAD after this subsection lands, and its result is
recorded with the phase's planning record, not in this file, as in round 1. So no docs-only commit
separates the measured SHA from the final SHA.

## 2026-10-11 — Phase 439: Requested-outcome proof (V2-EXEC-01)

This section appends to the register and rewrites no earlier section. Phase 439 removed every path
that let a step pass on something other than evidence that what it asked for happened: the
assertValue short-circuit, the verifier's default-pass rule and its presumption of success, the
web `waitFor` that reported success on timeout, the old Rule 19 that set `stepComplete`
immediately after a pure action, the assertValue network read that consumed the log, and the
call-free limit stop. In their place, the verifier lists the step's requested conditions, each
quoting the step and citing evidence; the runner checks every quote and citation, applies its own
guards and computes the pass; and every ending that is not a pass is judged and names what is
unproven. It kept every reader of persisted history and one verifier-less test seam. The section
follows the 2026-10-09 Phase 438 shape. Dated 2026-10-11; written by 439-08.

### The ruling

> V2-EXEC-01: A step, whether action or assertion, passes only on current, direct evidence that
> every requested condition holds (AUTO-12 applied to ordinary action steps).

From `.planning/REQUIREMENTS.md`. The owner picked the recommended option on every question asked
("do whatever is recommended but keep the phase faster"); the recommended defaults applied to the
questions left unasked were listed at the final check and accepted. They are recorded as
D-01..D-24 in `.planning/phases/439-requested-outcome-proof/439-CONTEXT.md`:

- D-01 a control's purpose counts: a click on an effect control (Submit, Save, Send, Pay, Delete,
  Export, Download) needs its effect in evidence; a tab, link or menu passes once the click lands;
- D-02 the verifier splits the step into conditions, each quoting the step, and the runner checks
  that the quotes cover every word of the step that is not a stop word;
- D-03 the verifier judges from the whole step's record: every action with its outcome and
  operation evidence, every value read, and the settled start and final screens; never the
  planner's reasoning, and never the author's context as evidence;
- D-04 completed downloads and the latest app clipboard write carry to later steps of the same
  test, labelled with their step and action; screens and earlier reads never carry; the bytes are
  held in memory, bounded, and never written to artifacts;
- D-05 a negative screen condition is met by its absence where it would appear; an app-side
  negative needs the app's own evidence;
- D-06 a masked value is judged by its placeholder;
- D-07 a step that is not proven ends `failed`, with typed per-condition verdicts (met, not met,
  unverified, inconclusive) and no new status anywhere;
- D-08 the verifier judges every ending that is not a pass (give-up, infeasible, limit stop), once,
  recorded but not debited; timeout, abort and cancel stay call-free;
- D-09 the reason names what is not proven;
- D-10 each met condition cites evidence the runner can find; the runner computes the pass;
- D-11 a pass whose own reasoning admits the action did not happen is refused, and Rule 19 is
  rewritten;
- D-12 every completion goes through the verifier, and a census proves every production door binds
  one;
- D-13 web `waitFor` fails on timeout;
- D-14 `assertValue` passes only on a real read;
- D-15 replay re-verifies live, and nothing marks a verdict as replayed;
- D-16 the runner itself checks open dialogs, real limits and narrowed re-checks;
- D-17 a saved file is checked by the runner by exact name and content, and its text never enters
  a prompt;
- D-18 a save is proven by a re-read after a reload or reopen;
- D-19 a visual condition judged without an image is inconclusive, and vision follows the model;
- D-20 acceptance is model-free paired regressions in agent-qa, in 434's named-cell list;
- D-21 the records owed: this section, two REQUIREMENTS reconciliations and the phase record;
- D-22 to D-24 one external live measurement on the final SHA, which gates nothing, and its report.

D-20 keeps agent-qa free of fixtures (437 D-19): every page is a small HTML string in its test
file, loaded in real headless Chromium, or a loopback `node:http` server defined in the same file
where a reload must see persisted state.

### How this inventory is measured

| Instrument | What it claims | Where |
|---|---|---|
| the census | `C439-CENSUS`: `executeStep` runs only in the member runner and the live editor, each binding a verifier; the member-run input requires one; both CLI scope-consumer factories build `new LLMVerifier(`; every production `runMemberTest(` takes a config from `buildMemberRunConfig`; and the composition files never name the injected executor. With `C439-UNIVERSE-FLOORS` and `C439-SELF-MATCH`. Needles are two halves joined at run time, and comments are blanked by the lexer the 432 to 438 censuses share. 4 cells, in `validate:arch`. | `packages/arch/src/__tests__/439-verifier-binding-census.test.ts` (439-04 `f7c1b1889`) |
| the vision gate census | `C439-VISION-GATE`: both CLI gates resolve vision with `visionFromConfig(configured, capabilities)`, and the live editor resolves its gate from its model and binds it on its ports. 2 cells, in `validate:arch`, in the same file. | the same file (439-06 `fca42e543`) |
| the runtime key sets | `C439-KEY-SETS`: a condition record carries exactly its eight members, the block exactly ending, conditions and openDialogs, a verdict exactly the four literals; the handoff schema version is still 7; a well-formed block loads, three malformed blocks are refused, and a handoff with no block loads unchanged. 9 cells. | `packages/schema/src/__tests__/439-key-sets.test.ts` (439-02 `a760a23cb`) |
| the behaviour cells | 183 model-free cells by name in the 434 gate's regression list, each with the `439 D-NN` decision it proves, in the schema, runner, web, agent, model, CLI and arch packages, the census and key-set cells above included. 31 families: `C439-COMPUTED-PASS` 5, `C439-JUDGE` 8, `C439-COVERAGE` 7, `C439-PHRASES` 13, `C439-CHECKS-LOOP` 4, `C439-KEY-SETS` 9, `C439-ROUTER-UNPROVEN` 7, `C439-ROOT-CAUSE` 6, `C439-UNPROVEN-ANALYSIS` 4, `C439-UNPROVEN-REASON` 1, `C439-STEP-RECORD` 5, `C439-PROMPT` 1, `C439-VERIFIER-PROMPT` 3, `C439-ENDINGS` 7, `C439-ASSERT-EVIDENCE` 3, `C439-CENSUS` 4, `C439-WAITS-AND-READS` 6, `C439-FARM-WAITS` 3, `C439-ASSERT-COMPARE` 14, `C439-REPLAY` 5, `C439-CARRY` 4, `C439-CARRY-MEMBER` 1, `C439-AUTO12` 12, `C439-GUARDS` 18, `C439-VISION` 4, `C439-CONFIGURED-VISION` 2, `C439-VISION-GATE` 2, `C439-SAVED-FILE` 6, `C439-DOWNLOAD-HOLD` 1, `C439-FILE-COMPARE` 12, `C439-JUDGED-CASES` 6. 439-08 ran every file holding a `C439-` cell with the JSON reporter: 183 `C439-` full names found, every one listed, none listed and missing. | `scripts/gate/inputs/regressions.json` (439-01 to 439-07, each in the commit that adds the cell) |

No live-model cell was added. Whether a live model splits, quotes and cites as the new contract
asks, and how often it now ends unverified, is the external live measurement's question (D-22).

**This file names retired shapes literally**, as the 2026-09-02 section explains for the whole
register. `DELETION-INVENTORY.md` sits outside every census region.

### What was removed

Baseline `5099723ed2c8dd658d80197d311187e0fb4cf98e` (`version-0.2`, the parent of 439's first
agent-qa commit `b86d5152b`). Code-closing HEAD `08fa97c1176ec77bc503b6c673b55dd060672335`, the
last commit before this section. `git diff --shortstat 5099723ed..08fa97c11`: 109 files changed,
9,819 insertions, 464 deletions; no file deleted. 21 commits, every one signed.

- **The verifier's final `success` boolean.** `VerificationResultSchema` (`runner/src/loop/
  verifier.ts`) returned `{ success, reasoning, isAppError }`, and the loop took `success` as the
  step's verdict. It is now `{ conditions, dialogs, isAppError, reasoning }` with no overall success
  member: each condition carries its quote, verdict, needs, citations and reasoning, and
  `judgeConditions` (`runner/src/loop/requested-conditions.ts`) computes the pass. A met condition
  whose citation the runner cannot find in what the verifier was given is unverified; an empty list
  never passes; the model-error fallback is `conditions: []` with `verifierError`, never a pass
  (439-01 `b86d5152b`, `99218e612`). `C439-COMPUTED-PASS`, `C439-JUDGE`.
- **The verifier's default-pass rule and its presumption of success.** The stable tier
  (`buildVerifierStableTier`, `runner/src/loop/prompts.ts`) said "If the action targeted a valid
  element and no error or contradicting state is visible, the goal is likely accomplished", and for
  every non-assertion step "return success unless an error appears or the AFTER screen positively
  shows that outcome did not happen … Outcomes that later steps perform are not required." Both are
  gone. The tier now states the per-condition contract in twelve sentences under "Requested
  conditions:" and keeps HARN's rule that no visible change is not failure and a change is not
  success (2,693 characters before, 4,389 after; 439-03 `24a7fdc18`). `C439-VERIFIER-PROMPT the
  stable tier states the per-condition contract`.
- **The verifier's last-action window.** The verifier saw the step text, the last action and the
  screens just before and after it, with input evidence only when notable. It now sees one bounded
  record of the whole step: every action with its outcome, acted element, masked error and
  operation evidence, every read, carried lines from earlier steps, and the settled start and
  final screens (`runner/src/loop/step-record.ts`; at most 40 action lines, 300 characters a line
  and 50 entries a list; 439-03 `cce36be59`). `C439-STEP-RECORD`.
- **The assertValue short-circuit.** A passing `assertValue` with `stepComplete` ended the step as
  passed with no verifier call (`executeStep` return path 3, verdict source `'assert-value'`, its
  own cache write and two `finish` returns). The block, its `readAssertValueOutcomeMeta` read and
  its loop import are gone; a passing read is now a cited line of the record, so a step that asks
  for two things cannot pass on one check (439-04 `f7c1b1889`). `C439-ASSERT-EVIDENCE two requested
  things cannot pass on one check`, `C439-ASSERT-EVIDENCE a passing read is cited evidence for its
  own condition`.
- **The "8 surviving return paths" header.** `executeStep`'s header comment read "The 8 surviving
  return paths (v1 had 9; the exec-fail-limit path is deleted, D-10)", listing "3. assertValue +
  complete → passed | failed (comparator short-circuit, no verify)" and "6. no-verifier +
  stepComplete → passed (trust the planner)". It now reads "The return paths", lists today's eight,
  and labels the no-verifier path a test seam proven unreachable from production (439-04
  `f7c1b1889`). `C439-CENSUS executeStep runs only behind a bound verifier`.
- **The call-free limit stop and the unjudged give-up** (436 D-13's "no model call is made at
  exhaustion"). A planner give-up, an infeasible declaration and both limit stops ended without a
  verifier call, so a bare "N/A" could be the only explanation. Each now settles once, makes one
  recorded and undebited verifier call over the step's record, records the per-condition block and
  appends what is unproven after its own reason (`Step failed: <reasoning> — <unproven>`,
  `Step declared infeasible: <reason> — <unproven>`, `<limit reason> — <unproven>`). An ending never
  becomes a pass, even with every condition met (439-04 `e232d777d`). `C439-ENDINGS`.
- **The old Rule 19 text.** "19. ACTION STEP COMPLETION: When the step instruction is a pure action
  … set stepComplete: true immediately. Do NOT retry expecting a visible screen change. … This rule
  applies to SINGLE-ACTION steps only." It is now "19. COMPLETION NEEDS ITS OUTCOME IN EVIDENCE":
  claim completion only when the requested outcome is in evidence and name it; a neutral control's
  outcome is the landed click, an effect control's is the effect; a kept value is proven only by a
  re-read after a reload or reopen; the same placeholder is the same value. Rules 20 to 23 are
  unchanged (439-03 `24a7fdc18`). `C439-PROMPT Rule 19 is the 439 text`, `C436-PROMPT Rule 23 is
  byte-unchanged`.
- **The web `waitFor` timeout success, on both web adapters.** `web/src/adapter.ts` and
  `web/src/farm-adapter.ts` caught the timeout with "Best-effort — condition never satisfied; let
  the loop re-observe." and returned `{ success: true }`. They now return a failure in the mobile
  adapters' words (`waitFor: text "<text>" did not appear within <ms>ms.`, `… was still present
  after <ms>ms.`, `waitFor: selector "<selector>" did not appear within <ms>ms.`), which reaches the
  next planning turn (439-05 `49047ed61`). `C439-WAITS-AND-READS a text that never appears fails the
  wait and the planner sees why`, `C439-FARM-WAITS a wait whose condition never holds fails and
  names what it waited for`.
- **The assertValue network drain.** Both web adapters' `assertValue { source: 'network' }` read
  called `drainNetworkLogs()`, which consumed the entries the step-end evidence should have
  received. It now calls `peekNetworkLogs()`, which leaves the drain index alone, and passes only on
  a matching entry (439-05 `49047ed61`). `C439-WAITS-AND-READS a network assertion reads without
  consuming`, `C439-FARM-WAITS a network assertion peeks at the log and leaves it for the step-end
  drain`.
- **The comparator's passes on an unread value.** `compareAssertValue`
  (`runner/src/compound/assert-value.ts`) let `isNull`, `isDefined` and `notEquals` pass on an
  undefined actual, and coerced `null` to the string `'null'`. An undefined actual now fails every
  op, `null` passes `isNull` only, a network read passes only `isDefined`, `contains` or `equals` on
  a matching entry, and `source: 'expr-result'` is refused before dispatch (439-05 `49047ed61`).
  `C439-ASSERT-COMPARE`, `C439-WAITS-AND-READS expr-result reads nothing and fails`.
- **An empty step folded to a cache `hit`.** `foldCacheStatus([])` returned `'hit'` vacuously; it is
  now `'miss'` (439-05 `8f70676c7`). That is the fold behind the vacuous `hit` the Phase 438
  section lists as retained. `runner/src/loop/__tests__/evidence.test.ts` (`empty step ⇒ miss`, not
  a listed cell).
- **The CLI's `vision ?? true`.** Both CLI gates (`cli/src/commands/run.ts`) used
  `plannerCfg.vision ?? true`, and the live editor bound no vision gate. All three now resolve with
  `visionFromConfig(configured, capabilities)` (439-06 `fca42e543`). `C439-VISION-GATE`,
  `C439-CONFIGURED-VISION`.
- **The screenshot instruction on a text-only turn.** "Analyze the attached screenshot for visual
  cues …" sat in the stable tier for every model; it now rides only a turn that carries an image
  (439-03 `24a7fdc18`). `C439-VERIFIER-PROMPT the screenshot paragraph rides only a turn with an
  image`.

### What was RETAINED, and why

| Item | Why kept | What pins it |
|---|---|---|
| the no-verifier completion branch in `executeStep` | a test seam: unit tests drive the loop without a verifier; no production door reaches it | `C439-CENSUS executeStep runs only behind a bound verifier`, `C439-CENSUS the member-run input requires a verifier` |
| `VerdictSource 'assert-value'` (`schema/src/handoff/verb-evidence.ts`) | no new run writes it; old handoffs carry it, and the authoring router and eval fixtures still read it | the router's existing cells (`agent/src/authoring/__tests__/router.test.ts`) |
| `readAssertValueOutcomeMeta` in `runner/src/compound/metadata.ts` | the loop no longer imports it; tests still read the outcome meta it parses | not pinned by a 439 cell |
| `LimitStopEvidence.requestedOutcome: 'unverified'` (`schema/src/handoff/limit-evidence.ts`) | its field and value stay; the per-condition block sits beside it (D-08 supersedes 436 D-13's call-free stop, not its record) | `C439-ENDINGS an action-limit stop observes, then is judged` |
| the setVariable short-circuit | the runner sets the variable itself, so there is no outcome to verify (D-12) | `C439-ASSERT-EVIDENCE setVariable with stepComplete stays call-free` |
| Android and iOS network assertions unavailable | D-14 changes the web reads only | not pinned by a 439 cell |
| replay without a planning call, and no replay marker | a cache hit and procedure replay keep going through the verifier on a fresh observation, so `eval-and-core-types.md`'s "marked as replayed" is owed only if hit-side verification is ever skipped (D-15) | `C439-REPLAY` |
| the tool envelope and `toolSchemaDigest`, `screenIdentityHash` and the cache keys | the new vocabulary is in the verifier's structured output and the handoff, not in the planner's tools | `validate:tools` (14, unchanged) |

### What degrades, stated plainly

- **Verifier calls per step go up.** One more call at every give-up, infeasible declaration and
  limit stop (D-08), and one at every step that a passing `assertValue` used to end (D-12). Each
  ending also spends one 500 ms settle when a verifier is bound.
- **A step whose conditions leave a word of the step uncovered, or reword it, is unverified**, and
  a pass whose own or the planner's reasoning admits the action did not happen is not met. The
  admission list is English-only, and a same-verb negation about another object is refused too.
- **A web `waitFor` that times out is now a failure** the planner sees and re-plans on.
- **`assertValue { source: 'expr-result' }` is refused**, an `expr` evaluating to `undefined` no
  longer satisfies `isNull`, and `equals "null"` no longer passes on a null read.
- **A save is not proven by "Saved".** A persistence condition needs a reload or reopen after the
  last state-changing action and a final-screen citation.
- **Screens with an open dialog re-partition the cache.** The web observation now keeps `dialog`
  and `alertdialog`, so `screenIdentityHash` changes on those screens and refs after the dialog
  shift by one; a dialog's child text folds into the dialog node.
- **Unknown models default to text-only where the config leaves `vision` unset.** This holds in the
  live editor. On the CLI the model config schema defaults `vision` to true, as
  `spec/v2/model-and-runtime-config.md` says, so an unknown model still gets screenshots there
  unless its config says `vision: false`; whether D-19's fallback should also apply on the CLI is
  an open owner decision.
- **A condition that only a picture can settle, judged without an image, is inconclusive**, and the
  step cannot pass.
- **The verifier turn's bytes changed**: the record replaces the action line and the before/after
  pair, and a "Controls with reported limits:" block appears when a final-screen control reports a
  min or max.

### Persisted values that keep reading

| Persisted value | Disposition | Evidence |
|---|---|---|
| handoff schema version 7 with the new optional `StepEvidence.conditionVerdicts` (`schema/src/handoff/condition-evidence.ts`) | **Written by new runs, optional to readers.** `CURRENT_HANDOFF_SCHEMA_VERSION` stays 7; the loader admits the block only in traversable form and a handoff without it loads unchanged. The router, root-cause classifier, analyze-run and the evidence diet read an unproven step as a typed non-pass. | `C439-KEY-SETS`, `C439-ROUTER-UNPROVEN`, `C439-ROOT-CAUSE`, `C439-UNPROVEN-ANALYSIS` |
| `LimitStopEvidence.requestedOutcome: 'unverified'` | **Read and still written**, with the per-condition block beside it. | `C439-ENDINGS an action-limit stop observes, then is judged` |
| `verifierVerdict.pass` | **Still a boolean**, now carrying the runner's computed result; the strict dashboard schema reads it unchanged. | `C439-COMPUTED-PASS` |
| the `'assert-value'` verdict source in old handoffs | **Read, never written.** | the router's existing cells |

### Accepted risks

- **The phrase check is English-only** and refuses a same-verb negation about another object
  (T-439-09). Its patterns are documented in `requested-conditions.ts`'s header.
- **A met condition passes on one found citation** even when another of its citations is found
  nowhere, so a total citing a read page and an unread page passes. Whether every read citation
  must be found is an owner decision, recorded open in the phase's `deferred-items.md`.
- **CRLF equals LF and one leading BOM is ignored** by the saved-file comparator (RESEARCH A5), so
  a CRLF-only defect passes. Recorded for the owner.

### The instruments that notice a return

- **`pnpm run validate:arch`** runs the 439 census after the 438 file. A new production door that
  runs a step without a verifier, a member-run input with an optional verifier, a consumer factory
  that builds none, or a vision gate that does not go through `visionFromConfig` reds by name on
  the commit that adds it.
- **The 434 gate** (`pnpm run gate:local`) must execute and pass all 183 listed 439 cells: a
  default-pass verifier, a short-circuited assertValue, a timeout `waitFor` success, a draining
  network read, an unjudged ending or a Rule 19 that completes on dispatch reds there. No mutation
  driver was added.

### Not observed, stated as such

- **No live model ran in agent-qa.** Every cell uses a scripted planner and a scripted or fake
  verifier, so whether a live model splits a step, quotes it and cites evidence as asked, and judges
  totals, positions and dead submits correctly, is measured by an external live measurement on the
  final SHA (D-22), which agent-qa never reads; it gates nothing.
- **No mobile device ran.** Android and iOS dialog and limit detection are unit cells on inline page
  sources.
- **The live editor's vision gate** is pinned by census, not exercised in a live session.

### Reconciliation

D-01 reads `spec/v2/harness-action-outcomes.md` § Decision's "an instruction that requests only an
interaction may be satisfied by evidence of that interaction" so that a click on an effect control
requests its effect. D-04 reads V2-EXEC-01's "current, direct evidence" to include a download or the
latest app clipboard write from an earlier step of the same test, labelled with its step and action.
Both are recorded in `.planning/REQUIREMENTS.md` by 439-08 as reconciliations 21 and 22.

### Gate at the time of writing (2026-10-11)

Run by 439-08 from `agent-qa/` with `pnpm run gate:local -- --out <dir>`, at turbo's default
concurrency (434 D-20). The gate clones the committed SHA into a fresh temporary directory, installs
with the frozen lockfile and runs every leg there. It ran on
`741a7b2506d36470843ca98549cd53964c8240f5`. That commit is this section without this subsection,
on top of the code-closing HEAD `08fa97c11`; no gate input changed in this plan, because every
`C439-` cell was already listed. The source tree was clean (`sourceDirty: false`). The run lasted
10 min 3 s (00:41:39Z to 00:51:42Z on 2026-10-11 UTC). The 1-minute load was 1.6 at the start, and
the 1- and 5-minute loads were 5.0 and 17.4 at the end. It is the phase's first and only gate run;
it was green on its first run.

| Leg | Observed | Exit |
|---|---|---|
| clone, install | fresh clone at the SHA; `pnpm install --frozen-lockfile` | 0, 0 |
| turbo build and typecheck | 46/46 tasks | **0** |
| turbo test | 46/46 tasks; 23,993 passed, 0 failed, 56 skipped, every skip a registered entry | **0** |
| `validate:skills`, `validate:agents`, `validate:publish` | 4, 24 and 22 checks | **0** |
| `validate:tools` | 14 passed, the same 14 as at `5099723ed`, so no agent tool was added | **0** |
| `validate:arch` | 538 passed (532 at `5099723ed`, plus the 4 `C439-CENSUS` and 2 `C439-VISION-GATE` cells) | **0** |
| `validate:safety`, `validate:431-discovery-imports`, `lint:namespace` | 9 passed; 885 imports; 3,098 files | **0** |
| node-test, conformance selftest, conformance | 153 passed; 4; 50 | **0** |
| audit (`pnpm audit --prod --json`) | 493 prod dependencies: critical 0, high 0, moderate 5, low 1. pnpm 10.6.1 exits 1 on any advisory, and the gate judges the JSON metadata (434's owner decision) | 1, judged pass |
| regressions | **1194 of 1194 listed cells executed and passed**: 434's 43, Phase 436's 459, Phase 437's 262, Phase 438's 247 and Phase 439's 183 | — |
| register | 55 entries, 56 skips matched, 0 stale, 0 unlisted, 0 conditional entries run | — |

Verdict: `gate green: 0 finding(s)`, `record: true`, exit **0**. Before the gate, `pnpm build`,
`pnpm typecheck` (0 `error TS`), `validate:arch` (538), `validate:tools` (14), `validate:skills` and
`validate:publish` each exited 0 in the working tree at the same SHA. The commit that adds this
subsection changes only this file, which no test reads.

**Toolchain:** node 24.15.0 · pnpm 10.6.1 · turbo 2.9.7 · Chromium 149.0.7827.55 (revision 1228) ·
macOS (Darwin 27.0.0, arm64, 12 CPUs).

## 2026-10-12 — Phase 440: Authoring intent (V2-EXEC-02)

This section appends to the register and rewrites no earlier section. Phase 440 removed the paths
that let an authored test lose a value the user stated: refine's input carried only the scope, so
its prompt never held the request; compile's only post-check was the config target name; the final
write published without looking at the request; and the op's caller line read every refusal as a
duplicate. In their place, one plain-code check with no model call lists the request's quoted
strings, numbers, prices and dates, and compile, refine, repair and keep each require the draft's
steps to carry every one of them word for word. A loss is refused at compile, dropped at refine,
fenced at repair and refused at keep; nothing that lost a stated value is written. It kept the
draft-keyed retrieval, the single refinement round, the router, dedup, the saved receipt and the
abandonment kinds. The section follows the 2026-10-11 Phase 439 shape. Dated 2026-10-12; written by
440-06.

### The ruling

> V2-EXEC-02: The authoring compile, refine, keep and repair paths preserve the values the user
> stated (amended 2026-10-12, reconciliation 24).
>
> - **The prompts.** Compile and refine put the user's stated subject, values and checks over
>   project knowledge, and refine receives the request.
> - **The check.** One plain-code check, with no model call, requires every quoted string, number,
>   price and date in the request to appear word for word in the draft. A draft or patch that loses
>   one is refused, dropped or fenced, naming the missing values, and is never written. A green run
>   of a test that lost a stated value is not success.
> - **Not enforced.** An unquoted subject swap, or a dropped check with no stated value.
> - The historical "Kitchen Appliances" → "All Products" substitution (made at compile, with no
>   repair) is reproduced on a local fixture. It is closed by a regression through the public
>   authoring path (MCP `agent_qa_write_test` or `fn authoring.draft.write`).
> - If the defect no longer reproduces, it is reported as a regression test, never as a freshly
>   reproduced defect.

From `.planning/REQUIREMENTS.md`. The owner picked the recommended option on every question asked
("please keep the phase quick", 2026-10-11), then shrank the phase ("Let's shrink it", 2026-10-12)
after the Phase 441 discussion found the first plans adding a guardrail scan. Reconciliation 24
records the shrink, and `.planning/phases/440-authoring-intent/440-CONTEXT.md`'s amendment block
holds the decisions as amended:

- D-01 (a model judge with coverage and citation checks) is replaced by D-03 alone;
- D-02 anything may change except a stated value: steps and checks may be added and unquoted words
  reworded, and a vague request is never refused;
- D-03 a stated value is a quoted string, a number, a price or a date, and it must appear word for
  word in the draft's steps, case kept, with only whitespace runs tidied;
- D-04 compile and refine each get one line: the request's stated subject, values and checks win
  over project knowledge;
- D-05 a compile draft that lost a stated value is refused before any run, with no retry;
- D-06 refine receives the request; a patch that loses a stated value is dropped and the compiled
  draft goes on; the retrieval query stays the draft's words;
- D-07 a repair patch that loses a stated value is fenced and counts as one of the 3 tries; the
  existing abandonment kinds stay;
- D-08 keep checks the exact draft right before it is written, with no verdict cache;
- D-09 the outcome stays `refused`, with one optional field naming the stage and the missing values;
- D-12 both skill copies gain one line: show the missing values, stop, never reword the request;
- D-13 "reproduced" means the public-path cell run once on the pre-fix code with a scripted model;
- D-14 every case goes through `invokeFunction('authoring.draft.write')` with a fake shelf;
- D-15 acceptance is model-free cells in 434's named-cell list;
- D-17 the records owed: this section, the phase record and the folded todo.

D-10 (change records), D-11 (the intent map) and D-16 (the live-model run) were dropped.

**This file names retired shapes literally**, as the 2026-09-02 section explains for the whole
register. `DELETION-INVENTORY.md` sits outside every census region.

### What was removed

Baseline `288e41d4a11188eb6aa78d24598be3532d8b5c6e` (`version-0.2`, the parent of 440's first
agent-qa commit `354f53996`). Code-closing HEAD `7b9f0ed1001ab87275dd7db440a2f8792b0f8f9e`. `git
diff --shortstat 288e41d4a..7b9f0ed10`: 24 files changed, 1,846 insertions, 50 deletions; no file
deleted. 11 commits, every one signed. The gate list commit `34af72b54` follows it and adds the 71
`C440-` entries.

- **Refine's request-free input (the implicit exclusion of the request).** `refineDraft(draft,
  input: { readonly scope: ScopeKey }, deps)` took only the scope, so the request could not reach
  the refine prompt, which showed the draft and the project knowledge and nothing else. The
  header's "WHY THE QUERY IS THE DRAFT AND NOT THE INTENT" argued for the retrieval query; the prompt
  inherited the exclusion without a reason of its own. The input is now `{ scope, intent }`: the
  request is the prompt's first context block, titled `Intent`, and the `Role` body ends with
  `REQUEST_WINS_INSTRUCTION`. `draftRetrievalQuery(draft)` is still the retrieval query and
  `REFINEMENT_ROUNDS = 1` is unchanged; the header gained one dated line saying so. After
  `applyPatches` stages a draft, a patch that loses a stated value answers `not-applied` with
  `statedValuesMissingReason(missing)`, and the compiled draft goes on (440-04 `cdb3103d5`,
  `da67b9b80`). `C440-REFINE-REQUEST`, `C440-PROMPTS`, `C440-VALUE-REFINE`.
- **Compile's target-name-only post-check.** `compileDraft`'s only check of what the model wrote
  was that the config `target` is a configured name. That check stays. `runAuthoringLoop` now
  extracts the stated values once (`extractStatedValues(input.intent)`, in the new
  `agent/src/authoring/stated-values.ts`, 440-01 `6e85d2043`) and checks the compiled draft's steps
  before refine runs. A loss returns `refused` with `statedValueRefusal: { stage: 'compile',
  missingValues }`, the compiled draft's `draftRef`, no receipt and zero runs, and is not retried.
  The compile `Role` body ends with `REQUEST_WINS_INSTRUCTION` (440-02 `5be11c28a`).
  `C440-PUBLIC-PATH`, `C440-VALUE-COMPILE`, `C440-PROMPTS`, `C440-STATED-VALUES`,
  `C440-FALSE-REFUSAL`.
- **The unchecked final write.** `writeFinalDraft(draft, receipt, shelf)` published every
  disposition except `rejected` without looking at the request. `writeFinalDraft(draft, receipt,
  shelf, statedValues)` now checks the exact draft it is about to write and answers `{
  missingValues }` instead of publishing. It still holds the only `.publish(` in `loop.ts`.
  `routeAfterVerify` takes the values as a required fourth parameter, and all three write sites
  (keep-eligible and proposal-only, draft mode's `unverified`, a repaired draft's final receipt)
  answer `refused` with `stage: 'keep'`, the checked draft's ref, its receipt and the runs already
  spent (440-05 `b699a26cf`). `C440-VALUE-KEEP`.
- **Repair's request-blind patch.** `repairDraft` never saw the request; only the identity and
  passing-prefix fences and the credential screen looked at a patch. `RepairDeps.statedValues` is
  now required, and `fencePatchAgainstStatedValues` runs after the `unparsable` check and before the
  unchanged credential screen. A patch that loses a value starts no run, spends one of
  `REPAIR_ITERATION_CAP`'s 3 tries, does not advance the candidate, and the next prompt names the
  missing values (440-05 `7b9f0ed10`). `C440-VALUE-REPAIR`.
- **`classify` reading every refusal as a duplicate.** The op's caller line answered every
  `refused` output `duplicate` or `duplicate-of:<ref>`. A refused output carrying
  `statedValueRefusal` now answers `stated-values-missing:<stage> "<value>", …` with the spent
  suffix, ahead of the duplicate branch (440-02 `5be11c28a`). `C440-REFUSAL-FIELD`.
- **The output schema's digest.** `AuthoringDraftWriteOutputSchema` gained the optional
  `statedValueRefusal` (strict: exactly `stage` and a non-empty `missingValues`) and three rules: it
  rides only on `refused`, never beside the duplicate `refusal`, and a `refused` output carries one
  of the two. The golden's `authoring.draft.write` `outputSchemaDigest` moved from `aaca3f5b…7c26f59`
  to `e1135af5…2e045fea`; its input digest and the capability catalog did not move. Both schema
  barrels export the four names (440-02 `5be11c28a`, 440-03 `e2136fb28`). `C440-REFUSAL-FIELD`.
- **One re-spelled intent.** agent-local's twelve-draft cell ended its intents `(0)` to `(11)`,
  numbers its drafts never carried. They now end `(a)` to `(l)`; the title, count and assertions are
  unchanged (440-01 `b79e69d7e`). `C432-TEST-WRITE-DISPOSITION: twelve drafts are twelve written
  files, and none waits to be accepted`.

No byte-pinned prompt test moved: the refine prompt has no title pin, and the compile block titles
are pinned unchanged by `C440-PROMPTS the compile block titles are unchanged`.

### What was RETAINED, and why

| Item | Why kept | What pins it |
|---|---|---|
| `draftRetrievalQuery(draft)` as refine's retrieval query | the request was already retrieved against at stage 1 (394 D-18); `spec/v2/test-authoring.md` §5's draft-as-query refinement is unchanged (D-06) | `C440-REFINE-REQUEST the refine retrieval query is still the draft's words, not the request` |
| `REFINEMENT_ROUNDS = 1` and the unconditional round | D-06 keeps the round's shape; the check only decides whether a patch is applied | `C440-VALUE-REFINE a no-op round makes no change and needs no check` |
| the router's rules | the model never routes; a faithful draft the app disagrees with stops on rule 2 and writes nothing (411 D-10) | `C440-PUBLIC-PATH a faithful draft the app disagrees with stops on rule 2 and writes nothing` |
| dedup (`dedup.ts`) and the duplicate `refusal` payload | not this phase | `C440-REFUSAL-FIELD the refusal never rides beside a duplicate refusal` |
| `DraftReceiptSchema`, the verify op's input and the saved receipt | D-11 was dropped, so nothing new is saved and no outside caller can supply a "faithful" claim | the golden: only `authoring.draft.write`'s output digest moved |
| the edit op (`authoring.draft.edit`) | it carries no request to check against | not pinned by a 440 cell |
| the funnel's reading of persisted receipts, and its side counters | no side counter was added (440-01 decision 6) | not pinned by a 440 cell |
| the abandonment kinds `exhausted` and `prefix-regressed` | D-07 as amended: a value-refused try is an ordinary spent try | `C440-VALUE-REPAIR running out after value refusals keeps the existing abandonment kinds`; `loop.test-d.ts` unchanged |
| `screenDraftForCredentials` (after refine in `loop.ts`, after the patch in `repair.ts`) and the registry's required audit-sink stub | Phase 441 removes both (reconciliation 23); 440 adds no new caller of the scan | the existing `repair-credential-screen.test.ts` cells |
| compile's target-name check | unrelated to the request's values | the existing compile cells |
| the agent barrel `agent/src/index.ts` and the tool envelope | no agent tool and no barrel export was added | `validate:arch`'s barrel lint; `validate:tools` (14, unchanged) |

### What degrades, stated plainly

- **What is not enforced** (reconciliation 24): an unquoted subject swap, and a dropped or narrowed
  check that carries no stated value. The prompt line makes them less likely; nothing refuses them.
- **A vague request is never refused**, whatever the draft says.
- **A quoted value found only outside the steps is refused.** Only the steps are searched, never the
  test name, `context` or `target`, so a quoted target name that no step mentions is refused.
- **The match is exact.** A case change, a singular or plural, a trimmed value, or a number spelled
  differently (`10` against `10.00`) is a loss. Canonical Unicode is tidied (NFC) and compatibility
  forms are not, so a full-width digit does not match its ASCII form.
- **Extraction is conservative.** A month-name date needs a capital first letter, so `march 3`
  states only `3`; a number in a URL or a host and port states nothing; a single quote opens only at
  the start or after whitespace, `(` or `[`, so an apostrophe inside a word never opens a value.
- **A compile refusal leaves the compiled draft staged on the shelf**, like every compiled draft;
  the refusal carries its `draftRef`.
- **The compile and refine prompts' bytes changed**: both `Role` bodies end with the request-wins
  sentence, and the refine prompt gained the `Intent` block. No model call was added.

### Persisted values that keep reading

None changed. The op's output, where `statedValueRefusal` lives, is not persisted. The saved
`DraftReceipt`, the written test file, the handoff schema and every abandonment kind are unchanged,
so every reader of persisted history reads what it read at `288e41d4a`.

### Accepted risks

- **A keep refusal after a persisted keep-eligible receipt.** Verify saves the `DraftReceipt` before
  keep runs, and the funnel counts persisted dispositions. A draft refused at keep would still count
  as kept. Compile, refine and repair check the same values first, so this happens only if an
  earlier check were bypassed. No side counter was added (440-RESEARCH Pitfall 4).
- **The skill line is text.** `C440-SKILL` pins the words in both copies, not whether a coding agent
  obeys them.

### The instruments that notice a return

- **The 434 gate** (`pnpm run gate:local`) must execute and pass all 71 listed `C440-` cells, each
  with its `440 D-NN` origin in `scripts/gate/inputs/regressions.json`: `C440-PUBLIC-PATH` 4,
  `C440-STATED-VALUES` 22, `C440-FALSE-REFUSAL` 4, `C440-VALUE-COMPILE` 6, `C440-PROMPTS` 3,
  `C440-REFUSAL-FIELD` 8, `C440-SKILL` 3, `C440-REFINE-REQUEST` 2, `C440-VALUE-REFINE` 6,
  `C440-VALUE-KEEP` 6, `C440-VALUE-REPAIR` 7. A refine prompt without the request, an unchecked
  compile, refine patch, repair patch or final write, or a refusal read as a duplicate reds there.
  440-06 ran every file holding a `C440-` cell with the JSON reporter: 71 `C440-` full names found,
  every one passed and listed.
- **`C440-VALUE-KEEP the keep check is the only door to publishing`** reads `loop.ts` and pins one
  `.publish(` inside `writeFinalDraft`, after its `missingStatedValues(` call.
- **The conformance golden** reds on any change to the output schema that is not regenerated.
- No arch census and no mutation driver was added.

### Not observed, stated as such

- **No live model ran.** Every cell uses a scripted model that answers by `agent_context`. Whether a
  live model still makes the historical substitution was to be a live-model data point (D-16), which
  reconciliation 24 dropped.
- **No real browser ran.** Gate runs are a fake shelf returning a passing or a clean-failing result
  (`agent/src/authoring/__tests__/evidence-fixtures.ts`); D-14's real-Chromium spike was dropped.
- **The MCP door end to end** (`agent_qa_write_test`) is deferred; its output shape is proven by the
  golden, and Phase 446 tests the host recipes against the staged artifact.

### Reconciliation

Reconciliation 24 (2026-10-12) in `.planning/REQUIREMENTS.md` amended V2-EXEC-02 before the replan,
and `spec/v2/release-readiness.md` was amended the same day. What was built matches it, so no new
reconciliation was needed.

### Gate

The record gate runs on the commit that adds this section, which is Phase 440's final agent-qa SHA.
Its legs, counts and verdict are recorded in `.planning/phases/440-authoring-intent/440-RECORD.md`
§ Gate rather than quoted here, so no agent-qa commit follows the gate run.

### Gap closure round 1 (440-07 to 440-09), 2026-10-12

This subsection appends to the Phase 440 section and rewrites none of it; written by 440-09. The
owner chose "Fix false refusals (Recommended)" on 2026-10-12
(`.planning/phases/440-authoring-intent/440-UAT.md` tests 1 and 2). The round covers three findings
of the phase's code review (`440-REVIEW.md`): CR-01, WR-01 and WR-03. The owner accepted WR-02 and
WR-04 as limitations, and IN-01 to IN-04 are left open. Every commit below is in agent-qa on
`version-0.2` and signed; every cell is listed in `scripts/gate/inputs/regressions.json` with its
`440 D-NN` origin (gate-listed in `996719eba`). No listed cell was re-spelled: every earlier 440
cell passes unedited, and both test files' diffs from `bd2d9a200` add lines only. The only product
file that changed is `agent/src/authoring/stated-values.ts`; its three exports and their
signatures did not.

**What was removed**

- **Every unquoted digit run read as a stated number, list markers and step labels included**
  (CR-01). `extractStatedValues` collapsed line breaks into spaces and then read every unquoted
  number, so `1. open the shop 2. click the "Add to cart" button 3. check the cart` with a faithful
  draft was refused at compile with `missingValues ["1","2","3"]`, and `Step 1: … Step 2: …` the
  same way. Now a line break survives the whitespace collapse until the marker scan has seen it,
  and outside quotes two rules blank digits before the number scan (G1). A list run of `1.`, `1)`
  or `(1)` markers starts at `1` at the start of the request, after a line break, or after `:`,
  `.`, `!` or `?` and one space, and continues only by the exact next number with the same
  delimiter. A step label is `Step N` followed by `:`, `)`, `.` and whitespace, or a spaced dash. A
  number, price or quoted value inside an item is still stated. 440-07 `dc040d8df`, `ffb1bf9ec`.
  Cells:
  - `C440-FALSE-REFUSAL a numbered list written inline states no list number`
  - `C440-FALSE-REFUSAL a numbered list written one item per line states no list number`
  - `C440-FALSE-REFUSAL a list numbered with closing parentheses states no list number`
  - `C440-FALSE-REFUSAL a list numbered in parentheses states no list number`
  - `C440-FALSE-REFUSAL a numbered list after a colon or a sentence states no list number`
  - `C440-FALSE-REFUSAL a step-labelled request states no step number`
  - `C440-STATED-VALUES a number, price or quoted value inside a list item is still a stated value`
  - `C440-STATED-VALUES a list marker inside a quoted value is kept as typed`
  - `C440-STATED-VALUES a list starts only at 1, at the start of the request, a line, a colon or a sentence`
  - `C440-STATED-VALUES a number written where the next list marker would go is read as that marker, the known leftover`
  - `C440-STATED-VALUES a step number with no label delimiter is a stated value`
  - `C440-STATED-VALUES a long run of list markers and step labels is checked in linear time`
  - `C440-VALUE-COMPILE a numbered request with a faithful draft is kept and written`
  - `C440-VALUE-COMPILE a request numbered in parentheses with a faithful draft is kept and written`
  - `C440-VALUE-COMPILE a number stated inside a numbered item is still refused at compile when the draft loses it`
  - `C440-VALUE-COMPILE a step-labelled request with a faithful draft is kept and written`
- **A straight double quote opening anywhere, and single quotes opening at `'90s` and pairing on
  `'n'`** (WR-01). A straight `"` had no boundary rule, so `check the 15" laptop shows "In Stock"`
  demanded `laptop shows` and left `In Stock` unprotected, and `'90s` or `rock 'n' roll` paired
  with a later quote. Now (G2) a straight double quote opens only when no Unicode letter or number
  is right before it, a single quote followed by ASCII digits glued to a letter opens nothing, and
  a single-quoted `n` is ordinary text. 440-08 `9419ba1e1`. Cells:
  - `C440-FALSE-REFUSAL an inch mark opens no quoted value`
  - `C440-FALSE-REFUSAL an in-word apostrophe opens no quoted value`
  - `C440-STATED-VALUES a quoted value next to an inch mark stays protected`
  - `C440-STATED-VALUES a straight double quote opens after anything but a letter or number`
  - `C440-STATED-VALUES a single-quoted value that starts with a number or is one capital letter is still a value`
- **Only a hostname-led host and port being an address** (WR-03). `isAddress` exempted a chunk
  containing `://`, starting `www.`, or shaped as a hostname-led host and port, so
  `192.168.1.10`, `127.0.0.1:3000/products`, `[::1]:3000` and `(localhost:3000)` were demanded.
  Now (G3) a dotted IPv4 address with an optional port, path and trailing punctuation, a bracketed
  IPv6 host with an optional port and path, and any address form behind one leading `(` are
  addresses. 440-08 `6ca03cdd6`. Cells:
  - `C440-FALSE-REFUSAL an IP address, with or without a port and path, states nothing`
  - `C440-FALSE-REFUSAL a bracketed IPv6 host and port states nothing`
  - `C440-FALSE-REFUSAL a host and port in parentheses states nothing`
  - `C440-STATED-VALUES a number shaped like part of an address is still a stated value`
  - `C440-STATED-VALUES a long request of inch marks, apostrophes and addresses is checked in linear time`

**What was RETAINED, and why**

| Item | Why kept | Where recorded |
|---|---|---|
| WR-02: backticks, guillemets, `„…“`, corner brackets and a curly opener closed by a straight quote are not read as quotes | accepted by the owner as a limitation (2026-10-12, "Fix false refusals (Recommended)") | `440-REVIEW.md` WR-02; `440-RECORD.md` § Gap closure round 1 |
| WR-04: a minus before a currency symbol is dropped; a value starting or ending with punctuation skips that edge's glued-to-a-word check; `_` is not a word character | accepted by the owner, as above | `440-REVIEW.md` WR-04; `440-RECORD.md` § Gap closure round 1 |
| IN-01 to IN-04 | outside the round's scope; left `open` | `440-REVIEW.md`; `440-REVIEW-DISPOSITION.md` |
| the three exports `extractStatedValues`, `missingStatedValues` and `statedValuesMissingReason`, and their signatures | the fixes are inside extraction; matching and every caller are unchanged | `C440-STATED-VALUES the module is pure`; the callers' existing `C440-` cells |
| the skill bullet in both `agent-qa-authoring` copies | UAT test 3 passed against it on 2026-10-12 | the `C440-SKILL` cells; `440-UAT.md` test 3 |
| the output schema, its conformance golden and the abandonment kinds | the refusal's shape and the repair cap do not change; `packages/schema`, `packages/cli` and `skills` have no diff from `bd2d9a200` | the `C440-REFUSAL-FIELD` cells; the golden; `C440-VALUE-REPAIR running out after value refusals keeps the existing abandonment kinds` |
| `loop.ts`, `refine.ts`, `repair.ts` and the op | the round changes what is extracted, not where it is checked | no diff from `bd2d9a200` |

**What degrades, stated plainly**

- **A number written where the next list marker would go is read as that marker** (G1 item 5).
  Inside an open run, `1. set the quantity to 2. Then check the cart` and `(1) set the quantity to
  (2) then check the cart` state nothing, so a draft without `2` is not refused. It stops there: a
  `2,`, a `2)` in a `.` run and a final `2.` still state `2`. Pinned by:
  - `C440-STATED-VALUES a number written where the next list marker would go is read as that marker, the known leftover`
- **A list that starts at a number other than 1 is still read as numbers**: `3. open the shop 4.
  click the cart` states 3 and 4. Lists numbered `1.`, `1)` and `(1)` are covered.
- **A double quote glued to a word on both sides states nothing** (G2 item 4): `size"M"`.
- **A leading elision other than `'n'` can still pair with a later quote** (G2 item 4): `'til the
  'Sale'` pairs as it did before.
- **A four-part dotted number reads as an IPv4 address and states nothing** (G3 item 4): `1.2.3.4`.
- **A parenthesized letter-led host and port states nothing**: `(Total:3)`, as `Total:3` already
  did at `bd2d9a200` (observed by 440-08).
- **WR-02's and WR-04's cases.** A value quoted only in backticks, guillemets, `„…“`, corner
  brackets or a curly-open straight-close pair is not extracted and so not protected. `-$5` is read
  as `$5`; a value that starts or ends with punctuation is carried inside a longer word on that edge
  (`-5` by `10-5`, `$5` by `US$5`); and `Sale` is carried by `Sale_2`.

**The instruments that notice a return**

- The 434 gate's regression list grew from 1308 to 1334 cells: `C440-FALSE-REFUSAL` 11 (6 from
  440-07, 5 from 440-08), `C440-STATED-VALUES` 11 (6 and 5) and `C440-VALUE-COMPILE` 4 (440-07,
  through `invokeFunction('authoring.draft.write')`). 97 cells now carry a `440` origin: `440 D-02`
  15, `440 D-03` 33 and `440 D-05` 10, the other origins unchanged.
- List markers or step labels demanded again red the `C440-FALSE-REFUSAL` list and step cells and
  the three public-path `kept and written` cells. An in-item number no longer demanded, an inch
  mark opening a quote again, or a non-address number exempted red the controls named above
  (`… is still refused at compile when the draft loses it`, `… stays protected`, `… is still a
  stated value`). An address demanded again reds the three address cells. A scan that is no longer
  linear reds the two linear-time cells.

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands. Its legs, counts and
verdict are recorded in `.planning/phases/440-authoring-intent/440-RECORD.md` § Gap closure round
1 rather than quoted here, so no agent-qa commit follows it.

### Gap closure round 2 (440-10 to 440-12), 2026-10-12

This subsection appends to the Phase 440 section and rewrites none of it, round 1's subsection
included; written by 440-12. It follows `.planning/phases/440-authoring-intent/440-VERIFICATION.md`
(`gaps_found`, 80 of 83) and `440-REVIEW.md` § Gap closure round 1 re-review. That re-review's
WR-05 to WR-08 are regressions round 1 introduced in what the check protects: values that
`bd2d9a200` extracted and protected, and that round 1's rules dropped, so a draft changing them was
kept and written. The owner's standing instruction was "Fix false refusals (Recommended)"
(`440-UAT.md`), with only WR-02 and WR-04 accepted as limitations. After round-2 planning, on
2026-10-12, the owner chose "Safe side (Recommended)" for the ambiguous list and step cases
(`.planning/phases/440-authoring-intent/440-11-PLAN.md` § Owner decision): when unsure, a number is
read as a value, so a draft that changes it is refused, never written. Every commit below is in
agent-qa on `version-0.2` and signed; every cell is listed in `scripts/gate/inputs/regressions.json`
with its `440 D-NN` origin (gate-listed in `90b278360`). No listed cell was re-spelled: every
earlier 440 cell passes unedited, and both test files' diffs from `2edfe953a` add lines only. The
only product file that changed is `agent/src/authoring/stated-values.ts`; its three exports and
their signatures did not.

**What was removed**

- **A single quote refusing to open before any digits glued to a letter** (WR-06). Round 1's rule
  for `'90s` also matched ordinary quoted values, so `search for '4K' and check the first result
  title says '3D Movies'` went from `["4K","3D Movies"]` at `bd2d9a200` to `[]`, `'1st Place'`,
  `'2FA'` and `‘5G Plans’` were lost the same way, and a draft saying `'8K'` was kept and written.
  Now (G4) a single quote refuses to open only before a decade: one digit, `0` and `s`, not
  followed by a letter, a number or a closing single quote (`DECADE_ELISION`). `'80s` and `'70s`
  open nothing; `'4K'`, `'3D Movies'`, `'2FA'`, `'1st Place'`, `‘5G Plans’`, a closed `'90s'`,
  `'95s'` and `'15s timeout'` are values. Round 1's digit-run helper and its letter-only pattern
  are deleted. 440-10 `61bba5f44`. Cells:
  - `C440-STATED-VALUES a single-quoted value that starts with digits glued to a letter is a stated value`
  - `C440-STATED-VALUES only a two-digit decade after a single quote opens no quoted value, and a quoted value that starts with one is the known leftover`
  - `C440-VALUE-COMPILE a single-quoted value that starts with digits glued to a letter is refused at compile when the draft loses it`
- **A bracketed group with one colon read as an IPv6 host** (WR-07). Round 1's `BRACKETED_IPV6`
  needed only one colon between hex digits, so `check the slot [10:30] is shown` went from
  `["10:30"]` to `[]`, `[16:9]` the same way, and a draft saying `[11:45]` was kept and written.
  Now (G5) a bracketed group is an IPv6 host only when it is hex digits, dots and colons and holds
  `::` or at least six colons (`holdsIpv6Groups`). `[16:9]`, `[10:30]`, `[Bed:2]` and
  `[10:30:45]` are values; `[::1]:3000`, `[fe80::1]`, `[2001:db8::1]:443`,
  `[2001:db8:0:0:0:0:0:1]:443/cart` and `[::ffff:192.0.2.1]:8080` state nothing. 440-10
  `ed92b6e28`. Cells (the linear-time cell covers G4's and G5's shapes):
  - `C440-STATED-VALUES a bracketed time or ratio is a stated value`
  - `C440-STATED-VALUES a long request of decade elisions, digit-led quotes and bracketed colons is checked in linear time`
  - `C440-FALSE-REFUSAL a bracketed IPv6 host in compressed or full form states nothing`
  - `C440-VALUE-COMPILE a bracketed time is refused at compile when the draft loses it`
- **An unconfirmed list run after `:`, `.`, `!` or `?`** (WR-08). Round 1 started a run at any
  `1.`, `1)` or `(1)` after one of these and a space, with no second marker, so the stated value
  itself was blanked and a later `2.` with it: `check the badge shows: 1. Then click checkout` went
  from `["1"]` to `[]`, `Check Quantity: 1. Then set it to 2. Then check Total: $40.` from
  `["1","2","$40"]` to `["$40"]`, and a draft saying `0` was kept and written. Now (G6) such a run
  is held until its `2` with the same delimiter follows; when the held `1.` and that `2.` both end
  a sentence (the next word starts with a capital letter), the run waits for its `3.`. A held `1`
  that is never confirmed stays a stated value. The pass runs over the whole request with quoted
  values masked, so a `2` after a quoted item confirms the run. Runs at the request start or a line
  start still start at once. 440-11 `6d4d51872`. Cells:
  - `C440-STATED-VALUES a number stated after a colon or a sentence end is a stated value when no list follows it`
  - `C440-STATED-VALUES a list after a colon or a sentence starts only when its 2 follows, and a lowercase sentence stating 1 and then 2 is the known leftover`
  - `C440-FALSE-REFUSAL a list after a colon or a sentence states no list number once its next marker follows, across a quoted value too`
  - `C440-VALUE-COMPILE a lone 1 stated after a colon is refused at compile when the draft loses it`
- **A step label anywhere in a sentence** (WR-05). Round 1 blanked the digits of any `step N`
  followed by `:`, `)`, a spaced dash, or `.` before whitespace or the end, wherever it sat, so
  `check the wizard is on step 2. Then click Next` went from `["2"]` to `[]`, as did `says Step 2:
  Payment`, `shows step 2.` and `go to step 3)`, and a draft saying step 3 was kept and written.
  Now (G7) a step label counts like a list marker, over the same masked request: `Step 1` starts a
  run only at a run start (at once at the request or a line start, held until its `Step 2` after a
  colon or a sentence), and a later label continues the run only as its next number, with the
  run's delimiter or from a run start. Any other `step N` is ordinary text, so its number is a
  stated value. 440-11 `451e79ee8`. Cells (the linear-time cell covers G6's and G7's shapes):
  - `C440-STATED-VALUES a step number stated mid-sentence is a stated value`
  - `C440-STATED-VALUES a step label counts only from the start of the request, a line, a colon or a sentence, and a step number where the next label would go is the known leftover`
  - `C440-STATED-VALUES a long request of held list starts and step labels is checked in linear time`
  - `C440-FALSE-REFUSAL a step-labelled list after a colon, a sentence or a line break states no step number`
  - `C440-VALUE-COMPILE a step number stated mid-sentence is refused at compile when the draft loses it`

**What was RETAINED, and why**

| Item | Why kept | Where recorded |
|---|---|---|
| WR-02: backticks, guillemets, `„…“`, corner brackets and a curly opener closed by a straight quote are not read as quotes | accepted by the owner as a limitation (2026-10-12, "Fix false refusals (Recommended)"); not touched by this round | `440-REVIEW.md` WR-02; `440-RECORD.md` § Gap closure round 1 |
| WR-04: a minus before a currency symbol is dropped; a value starting or ending with punctuation skips that edge's glued-to-a-word check; `_` is not a word character | accepted by the owner, as above; not touched by this round | `440-REVIEW.md` WR-04; `440-RECORD.md` § Gap closure round 1 |
| IN-01 to IN-05 (IN-05: nested outline numbers such as `1.1` inside a numbered request are still stated values) | outside the round's scope; left `open` | `440-REVIEW.md`; `440-REVIEW-DISPOSITION.md` |
| the three exports `extractStatedValues`, `missingStatedValues` and `statedValuesMissingReason`, and their signatures | the fixes are inside extraction; matching and every caller are unchanged | `C440-STATED-VALUES the module is pure`; the callers' existing `C440-` cells |
| the skill bullet in both `agent-qa-authoring` copies, the output schema, its conformance golden and the abandonment kinds | the refusal's shape and the repair cap do not change; `packages/schema`, `packages/cli` and `skills` have no diff from `bd2d9a200` | the `C440-SKILL` and `C440-REFUSAL-FIELD` cells; the golden; `C440-VALUE-REPAIR running out after value refusals keeps the existing abandonment kinds` |
| `loop.ts`, `refine.ts`, `repair.ts` and the op | the round changes what is extracted, not where it is checked; no diff from `bd2d9a200` | `git -C agent-qa diff --quiet bd2d9a200 HEAD -- …` (440-10 and 440-11 scope checks) |
| round 1's rules this round did not narrow: list runs and step runs at the request start and at line starts, the inch mark, `'n'`, IPv4 addresses and the parenthesized host | not among the re-review's findings; their round-1 cells pass unedited | `C440-FALSE-REFUSAL a numbered list written inline states no list number`, `C440-FALSE-REFUSAL a numbered list written one item per line states no list number`, `C440-FALSE-REFUSAL a step-labelled request states no step number`, `C440-FALSE-REFUSAL an inch mark opens no quoted value`, `C440-FALSE-REFUSAL an in-word apostrophe opens no quoted value`, `C440-FALSE-REFUSAL an IP address, with or without a port and path, states nothing`, `C440-FALSE-REFUSAL a host and port in parentheses states nothing` |

**What degrades, stated plainly**

The owner accepted this round's trade-off on 2026-10-12 by answering "Safe side (Recommended)"
(`440-11-PLAN.md` § Owner decision). Each residue below cannot be removed without either losing a
protected value or undoing a false-refusal fix, because its input has the same shape as a pinned
input on the other side of the rule. Each carries its acceptance wording.

- **`'30s ad'`: a single-quoted value that starts with a decade and goes on past it** (G4 item 4,
  a value loss). `check the '30s ad' banner` states nothing, so a draft saying `'40s ad'` is not
  refused. Pinned by `C440-STATED-VALUES only a two-digit decade after a single quote opens no quoted value, and a quoted value that starts with one is the known leftover`.
  Same shape as `check the '90s collection and the users' cart`, which `C440-FALSE-REFUSAL an in-word apostrophe opens no quoted value`
  pins as stating nothing. Owner-accepted 2026-10-12 ("Safe side (Recommended)").
- **`[12::30]`: a bracketed group of hex digits and dots that holds `::`** (G5 item 4, a value
  loss). It states nothing. No cell pins it, although the owner's option text calls the leftovers
  pinned. Same shape as the compressed IPv6 hosts `[::1]:3000` and `[fe80::1]`, which
  `C440-FALSE-REFUSAL a bracketed IPv6 host and port states nothing` and
  `C440-FALSE-REFUSAL a bracketed IPv6 host in compressed or full form states nothing` pin as
  stating nothing. Owner-accepted 2026-10-12 ("Safe side (Recommended)").
- **A one-item list after a colon** (G6 item 5, a false refusal). `Checkout test: 1. open the shop`
  states `1`, so a faithful draft without it is refused. Pinned by `C440-STATED-VALUES a list after a colon or a sentence starts only when its 2 follows, and a lowercase sentence stating 1 and then 2 is the known leftover`.
  Same shape as `check the badge shows: 1. Then click checkout`, pinned as a value by
  `C440-STATED-VALUES a number stated after a colon or a sentence end is a stated value when no list follows it`.
  Owner-accepted 2026-10-12 ("Safe side (Recommended)").
- **A two-item list after a colon whose items each start with a capital letter** (G6 item 5, a
  false refusal). `Checkout test: 1. Open the shop 2. Add 2 items` states `1` and `2`. Pinned by the
  same cell. Same shape as `Check Quantity: 1. Then set it to 2. Then check Total: $40.`, pinned as
  values by the same value cell. Owner-accepted 2026-10-12 ("Safe side (Recommended)").
- **The same one-item and two-capitalized-item lists after a sentence end (`.`, `!` or `?`) instead
  of a colon** (G6 item 5, a false refusal). G6 treats the four start characters the same, so these
  behave as the colon forms do; the rule is pinned through the colon forms in the cell above, and
  no cell pins the sentence-end inputs themselves. Same shape as `Is the count right? 1. Then click`,
  pinned as a value by `C440-STATED-VALUES a number stated after a colon or a sentence end is a stated value when no list follows it`.
  Covered by the owner's 'Safe side' decision of 2026-10-12; not named individually.
- **A lowercase sentence after a colon or a sentence end that states `1.` and later `2.`** (G6
  item 5, a value loss). `Check quantity: 1. then set it to 2. then check the cart` states nothing,
  so a draft without the numbers is not refused. Pinned by `C440-STATED-VALUES a list after a colon or a sentence starts only when its 2 follows, and a lowercase sentence stating 1 and then 2 is the known leftover`.
  Same shape as round 1's `Test the cart. 1. add 2 items 2. check the total is $20` in
  `C440-FALSE-REFUSAL a numbered list after a colon or a sentence states no list number`.
  Owner-accepted 2026-10-12 ("Safe side (Recommended)").
- **A step list that starts mid-sentence** (G7 item 4, a false refusal). `Test the wizard Step 1:
  open it Step 2: click Next` states `1` and `2`. Pinned by `C440-STATED-VALUES a step label counts only from the start of the request, a line, a colon or a sentence, and a step number where the next label would go is the known leftover`.
  Same shape as `check the wizard heading says Step 2: Payment`, pinned as a value by
  `C440-STATED-VALUES a step number stated mid-sentence is a stated value`. Owner-accepted
  2026-10-12 ("Safe side (Recommended)").
- **A mid-sentence label that switches delimiter** (G7 item 4, a false refusal). `Step 1: open the
  shop Step 2. add items` states `2`. Pinned by the same step cell. Same shape as `check the wizard
  is on step 2. Then click Next`, pinned as a value by `C440-STATED-VALUES a step number stated mid-sentence is a stated value`.
  Covered by the owner's 'Safe side' decision of 2026-10-12; not named individually.
- **A one-label step list after a colon or a sentence** (G7 item 2, a false refusal). `Checkout
  test: Step 1: open the shop` states `1`: the label is held and never confirmed. No cell pins this
  input; 440-11's spot check confirmed it, and the held, never-confirmed `Step 1` is pinned by
  `check the title shows: Step 1. Then click Next` in `C440-STATED-VALUES a step number stated mid-sentence is a stated value`.
  Same shape as that value. Covered by the owner's 'Safe side' decision of 2026-10-12; not named
  individually.
- **A `Step N` written where the next label would go** (G7 item 4, a value loss). Inside an open
  step run, `Step 1: click Next. Step 2: check the wizard shows Step 3: Payment` states nothing, so
  a draft saying `Step 4: Payment` is not refused. Pinned by `C440-STATED-VALUES a step label counts only from the start of the request, a line, a colon or a sentence, and a step number where the next label would go is the known leftover`.
  Same shape as a mid-sentence next label such as `Step 1 - open the shop Step 2 - add 2 items` in
  `C440-FALSE-REFUSAL a step-labelled request states no step number`. Owner-accepted 2026-10-12
  ("Safe side (Recommended)").
- Round 1's subsection above still describes round 1's rules for list runs after `:`, `.`, `!` or
  `?`, step labels, the digit-led elision and the bracketed host. This subsection supersedes those
  descriptions without editing them. Round 1's own degradations, WR-02's and WR-04's cases among
  them, are unchanged.

**The instruments that notice a return**

- The 434 gate's regression list grew from 1334 to 1350 cells: `C440-FALSE-REFUSAL` 3 (1 from
  440-10, 2 from 440-11), `C440-STATED-VALUES` 9 (4 and 5) and `C440-VALUE-COMPILE` 4 (2 and 2,
  through `invokeFunction('authoring.draft.write')`). 113 cells now carry a `440` origin: `440 D-02`
  18, `440 D-03` 42 and `440 D-05` 14, the other origins unchanged.
- A return of round 1's digit-led elision reds `… starts with digits glued to a letter is a stated
  value` and its public-path compile cell; a decade test that widens or narrows reds one side of
  the decade cell, and the `'90s` side also reds 440-08's in-word apostrophe cell. A one-colon
  bracketed host reds the bracketed-time cell and `a bracketed time is refused at compile …`; a lost
  IPv6 exemption reds both bracketed-IPv6 `C440-FALSE-REFUSAL` cells. An unconfirmed mid-line run
  reds the number-after-a-colon cell and `a lone 1 stated after a colon is refused at compile …`; a
  run never confirmed reds the round-2 list `C440-FALSE-REFUSAL` cell and round 1's list cells. A
  step label read anywhere again reds the mid-sentence step cell and its compile cell; a step run
  never confirmed reds the round-2 step `C440-FALSE-REFUSAL` cell and round 1's step cells. A fix
  or widening of a pinned leftover reds its known-leftover cell on one side or the other. A scan
  that is no longer linear reds the two new linear-time cells.

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands. Its legs, counts and
verdict are recorded in `.planning/phases/440-authoring-intent/440-RECORD.md` § Gap closure round
2 rather than quoted here, so no agent-qa commit follows it.

### Gap closure round 3 (440-13 to 440-14), 2026-10-12

This subsection appends to the Phase 440 section and rewrites none of it, rounds 1 and 2's
subsections included; written by 440-14. It follows
`.planning/phases/440-authoring-intent/440-REVIEW.md` § Gap closure round 2 re-review (agent-qa
`2edfe953a..5442d42a1`). That re-review's WR-09 to WR-11 are values that `bd2d9a200` protected
and `5442d42a1` dropped, so a draft changing them was kept and written. On 2026-10-12 the owner
chose "Final round 3 (Recommended)" for the phase's final gap round (`440-UAT.md`, the comment
above the three newest gaps), verbatim:
"Fix WR-09 (sentence guard for steps), WR-11 (track the open list and the held candidate separately) and the (1)/1) guard from WR-10. Fixes for WR-09 and WR-11 are already prototyped and pass all 59 existing behaviour cells. Record the remaining same-shape cases under Safe side. Stop rule: later findings in this class get recorded, not another round. About 1 hour."
Every commit below is in agent-qa on `version-0.2` and signed; every cell is listed in
`scripts/gate/inputs/regressions.json` with its `440 D-NN` origin (gate-listed in `866390365`).
No listed cell was re-spelled: every earlier 440 cell passes unedited, and both test files' diffs
from `5442d42a1` add lines only. The only product file that changed is
`agent/src/authoring/stated-values.ts`; its three exports and their signatures did not.

**What was removed**

- **A held step run without a sentence guard** (WR-09). Round 2's step pass (G7) never set or
  read the held run's sentence guard, so a held `Step 1` after a colon or a sentence was confirmed
  by any later `Step 2` with the same delimiter: `check the title shows: Step 1. Then click Next and check it shows Step 2. Then click Pay`
  went from `["1","2"]` at `bd2d9a200` to `[]` at `5442d42a1`, as did
  `Check the heading: Step 1: Welcome. Click Next. Check the heading: Step 2: Payment.` and
  `Check the progress says: Step 1 - Cart. Then click Next and check it says Step 2 - Payment`,
  and a draft saying `Step 3` was kept and written. Now (G8) each label works out once whether its
  heading ends a sentence (its delimiter followed by a space or a line break and a capital letter).
  A held `Step 1` and its `Step 2` that each do wait for `Step 3`, which blanks all three; a held
  label never confirmed stays a stated value. At-once runs are unchanged. 440-13 `2b692f82b`.
  Cells:
  - `C440-STATED-VALUES a held step label and its next label that each end a sentence are stated values until a third label follows, and a capitalized two-label step list is the known boundary`
  - `C440-FALSE-REFUSAL a held step list states no step number once its third label follows or its labels do not each end a sentence`
  - `C440-VALUE-COMPILE a step number stated in a held step heading is refused at compile when the draft loses it`
- **One run per pass, so a held candidate overwrote the open run** (WR-11). Round 2 kept one run
  in each blanking pass, and a held start overwrote it even inside a list that had started at
  once. `1. check the badge shows: 1. Then add another item\n2. check the badge shows: 2. Then check out`
  went from `["1","2"]` at `bd2d9a200` to `["2"]` (the outer `2.` confirmed the held `1`);
  `1. open the cart\n2. check the badge shows: 1. Then add another item\n3. check the total says $40`
  stated the outer item number `3` (`["1","3","$40"]`); and
  `Step 1: open the cart\nStep 2: check the title shows: Step 1. Then click Next\nStep 3: click Pay`
  stated `["1","3"]`, a false refusal that `2edfe953a` did not have. Now (G9) `blankListMarkers`
  and `blankStepLabels` each keep an open run and a held candidate: an at-once `1` sets the open
  run and clears the held one, a held `1` sets only the held one, a token that continues the open
  run is tested first, and only then does a token that continues the held one go through the
  sentence guard. The three requests state `["1","2"]`, `["1","$40"]` and `["1"]`. 440-13
  `af58bbf31`. Cells:
  - `C440-STATED-VALUES a held 1 inside a numbered item never takes over the item list, so the next item number neither confirms it nor becomes a stated value`
  - `C440-STATED-VALUES a held step label inside a step-labelled item never takes over the item steps, so the next item label is not a stated value`
- **The held-run sentence guard limited to `.`** (WR-10). Round 2's G6 guard applied only to a
  held `1.`, so a capitalized `1) … 2)` or `(1) … (2)` pair was read as a list:
  `Check the badge shows: 1) Then add one more and check it shows 2) Then check out` went from
  `["1","2"]` at `bd2d9a200` to `[]`. Now (G10) a held start records the guard for every
  delimiter, so a held `1)` or `(1)` and its next marker that are each followed by a space and a
  capital letter wait for the third marker, as a held `1.` does;
  `Check the badge says: (1) Then add one more and check it says (2) Then check out` states
  `["1","2"]`. 440-13 `d1ec9072d`. Cells (the linear-time cell covers G8's, G9's and G10's
  shapes; the leftovers cell pins every value the round still leaves unprotected):
  - `C440-STATED-VALUES a held 1) or (1) run whose markers are each followed by a capital letter is a stated value until its third marker follows, and a capitalized two-item paren list is the known boundary`
  - `C440-STATED-VALUES a capital then lowercase pair, three capitalized sentences, a lowercase paren pair and a number read as the next marker or label of a run after a held start are the known leftovers`
  - `C440-STATED-VALUES a long request of held step headings, nested held starts and held paren runs is checked in linear time`
  - `C440-FALSE-REFUSAL a held 1) or (1) list states no list number once its third marker follows or its items start lowercase`

**What was RETAINED, and why**

| Item | Why kept | Where recorded |
|---|---|---|
| WR-02: backticks, guillemets, `„…“`, corner brackets and a curly opener closed by a straight quote are not read as quotes | accepted by the owner as a limitation (2026-10-12, "Fix false refusals (Recommended)"); not touched by this round | `440-REVIEW.md` WR-02; `440-RECORD.md` § Gap closure round 1 |
| WR-04: a minus before a currency symbol is dropped; a value starting or ending with punctuation skips that edge's glued-to-a-word check; `_` is not a word character | accepted by the owner, as above; not touched by this round | `440-REVIEW.md` WR-04; `440-RECORD.md` § Gap closure round 1 |
| IN-01 to IN-05 (IN-05: nested outline numbers such as `1.1` inside a numbered request are still stated values) | outside the round's scope; left `open` | `440-REVIEW.md`; `440-REVIEW-DISPOSITION.md` |
| the three exports `extractStatedValues`, `missingStatedValues` and `statedValuesMissingReason`, and their signatures | the fixes are inside extraction; matching and every caller are unchanged | `C440-STATED-VALUES the module is pure`; the callers' existing `C440-` cells |
| the skill bullet in both `agent-qa-authoring` copies, the output schema, its conformance golden and the abandonment kinds | the refusal's shape and the repair cap do not change; `packages/schema`, `packages/cli` and `skills` have no diff from `bd2d9a200` | the `C440-SKILL` and `C440-REFUSAL-FIELD` cells; the golden; `C440-VALUE-REPAIR running out after value refusals keeps the existing abandonment kinds` |
| `loop.ts`, `refine.ts`, `repair.ts` and the op | the round changes what is extracted, not where it is checked; no diff from `bd2d9a200` | `git -C agent-qa diff --quiet bd2d9a200 HEAD -- …` (440-13's scope check) |
| rounds 1 and 2's rules this round did not narrow: list and step runs that start at once at the request start or a line start, G7's label position for step labels, the quote rules (the inch mark, `'n'`, the decade elision) and the address rules (IPv4, the parenthesized host, the IPv6 shape test) | not among the re-review's findings; their cells pass unedited | `C440-FALSE-REFUSAL a numbered list written inline states no list number`, `C440-FALSE-REFUSAL a numbered list written one item per line states no list number`, `C440-FALSE-REFUSAL a step-labelled request states no step number`, `C440-STATED-VALUES a step number stated mid-sentence is a stated value`, `C440-FALSE-REFUSAL an in-word apostrophe opens no quoted value`, `C440-STATED-VALUES only a two-digit decade after a single quote opens no quoted value, and a quoted value that starts with one is the known leftover`, `C440-FALSE-REFUSAL an IP address, with or without a port and path, states nothing`, `C440-FALSE-REFUSAL a host and port in parentheses states nothing`, `C440-FALSE-REFUSAL a bracketed IPv6 host in compressed or full form states nothing` |

**What degrades, stated plainly**

The owner's answers of 2026-10-12, "Safe side (Recommended)" (`440-11-PLAN.md` § Owner decision)
and "Final round 3 (Recommended)" ("Record the remaining same-shape cases under Safe side"), cover
the first six entries below, none of them named individually. Each cannot be removed without
either losing a protected value or undoing a false-refusal fix, because its input has the same
shape as a pinned input on the other side of the rule. The seventh entry is covered by neither
decision.

- **The capital-then-lowercase pair, list and step forms** (G11, a value loss).
  `Check the badge shows: 1. Then set the quantity to 2. then check the cart` and
  `check the title shows: Step 1. Then click Next and check it shows Step 2. then click Pay` state
  nothing, so a draft saying the badge shows `0` is not refused. Pinned by
  `C440-STATED-VALUES a capital then lowercase pair, three capitalized sentences, a lowercase paren pair and a number read as the next marker or label of a run after a held start are the known leftovers`.
  Same shape as round 2's `Test the cart. 1. Add 2 items 2. check the total`, pinned as a list by
  `C440-FALSE-REFUSAL a list after a colon or a sentence states no list number once its next marker follows, across a quoted value too`.
  Covered by the owner's 'Safe side' decision of 2026-10-12; not named individually.
- **Three capitalized sentences, list and step forms** (G11, a value loss).
  `Check Quantity: 1. Then set it to 2. Then set it to 3. Then check the total` and
  `check the title shows: Step 1. Then click Next. It shows Step 2. Then click Pay. It shows Step 3. Then pay`
  state nothing. Pinned by the same leftovers cell. Same shape as round 2's
  `Checkout test: 1. Open the shop 2. Add 2 items 3. Check the cart` (the same round-2
  `C440-FALSE-REFUSAL` cell) and this round's `Test the wizard. Step 1. Open it. Step 2. Click Next. Step 3. Pay.`
  in `C440-FALSE-REFUSAL a held step list states no step number once its third label follows or its labels do not each end a sentence`.
  Covered by the owner's 'Safe side' decision of 2026-10-12; not named individually.
- **The lowercase paren pair, `(N)` and `)` forms** (G11, a value loss).
  `Check the badge says: (1) and after adding check it says (2) items` and
  `Check the badge shows: 1) then add one more and check it shows 2) then check out` state nothing.
  Pinned by the same leftovers cell. Same shape as round 1's
  `Checkout test: (1) open the shop (2) add 2 items`, pinned as a list by
  `C440-FALSE-REFUSAL a list numbered in parentheses states no list number`, and round 2's
  `Checkout test: 1) open the shop 2) add 2 items`. `440-UAT.md`'s WR-10 truth names the first
  input as stating `["1","2"]`; under "the same guard as `1.` runs" it is this lowercase pair, and
  stating `["1","2"]` would need an edit to round 1's pinned cell, which round 3's scope forbids.
  The capitalized paren pair is the one the guard protects.
  Covered by the owner's 'Safe side' decision of 2026-10-12; not named individually.
- **A capitalized two-label step list after a colon or a sentence** (G8 item 3, a false refusal
  that WR-09's guard brings in). `Checkout test: Step 1: Open the shop Step 2: Add 2 items` and
  `Test the wizard. Step 1. Open it. Step 2. Click Next.` state `1` and `2`. Pinned by
  `C440-STATED-VALUES a held step label and its next label that each end a sentence are stated values until a third label follows, and a capitalized two-label step list is the known boundary`.
  Same shape as `Check the heading: Step 1: Welcome. Click Next. Check the heading: Step 2: Payment.`,
  pinned as values by the same cell; the step twin of round 2's owner-accepted two-capitalized-item
  list after a colon. Covered by the owner's 'Safe side' decision of 2026-10-12; not named
  individually.
- **A capitalized two-item `1)` or `(1)` list after a colon or a sentence** (G10 item 2, a false
  refusal that WR-10's guard brings in). `Checkout test: 1) Open the shop 2) Add 2 items` and
  `Checkout test: (1) Open the shop (2) Add 2 items` state `1` and `2`. Pinned by
  `C440-STATED-VALUES a held 1) or (1) run whose markers are each followed by a capital letter is a stated value until its third marker follows, and a capitalized two-item paren list is the known boundary`.
  Same shape as `Check the badge shows: 1) Then add one more and check it shows 2) Then check out`,
  pinned as values by the same cell; the paren twin of round 2's owner-accepted
  two-capitalized-item list. Covered by the owner's 'Safe side' decision of 2026-10-12; not named
  individually.
- **A list restarted at 1 inside an open list's first item** (G9, a false refusal that WR-11's
  split brings in). `1) open the shop. 1) add items 2) pay` states `1`, where `5442d42a1` stated
  nothing. Pinned by
  `C440-STATED-VALUES a held 1 inside a numbered item never takes over the item list, so the next item number neither confirms it nor becomes a stated value`.
  Same shape as that cell's `1. check the badge shows: 1. Then add another item\n2. check the badge shows: 2. Then check out`,
  whose held `1` is a value. Covered by the owner's 'Safe side' decision of 2026-10-12; not named
  individually.
- **A number read as the next marker or label of a run after a held start** (G9 item 3, a value loss), a regression against 5442d42a1 introduced by round 3, not covered by an owner decision: `1. check the badge shows: 1. Then set it to 2. Then check out` states `1` where `5442d42a1` stated `1`, `2`; `1. open the cart\n2. check the badge shows: 1. Then set it to 3. Then check out` `1` (was `1`, `3`); `1. check the badge shows: 1) Then set it to 2. Then check out` `1` (was `1`, `2`); `1. check the badge shows: 1. then add one\n2. check the badge shows: 2. then check out` nothing (was `2`); `Step 1. Check the heading shows: Step 1 - Cart. Then go on to Step 2. Then pay` `1` (was `1`, `2`); `test: Step 1. Step 2 - Step 3.` nothing (was `3`). Pinned by `C440-STATED-VALUES a capital then lowercase pair, three capitalized sentences, a lowercase paren pair and a number read as the next marker or label of a run after a held start are the known leftovers`; read as an item number the dropped token is WR-11's fix, and the held-first order of tests was rejected because it newly refuses a nested step list's label (`Step 1: check the title shows: Step 1. Then click Next\nStep 2: Click Pay` would state `1` and `2`). It is surfaced for the owner in `440-RECORD.md` § Gap closure round 3 § Regression against 5442d42a1, is not a ledger row, and gets no further fix round.
- Round 2's subsection above still describes G6 and G7 as built in round 2 (one run per pass, a
  sentence guard for held `1.` runs only, none for held step runs). This subsection supersedes
  those descriptions without editing them. Rounds 1 and 2's own degradations, WR-02's and WR-04's
  cases among them, are unchanged.

**Stop rule**

The owner's "Stop rule: later findings in this class get recorded, not another round." closes this
class (a list marker, step label or held-run shape for which `extractStatedValues` drops a stated
number or demands a list or label number), as set out in `440-RECORD.md` § Gap closure round 3
§ Stop rule.

**The instruments that notice a return**

- The 434 gate's regression list grew from 1350 to 1359 cells, all from 440-13:
  `C440-FALSE-REFUSAL` 2, `C440-STATED-VALUES` 6 and `C440-VALUE-COMPILE` 1 (through
  `invokeFunction('authoring.draft.write')`). 122 cells now carry a `440` origin: `440 D-02` 20,
  `440 D-03` 48 and `440 D-05` 15, the other origins unchanged.
- A step pass without the sentence guard again reds the held step heading value cell and
  `a step number stated in a held step heading is refused at compile …`; a guard that also holds a
  third label reds the held step list `C440-FALSE-REFUSAL` cell. A return to one run per pass reds
  the two nested held-start cells (the outer `2.` confirming the held `1`, the outer `3` or
  `Step 3` refused); the held-first order of tests reds the nested step cell and the leftovers
  cell. A `.`-only guard again reds the paren value cell; a paren guard that also holds lowercase
  or three-marker runs reds the paren `C440-FALSE-REFUSAL` cell and round 1's
  `C440-FALSE-REFUSAL a list numbered in parentheses states no list number`. A fix or widening of
  a known leftover, the seventh entry's inputs among them, reds the leftovers cell on one side or the other.
  A scan that is no longer linear reds the new linear-time cell.

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands. Its legs, counts and
verdict are recorded in `.planning/phases/440-authoring-intent/440-RECORD.md` § Gap closure round
3 rather than quoted here, so no agent-qa commit follows it.

### Gap closure round 4 (440-15), 2026-10-12

This subsection appends to the Phase 440 section and rewrites none of it, rounds 1 to 3's
subsections included; written by 440-15. It follows
`.planning/phases/440-authoring-intent/440-REVIEW.md` § Gap closure round 3 re-review (agent-qa
`5442d42a1..fe15e1371`). That re-review's WR-12 is a month-name date that `bd2d9a200` protected and
later rounds dropped, outside the round-3 stop rule's class. On 2026-10-12 the owner answered two
questions (`440-UAT.md`, the comment above the newest gap), verbatim. To WR-12, "Fix in a
micro-round (Recommended)": "One plan: a bounded month-name look-behind (prototype passes all 68 cells), plus the missing IN-06 pinning cell, then the record gate again. Cost on the safe side: '1. pick the month March 2. pay' would be refused. About 45-60 min."
To entry F, "Accept as a limitation (Recommended)": "Record F as owner-accepted on 2026-10-12, alongside the Safe-side residues G and its step twin (IN-07). The phase closes with no open regression."
Every commit below is in agent-qa on `version-0.2` and signed; every cell is listed in
`scripts/gate/inputs/regressions.json` with its `440 D-NN` origin (gate-listed in `b7b5da040`).
No listed cell was re-spelled: every earlier 440 cell passes unedited, and both test files' diffs
from `fe15e1371` add lines only. The only product file that changed is
`agent/src/authoring/stated-values.ts`; its three exports and their signatures did not.

**What was removed**

- **A month-name date's day read as a list marker** (WR-12). `blankListMarkers` runs over the
  whole request before the date scan, so a `2.` right after `Oct ` that continued the open list
  run, or confirmed a held start, was blanked, and `MONTH_NAME_DATE` no longer saw the date.
  `1. check the badge shows: 1. Then check the date is Oct 2. Then check out` stated
  `["1","Oct 2"]` at `bd2d9a200` and `5442d42a1` and `["1"]` at `fe15e1371`, as did the
  `October 2` form (`["1","October 2"]`, then `["1"]`), so a draft saying `Oct 3` was kept and
  written. The open-run form `1. open the calendar\n2. check the date shows Oct 3. Then click Next`
  and the lowercase held form `Check the badge shows: 1. then check the date is Oct 2. then pay`
  have lost the date since round 1 (`2edfe953a`): `["1","2","Oct 3"]` and `["1","Oct 2"]` at
  `bd2d9a200`, `[]` at `5442d42a1` and `fe15e1371`. Now a module-level `MONTH_BEFORE`, built from
  the same month names the date scan uses (a month name with no letter or digit before it, then one
  space, then the end of the slice), is tested in `blankListMarkers` on the 12 characters before
  every token that is not an `(N)` token, right after the token is read and before the run start,
  the open-run and the held-candidate tests. A token right after a month name and a space neither
  starts, continues nor confirms a run and is never blanked, so the date scan sees the date whole.
  The four requests state `["1","Oct 2"]`, `["1","October 2"]`, `["Oct 3"]` and `["1","Oct 2"]`.
  A line-start marker after a line that ends in a month name stays a marker, because the slice
  then ends in a line break, not a space. 440-15 `c36718fca`. Cells:
  - `C440-STATED-VALUES a month-name date is a stated value even where the next list marker would go, and an item that ends in a month name before the next marker is the known boundary`
  - `C440-STATED-VALUES a long request of month-name days where the next list marker would go is checked in linear time` (a control)
  - `C440-VALUE-COMPILE a month-name date where the next list marker would go is refused at compile when the draft changes it` (through `invokeFunction('authoring.draft.write')`)

**What was RETAINED, and why**

| Item | Why kept | Where recorded |
|---|---|---|
| the step pass, unchanged | `STEP_LABEL` blanks only digits that directly follow the word `Step` and one space, so no month name can directly precede a step label's digits; `blankStepLabels` has no diff from `fe15e1371` | `C440-STATED-VALUES a month-name date is a stated value even where the next list marker would go, and an item that ends in a month name before the next marker is the known boundary` (its step-labelled row); every earlier step cell, unedited |
| the open-run-first order of tests and the at-once reset (G9) | round 3's rules; the reset was unpinned (IN-06) and is now pinned in each pass | `C440-STATED-VALUES an at-once 1 clears the held candidate in the list pass and in the step pass, so a stale held 1 is never confirmed by a later stated 2` |
| WR-02 and WR-04 | accepted by the owner as limitations (2026-10-12, "Fix false refusals (Recommended)"); not touched by this round | `440-REVIEW.md`; `440-RECORD.md` § Gap closure round 1 |
| IN-01 to IN-05 (IN-05: nested outline numbers such as `1.1` inside a numbered request are still stated values) | outside the round's scope; left `open` | `440-REVIEW.md`; `440-REVIEW-DISPOSITION.md` |
| the three exports `extractStatedValues`, `missingStatedValues` and `statedValuesMissingReason`, and their signatures | the fix is inside extraction; matching and every caller are unchanged | `C440-STATED-VALUES the module is pure`; the callers' existing `C440-` cells |
| the skill bullet in both `agent-qa-authoring` copies, the output schema, its conformance golden and the abandonment kinds | the refusal's shape and the repair cap do not change; `packages/schema`, `packages/cli` and `skills` have no diff from `bd2d9a200` | the `C440-SKILL` and `C440-REFUSAL-FIELD` cells; the golden |
| `loop.ts`, `refine.ts`, `repair.ts` and the op | the round changes what is extracted, not where it is checked; no diff from `bd2d9a200` | `git -C agent-qa diff --quiet bd2d9a200 HEAD -- …` (440-15's scope check) |

**What degrades, stated plainly**

- **An inline item that ends in a month name right before the next marker** (WR-12's cost, a false
  refusal on the Safe side). `1. pick the month March 2. pay` states `["March 2"]`, where
  `fe15e1371` stated nothing, so a faithful draft that does not repeat `March 2` is refused. Pinned
  by `C440-STATED-VALUES a month-name date is a stated value even where the next list marker would go, and an item that ends in a month name before the next marker is the known boundary`.
  The same cell pins the other side: `1. pick the month March\n2. pay`, with the marker at a line
  start, states nothing. Owner-accepted 2026-10-12 ("Fix in a micro-round (Recommended)").
  The same cost with a following marker: `1. pick the month March 2. pay 3. check out` states
  `["March 2","3"]`, because the skipped day does not advance the run; the owner's option text
  names only the first input, and the same cell pins this one.
- **A step list restarted at Step 1 inside an open step list's first item** (IN-07, the step twin
  of round 3's entry G). `Step 1: open the shop. Step 1: add items Step 2: pay` and
  `Step 1. Step 1. Step 2.` each state `["1"]`, where `5442d42a1` stated nothing. Pinned by
  `C440-STATED-VALUES a step list restarted at Step 1 inside the first item of an open step list states its 1, the step twin of a list restarted at 1`.
  The list form on the other side is entry G's `1) open the shop. 1) add items 2) pay`, pinned by
  `C440-STATED-VALUES a held 1 inside a numbered item never takes over the item list, so the next item number neither confirms it nor becomes a stated value`.
  Covered by the owner's 'Safe side' decision of 2026-10-12; not named individually. The owner's
  round-4 answer refers to it as G's step twin.
- 2026-10-12 (440-15): round 3's seventh entry above, entry F (a number read as the next marker or
  label of a run after a held start, `1. check the badge shows: 1. Then set it to 2. Then check out`
  states `1`), is now Owner-accepted 2026-10-12 ("Accept as a limitation (Recommended)"). Its label
  there, "a regression against 5442d42a1 introduced by round 3, not covered by an owner decision",
  is superseded by this note without editing it. Its pinning cell is unchanged.
- Rounds 1 to 3's own degradations, WR-02's and WR-04's cases and entries A to E and G among them,
  are unchanged. Round 1's G1 item 5 (a number written where the next list marker would go is read
  as that marker) no longer applies to a number right after a month name and a space.

**The instruments that notice a return**

- The 434 gate's regression list grew from 1359 to 1364 cells, all from 440-15:
  `C440-STATED-VALUES` 4 and `C440-VALUE-COMPILE` 1. 127 cells now carry a `440` origin:
  `440 D-03` 52 and `440 D-05` 16, the other origins unchanged.
- Removing the look-behind reds the WR-12 value cell and
  `C440-VALUE-COMPILE a month-name date where the next list marker would go is refused at compile when the draft changes it`
  (440-15's failing-first run at `fe15e1371`).
- Removing the at-once reset from the list pass or from the step pass reds
  `C440-STATED-VALUES an at-once 1 clears the held candidate in the list pass and in the step pass, so a stale held 1 is never confirmed by a later stated 2`
  (440-15's two mutant runs, each reddening that cell alone).
- A change to the restarted step list's output reds the IN-07 pin.
- A scan that is no longer linear reds the new linear-time cell.

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands. Its legs, counts and
verdict are recorded in `.planning/phases/440-authoring-intent/440-RECORD.md` § Gap closure round
4 rather than quoted here, so no agent-qa commit follows it.

### Gap closure round 5 (440-16), 2026-10-12

This subsection appends to the Phase 440 section and rewrites none of it, rounds 1 to 4's
subsections included; written by 440-16. It follows
`.planning/phases/440-authoring-intent/440-VERIFICATION.md` (re-verification after round 4, agent-qa
`35077bf21`), whose one gap is a value loss that round 4 brought in. On 2026-10-12 the owner
answered (`440-UAT.md`, the comment above the newest gap), verbatim,
"Narrow fix, then close (Recommended)": "One small plan: clear the held run when the month-name skip fires on a held-start or next-number token, add cells for both inputs, record gate, record and gitlink. Then re-verify and complete the phase. About 45 min."
Every commit below is in agent-qa on `version-0.2` and signed; every cell is listed in
`scripts/gate/inputs/regressions.json` with its `440 D-NN` origin. No listed cell was re-spelled:
every earlier 440 cell passes unedited, and both test files' diffs from `35077bf21` add lines only.
The only product file that changed is `agent/src/authoring/stated-values.ts`; its three exports and
their signatures did not.

**What was removed**

- **A stale held `1` confirmed past a skipped month-name day** (the round-4 regression). Round 4's
  skip left the held run alone, so when the skipped day would have started a held run or taken its
  next number, an earlier held `1` stayed armed and a later bare `2.` or `2)` confirmed it and
  blanked both. `Check the badge shows: 1. Then check the date is Oct 2. Then set it to 2. then pay`
  stated `["1","Oct 2","2"]` at `bd2d9a200`, `5442d42a1` and `fe15e1371` and `["Oct 2"]` at
  `35077bf21`; `Check the counter: 1) Then set the delivery date to Oct. 1. Then check the counter shows 2) and pay`
  stated `["1","Oct. 1","2"]` at the first three and `["Oct. 1"]` at `35077bf21` (measured on
  scratch copies of each SHA's module). So a draft saying the badge shows `0` was written green.
  Now, where round 4's skip fires in `blankListMarkers`, a token that would start a held run, or
  that has the held run's next number and delimiter, clears the held run before the skip; the
  skipped token is still never blanked and still neither starts, continues nor confirms a run, and
  the open run is untouched. Both requests state their `fe15e1371` values again. 440-16
  `825e2b430`. Cells:
  - `C440-STATED-VALUES a month-name day where a held run would start or take its next number clears the held run, so a later 2 never confirms a stale held 1, and a list after a colon whose first item states that day is the known boundary`
  - `C440-VALUE-COMPILE a stated badge number beside a month-name date is refused at compile when the draft changes it` (through `invokeFunction('authoring.draft.write')`)

**What was RETAINED, and why**

| Item | Why kept | Where recorded |
|---|---|---|
| round 4's look-behind (`MONTH_BEFORE`, its 12-character slice, its `(N)` exclusion) and its skip | a skipped day is still never blanked and still not a run start, continuation or confirmation; the open run is untouched; only the held run is cleared | `C440-STATED-VALUES a month-name date is a stated value even where the next list marker would go, and an item that ends in a month name before the next marker is the known boundary`, unedited |
| the step pass, unchanged | round 4's skip exists only in the list pass; `blankStepLabels` has no diff from `35077bf21` | every earlier step cell, unedited |
| WR-02 and WR-04 | accepted by the owner as limitations; not touched by this round | `440-REVIEW.md`; `440-RECORD.md` § Gap closure round 1 |
| IN-01 to IN-05 and IN-08 | outside the round's scope; left `open` | `440-REVIEW.md`; `440-REVIEW-DISPOSITION.md` |
| the three exports and their signatures | the fix is inside extraction | `C440-STATED-VALUES the module is pure`; the callers' existing `C440-` cells |
| the skill bullet in both `agent-qa-authoring` copies, the output schema, its conformance golden and the abandonment kinds | the refusal's shape does not change; `packages/schema`, `packages/cli` and `skills` have no diff from `bd2d9a200` | the `C440-SKILL` and `C440-REFUSAL-FIELD` cells; the golden |
| `loop.ts`, `refine.ts`, `repair.ts` and the op | no diff from `bd2d9a200` | `git -C agent-qa diff --quiet bd2d9a200 HEAD -- …` (440-16's scope check) |

**What degrades, stated plainly**

- **A list after a colon whose first item states a month-name date at the list's next number,
  before its real `2.`** (the fix's cost, a false refusal on the Safe side).
  `Checkout test: 1. pick the delivery date Oct 2. then 2. pay` states `["1","Oct 2","2"]`, as at
  `bd2d9a200`; it stated `["2"]` at `5442d42a1` and `fe15e1371` and `["Oct 2"]` at `35077bf21`. So
  a faithful draft that keeps `Oct 2` but not the list's `1` is refused. It is the same shape,
  token for token, as the gap input the owner chose to protect, which the same cell pins on the
  other side. Pinned by the last row of
  `C440-STATED-VALUES a month-name day where a held run would start or take its next number clears the held run, so a later 2 never confirms a stale held 1, and a list after a colon whose first item states that day is the known boundary`.
  Covered by the owner's 'Safe side' decision of 2026-10-12; not named individually.
- Rounds 1 to 4's own degradations are unchanged, round 4's WR-12 cost, entry F, IN-07 and entries
  A to E and G among them.

**The instruments that notice a return**

- The 434 gate's regression list grew from 1364 to 1366 cells, both from 440-16:
  `C440-STATED-VALUES` 1 and `C440-VALUE-COMPILE` 1. 129 cells now carry a `440` origin:
  `440 D-03` 53 and `440 D-05` 17, the other origins unchanged.
- Removing the clear reds both new cells (440-16's failing-first run at `35077bf21`).
- Removing either clause of the clear reds the new value cell alone, on that clause's row: without
  the held-start clause on the paren row, without the next-number clause on the dot row (440-16's
  two mutant runs).

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands. Its legs, counts and
verdict are recorded in `.planning/phases/440-authoring-intent/440-RECORD.md` § Gap closure round
5 rather than quoted here, so no agent-qa commit follows it.

## 2026-10-15 — Phase 441: Declared-secret masking (V2-EXEC-03)

This section appends to the register and rewrites no earlier section; the one change it makes to
older text is the dated correction below, which points at four 2026-10-02 rows without editing
them. Phase 441 made one rule true: only the values in the file `workspace.secretsFile` names are
masked, by raw exact match whatever their length, and each shows as `[secret:<name>]` everywhere
text leaves the process or is written. Nothing restores a value, and nothing else is masked,
detected or blocked. Everything that did more was deleted: the safety masking context and its
numbered placeholders, its seeding from the environment and auth state, auth-state redaction, the
digest sidecar and host key, every display unmask, the masked-value marker vocabulary and its
chips, the network header mask, the debug log's regex redactor, curation's capture blacklist, the
config path map and key-name check, the config reveal, every guardrail (the model-request scan,
the stream scan, the committed-egress check, the construction scan, the authoring credential
screen), the guardrail policy and its audit, the safety hook framework, the prompt-injection flag
and curation's flagged path. What stayed is the runner's `SecretRedactor`, now the one masking
function, and the seams that carry its mask. The section follows the 2026-10-02 Phase 432 shape.
Dated 2026-10-15; written by 441-35.

### The ruling

> V2-EXEC-03: Only declared secrets are masked, everywhere, including the public CLI `ask` and
> `chat` paths outside a run (amended 2026-10-12, reconciliation 23).
>
> - **What is masked.** Only the values in `workspace.secretsFile`, by raw exact match whatever
>   their length, shown as `[secret:<name>]`.
> - **Where.** Model requests, run records and logs, session events, receipt clauses and derived
>   transcript fields, the dashboard, MCP results, analytics payloads, the cache key and the
>   terminal.
> - **Never restored.** Nothing restores a value.
> - **Nothing else.** Emails, auth state, environment variables, `envFile` values and undeclared
>   credential-shaped text are not masked, and nothing is detected or blocked.
> - **What is removed.** The guardrails, their audit and config, the `MaskingContext`, auth-state
>   redaction, the digest sidecar and every unmask path. The runner's `SecretRedactor` is the one
>   masking function.
> - **The proof.** A fixture secrets file runs through the real composition for a run, `ask` and
>   `chat`, and every persisted byte and model request is read. No declared value appears. An
>   email, an env credential and an undeclared card number and token pass through unchanged, and
>   ordinary content stays useful.
> - **Folded candidate.** 396-06 #3 (a credential reaching MCP config-change diffs) is
>   re-verified for a declared secret, and fixed if it reproduces.

From `.planning/REQUIREMENTS.md`. Reconciliation 23 (2026-10-12) records the owner's decision from
the Phase 441 discussion (2026-10-11 and 2026-10-12). It supersedes V2-EXEC-03's 2026-10-05 text
("configured secrets and emails use the existing masking; credential-shaped text that is not
configured uses the existing guardrail detectors"), execution-safety §3 (egress guardrails), §4
(reversible masking with numbered placeholders and unmasking for human output) and the guardrail
half of §6, and READY-FUT-05, and it lists what must not come back: automatic detection (regex,
entropy or name heuristics), auto-registration from the environment, cookies or storage, numbered
placeholders that need a value map, restoring masked values for display, and blocking a model
request on its content. Its evidence: on the built safety package with the default policy,
`Enter card 4242 4242 4242 4242 and pay` was blocked (Stripe's standard test card), and
`Log in as qa@example.com` reached the model as `<REDACTED:email>`.

The owner, verbatim, as `.planning/phases/441-declared-secret-masking/441-CONTEXT.md` records it:

> No internal mapping of any secret. Only what's declared by the user. (D-01)

> DO NOT SKIP ANYTHING (D-02, on removing the 4-character floor)

> I am a fan of less code, simpler and cleaner things. (D-11)

> As I said secrets mentioned in the secret file is expected to leak. So users are already advised
> to put temp secrets. (D-18)

> remove it as a half baked solution would cause more issues. We will either build a new one or
> use anything famous. (D-26, on `injectionShape`)

The two decisions the owner added at planning (2026-10-12), as CONTEXT records them:

- **D-28: Three more masks of undeclared values are removed.** Each keeps only the declared-secret
  mask: network evidence's credential-header masking (`NETWORK_CREDENTIAL_HEADERS` turned into
  `maskedMarker('secret')`), the regex redactor in the opt-in LLM debug log (`SECRET_PATTERNS`),
  and curation's capture blacklist (`CAPTURE_BLACKLIST_NAME_PATTERNS` turned into
  `<REDACTED:capture-blacklist>`). With their last producers gone, the `␟masked:…␟` vocabulary
  and the dashboard's masked-value chips go too. The dashboard shows `[secret:<name>]` as text.
- **D-29: Config output has no masks of its own.** The config path map goes (`CONFIG_MASKING_MAP`,
  `MaskingClass`, `createMaskedConfigReader`, with their users in cli and dashboard-server and the
  dashboard's 4-character floor). The credential key-name check goes (`isCredentialEntry`, so the
  whole of `credential-entry.ts`), with its redaction of `config show` and the run `--debug`
  tables and its two `config set` refusals. Config text that reaches the terminal, the dashboard
  or the model passes through the declared-secret mask like any other text.

**This file names retired tokens literally**, as the 2026-09-02 section explains for the whole
register. `DELETION-INVENTORY.md` sits outside every census region; inside them, the 441 census
spells each needle as two halves.

### How this inventory is measured

| Instrument | What it claims | Where |
|---|---|---|
| the census | 20 legs, `C441-RETURN-01`..`20`, each scanning its regions through the 432/436 lexer (comments blanked; strings, templates and regex literals kept) for 230 needles, 2 patterns and 28 absent paths, so a removed masker, restore path, marker vocabulary, redactor, guardrail, audit writer or hook seam returning to production source reds by name. `C441-SAFETY-SURFACE` pins the safety and safety-local barrels' value exports. `C441-UNIVERSE-FLOORS`, `C441-LEXER-CONTROL`, `C441-PLANTED-POSITIVE` (249 plants, every leg red as code and green as a comment or a kept name) and `C441-SELF-MATCH`. 25 cells, in `validate:arch`. | `packages/arch/src/__tests__/441-declared-secret-masking-deleted.test.ts` (441-34 `10f615bce`, `8e95d1ad6`) |
| the gate list | 174 `C441-` cells listed in `scripts/gate/inputs/regressions.json` after the 1366 rows listed at `6de55acde` (which are unchanged and in order except two in-place renames, below), each with its `441 D-NN` origin, so `gate:local` must execute and pass every one | `scripts/gate/inputs/regressions.json` (441-35 `d59dbf568`) |
| `validate:safety` (a) | the declared-secret masking middleware is the last element of `createModel`'s per-call middleware and is given `createModel`'s mask: 6 cells, one over the real registry source and five held-out offenders | `packages/safety/src/__tests__/validate-safety.test.ts` (441-04 `6b54dd945`, `605f2a8f7`) |
| the proof | the spawned `agent-qa run`, `ask` and `chat` over a secrets file holding a 3-character and a long value, every model request and every byte under the hermetic root scanned, and the D-23 twin | `packages/cli/src/__tests__/conformance/441-declared-secret-proof.test.ts` (441-06, 441-13) |

**Both ends of the derivation, stated so it can be re-run.** Baseline
`6de55acde` (agent-qa `version-0.2`, Phase 440's final SHA). Closing SHA `d59dbf568` (441-35's gate
list commit, the parent of this section's commit). `git -C agent-qa diff --shortstat
6de55acde d59dbf568`: 984 files changed, 14,507 insertions, 34,953 deletions (under `packages/`:
975 files, +13,403/−34,870). `--diff-filter=D`: 94 files deleted, 44 production modules (3,450
lines) and 50 test files (8,389 lines). `--diff-filter=A`: 13 files added (`cli/src/composition/
declared-secrets.ts`, `safety/src/egress/masking-middleware.ts`, `schema/src/config/leaves.ts`,
`agent/src/functions/ops/secret-mask.ts` and nine test files). 142 commits, every one signed
(`%G?` = `G`): two curation fixes that precede 441-01's base and come from no 441 plan
(`00b8289dc`, `256cbb6b9`; the first added `cli/src/gates/__tests__/mark-noise-floor-fallback.test.ts`,
which 441-52 later swept), 139 from 441-01 to 441-60 and 441-35's gate list. The deleted-file
table below is derived from `git -C agent-qa log --diff-filter=D --name-only 6de55acde..d59dbf568`,
not transcribed from a summary. The per-token counts are 441-34's (`441-34-SUMMARY.md` § Needles):
production files holding each needle at `6de55acde` and at `8e95d1ad6`, measured from a
full-context `git diff --no-renames` because `git grep` is outside this phase's allowed command
shapes, comments included; the code count with comments blanked is 0 for every needle at
`8e95d1ad6`. Between `8e95d1ad6` and `d59dbf568` agent-qa changed only by 441-46's documentation
(two skill copies and references, two READMEs, the init pointer, the scaffold comment, the
dashboard help string, `docs/adversarial-split.md` and one schema comment) and 441-35's gate list,
and the census runs again in the record gate.

### What was deleted

#### Files deleted

The census column names the leg whose absent path or needles cover the file.

| File (under `packages/`) | Lines at baseline | Deleting commit | Census leg | Return cell |
|---|---|---|---|---|
| `safety/src/masking/context.ts` | 130 | `f544714c3` (441-33) | 01 (absent `safety/src/masking/`) | `C441-RETURN-01` |
| `safety/src/masking/seed.ts` | 28 | `f544714c3` (441-33) | 01 | `C441-RETURN-01` |
| `safety/src/masking/detectors.ts` | 16 | `f544714c3` (441-33) | 01 | `C441-RETURN-01` |
| `safety/src/masking/human-output.ts` | 6 | `f544714c3` (441-33) | 01 | `C441-RETURN-01` |
| `safety/src/masking/resolver.ts` | 13 | `f544714c3` (441-33) | 01 | `C441-RETURN-01` |
| `safety/src/masking/categories.ts` | 5 | `f544714c3` (441-33) | 01 | `C441-RETURN-01` |
| `safety/src/masking/egress-hook.ts` | 14 | `5a1985175` (441-33) | 01 | `C441-RETURN-01` |
| `schema/src/safety/masking.ts` | 4 | `736fba50a` (441-45) | 02 | `C441-RETURN-02` |
| `cli/src/composition/display-unmask.ts` | 177 | `dd8922486` (441-15) | 05 | `C441-RETURN-05` |
| `dashboard-server/src/masking/display-tree.ts` | 60 | `8b3793084` (441-15) | 05 | `C441-RETURN-05` |
| `runner-local/src/masking-sidecar.ts` | 198 | `2c2edde48` (441-48) | 05 | `C441-RETURN-05` |
| `schema/src/run/masked-marker.ts` | 87 | `54ce62dfd` (441-38) | 06 | `C441-RETURN-06` |
| `dashboard-ui/src/lib/masked-text.ts` | 99 | `7fb5955b2` (441-38) | 06 | `C441-RETURN-06` |
| `dashboard-ui/src/components/run-detail/masked-chip.tsx` | 48 | `7fb5955b2` (441-38) | 06 | `C441-RETURN-06` |
| `dashboard-ui/src/components/run-detail/masked-text.tsx` | 34 | `7fb5955b2` (441-38) | 06 | `C441-RETURN-06` |
| `runner/src/hooks/redaction.ts` | 237 | `1881a89b8` (441-05) | 07 | `C441-RETURN-07` |
| `core/src/auth-state/redaction.ts` | 11 | `1881a89b8` (441-05) | 07 | `C441-RETURN-07` |
| `knowledge-local/src/curator/capture-blacklist.ts` | 235 | `d6e1f9ea4` (441-25) | 10 | `C441-RETURN-10` |
| `schema/src/action/credential-fields.ts` | 20 | `9aaddd409` (441-25) | 10 | `C441-RETURN-10` |
| `agent/src/config-mutation/credential-entry.ts` | 158 | `5a2c811b2` (441-20) | 11 (also 15: `valueLooksLikeCredential`) | `C441-RETURN-11` |
| `schema/src/config/masking.ts` | 245 | `a049ccd6b` (441-40) | 11 | `C441-RETURN-11` |
| `safety/src/guardrail/detectors.ts` | 317 | `f544714c3` (441-33) | 12 (absent `safety/src/guardrail/`) | `C441-RETURN-12` |
| `safety/src/guardrail/scan.ts` | 138 | `f544714c3` (441-33) | 12 | `C441-RETURN-12` |
| `safety/src/guardrail/luhn.ts` | 27 | `f544714c3` (441-33) | 12 | `C441-RETURN-12` |
| `safety/src/guardrail/egress-hook.ts` | 47 | `5a1985175` (441-33) | 12 | `C441-RETURN-12` |
| `safety/src/guardrail/stream-scan.ts` | 187 | `5a1985175` (441-33) | 12 | `C441-RETURN-12` |
| `safety/src/guardrail/policy-loader.ts` | 30 | `f544714c3` (441-33) | 12 (also 13) | `C441-RETURN-12`, `-13` |
| `safety/src/guardrail/committed-egress.ts` | 111 | `f544714c3` (441-33) | 12 (also 14) | `C441-RETURN-12`, `-14` |
| `safety/src/guardrail/construction-scan.ts` | 187 | `f544714c3` (441-33) | 12 (also 15) | `C441-RETURN-12`, `-15` |
| `eval/src/cassette/egress.ts` | 33 | `f544714c3` (441-33) | 12 | `C441-RETURN-12` (`cassetteEgressText`) |
| `schema/src/safety/guardrail-policy.ts` | 23 | `736fba50a` (441-45) | 13 | `C441-RETURN-13` |
| `knowledge-local/src/bundle-egress.ts` | 50 | `c14a0945f` (441-22) | 14 | `C441-RETURN-14` |
| `schema/src/safety/scan.ts` | 7 | `736fba50a` (441-45) | 15 | `C441-RETURN-15` |
| `schema/src/safety/content-origin.ts` | 6 | `736fba50a` (441-45) | 15 | `C441-RETURN-15` |
| `knowledge-local/src/curator/embed-gate.ts` | 83 | `b0dde79d7` (441-24) | 16 | `C441-RETURN-16` |
| `safety-local/src/jsonl-audit-sink.ts` | 19 | `37cc19c49` (441-44) | 18 | `C441-RETURN-18` |
| `safety/src/ports/audit-sink.ts` | 21 | `f544714c3` (441-33) | 18 | `C441-RETURN-18` |
| `safety/src/policy/audit-sink-resolver.ts` | 13 | `f544714c3` (441-33) | 18 | `C441-RETURN-18` |
| `safety/src/hooks/registry.ts` | 128 | `5a1985175` (441-33) | 19 (absent `safety/src/hooks/`) | `C441-RETURN-19` |
| `safety/src/hooks/first-party.ts` | 84 | `5a1985175` (441-33) | 19 | `C441-RETURN-19` |
| `safety/src/hooks/interfaces.ts` | 46 | `5a1985175` (441-33) | 19 | `C441-RETURN-19` |
| `safety/src/hooks/capability.ts` | 19 | `5a1985175` (441-33) | 19 | `C441-RETURN-19` |
| `safety/src/egress/provider-request-middleware.ts` | 21 | `5a1985175` (441-33) | 19 | `C441-RETURN-19` |
| `schema/src/safety/hook-results.ts` | 28 | `736fba50a` (441-45) | 19 | `C441-RETURN-19` |

The 50 deleted test files went with their subjects, each in the commit that deleted the subject:
`efd1c5979` (441-03) `agent/src/authoring/__tests__/secret-guardrail.test.ts` (355);
`1881a89b8` (441-05) `core/src/auth-state/__tests__/redaction.test.ts` (148); `46859e653`
(441-47) `eval/src/replay/__tests__/guard-block-refusal.test.ts` (75); `8b3793084` (441-15)
`dashboard-server/src/masking/__tests__/display-tree.test.ts` (96); `dd8922486` (441-15)
`cli/src/composition/__tests__/display-unmask.test.ts` (345); `2c2edde48` (441-48)
`runner-local/src/__tests__/masking-sidecar.test.ts` (165); `7fb5955b2` (441-38) the two
`masked-text` tests in `dashboard-ui` (95, 220); `54ce62dfd` (441-38)
`schema/src/__tests__/masked-marker.test.ts` (122); `5a2c811b2` (441-20)
`agent/src/config-mutation/__tests__/credential-entry.test.ts` (216); `3000eeca0` (441-20)
`cli/src/composition/__tests__/429-masking-parity.test.ts` (138); `27d014a02` (441-49)
`dashboard-server/src/__tests__/routes.config-reveal.test.ts` (308); `c14a0945f` (441-22)
`knowledge-local/src/__tests__/bundle-egress.test.ts` (61) and `committed-egress-proof.test.ts`
(179); `6783e329d` (441-24) `cli/src/__tests__/curation-injection-safety.acceptance.test.ts`
(382); `b0dde79d7` (441-24) `knowledge-local/src/curator/__tests__/embed-gate.test.ts` (143);
`eb586581a` (441-25) `cli/src/__tests__/curation-capture-safety.acceptance.test.ts` (314);
`d6e1f9ea4` (441-25) `knowledge-local/src/curator/__tests__/capture-blacklist.test.ts` (299);
`9eb10d2b7` (441-60) `runner/src/loop/__tests__/gate-dispatch.test.ts` (159); `37cc19c49` (441-44)
`safety-local/src/__tests__/jsonl-audit-sink.test.ts` (252) and `readline-confirm.test.ts` (42);
`5a1985175` (441-33) eleven safety tests (`guardrail/__tests__/{analyze-run-red-seam,egress-hook,
stream-scan}`, `hooks/__tests__/{first-party,registry}`, `masking/__tests__/egress-hook`,
`policy/__tests__/{gate-remedies,gate,pin-deny,scenario-contract}`,
`ports/__tests__/confirm-surface.test-d.ts`); `f544714c3` (441-33) seventeen safety and eval tests
(`eval/src/cassette/__tests__/egress`, `safety/src/__tests__/masking-snapshot`,
`guardrail/__tests__/{committed-egress,construction-scan,detectors,injection-shape,luhn,
policy-loader}`, `masking/__tests__/{cache-key-floor,context,context.test-d,detectors,
never-persisted,seed,unmask-boundary}`, `policy/__tests__/{audit-sink-resolver,scope}`,
`ports/__tests__/policy-ports`). Their per-file cell counts and claim transfers are in each
deleting plan's summary. No deleted file held a cell listed in `regressions.json`.

#### Members removed from surviving files, by census leg

Counts are production files holding the needle, `6de55acde` → `8e95d1ad6` (441-34's measurement);
the full needle table, 230 needles with their counts, is in `441-34-SUMMARY.md` § Needles.

| Leg | Members (representative needles, b → h) | Removing plans and commits |
|---|---|---|
| 01 safety masker | `createMaskingContext` 20 → 0, `getActiveMaskingContext` 13 → 0, `seedMaskingContext` 9 → 0, `unmaskForHumanOutput` 20 → 0, `detectEmails` 4 → 0 and the ambient resolver | callers: 441-14 `d30104a1e`, `36c191e06`; 441-16 `fb8013d4e`; 441-19 `e20eabecb`; module: 441-33 `5a1985175`, `f544714c3` |
| 02 context type and restore member | `MaskingContext` 30 → 0; the `unmask:` member and `.unmask(` calls 4 → 0, 1 → 0 | 441-58 `f011a8f0a`; 441-13 `7c2767637`; 441-45 `736fba50a` |
| 03 numbered placeholders, generic marker | `<SECRET_` 22 → 6 and `<EMAIL_` 11 → 1 (the remaining hits are comments that describe old runs), `PLACEHOLDER_PATTERN` 7 → 0, the runner's generic `[secret]` value marker | 441-01 `028bd4843`, `0ac642a3d`; 441-10 `c5b02cc41`; 441-38 `54ce62dfd` |
| 04 run seed | `buildRunMaskingContext` 11 → 0, `sensitiveEnvSlice` 6 → 0, `extractAuthStateSensitiveStrings` 3 → 0, `createAnalyticsMaskingContext` 2 → 0, the door-side `mergedSecretStore`, `bindMaskingSecrets`, `mintedSecretStore` | 441-08 `b26d8dcf1`; 441-19 `e20eabecb`, `bc865a992`; 441-58 `e2020665b`, `f011a8f0a`; 441-48 `44e6cb197` |
| 05 display restore and sidecar | `unmaskTreeForDisplay` 7 → 0, `createDisplayUnmasker`, `markUnrestorablePlaceholders`, the digest helpers, `masking-digests.json` 3 → 0 | 441-15 `8b3793084`, `dd8922486`; 441-48 `2c2edde48` |
| 06 marker vocabulary and chips | `maskedMarker` 17 → 0, `MaskedText` 31 → 0, `copyTextOf` 12 → 0, the U+241F `masked:` opener 2 → 0, the chip labels | 441-17 `5808c6933`, `882e4d703`; 441-37 `9e22a9085`, `de7fb1dc7`; 441-38 `7fb5955b2`, `54ce62dfd` |
| 07 auth-state redaction | `redactAuthStateValue` 10 → 0, `AUTH_STATE_REDACTION_MARKER` 4 → 0 | 441-05 `d2e40c08d`, `1881a89b8` |
| 08 network header mask | `NETWORK_CREDENTIAL_HEADERS` 3 → 0, `NetworkCredentialHeader` 2 → 0 | 441-59 `3306b8be8` |
| 09 debug log redactor | `SECRET_PATTERNS` 1 → 0 | 441-36 `8fba37697` |
| 10 capture blacklist and receipt | `captureReceipt` 8 → 0, `capture-blacklist` 8 → 0, `isCredentialValueField` 5 → 0, the trajectory slot's `targetRef` | 441-25 `eb586581a`, `9aaddd409`, `d6e1f9ea4` |
| 11 config masks and reveal | `CONFIG_MASKING_MAP` 3 → 0, `classifyConfigPath` 7 → 0, `isCredentialEntry` 5 → 0, `CONFIG_MASK_PLACEHOLDER` 9 → 0, `/api/config/reveal` 3 → 0, `revealAt`, `RevealState` | 441-20 `5a2c811b2`, `3000eeca0`; 441-21 `ebc2a757e`; 441-49 `27d014a02`, `49d6030a6`; 441-40 `566fbadad`, `a049ccd6b` |
| 12 guardrail detectors and scans | `GuardrailBlockError` 4 → 0, `createGuardrailProviderRequestHook` 4 → 0, `createGuardrailStreamScan` 3 → 0, `findDetectorMatches` 6 → 0, `injectionShape` 11 → 0 | 441-36 `dada2e9fa`; 441-47 `46859e653`; 441-24 `6783e329d`; 441-33 |
| 13 guardrail policy | `loadGuardrailPolicy` 22 → 0, `defaultGuardrailPolicyInput` 22 → 0, `GuardrailPolicy` 36 → 0, `computeAdversarialPolicyDigest` 3 → 0 | 441-26 `b4cb5a95d`; 441-27 `2f0dde5f8`; 441-53 `31519ed5c`, `0801b50c8`; 441-45 |
| 14 committed-egress checkpoint | `assertCommittedEgressSafe` 21 → 0, `CommittedEgressBlockedError` 15 → 0, `egress-blocked` 28 → 0, the egress channels | 441-12 `fe03af3ab`; 441-22 `c14a0945f`, `3b370137e`; 441-41 `47948dfae`, `f32ef045a`; 441-23 `66b4585ce`, `ef6f7de7a`; 441-42 `c35bdcada`, `b9b000d67`, `30ca6afdd` |
| 15 construction scan, config credential check | `configScan` 9 → 0, `guardrail-hit` 5 → 0, `ConfigScanFinding` 5 → 0, `valueLooksLikeCredential` 1 → 0, `ScanResult` 5 → 0 | 441-18 `f75fb434c`, `9a1853e1c`; 441-39 `92829dedb`, `79871c436`; 441-20 `5a2c811b2`; 441-45 `736fba50a` |
| 16 injection path and embed gate | `injectionFlagged` 8 → 0, `secretFlagged` 8 → 0, `restrictedInjectionDelta` 1 → 0, `assessEmbeddingInput` 2 → 0, `injection-restricted` 2 → 0, `restricted-fallback` 2 → 0 | 441-24 `6783e329d`, `b0dde79d7`; 441-50 `99013e58d` |
| 17 authoring credential screen | `screenDraftForCredentials` 4 → 0, `DraftSecretRefusedError` 2 → 0 | 441-03 `efd1c5979`, `d27aeffaf` |
| 18 guardrail audit | `JsonlAuditSink` 24 → 0, `appendGuardrailAudit` 8 → 0, `buildRunAuditSink` 6 → 0, `auditBaseDir` 22 → 0, `AuditSink` 22 → 1 (a comment), the eval audit locations | 441-31 `d6dea21ec`, `769512dbc`; 441-43 `53cce12a5`, `8b439aa4f`; 441-32 `42a880516`, `7c7eadf14`; 441-26, 441-51, 441-52, 441-53; 441-56 and 441-57; 441-28, 441-29, 441-54 (the registry's sink); 441-44 `2d8bbc279`, `37cc19c49` |
| 19 hook framework and loop hook port | `registerFirstPartySafetyHooks` 4 → 0, `SafetyHookRunner` 9 → 0, `safetyHooks` 7 → 0, `buildRunSafetyHooks` 3 → 0, `policyDenial`, `runToolCallAsync` | 441-30 `6be6fe152`, `0b2fb86f3`; 441-60 `9eb10d2b7`, `0c944cb9b`; 441-33 `5a1985175` |
| 20 cold-read masking scope | `withReadScope` 3 → 0, `COLD_READ_SCOPE_FUNCTION_IDS` 2 → 0, `createColdReadMaskingSources` 2 → 0 | 441-16 `7ced26a49`, `fb8013d4e` |

Four dependency edges went with their last import: analytics → `@vostride/agent-qa-safety`
(441-08), eval-local → `@vostride/agent-qa-safety-local` (441-32), knowledge-local →
`@vostride/agent-qa-safety-local` (441-41), and the agent and cli runtime edges to
`@vostride/agent-qa-safety`, which became devDependencies for tests that import kept exports
(441-29, 441-43; 441-45 closed both as intended). `pnpm-lock.yaml`: +6/−15, each edit made by hand
and verified with `install --offline --frozen-lockfile`. The conformance golden's
`ConfigChangeAnswer` digests moved once, when the config-change answer lost its `guardrail-hit`
arm (441-39 `92829dedb`).

#### Registered gate rows renamed in place

The 1366 rows listed at `6de55acde` are still listed, in order. Two were renamed in the same commit
as their subject, file and origin unchanged:

- `C436-PROMPT Rule 23 is byte-unchanged` → `C436-PROMPT Rule 23 is the 441 one-line secrets rule`
  (436 D-26; 441-01 `0ac642a3d`).
- `C438-PROCEDURE-WRITE passes the written name and row through the active masking context` →
  `C438-PROCEDURE-WRITE passes the written name and row through the tail's mask` (438 D-11; 441-10
  `2f86a5278`).

No listed row was removed or moved to another file.

### What was RETAINED, and why

| Item | Where (at `d59dbf568`) | Why kept | What pins it |
|---|---|---|---|
| `SecretRedactor` and `SecretStore`: one compiled pass, longest value first, `[secret:<first-declared name>]`, templates named, existing markers kept | `runner/src/loop/secrets.ts` | the one masking function (D-11); 441-01 decision 1 | `C441-REDACTOR` (9 cells) |
| `{{secret:<name>}}`, filled locally at dispatch | the runner's template resolution | how a test types a secret (D-09) | `C441-DISPATCH-REFUSAL the template form still types the real value` |
| `[secret:<name>]`, the marker | everything that writes or prints | D-05 | the proof cells |
| the literal-marker refusal (`literalSecretMarkerRefusal`) at dispatch and at the three authoring draft sites | `runner/src/loop/secrets.ts`, the runner loop, `agent/src/authoring/` | D-10 | `C441-DISPATCH-REFUSAL` (7), `C441-DRAFT-MARKER` (11) |
| the host loader `createDeclaredSecretMask(configPath)`, re-read on `(mtimeMs, size, ino)` change, refusing with `DeclaredSecretsUnavailableError` | `cli/src/composition/declared-secrets.ts` (new) | how `ask`, `chat`, MCP, analytics, the daemon and the dashboard reach the mask (441-01 decision 5) | `C441-LOADER` (5) |
| `createMaskingMiddleware(mask)` and `mapPromptLeaves`, last in `createModel`'s per-call middleware | `safety/src/egress/masking-middleware.ts` (new), `safety/src/egress/map-prompt-leaves.ts`, `model/src/registry.ts` | model egress masks with the caller's mask (441-01 decision 6); binary and base64 data never reaches the mask (D-21) | `C441-EGRESS` (20), `validate:safety` (a) |
| `runSafetyScope`, with the execution context only | `safety-local/src/safety-scope.ts` | Open Question 5: the execution context is a durable field; its audit and masking members went in 441-44 and 441-33 | `C441-SAFETY-SURFACE` |
| `classifyRisk` and `TIER_ORDER` | `safety/src/policy/` | eval scoring reads the tiers (432's reason) | `C432-EVAL-RISK-PARITY`, `C441-SAFETY-SURFACE` |
| the data delimiters and memory's L3 DATA framing (`wrapAppObservedData`, `APP_OBSERVED_DATA_OPEN`/`CLOSE`) | `safety/src/serving/data-delimiters.ts` | prompt framing, not a detector (D-26 "What stays") | `C441-SAFETY-SURFACE` |
| the curation posture `'no-masker'` / `'masker-active'` | cli curation | Pitfall 6: removing it changes who curates; `'masker-active'` now means a declared mask is bound (441-01 decision 10) | `C441-CURATION the post-run tail declares masker-active exactly when it holds a mask` |
| the analytics structural seam (`AnalyticsMaskingContext`, its leaf walk) | `analytics/src/masking-seam.ts` | the analytics hosts hand it the declared mask; the package itself imports nothing from safety | `C441-ANALYTICS` (4) |
| `maskRecordContent` and `MaskFn` | `schema/src/functions/record-join.ts`, `schema/src/run/bus-projections.ts` | every consumer takes a `MaskFn` (441-01 decision 4) | census kept-name control |
| the config reader names (`getMasked`, `MaskedResolvedConfig`, `MaskedConfigEntry`) | `schema/src/config/`, cli, agent | their output now passes through the declared mask only; renaming them is churn | census kept-name control; `C441-CONFIG` (15) |
| the config leaf list `CONFIG_SCHEMA_LEAVES` | `schema/src/config/leaves.ts` (new) | the plain leaf list the map became (441-01 decision 16) | the config editor cells |
| the D-18 raw fields: the handoff's screen state, `stepText`, `plannedAction`, `interpolatedVariables`, the cache's `fill` text | runner, schema | D-18: saved unmasked by design and never scanned; the cache still refuses a step that uses a secret | the proof's D-18 path blanking (441-13) |
| `assertRestrictedFallbackDelta` | `knowledge-local/src/curator/fallback.ts` | its commit-side caller went in 441-24 (leg 16); whether the defence returns under another reason is 441's review's (deferred) | its own `fallback.test.ts` cells |

### What degrades, stated plainly

- **An undeclared credential of any kind is not masked anywhere.** An email, a cookie or
  localStorage value, saved auth state, an environment variable of any name (including
  `ANTHROPIC_API_KEY`, `GH_TOKEN` and `*_PASSWORD`), an `envFile` value, a card number, an AWS key
  and a bearer token reach the model, the records, the transcript, the dashboard, MCP and the
  terminal as written (D-01, D-23).
- **No request and no committed file is scanned or blocked.** A model request is sent whatever it
  holds; knowledge bundles, receipts, policy files, quarantine rows, eval reports, seeds,
  adversarial cases and the working-memory flush are written as authored (D-15).
- **Curation treats every candidate the same.** Instruction-shaped text is authored, committed and
  embedded through the normal path; there is no prompt-injection defence until READY-FUT-07 (D-26,
  D-27). Curated DOM and accessibility snapshots carry only the declared mask; screenshots are
  copied byte for byte (D-28, D-21).
- **The dashboard has no reveal.** A declared value is shown as `[secret:<name>]` and cannot be
  shown as the value (D-07, D-29).
- **Config output shows values as written, except declared ones.** `config show`, the run
  `--debug` tables, the dashboard config editor and `config.get` show an undeclared
  credential-named or credential-shaped value as written. `config set` accepts any key and value.
- **A short declared value masks every occurrence.** A 1-character or 3-character value is masked
  wherever it appears, ordinary words included (D-02).
- **Matching is raw and exact.** A URL-encoded, JSON-escaped, base64 or case-changed form of a
  declared value is not masked (D-03; `C441-REDACTOR encoded and case-changed forms are not masked`).
- **A value declared after a run is not masked in that run's stored text.** Records are masked at
  write; the dashboard serves stored text (441-01 decision 13).
- **Known text paths that skip the mask**, open for 441's review: `config set`'s success line
  echoes the written value; curation's fact and caution seeds copy element names and root-cause
  text without the mask. MCP answers a generic "Internal server error" when the secrets file is
  missing (fail-closed, but the cause is hidden).

### Persisted values the narrowed contract governs

No migration and no compatibility code (D-20).

| Persisted value | Disposition | Evidence |
|---|---|---|
| old `<SECRET_n>` / `<EMAIL_n>` placeholders, the runner's old generic `[secret]` marker and `␟masked:…␟` markers in existing `events.jsonl`, handoffs, session JSONL and `runs.db` | **Shown as stored text.** Nothing converts, chips or restores them. | `failure-banner.test.tsx` `FailureBanner old marker text renders as written` (441-38); `SECRET-PLACEHOLDER-AS-TEXT: an old <SECRET_n> placeholder is shown as written, with no chip` (441-37); `step-name-pills.test.tsx` `shows an old run's numbered placeholder in a DURABLE step text as the characters it holds` (441-17); `C441-DISPLAY the console reporter prints a numbered placeholder unchanged and restores nothing`; `C441-CURATION a numbered email placeholder from an old run is literal text` |
| `<root>/runs/<id>/masking-digests.json` and `<root>/masking-key` | **Left on disk, never read.** No code writes or reads a digest or a host key (441-48). | `C441-RETURN-05` (`masking-digests.json`, `MASKING_HOST_KEY_FILE`) |
| `guardrail_audit.jsonl` in `.agent-qa/`, `.agent-qa/runs/<id>/` and under `.agent-qa/eval/audit/` | **Left on disk, never read.** Nothing writes or reads one (441-31, 441-32, 441-43, 441-44). | `C441-RUN-RECORDS a completed run leaves no guardrail audit file in its run directory`; `C441-RUN-RECORDS an eval replay and its adjudication write no guardrail audit file`; `C441-RETURN-18` |
| curation queue rows (`memory/queue/`) carrying a `captureReceipt` (every row written before 441-25) or `secretFlagged` / `injectionFlagged` (before 441-50) | **Read as malformed and skipped.** The payload stays `.strict()` at queue version 2; `queuedPayloads` skips the row and the drain quarantines it and carries on. | `curation queue atomic emit drop (CUR-04/T-378-07..09) C441-CURATION a queue row with a capture receipt is skipped as malformed` (441-25); `… C441-CURATION a queue row with the retired flags is skipped as malformed` (441-50) |
| the candidate content address (`candidateId`, and `curationJobId` in bundle outcome lines) | **Moved twice**: when the receipt left the address (441-25) and when the two flags left it (441-50). The same evidence gets a different id; committed bundles keep their old ids. `416-v51-reference.json`'s six pinned ids were re-spelled both times (`fact/door2-canary` `dd7e34f3…` → `032f723f…`, `fact/door3-drain` `0c7ea57b…` → `e7312cfd…`, `caution/door3-drain` `7c1f8aeb…` → `66345bc4…`, `fact/door1-promote` `fd3b9e3c…` → `d6aab49f…`, `caution/door1-promote` `93b33945…` → `42755dbf…`, `caution/door2-canary` `c82bbf54…` → `f3c3bbc4…`, the second move's values). | `416-v51-reference.test.ts`, `promotion-floor.acceptance.test.ts` (441-25 `d6e1f9ea4`, 441-50 `99013e58d`) |
| `artifacts.json` (`ArtifactsIndexSchema`) whose skipped-artifact `reason` is `'capture-blacklist'` | **Fails the schema.** The reason left the enum (441-25). | read from 441-25's change; not pinned by a cell |
| procedure trajectory value slots carrying `targetRef` | **Undecodable.** `trajectoryValueSlotSchema` is strict and lost the key (441-25), so `parseProcedureTrajectorySeed` returns `undefined` and the extraction author answers `fallback-required` (`malformed`), which the fallback disposes as a Noop. Such seeds sit only in pre-441-25 queue rows, which are already skipped for their receipt. | read from `cli/src/curation/emit-candidates.ts` and `curator-author.ts` at `d59dbf568`; not pinned by a cell |
| adversarial refresh records (`<agentQaRoot>/eval/adversarial-state/<product>/<digest>.json`) carrying `policyDigest` or a `'refused'` tuple outcome | **Read as malformed.** The strict schema refuses `policyDigest`, and `readAdversarialRefreshRecords` throws on it as on any malformed record (441-53). A record for the same refresh now has a different file name. The probe store's `'refused'` completion outcome is unchanged. | `C441-COMMITTED adversarial admission needs no guardrail policy` (its legacy-record leg) |
| bundle provenance `withheld: true`, stamped before 441-24 | **Still read.** The optional field stays in `schema/src/knowledge/bundle-files.ts` and the promotion gate still holds such a bundle as `withheld`; no writer stamps it now. | read from code at `d59dbf568`; not pinned by a cell |
| the retired outcome reasons `egress-blocked`, `injection-restricted`, `restricted-fallback` and the commit outcome `withheld` | **Not persisted.** They were return values of the commit, store, drain and seeding paths; no production code names them (`C441-RETURN-14`, `-16`). `DrainReport.withheld` stays and is always 0 (deferred). | 441-22, 441-24, 441-42 |
| action-cache entries keyed before 441-09 | **May miss.** The key now folds step text through the declared mask instead of the masking context, so a step whose text held an email or an environment-seeded value keys differently and is planned again. No entry is rewritten. | inferred from 441-09's change; not observed by a cell |
| chat session files holding a value typed before 441, or an undeclared value | **Left as typed.** No history rewrite (D-19); no purge (out of scope). | `C441-CHAT an undeclared credential typed in chat is stored as typed` |

There is no user-facing guardrail or masking config key to retire: the guardrail policy input was
in code only, and `safety.*` was cut in 432 (441-RESEARCH § Runtime State Inventory).

### Correction to the 2026-10-02 retained rows

The Phase 432 section lists as retained four things Phase 441 deleted. The rows are kept as written;
this is their dated pointer.

- Members table, `appendExecutionAudit` row: "`JsonlAuditSink` …, now the guardrail append only".
  `JsonlAuditSink` was deleted in 441-44 (`37cc19c49`).
- What was RETAINED, "the guardrail audit: `AuditSink`, `JsonlAuditSink.appendGuardrailAudit`,
  `guardrail_audit.jsonl`" and "`registerFirstPartySafetyHooks`' masking and guardrail middleware":
  deleted in 441-33 (`5a1985175`, `f544714c3`) and 441-44; the model path's masking is now
  `createMaskingMiddleware`, still pinned last by `validate:safety` (a).
- What was RETAINED, "the `env-var-name` masking class" in `schema/src/config/masking.ts`: the file
  was deleted in 441-40 (`a049ccd6b`).
- Persisted values, "`guardrail_audit.jsonl` — Actively retained": no row is appended now; old files
  are left unread (above).

### The instruments that notice a return

- **`pnpm validate:arch`** runs the 441 census beside the earlier ones (412, 430, 432 and 436 to
  439 among them):
  `C441-RETURN-01` to `C441-RETURN-20`, `C441-SAFETY-SURFACE`, and the instruments
  `C441-UNIVERSE-FLOORS`, `C441-LEXER-CONTROL`, `C441-PLANTED-POSITIVE` and `C441-SELF-MATCH`. A
  returning masker, restore path, marker, redactor, guardrail, policy, egress check, scan, flag,
  audit writer, hook seam or cold-read scope reds by name on the commit that adds it.
- **`pnpm validate:safety`** (a): the declared-secret masking middleware is last in `createModel`
  and given its mask.
- **The 434 gate** (`pnpm run gate:local`) must execute and pass all 174 listed `C441-` cells, each
  with its `441 D-NN` origin: `C441-REDACTOR` 9, `C441-DISPATCH-REFUSAL` 7, `C441-PROMPTS` 3,
  `C441-DRAFT-MARKER` 11, `C441-LOADER` 5, `C441-EGRESS` 20, `C441-DEBUG-LOG` 4,
  `C441-HOOK-OUTPUT` 3, `C441-CHAT` 5, `C441-PROOF` 5, `C441-NOTHING-ELSE` 3, `C441-MCP-DIFF` 1,
  `C441-ANALYTICS` 4, `C441-RUN-RECORDS` 14, `C441-NETWORK` 2, `C441-DISPLAY` 9, `C441-COLD-READ` 3,
  `C441-CONFIG-SCAN` 4, `C441-CONFIG` 15, `C441-COMMITTED` 10, `C441-CAPTURE` 1, `C441-CURATION` 8,
  `C441-RETURN` 25, `C441-SKILL` 2, `C441-NO-HOOK-PORT` 1. The proof (`C441-PROOF`) and its twin
  (`C441-NOTHING-ELSE`) red if a declared value reaches a request or a byte on disk, or if an
  undeclared value is masked or a request blocked.
- **Fifteen more `C441-` cells run in the ordinary package suites but are not in the gate list**,
  because they sit under older describes and their full names do not start with `C441-`: two in
  `cli` (`run-detail-dom.test.ts`, `run-detail-failure-dom.test.ts`, `C441-DISPLAY`), five in
  `knowledge-local/src/__tests__/curation-queue.test.ts` (`C441-CAPTURE` 3, `C441-CURATION` 2), six
  in `curator/__tests__/commit.test.ts` and one in `curator/__tests__/drain.test.ts`
  (`C441-CURATION`), and one in `review/__tests__/apply-review.test.ts` (`C441-COMMITTED`). They are
  named in `441-RECORD.md`.

### Not observed, stated as such

- **No live model ran.** Every cell uses a stub or scripted model; the proof's run leg drives the
  shipped binary against its own page and a recording model proxy.
- **The hosted quickstart** (`vostride.com/docs/agent-qa/quickstart`) is outside agent-qa and was
  not edited; it does not yet state the rule (the owner's manual follow-up).
- **No user workspace was migrated or inspected.** The persisted-value dispositions above are what
  the cells and the code at `d59dbf568` show for files written in the old formats, not an
  observation of a real project.
- **A real coding-agent session over MCP, and a person clicking through the dashboard,** were not
  performed; the MCP and dashboard cells stand in for them.

### Reconciliation

Reconciliation 23 (2026-10-12) in `.planning/REQUIREMENTS.md` amended V2-EXEC-03 before planning
(and was widened the same day to remove `injectionShape` and add READY-FUT-07), and
`spec/v2/execution-safety.md` (its dated block) and `spec/v2/release-readiness.md` (V2-EXEC-03 and
§4.1) were amended the same day. What was built matches it, so no new reconciliation was needed.

### Gate at the time of writing

The record gate runs on Phase 441's final agent-qa SHA, which
`.planning/phases/441-declared-secret-masking/441-RECORD.md` § Final SHA names. Its legs, counts and
verdict, including a first red run on the commit that added this section, are recorded in that
file's § Gate rather than quoted here, so no agent-qa commit follows the gate run.

### Gap closure round 1 (441-61 to 441-66), 2026-10-15

This subsection appends to the Phase 441 section and rewrites none of it; written by 441-66. It
follows `.planning/phases/441-declared-secret-masking/441-VERIFICATION.md` (agent-qa `1a913e426`,
6 of 10 truths), whose gaps the orchestrator decided as GAP-D1 to GAP-D9 on 2026-10-15, with the
owner's delegation. Every commit below is in agent-qa on `version-0.2` and signed. Every new cell is
listed in `scripts/gate/inputs/regressions.json` with its `441 GAP-D<n>` origin, after the 1540
rows listed at `1a913e426`, which are unchanged and in order. Three registered cells were re-aimed
under their kept names: `C441-EGRESS a JSON tool result is walked leaf by leaf` (its key is now
expected masked), `C441-PROOF run masks both declared values in every model request, record and
terminal line` (two assertions added) and `C441-COMMITTED adversarial admission needs no guardrail
policy` (its legacy leg now expects the old record to be skipped).

**What each decision changed**

- **GAP-D1, templates reach the model (VERIFICATION truth 6, CR-B01, WR-B01).** The template rule
  lives once, inside `createMaskingMiddleware`
  (`safety/src/egress/masking-middleware.ts`): each string leaf on its way to a model is split on
  `{{secret:<name>}}`, the text between tokens is masked, and a token is sent verbatim when the mask
  only names it. No mask call site changed. Records, logs and the terminal still turn the template
  into `[secret:<name>]`. `SecretRedactor.redactString` now also masks a declared value written as
  the name inside an undeclared marker or template (`[secret:hunter2]` becomes
  `[secret:[secret:PW]]`). 441-61. Cells: `C441-GAP-EGRESS` (3), `C441-GAP-REDACTOR` (2).
- **GAP-D2, object keys are masked (truth 7, CR-B02, WR-B05, IN-A07).** The prompt walker
  (`mapJsonLike`) masks object keys, walks `toJSON` results and class instances as the JSON a
  provider receives, returns binary untouched and refuses two keys that mask to one name. The new
  schema walk `maskPayloadTree` does the same for documents whose keys are data: `fn` output, the
  chat projection (`maskChatProjection`) and the `entities`, `knowledge read` and
  `knowledge maintain` `--json` emitters. 441-61, 441-62. Cells: `C441-GAP-EGRESS` (6),
  `C441-GAP-WALKER` (3), `C441-GAP-TRANSCRIPT` (1).
- **GAP-D3, the terminal (truth 8, CR-A01, CR-A02, CR-A03, T-441-45, WR-A06, WR-A02, WR-D03).**
  `fn` masks the result's structure before it serializes. Judge calibration (cli and eval-local)
  masks the string leaves of its structure, never serialized JSON. `config set` prints its success
  line through `createDeclaredSecretMask(configPath).mask`, and without a usable mask it prints the
  line without the value; the write always stands. The run's framework-error, run-denied and run-id
  refusal lines go through the run's redactor. The post-run tail masks every line it logs and every
  log it hands on. `createDeclaredSecretMask` re-resolves `workspace.secretsFile` when the config
  file changes. 441-62, 441-63. Cells: `C441-GAP-DISPLAY` (5), `C441-GAP-CONFIG` (2),
  `C441-GAP-LOADER` (2).
- **GAP-D4, curation seeds (truth 9, T-441-25, T-441-50, CR-A04, WR-C03, WR-C01).** Fact, caution
  and measurement seeds are composed, then masked whole. Anchors and observations are masked by
  their text members before the evidence token and the content address are derived, so the
  deterministic fallback commits only masked text. The procedure seed masks target names, page
  routes and every observed value before classification, so a typed declared value becomes a
  `masked-secret` slot. The disposition's literal check matches `[secret:<name>]`. 441-64. Cells:
  `C441-GAP-CURATION` (4).
- **GAP-D5, dashboard answers (truth 10's leak half, WR-D04).** The router receives the declared
  mask (`RouterDeps.declaredSecretMask`). The registry hook-run answer (output, stdout, stderr,
  error, variable keys and values, network log URLs), the LLM connection test's message and
  details, `GET /api/config/targets` names and config issue paths are masked. Without a usable mask,
  each leaves the text out rather than answer it raw. 441-65. Cells: `C441-GAP-DASHBOARD` (6).
- **GAP-D6, the two kept dashboard redactions (truth 10's "nothing else" half, IN-D01).** No code
  changed. The exception is below, and the skill (both copies), the contracts reference (both
  copies), `README.md` and the cli README now name it wherever they say nothing else is masked.
  441-66 `b58044d14`.
- **GAP-D7, a shown marker is never written back (CR-D01).** `ConfigManager.applyChanges` refuses a
  change whose path, selector name, move source, value leaf or value key holds `[secret:<name>]`,
  before the file is read, with the new refusal `marker_written_back`. The dashboard, chat and MCP
  config writes share it. 441-65. Cells: `C441-GAP-CONFIG-WRITE` (3).
- **GAP-D8, pre-441 data (SC6's caveat, CR-C01, CR-C02).** `knowledge purge` reads a queue payload
  that matches no current schema loosely and leaves it in place unless it names purged content;
  non-JSON bytes still refuse. `readAdversarialRefreshRecords` skips a record that fails the strict
  schema. 441-64. Cells: `C441-GAP-OLD-DATA` (3).

#### Retained as a deliberate exception (GAP-D6)

| Item | Where | What it masks | Why kept |
|---|---|---|---|
| `withoutSavedValues` | `dashboard-server/src/server/routes.ts` | the LLM connection test's saved header values, each at least four characters (`MIN_REDACTED_HEADER_LENGTH`), replaced with `[redacted]` in the provider's error text before the declared mask runs | it stops a key or header the person is testing being echoed back to the browser |
| `withoutSecret` | `dashboard-server/src/server/llm-connect-route.ts` | the key typed into the connect flow, replaced in the provider's error text | the same: the typed key under test is not echoed to the browser |

Both mask undeclared values, so they are the one exception to "nothing else is masked". VERIFICATION
truth 10's "nothing else is masked, and the runner's `SecretRedactor` is the one masking function"
half is accepted by an override in `441-VERIFICATION.md` (orchestrator, owner delegated, GAP-D6).
`C441-GAP-DASHBOARD an LLM connection test answers provider error text with a declared value only as
its marker` also pins the `[redacted]` saved header.

#### Contracts and persisted values

| Contract or persisted value | Disposition | Evidence |
|---|---|---|
| `ConfigWriteRefusal` / `CONFIG_WRITE_REFUSALS` | **Gains `marker_written_back`.** The page's `CONNECT_REFUSAL_COPY` and the agent's `FIELD_WRITE_REFUSAL_WORDS` carry its words. A refusal on a change addressed by a `{ name }` selector shows as the general "Not saved" message, not under the field (open). | `C441-GAP-CONFIG-WRITE` (3); `C429-CONFIG-WRITE-REFUSALS-EXACT` |
| `maskPayloadTree` | **New export of `@vostride/agent-qa-schema`** (run barrel and root barrel), beside `maskPayloadStrings`, which keeps its values-only behaviour for run records and bus projections. | `C441-GAP-WALKER` (3) |
| dashboard answers with no usable mask | **Answer without the text.** The hook run answers `503 masking_unavailable`; the target list answers `500 masking_unavailable`; the LLM test answers its class sentence with no provider text and no details. | `C441-GAP-DASHBOARD` (6) |
| the candidate content address | **Moves only for evidence that holds a declared value.** Anchors and observations are masked before the address is built. No `416-v51-reference.json` id moved and nothing was re-spelled in 441-64: its fixtures declare no value. | `416-v51-reference.test.ts`, `promotion-floor.acceptance.test.ts` (unchanged, 441-64 `80ea9c47d`) |
| curation queue payloads written before Phase 441 that match no current schema | **Skipped by `knowledge purge`** (D-20). Left in place unless their candidate id, a seed or an artifact digest names purged content, which sweeps them. The drain still skips and quarantines them, as recorded above. | `C441-GAP-OLD-DATA` (2 purge cells) |
| adversarial refresh records written before Phase 441 (carrying `policyDigest`) | **Treated as absent** (D-20). `readAdversarialRefreshRecords` skips them; a record whose digest name or product does not match still throws. | `C441-GAP-OLD-DATA a later refresh stages beside a pre-441 refresh record`; the re-aimed `C441-COMMITTED` cell |
| curation queue rows and committed fact, caution and procedure bundles written after this round | **Hold a declared value only as `[secret:<name>]`** in seeds, anchors, natural keys, target names, page routes and observed values. Rows and bundles written before the round are not rewritten. | `C441-GAP-CURATION` (4) |

The derived index (`memory/index/knowledge.db`, gitignored) still stores a run's exercised anchors
from the raw handoff (D-18); this is open for 441's review.

#### Supersedes

- **"Known text paths that skip the mask"** (What degrades, above): `config set`'s echo is closed
  (441-63) and curation's fact and caution seeds are closed (441-64). MCP's generic "Internal server
  error" on a missing secrets file stays open.
- **The loader row's re-read sentence** (What was RETAINED, above): the loader now also re-resolves
  `workspace.secretsFile` when the config file's `(mtimeMs, size, ino)` changes, keys its content
  cache on the path and the file's stat, and never caches a failed resolve; a config that drops the
  setting refuses (441-63).
- **"An undeclared credential of any kind is not masked anywhere"** (What degrades, above): except
  the two GAP-D6 redactions above.
- **The adversarial refresh row** (Persisted values, above): such a record is now skipped, not read
  as malformed and thrown on (441-64).
- **The 434 gate count** (The instruments, above): the gate list holds 214 `C441-` cells, the 174
  above and 40 `C441-GAP-` cells (`C441-GAP-EGRESS` 9, `C441-GAP-REDACTOR` 2, `C441-GAP-WALKER` 3,
  `C441-GAP-TRANSCRIPT` 1, `C441-GAP-DISPLAY` 5, `C441-GAP-CONFIG` 2, `C441-GAP-LOADER` 2,
  `C441-GAP-CURATION` 4, `C441-GAP-OLD-DATA` 3, `C441-GAP-DASHBOARD` 6, `C441-GAP-CONFIG-WRITE` 3).

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands. Its legs, counts and
verdict are recorded in `.planning/phases/441-declared-secret-masking/441-RECORD.md` § Gate and the
SHA in § Final SHA, rather than quoted here, so no agent-qa commit follows it.

### Gap closure round 2 (441-67 to 441-70), 2026-10-15

This subsection appends to the Phase 441 section and rewrites none of it, including the round 1
subsection above; written by 441-70. It follows the round 1 gap review (2026-10-15), whose findings
the orchestrator decided as GAP2-D1 to GAP2-D8 on 2026-10-15, with the owner's delegation. GAP2-D8
comes from the security re-audit's flag 5. Every commit below is in agent-qa on `version-0.2` and
signed. Every new cell is listed in `scripts/gate/inputs/regressions.json` with its `441 GAP2-D<n>`
origin, after the 1580 rows listed at `61cc568fd`, which are unchanged and in order. Four registered
cells were re-aimed under their kept names, as recorded below; no row was edited.

**What each decision changed**

- **GAP2-D1, a literal that contains a declared value is not a secret parameter (CR-G01).**
  `trajectoryValueClassification` (`cli/src/curation/emit-candidates.ts`) now takes the raw and the
  masked value and decides in order: a raw value equal to a test variable keeps that variable's
  binding; a masked value that is exactly one `[secret:NAME]` or `{{secret:NAME}}` binds `NAME`;
  any other secret form is a `literal`; `{{env:` is an unnamed test variable; everything else is a
  `literal`. The two secret-name patterns are anchored to the whole value. With `PW=hunter2`, a typed
  `hunter2-extra` is queued as the literal `[secret:PW]-extra`, never authored as `{ param: 'PW' }`.
  441-67 `1660c2c72`, `206560e61`. Cells: `C441-GAP2-CURATION` (4).
- **GAP2-D2, text bound for a model is masked whole before a template is restored (WR-G01).**
  `createMaskingMiddleware`'s module-private leaf function (`maskKeepingTemplates`,
  `safety/src/egress/masking-middleware.ts`) sends `mask(text)` and puts a `{{secret:NAME}}` token
  back only when its name holds no declared value, the mask names or keeps it, masking piece by
  piece equals the whole pass, and the cut-brace probes over the whole text before and after the
  token find no declared value across its braces. No export, call site or barrel changed. 441-67
  `c0a774cbb`, `2c7241109`. Cells: `C441-GAP2-EGRESS` (3).
- **GAP2-D6, judge calibration keeps its discriminants and masks its free text (WR-G02, CR-A02's
  rest).** The new eval-local export `maskJudgeCalibrationText(value, mask)`
  (`eval-local/src/judge-calibration-composition.ts`, exported from its `index.ts`) masks every string
  leaf except at a fixed list of type paths whose declared type is a closed string-literal union,
  chosen per arm from the raw top-level `kind` and `artifact.status`, never by a bare key name. The
  kept paths are `kind`, `status`, `minNSource`, `artifactDisposition`, `reason` (capability-gap arm
  only), `judgeTargeted.basis`, `.source` and `.reason`, `entries[].credential`,
  `entries[].failures[]`, `rows[].kind`, `.reason` and `.axis`, and `artifact.status`,
  `.minNSource`, `.reason` (gap arm only) and `.judgeTargeted.*`. The judge panel preview and the
  cli's `runJudgeCalibrateVerb` return through it; neither imports `maskPayloadStrings` now.
  `eval calibrate --judge-panel` prints the capability gap instead of throwing when a declared value
  spells part of `capability-gap`. 441-68 `2f75a1e42`, `7538cd702`. Cells: `C441-GAP2-JUDGE` (4).
- **GAP2-D3, chat and the `fn` stream keep their structure (WR-G06).** `maskChatProjection` is
  deleted from `agent-local/src/composition/compose-local-agent.ts`. Session events, op answers and
  turn results are projected member by member through module-private rule tables: text members pass
  the mask, data subtrees (`clause_result.payload`, an op answer's `payload`) pass
  `maskPayloadTree`, closed-vocabulary and minted members (`kind`, `turnId`, `at`, statuses, op ids,
  origins, stages, hashes, counts) and every key are written as they are, and a member no table
  names is masked as a tree. `fn.ts`'s `streamLine` keeps each `--json` stream line's `seq`, `ts`,
  `runId` and `type` keys; `seq`, `ts` and `type` keep their values, `runId` passes the mask and the
  rest passes `maskPayloadTree`. 441-68 `d78adddfa`, `e7244d6f5`. Cells: `C441-GAP2-TRANSCRIPT` (2),
  `C441-GAP2-DISPLAY` (1).
- **GAP2-D4, an `expect` is compared, never refused as a write-back (WR-G04).**
  `changeWithShownMarker` (`dashboard-server/src/config/config-manager.ts`) skips `expect` ops,
  path and value. `expectHolds` passes an expect that deep-equals the field as the file holds it, or
  the field passed through `maskPayloadTree` with the declared mask; a mask that throws matches
  nothing, and anything else refuses `field_changed` as before. Deleting a model while a judge name
  holds a declared value now lands, and the judges list stays raw in the file. Every
  `marker_written_back` refusal uses the new schema sentence, and the agent's
  `FIELD_WRITE_REFUSAL_WORDS.marker_written_back` tells chat and MCP to edit the config file
  directly. 441-69 `4945742f4`, `887331b5c`, `17bb918dc`. Cells: `C441-GAP2-WRITE-BACK` (3).
- **GAP2-D5, a masked target is never saved into a test or suite file (WR-G03).** `POST /api/tests`,
  `PUT /api/tests/:id`, `POST /api/suites` and `PUT /api/suites/:id`
  (`dashboard-server/src/server/routes.ts`) check the content's `target` after the presence checks
  and before the id lookup, validation or any write, and answer `422 marker_written_back` with the
  sentence when it holds `[secret:<name>]`. The predicate is `holdsShownMarker`, now a module export
  of `config-manager.ts` (the package barrel does not re-export it). `ApiError` takes the server's
  sentence as its message for this reason, so both editors show it. 441-69 `d5f68ddb6`, `28efbe900`.
  Cells: `C441-GAP2-TEST-SAVE` (4).
- **GAP2-D8, `config set` refuses a shown marker (security re-audit flag 5).** `setAction`
  (`cli/src/commands/config.ts`) refuses a key or value matching `[secret:<name>]` before the config
  file is read, prints `config set refused (marker_written_back): <sentence>` on stderr, exits 1 and
  never echoes the value. The success path and 441-63's masked line are unchanged. 441-69
  `7ad7142b9`, `17bb918dc`. Cells: `C441-GAP2-CONFIG` (2).

**Re-aimed registered cells (names kept).** `C441-GAP-DISPLAY judge calibrate keeps numbers and DTO
keys with a one-digit declared value and masks string leaves` now expects `minNSource: 'default'`
and asserts a masked judge model id; `C441-GAP-DISPLAY the judge panel preview keeps its keys when a
declared value is a key name and masks string leaves` now expects `status: 'uncalibrated'` and
asserts a masked recorded model id (441-68). `C441-GAP-CONFIG-WRITE a set whose value holds a shown
marker is refused and the file is unchanged` and `C441-GAP-CONFIG-WRITE a path segment, selector,
move source or value key holding a shown marker is refused and the file is unchanged` now expect
`MARKER_WRITTEN_BACK_SENTENCE`, and the second no longer lists the expect-led change set, because an
expect writes nothing (441-69).

#### Contracts and persisted values

| Contract or persisted value | Disposition | Evidence |
|---|---|---|
| `MARKER_WRITTEN_BACK_SENTENCE` | **New export of `@vostride/agent-qa-schema`** (`schema/src/config/config-write.ts`, re-exported from the config barrel and the root barrel beside `CONFIG_WRITE_REFUSALS`). The one sentence for `ConfigManager`, the test and suite save refusal, `config set` and `CONNECT_REFUSAL_COPY.marker_written_back`: it tells the person to edit the config or test file directly and not to copy the marker; the secret's value stays in the secrets file. | `C441-GAP2-WRITE-BACK a set whose value holds a marker is still refused, with a sentence naming the config file` |
| `maskJudgeCalibrationText` | **New export of `@vostride/agent-qa-eval-local`.** The judge-calibration DTO keeps its closed-vocabulary values raw at the type paths listed above and masks every other string leaf, including refused, busy, input-drift and publication-failed reasons, judge names, model ids, identities and paths. | `C441-GAP2-JUDGE` (4) |
| `marker_written_back` | **Covers ops that write only.** An `expect` is compared in the file's space or the masked space, never refused. **It now also covers** the dashboard's test and suite saves (`422`, target only) and `agent-qa config set` (exit 1, before the file is read). Chat and MCP config writes keep it through `ConfigManager`. | `C441-GAP2-WRITE-BACK` (3), `C441-GAP2-TEST-SAVE` (4), `C441-GAP2-CONFIG` (2) |
| procedure slots and committed procedures | **A typed value is bound to a secret only when it is exactly one marker or template.** A literal that contains a declared value is queued as a masked literal and refused at disposition by the masked-literal check, so such a procedure candidate no longer commits. A raw value equal to a test variable keeps the variable's binding even when it is also a declared value (open below). | `C441-GAP2-CURATION` (4) |
| chat session files (`*.jsonl`) | **Events keep their structural keys and closed-vocabulary values.** A session file written between 441-62 and 441-68 while a short declared value renamed its keys stays unreadable: those lines are refused on reopen as before, with no migration (D-20). Files written since 441-68 re-open with every event. | `C441-GAP2-TRANSCRIPT a chat session written while a one-character value is declared re-opens with every event` |
| `fn runs.events --json` lines | **Keep `seq`, `ts`, `runId` and `type` keys**, so `seq` stays a resume token; `runId`'s value is masked. | `C441-GAP2-DISPLAY` (1) |
| the config file after a model delete | **The judges list stays raw** when the page's expect-led change set lands. | `C441-GAP2-WRITE-BACK deleting a model while a judge name holds a declared value lands and leaves the judges raw` |
| test and suite files | **Never receive a `[secret:<name>]` target from the dashboard**; nothing is written on refusal. | `C441-GAP2-TEST-SAVE` (3 server cells) |

**`KEY_42` (441-67).** With `PIN=42` and a declared name `KEY_42`, user text
`use {{secret:KEY_42}} now` reaches the model as `use [secret:KEY_42] now`, the same marker every
record, log and terminal line shows (D-05 names a marker after the secret's own name). Neither the
template nor the value reaches the provider, but the `42` inside the name still appears in that
marker everywhere. Declared names that hold other declared values are not renamed; this is open for
441's review, and the cli and safety `C441-GAP2-EGRESS` cells pin the rendering.

#### Supersedes

- **Round 1's `marker_written_back` remedy** (Contracts and persisted values, round 1): the refusal
  no longer covers `expect` ops, and its words no longer say to change the value in the secrets file
  (`workspace.secretsFile`). They say to edit the config or test file directly
  (`MARKER_WRITTEN_BACK_SENTENCE`), and the agent's words say the same for chat and MCP.
- **Round 1's `maskPayloadTree` over whole chat envelopes** (GAP-D2's bullet, "the chat projection
  (`maskChatProjection`)"): the chat projection is per member; `maskPayloadTree` masks only the data
  subtrees, and keys and closed-vocabulary members are written as they are. The `fn --json` stream
  keeps its four structural keys the same way.
- **Round 1's template rule** (GAP-D1's bullet, "a token is sent verbatim when the mask only names
  it"): a token is restored only where restoring re-sends no declared value.
- **Round 1's judge-calibration masking** (GAP-D3's bullet, "masks the string leaves of its
  structure"): closed-vocabulary paths stay raw.
- **Round 1's procedure-seed classification** (GAP-D4's bullet, "so a typed declared value becomes a
  `masked-secret` slot"): only a value that is exactly one marker or template does.
- **The 434 gate count** (round 1's Supersedes): the gate list holds 237 `C441-` cells, the 214
  above and 23 `C441-GAP2-` cells (`C441-GAP2-CURATION` 4, `C441-GAP2-EGRESS` 3,
  `C441-GAP2-JUDGE` 4, `C441-GAP2-TRANSCRIPT` 2, `C441-GAP2-DISPLAY` 1, `C441-GAP2-WRITE-BACK` 3,
  `C441-GAP2-TEST-SAVE` 4, `C441-GAP2-CONFIG` 2).

#### Deferred

Not fixed in round 2, by the orchestrator's scope (owner delegated), and recorded as open entries in
`.planning/phases/441-declared-secret-masking/deferred-items.md`:

- WR-G05: masked guards and page, element and selector anchors are compared with raw live state at
  replay, so a procedure or fact on a route or element holding a declared value always misses
  (fail-closed).
- WR-G07: the pre-441 skips in `knowledge purge` and the adversarial refresh reader accept any
  schema failure, not only the legacy shape.
- WR-G08: a Files-section save naming a secrets file that does not exist makes every later mask
  call throw, which locks the dashboard's config page out.
- WR-C03's rest: `mask?` is still optional on the curation queue and `artifact-copy.ts`, and
  `knowledge-local/AGENTS.md` is unchanged.
- IN-G01 to IN-G04: three key-masking walkers with three semantics; no `{{secret:` line in the
  authoring compile and repair prompts; run-door lines printed before the redactor is bound; a key
  collision in a hook-run answer reported as `masking_unavailable`.
- WR-D03's live-editor half, still open.
- From the round's own plans: the `KEY_42` marker naming; a test variable whose value is exactly a
  declared value committed as a `string` parameter; judge-calibration closed unions that are still
  masked; a masked-space `expect` on a number or boolean field whose text is a declared value.

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands, and it also closes
round 1's carried record gate. Its legs, counts and verdict are recorded in
`.planning/phases/441-declared-secret-masking/441-RECORD.md` § Gate and the SHA in § Final SHA,
rather than quoted here, so no agent-qa commit follows it.

### Gap closure round 3 (441-71 to 441-73), 2026-10-15

This subsection appends to the Phase 441 section and rewrites none of it, including the round 1
and round 2 subsections above; written by 441-73. **Scope:** GAP3-D1..D6 (owner chose D1;
orchestrator, owner delegated, D2..D6). The owner chose D1, "Fix it": VERIFICATION truth 11 (the
committed eval corpus, WR-C02) is closed with code, not an override. The orchestrator scoped D2 to
D6 from the round 2 gap review (2026-10-15) on the owner's delegation. Every commit below is in
agent-qa on `version-0.2` and signed. Every new cell is listed in
`scripts/gate/inputs/regressions.json` with its `441 GAP3-D<n>` origin, after the 1603 rows listed
at `9f9cb5355`, which are unchanged and in order. No registered cell was re-aimed, and no row was
edited.

**What each decision changed**

- **GAP3-D1, the committed eval corpus holds a declared value only as its marker (truth 11,
  WR-C02).** `agent-qa eval seed`, the gold freeze, canary feedback staging and admission, and
  adversarial admission copied the D-18 fields (`stepText`, `stateBefore`, the planned action and
  typed text) into `agent-qa-eval/` raw, and every committed digest was computed over that raw
  text. The new eval export `maskCorpusText(doc, mask, options?)`
  (`eval/src/extract/corpus-text-mask.ts`) masks the D-18 text of a handoff, cassette or label
  record with the declared secrets and keeps closed vocabulary (refs, roles, platform, element
  state flags, each action type's closed members, anchors' `role`, `ordinal` and `ref`) by type
  path; it renames no key, leaves numbers alone and never walks `rerunOrigin`. The cli masks the
  handoff before extraction, so every committed hash is over committed text. The writer
  (`seedCommittedCorpus`) and the four other entry points require the mask and throw before any
  write without one, and the writer refuses a case any committed string of which
  `maskCorpusText(doc, mask, { everyLeaf: true })` would still change. 441-71 `0bfbb55b0`,
  `3e6784e94`, `828cf90b5`, `04920117b`, `94c53c097`, `a522580aa`. Cells: `C441-GAP3-CORPUS`
  (15: eval 3, cli 3, eval-local 9).
- **GAP3-D2, a judge calibration commit decides on raw data (CR-H01).** Round 2's commit arm built
  its identity and drift comparison from the masked preview, so a short declared value such as
  `0` turned every commit into `input-drift`. `runJudgePanelCalibration` is now the masked wrapper
  over a module-private `probeJudgePanelCalibration`; the commit arm reads the raw probe and
  returns `maskJudgeCalibrationText(await publishJudgeCalibration(…), mask)`
  (`eval-local/src/judge-calibration-composition.ts`). 441-72 `41badbff4`, `b340447c5`. Cells:
  `C441-GAP3-JUDGE` (2).
- **GAP3-D3, a template is restored only when its own text holds no declared value (WR-H01).**
  With `}`, `{{` or `W}` declared, `{{secret:PW}}` was still sent verbatim, because the restore
  checked the name and the text around the token, not the token's own braces. `keepsTemplate`
  (`safety/src/egress/masking-middleware.ts`) now also requires that neither one-brace cut of the
  token (`token.slice(0, -1)`, `token.slice(1)`) changes under the mask; the name check is gone,
  because the name lies inside both cuts, and the whole-token check stays (441-72's deviation, for
  the registered `C441-GAP-EGRESS` stub cell). 441-72 `41badbff4`, `b340447c5`. Cells:
  `C441-GAP3-EGRESS` (3: safety 2, cli 1).
- **GAP3-D4, the chat header model is masked, and a re-read records no switch (WR-H03, WR-H02).**
  The session log's header `model` was written and listed raw, and the fold (masked on append) was
  compared with a raw per-turn read, so every turn after a `/model` whose name held a declared
  value recorded a spurious `config_reread` change. The header thunk and the `config(sessionId)`
  thunk in `agent-local/src/composition/compose-local-agent.ts` pass the declared mask;
  `activeModel` and `chatModelsByName` stay raw. 441-72 `469ae4916`, `9902118ad`. Cells:
  `C441-GAP3-TRANSCRIPT` (2).
- **GAP3-D5, the whole-file write path refuses a shown marker (WR-H04).** Chat and MCP
  `config.hook.add` wrote a `[secret:<name>]` name or file into the hooks file through the files
  publication, which round 2's field-level `marker_written_back` never saw. The static
  `ConfigManager.addsShownMarker(current, next)` (`dashboard-server/src/config/config-manager.ts`)
  counts each distinct marker text; `replaceDocument` checks the revision, then the marker rule,
  then writes, and the host's `publishFiles` (`cli/src/composition/local-agent-host.ts`) checks
  every planned file before writing any, answering in the fields arm's words. 441-72 `4aa3d1f04`,
  `169d65e8c`. Cells: `C441-GAP3-WRITE-BACK` (4: dashboard-server 2, cli 2).

#### Contracts and persisted values

| Contract or persisted value | Disposition | Evidence |
|---|---|---|
| `maskCorpusText` | **New export of `@vostride/agent-qa-eval`** (with the type `MaskCorpusTextOptions`). The D-18 text of a handoff, cassette or label record masked with the declared secrets, closed vocabulary kept by type path, with an `everyLeaf` mode for the writer's check. | `C441-GAP3-CORPUS` eval cells (3) |
| `BuildSeedingPlanInput.mask` | **New optional member.** A rerun's original is re-projected through the mask after its raw digest checks, so rerun retirement works in masked space. | `C441-GAP3-CORPUS a rerun whose original decision text holds a declared value still retires its masked original silver label` |
| `seedCommittedCorpus`, `freezeGoldenTrajectory`, `admitStagedFeedback`, `refreshAdversarialSplit`, `stageFeedbackEntry` | **`mask` is required** and each throws a `TypeError` before any write without one; `seedCommittedCorpus` probes its mask once before the scaffold. The cli binds it from `createDeclaredSecretMask(configPath)`, so a missing secrets file fails closed with the loader's sentence. | `C441-GAP3-CORPUS seedCommittedCorpus without a mask throws before it writes anything`; `… stageFeedbackEntry without a mask throws before it creates the staging directory` |
| `SeedingRefusal` | **Gains `{ cassetteId, kind: 'unmasked-declared-value' }`**; nothing of the case (or the label revision) is written. Adversarial admission maps it to the new staging skip reason `'unmasked-declared-value'`. | `C441-GAP3-CORPUS the corpus writer refuses …` (2); `… adversarial admission skips a staged case …` |
| `ReplaceDocumentOutcome`, `ConfigFilePublishOutcome` | **Each gains `marker_written_back`.** `replaceDocument` answers `{ kind: 'refused', error: 'marker_written_back', message: MARKER_WRITTEN_BACK_SENTENCE }`; `publishFiles` answers `{ kind: 'refused', reason: 'marker_written_back', path, written: [] }`, and chat and MCP show `<file> refused this change as it now stands: <FIELD_WRITE_REFUSAL_WORDS.marker_written_back>, so nothing was written.` A document may keep a marker its file already holds, as often. | `C441-GAP3-WRITE-BACK` (4) |
| committed corpus text (`agent-qa-eval/` cassettes, label records, corpus entries) | **A declared value and a `{{secret:<name>}}` template are committed in record form, `[secret:<name>]`**, from 441-71 on. A replay of a decision that typed a secret compares a marker gold value. | `C441-GAP3-CORPUS eval seed commits a declared value …`; `… a gold freeze from a mark …` |
| committed digests (`screenStateHash`, `promptInputHash`) | **Computed over the committed text**, never over the raw screen state. | `C441-GAP3-CORPUS every hash a seeded case commits is computed over the committed text, never over the raw screen state` |
| cases committed before 441-71 | **Not rewritten (D-20).** A pre-fix case whose text holds a raw template or declared value re-seeds as `write-conflict` (write-once, D-17), with no migration; adversarial variants staged from such a seed are refused as `unmasked-declared-value`. | `C441-GAP3-CORPUS a feedback entry staged unmasked, as a pre-fix stage holds it, is refused at admission and commits nothing raw` |
| chat session headers (`*.jsonl`) | **Written with the model id masked from 441-72 on.** Older headers are unchanged (D-20); such a session records one masked `config_reread` change on its next turn (GAP3-03, open). | `C441-GAP3-TRANSCRIPT` (2) |
| the model-egress template restore | **Needs a token text free of every declared value** (both one-brace cuts unchanged by the mask). | `C441-GAP3-EGRESS` (3) |

**441-71's other known effects.** A feedback target whose route or element name holds a declared
value is `target-unavailable`, because the staging digest comparison stays raw against masked.
`rerunProvenance.originalEvidenceDigest` (a digest of the whole raw step evidence) is still
committed in label records; T-441-163 accepts it, because no committed file reproduces that
evidence. Under a one- or two-character declared value, the writer's `everyLeaf` check refuses
cases whose configuration text (a provider or model id) contains it (GAP3-02). An adversarial
`--dry-run` preview can list a case the real admission refuses (GAP3-01).

#### T-441-82

T-441-82 (an undeclared credential committed in a seeded cassette or an admitted probe) was
accepted in 441-42 on the premise "seeds come from masked run records" (`441-SECURITY.md`'s
register rows and AR-441-22). That premise was false until 441-71: the D-18 fields a case copies
were committed raw. Corrected rationale: since 441-71 (GAP3-D1), every case's D-18 text is masked
with the declared secrets before the case is built, and the committed-corpus writer refuses a case
that is not. The threat's undeclared-credential half stays accepted under D-01 and D-15. The
declared half is mitigated by T-441-157 and T-441-159; T-441-163 (the committed
`originalEvidenceDigest`) is the one accepted residue.

#### Supersedes

- **`seeding-composition.ts`'s composition-law sentence** "Cassette text arrives masked with the
  run's declared secrets from record time, and nothing else masks it": the D-18 text is masked
  before the case is built, and the writer requires the mask and refuses an unmasked case.
- **Round 2's claim that CR-D01 held on every write path** (the round 1 GAP-D7 bullet and round
  2's `marker_written_back` row): it held on the field path, test and suite saves and
  `config set`, not on whole-file writes. Since 441-72 it is true on every write path, whole-file
  writes included.
- **441-67's claim about braces touching a template** (round 2's GAP2-D2 bullet, "the cut-brace
  probes over the whole text before and after the token find no declared value across its
  braces"): a declared value inside the token's own text was not checked; the two in-token cuts now
  are.
- **The judge commit arm's use of the masked preview** (round 2's GAP2-D6 bullet, where the
  preview and `runJudgeCalibrateVerb` return through `maskJudgeCalibrationText`): the commit arm
  decides on the raw probe and masks only what it returns.
- **The 434 gate count** (round 2's Supersedes): the gate list holds 263 `C441-` cells, the 237
  above and 26 `C441-GAP3-` cells (`C441-GAP3-CORPUS` 15, `C441-GAP3-WRITE-BACK` 4,
  `C441-GAP3-TRANSCRIPT` 2, `C441-GAP3-JUDGE` 2, `C441-GAP3-EGRESS` 3).

#### Deferred

Not fixed in round 3, by the orchestrator's scope (owner delegated), and recorded as open entries in
`.planning/phases/441-declared-secret-masking/deferred-items.md`:

- IN-H01: the test and suite target pickers still offer masked names, which can never be saved.
- IN-H02: deleting a model that is itself a judge is still refused when a remaining judge's name
  holds a declared value.
- IN-H03: `config set` prompts for a value before refusing a key that holds a marker, and "No value
  provided." still exits 0.
- The daemon's stale prose: `cli/src/commands/daemon.ts:203-212` still credits the deleted
  guardrail-shape redaction.
- The verifier's R1 (run records' data-bearing object keys), R3 (the dashboard's hook catalog,
  detail and registry error) and R9 (the live editor's start-up secrets path), each still open.
- From the round's own plans: GAP3-01 to GAP3-04 and 441-71's known effects above.

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands. Its legs, counts and
verdict are recorded in `.planning/phases/441-declared-secret-masking/441-RECORD.md` § Gate and the
SHA in § Final SHA, rather than quoted here, so no agent-qa commit follows it.

### Gap closure round 4 (441-74), 2026-10-16

This subsection appends to the Phase 441 section and rewrites none of it, including the round 1
to round 3 subsections above; written by 441-74. **Scope:** GAP4-D1 and GAP4-D2. The owner chose
to fix CR-J01 now (2026-10-16). The finding came from the gap round 3 code review (2026-10-16).
Every commit below is in agent-qa on `version-0.2` and signed. Every new cell is listed in
`scripts/gate/inputs/regressions.json` with its `441 GAP4-D1` origin, after the 1629 rows listed
at `82a043b5f`, which are unchanged and in order. No registered cell was re-aimed, and no row was
edited.

**What GAP4-D1 changed**

- **GAP4-D1, a real run under a short declared value is seeded and marked again (CR-J01).** Round
  3's corpus writer check (`maskCorpusText(doc, mask, { everyLeaf: true })`) kept closed members by
  member name, and the name list had no `policyDigest`, `contextTierDigest`, `volatileTierDigest`
  or `runDate`, which every current leaf cassette carries under
  `input.servedBrief.proof.promptTurns[]`. So it checked digest and date members as text: under a
  one- or two-character declared value, every case of a real run was refused as
  `unmasked-declared-value`, `eval seed` committed nothing, and every mark's gold freeze threw
  `FeedbackFreezeRefusedError`. Now `maskCorpusText` acts at the member `servedBrief`, in both
  modes: it masks each prompt turn's `contextTier` and `volatileTier`, recomputes a changed tier's
  digest with `sha256hex` and the brief's `briefDigest` with `computeBriefDigest` over the masked
  brief, and leaves `policyL0`, `learnedL1`, `learnedL2`, `policyDigest` and `runDate` as written.
  In `everyLeaf` mode it then keeps the brief's closed members by type path and checks every other
  string leaf. Masking was chosen over refusing because the volatile tier always ends with
  `Current date: <runDate>` (`runner/src/loop/prompts.ts` `buildVolatileTier`): refusing would keep
  every case refused whenever the declared value occurs in the run date, which for `0` is every run
  dated 20xx. No eval, eval-local or cli code reads a brief's tiers; replay rebuilds them from
  `policyL0`, `learnedL1` and `learnedL2`, which stay byte-identical. 441-74 `2eecd9817` (RED),
  `ebe876b19` (GREEN). Cells: `C441-GAP4-CORPUS` (4: eval 3, cli 1).

#### Contracts and persisted values

| Contract or persisted value | Disposition | Evidence |
|---|---|---|
| `maskCorpusText`, the served-brief rule | **Changed, no new export.** At the member `servedBrief` (a handoff step, a leaf cassette's input leg, a trajectory record), in both modes: each `proof.promptTurns[]` `contextTier` and `volatileTier` is masked; a changed tier's digest is recomputed with `sha256hex` over the masked text; `briefDigest` is recomputed with `computeBriefDigest` only when a tier changed. A brief the mask leaves alone is returned byte-identical, placeholder digests included. | `C441-GAP4-CORPUS a prompt tier holding a one-character declared value is masked, …`; `… is returned byte-identical in both modes` |
| the `everyLeaf` keep table inside a served brief | **By type path, not by name.** Kept: `scope.tier`, `briefDigest`, `channel1[].id`, `channel1[].kind`, `channel1[].status`, `channel1[].tier`, `channel2[].id`, `channel2[].bodyDigest`, `channel3[].id`, `channel3[].anchors[].t`, `channel3[].anchors[].platform`, `proof.completeness`, `proof.admissionEvents[].id`, `proof.admissionEvents[].surface`, `proof.promptTurns[].runDate`, `proof.promptTurns[].policyDigest`, `proof.promptTurns[].contextTierDigest`, `proof.promptTurns[].volatileTierDigest`. Every other string leaf of the brief is checked. **Moved from kept to checked:** `channel2[].detailLevel` (the model's tool argument) and `truncation`, which the name list kept. Inside recorded exchanges no member is exempt, as before. | `C441-GAP4-CORPUS in everyLeaf mode a served brief keeps exactly its digest, date, enum, literal and minted-id paths, …` |
| committed `briefDigest` and `receipt.memoryBriefDigest` | **Computed over the masked brief when a tier held a declared value**, so they differ from the run's raw brief digest. A comparison of a committed cassette's brief with a raw handoff brief refuses (fail closed). The known one is `resolveFailingPathCandidate` (`eval-local/src/replay-gate-composition.ts`); its only production caller, the misdirection check through `ablateCanaryStep`, extracts from the raw handoff (`source: 'handoff'`), so no production path hands it a committed cassette. | `C441-GAP4-CORPUS under a one-character declared value, eval seed seeds a run …` (each committed brief guards, and `memoryBriefDigest` equals its `briefDigest`) |
| a short declared value inside a kept digest, run date or minted id | **Stays visible there (T-441-179, accepted; GAP4-02).** One inside the run date is also readable by lining `runDate` up against the masked volatile tier. | — |
| cases committed before 441-74 | **Unchanged (D-20, no migration).** A case committed before 441-71 is as round 3 left it. From 441-71 to 441-73 a case whose tier held a declared value was refused, so none was committed; a brief whose tiers hold none is byte-identical under the new rule. | `C441-GAP4-CORPUS a brief whose digests and run date hold … is returned byte-identical in both modes` |

#### Supersedes

- **441-71's statement that the closed-member list covers the corpus's digests** (441-71's
  summary and round 3's W1 rule): it did not cover `policyDigest`, `contextTierDigest`,
  `volatileTierDigest` or `runDate`; inside a served brief the members are now kept by type path.
- **GAP3-02's sentence "nothing raw reaches them from the run"**: false for `testId`, which comes
  from `testDef['test-id'] ?? test.name` and is a kept closed member (the verifier's R13).
- **The module header's record-time sentence** in `eval/src/extract/corpus-text-mask.ts`, "every
  other recorded member already arrives masked from record time": false for `testId`, model
  identities and the brief. The header now says the writer's check refuses every other string leaf
  still holding a declared value, except the kept members.
- **The 434 gate count** (round 3's Supersedes): the gate list holds 267 `C441-` cells, the 263
  above and 4 `C441-GAP4-CORPUS` cells.

#### Deferred

Recorded in `.planning/phases/441-declared-secret-masking/deferred-items.md`:

- GAP3-02, progressed: the served brief is matched by type path; the rest of the name list is
  not, and model identities under a short value are still refused.
- R13: a declared value typed into a test's own name or `test-id` is committed raw (open, for the
  owner's review).
- GAP4-01: the served brief's knowledge text (`policyL0`, `learnedL1`, `learnedL2`, channel
  summaries and anchors, `scope.key`, `truncation`, `sourceId`, `clusterKey`, `detailLevel`) is
  checked, not masked, so a case whose served knowledge holds a declared value is still refused.
- GAP4-02: a declared value inside a kept run date, digest or minted id is visible there
  (T-441-179).

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands. Its legs, counts and
verdict are recorded in `.planning/phases/441-declared-secret-masking/441-RECORD.md` § Gate and the
SHA in § Final SHA, rather than quoted here, so no agent-qa commit follows it.

## 2026-10-16 — Phase 442: Run ownership and production refusal (V2-RUN-01, V2-RUN-04)

This section appends to the register and rewrites no earlier section. Phase 442 made two rules
true. A run row is finalized only by the process that owns it, or, once that process is provably
gone, by a starting dashboard or a cancel on that row. And every run door refuses an undeclared
production target before any effect, plugin loading included. What did more was deleted: the
runs.db v3-to-v4 upgrade arm, the dashboard's startup sweep over every `running` row and its
"server restarted" sentence, the CLI crash loop over every `running` row, the suite's first-signal
sweep and its dependency name, and the cancel arm that marked anyone's `running` row cancelled.
The section follows the 2026-10-15 Phase 441 shape. Dated 2026-10-16; written by 442-11.

### The ruling

> V2-RUN-01: a crash, an interrupt or a starting dashboard finalizes only runs it owns or whose
> owner is gone.
>
> V2-RUN-04: production is refused before any effect on every door, including
> `POST /api/queue/enqueue`.

From `.planning/REQUIREMENTS.md`. The phase's decisions are in
`.planning/phases/442-run-ownership-and-production-refusal/442-CONTEXT.md`: the owner is the pid
plus its process start time and its host (D-01, D-20); an owner is gone only on proof, a dead pid
or a live pid whose start time differs from the stamp (D-02); runs.db is cut hard to v5 with no
upgrade (D-03); an orphan is finalized `failed` with "The process running this run (pid N) ended
before it finished." (D-04); a cancel is a request to the run's owner, refused for another live
process's run (D-06 to D-09); loading a plugin counts as an effect (D-10); and a run is curated
only under its own run's config, or handed back (D-13, D-17).

### How this inventory is measured

| Instrument | What it claims | Where |
|---|---|---|
| the census | `C442-NO-RUNNING-SWEEP`: no production code in `cli/src/` or `dashboard-server/src/` lists the `running` rows to finalize them, and no SQL text updates `runs` by status without naming its id (needles from halves, comments blanked by the 432 to 438 lexer). `C442-STATUS-WRITERS-CLASSIFIED`: the 35 `runs.status` writers are pinned by file and call, each `own`, `orphan` or `own-queue`. `C442-OWNER-REQUIRED`: the v5 DDL, run through `node:sqlite`, refuses an owner-less `running` row. `C442-UNIVERSE-FLOORS`, `C442-PLANTED-POSITIVE` and `C442-SELF-MATCH`. 6 cells, in `validate:arch`. | `packages/arch/src/__tests__/442-run-ownership-census.test.ts` (442-06 `0f1e75aaa`, `858c204a9`) |
| the gate list | 104 `C442-` cells and the 79 `C432-RETURN` cells of the approval and permission census listed in `scripts/gate/inputs/regressions.json` after the 1633 rows listed at `4ee8a4df6` (unchanged and in order), each with its `442 D-NN` origin, so `gate:local` must execute and pass every one | `scripts/gate/inputs/regressions.json` (442-11 `99787e5e6`) |
| the real-process cells | two concurrent `agent-qa run` processes over one runs.db: a framework crash, SIGINT and SIGTERM of one leave the other's row, artifact and post-run work intact; a shipped dashboard scene started, or cancelling, mid-run leaves a CLI-owned run alone | `packages/cli/src/__tests__/conformance/442-run-ownership.e2e.test.ts` (442-03, 442-04, 442-05) |
| the door table | 11 doors, each refusing a declared production run before any D-11 effect (a run directory, a runs.db row, a job-store row, a build ordinal, a target or model request, a plugin marker) and running it in one call with `allowProduction: true` | `packages/cli/src/__tests__/conformance/432-direct-parity.test.ts` (442-09) |

**Both ends of the derivation, stated so it can be re-run.** Baseline `4ee8a4df6` (agent-qa
`version-0.2`, Phase 441's research SHA and 442-01's base). Closing SHA `99787e5e6` (442-11's gate
list commit, the parent of this section's commit). `git -C agent-qa diff --shortstat 4ee8a4df6
99787e5e6`: 67 files changed, 5,911 insertions, 665 deletions (under `packages/`: 64 files,
+4,801/−662). `--diff-filter=D`: no file deleted. `--diff-filter=A`: 14 files added, three
production modules (`dashboard-server/src/db/run-owner.ts`,
`cli/src/composition/run-owner-probe.ts`, `cli/src/curation/run-curation-context.ts`), one test
fixture (`cli/src/__tests__/conformance/442-run-fixture.ts`) and ten test files. 32 commits, every
one signed (`%G?` = `G`): 31 from 442-01 to 442-10 and 442-11's gate list. The removed lines below
are read from each deleting commit's diff (`git -C agent-qa show <sha>`), not transcribed from a
summary. Line numbers are at `4ee8a4df6`.

### What was deleted

#### Members removed from surviving files

| Member (file at `4ee8a4df6`) | What it did | Deleting commit | The cell that notices its return |
|---|---|---|---|
| `fromV3Sql` (the optional field on a migration entry and the v4 entry's value, `dashboard-server/src/db/schema.ts:37`, `:43`) | the additive v3-to-v4 upgrade statements (424 D-13) | `dce450bf3` (442-01) | `C442-SCHEMA-V5 a version 3 file is refused naming the file and left untouched`, `C442-SCHEMA-V5 a version 4 file is refused naming the file and left untouched` (an upgrade arm would migrate instead of refuse); `C442-CENSUS … C442-OWNER-REQUIRED` reads the version 5 entry |
| `upgradingV3` and its arm (`dashboard-server/src/db/database.ts:339-353`: the version test, the statement choice, the re-check under the immediate lock) | opened a v3 file and upgraded it in place | `dce450bf3` (442-01) | the same two `C442-SCHEMA-V5` cells, which also compare the file's sha256 and require no `-wal` file |
| the startup loop over `db.getRuns({ status: 'running' })` (`dashboard-server/src/server/server.ts:466-490`) | marked every `running` row `failed` with a duration from `startedAt`, whoever owned it | `f0ba4343b` (442-04) | `C442-CENSUS … C442-NO-RUNNING-SWEEP`; `C442-ORPHAN a starting dashboard leaves a live, unknown or own run running`; `C442-DASHBOARD-START a dashboard started while a run is in flight leaves it running` |
| the sentence `Process terminated unexpectedly (server restarted)` (`server.ts:483`, `:485`), as failure summary and artifact error | guessed a cause it could not know | `f0ba4343b` (442-04) | no needle spells it; `C442-ORPHAN a starting dashboard finalizes a gone owner's run with the plain sentence` and `C442-DASHBOARD-START a dashboard started while a run is in flight leaves it running` require the D-04 sentence in its place |
| the artifact error `finalizeRunArtifactBestEffort(run.id, 'server-restart', 'startup-cleanup', …)` (`server.ts:485`) | finalized every swept run's artifact | `f0ba4343b` (442-04) | `C442-ORPHAN a starting dashboard finalizes a gone owner's run with the plain sentence` (the error is now `owner-gone` / `orphan-cleanup`); the census's `finalizeRunArtifact` writer count in `server.ts` |
| the log line `Cleaned up ${cleaned} orphaned run(s) stuck in 'running' state` (`server.ts:489`), the comment above the loop and its dated 402-09 suite-run-skip comment | reported the sweep | `f0ba4343b` (442-04) | `C442-ORPHAN an empty runs database starts with nothing finalized and no cleanup line` (the line is now `Finalized N run(s) whose agent-qa process had ended`, printed only above zero) |
| the crash catch's loop over `_crashDb.getRuns({ status: 'running' })` and `crashRunIdsPrinted` (`cli/src/commands/run.ts:5258-5296`) | marked every `running` row in the shared runs.db `failed` or `cancelled` and printed each id | `3b88be45b` (442-03) | `C442-CENSUS … C442-NO-RUNNING-SWEEP`; `C442-OWN-RUN-ONLY a crash of one run leaves the other run's row, artifact and post-run work intact` |
| `sweepSuiteDbs` (`run.ts:1803-1817`) and `activeSuiteDbs` (the door's `Set`, the producer input field, the pattern-context field, the add and delete calls) | on the first signal, marked every `running` row of every open suite handle `cancelled` (WINDOWS #551) | `3b88be45b` (442-03) | `C442-CENSUS … C442-NO-RUNNING-SWEEP`; `C442-OWN-RUN-ONLY SIGINT to one run cancels only that run`; `C442-OWN-RUN-ONLY SIGTERM to one run cancels only that run` |
| the shutdown controller's dependency `sweepSuiteDbs` (`cli/src/commands/shutdown-controller.ts`) | the first-signal sweep's hook | `3b88be45b` (442-03), renamed `finalizeOwnRun` with the same best-effort contract | `C442-OWN-RUN-ONLY the shutdown controller finalizes this process's own run once, on the first signal`; no needle spells the old name |
| `JobQueue.cancel`'s `running` arm as it stood (`dashboard-server/src/queue/job-queue.ts:136-162`, returning `boolean`) and the route's three-line comment about it (`routes.ts`) | marked any `running` row `cancelled`, finalized its artifact and emitted `cancel-running`, whoever owned it | `50ae6946a` (442-05) | `C442-CANCEL-OWNER a dashboard cancel leaves a CLI-owned run in flight untouched`; `C442-CANCEL-OWNER another live process's run is refused and nothing is written`; `C442-CENSUS … C442-STATUS-WRITERS-CLASSIFIED` reds on an added or removed status writer in `job-queue.ts`, not on a reshaped one |
| `agent-qa queue cancel`'s two `Failed to cancel: …` branches that exited 0 (`cli/src/commands/queue.ts`) | printed a failure and reported success | `9283bff5d` (442-05) | `C442-CANCEL-SENTENCE queue cancel prints a refusal and exits non-zero` |
| the live-run page's `.catch(() => { toast.error('Failed to cancel run') })` (`dashboard-ui/src/pages/live-run.tsx`) | discarded the route's answer | `9283bff5d` (442-05) | `C442-CANCEL-SENTENCE the refusal toast shows the route's sentence` |
| the run-door inputs' plugin load before the refusal (`resolveRunInvocationInputs` passing `loadAuthPlugins: request.loadAuthPlugins ?? true`, `run.ts:1225-1240`; `resolveConfig`'s unconditional auth and provider plugin load, `cli/src/config.ts:434-440`) | ran third-party plugin code for a request the core would refuse | `92fa77f8d` (442-08) | `C442-PLUGINS-AFTER-REFUSAL a refused production run loads no plugin`, `… suite …`, `… fn request …`; the 11 `C442-DOOR-TABLE … refuses a declared production run before any effect, plugin loading included` cells |
| `agent-qa mcp`'s plugin-loading startup read (`resolveConfig({ configPath: globalOpts.config })`, `cli/src/commands/mcp.ts:226`) and its long comment | loaded every plugin at server start to read analytics and the dashboard address | `f45a56571` (442-08) | `C442-PLUGINS-AFTER-REFUSAL agent-qa mcp starts without loading a plugin` |

No file was deleted. Six test cells went with the v3-to-v4 upgrade, in `dce450bf3`:
`MIGRATION-V3-HISTORY: keeps every prior row and NULL with fresh schema and index parity`,
`MIGRATION-ROLLBACK: failure after the first real ALTER restores schema, version and data` and
`MIGRATION-RACE-IDEMPOTENT: a second opener re-reads v4 under the lock and adds nothing`
(`424-read-migration.test.ts`); `MIGRATION-ROLLBACK: failure after a real ALTER restores schema,
version, data and foreign keys`, `MIGRATION-ROLLBACK: version stamp shares the same transaction as
both recording ALTERs` and `MIGRATION-RACE-IDEMPOTENT: a second opener that read version 3 before
the first migrated adds nothing and throws nothing` (`423-read-migration.test.ts`). None was
listed in `regressions.json`. The cells re-spelled in place, titles kept except where a title
named a version that is now false, are listed in each plan's summary (442-01, 442-02, 442-03,
442-05, 442-08, 442-10).

#### Registered gate rows

The 1633 rows listed at `4ee8a4df6` are still listed, unchanged and in order. No listed row was
renamed, removed or moved to another file: the two registered `post-run-tail.test.ts` cells that
442-10's harness change touched keep their names and pass.

### What was RETAINED, and why

| Item | Where (at `99787e5e6`) | Why kept | What pins it |
|---|---|---|---|
| the queue's own-run cancel: `JobQueue.cancel`'s `pending` arm and, for a `running` row whose owner classifies `self`, today's non-CAS `updateRun` to `cancelled`, the artifact finalize and `cancel-running` | `dashboard-server/src/queue/job-queue.ts` | the dashboard still cancels the runs it owns (D-07); Phase 444 owns cancel-before-stop (CONTEXT § Deferred Ideas) | `C442-CANCEL-OWNER the dashboard still cancels its own queued and running runs`; the five `JobQueue cancel` cells, titles kept |
| `updateRunStatus`, the queue's pending-to-running flip | `dashboard-server/src/db/database.ts`, called from `job-queue.ts` | how a dashboard takes ownership of a run it executes; it now writes the owner columns in the same statement (D-01) | `C442-OWNER-STAMP the queue flip stamps the dashboard`; `C442-CENSUS … C442-STATUS-WRITERS-CLASSIFIED` (`own-queue`) |
| `updateRun` and `insertRun` with a status | the ingest, `run.ts`, `server.ts`, `job-queue.ts` | every remaining call writes a row its caller owns; a `running` write stamps the handle's owner | `C442-CENSUS … C442-STATUS-WRITERS-CLASSIFIED` (35 writers) |
| `finalizeRunArtifactBestEffort` in `server.ts` | `dashboard-server/src/server/server.ts` | its run-settled and Appium-start-failure callers survive; only the startup loop's call went | the census's `server.ts` writer entries |
| `getRuns` | `database.ts` | list reads for routes and the dashboard; no production caller filters by `running` to finalize | `C442-CENSUS … C442-NO-RUNNING-SWEEP` |
| the second-signal force-exit paths | `run.ts`, `shutdown-controller.ts` | an artifact left unfinalized after a forced exit is today's behaviour; Phase 444 owns the cancel proof (442-01 Planner decision 7) | the seven `createShutdownController — first-vs-second-signal contract …` cells, titles kept |
| `RunRow` and `mapRunRow` without owner fields | `database.ts` | owners are read only through `readRunOwner` and `listRunningRunOwners`, so no route or UI shape changed (442-01 Planner decision 1) | read from code at `99787e5e6`; not pinned by a cell |
| `DELETE /api/runs/:id` | `database.ts`, `routes.ts` | deletes any row, a live process's `running` row included; deferred (CONTEXT § Deferred Ideas) | — |
| the daemon's `curateRun` binding | `cli/src/curation/post-run-tail.ts` (`STAGE_DRAINER`: curation is `masked-leg-only`) | it declares `no-masker` and never claims `curate-memory`, so it never drains another run's row (442-10) | 442-10's summary; not pinned by a C442 cell |

### What degrades, stated plainly

- **An older runs.db must be deleted once.** A `.agent-qa/runs.db` written at version 1 to 4 is
  refused on open with `<path> was written by an older agent-qa (runs database version <n>).
  Delete it and run again; agent-qa creates a new one.` The file is left byte-identical; its run
  history is not migrated (D-03). Inside `agent-qa run`, the sentence appears within the existing
  `Could not load dashboard reporter` warning.
- **A SIGKILLed run stays `running` until a dashboard start or a cancel finds its owner gone.**
  Nothing reaps an orphan while a dashboard stays up (CONTEXT § Deferred Ideas). The same holds
  for a suite run's own row after a framework crash on the suite path: `_crashDb` is set only on
  the direct path, so that row waits for the next dashboard start (442-01 Planner decision 7;
  RESEARCH Pitfall 10).
- **win32 liveness reads `unknown`.** `resolveProcessIncarnation` returns `undefined` on win32,
  so a live pid there is never shown to be the stamped process or a reused one. Another process's
  live row is never finalized, and a cancel on it is refused; only a dead pid classifies `gone`.
  The same applies to any live pid whose start time `ps` cannot read in time.
- **An owner on another host is `unknown`** (a container or a shared folder, D-20): its row is
  left `running` by every dashboard start and every cancel on this host.
- **The dashboard cannot cancel a run another live process owns.** The route answers 409 with
  `This run belongs to another agent-qa process (pid N). Stop it there with Ctrl+C.`, and
  `agent-qa queue cancel` prints it and exits 1. Delivering a cancel to another process
  (`runs.cancel`) is deferred.
- **A run directory without `run-config.json` is never curated by another run.** Every run before
  442-10 lacks the record. The prior-run janitor warns and leaves it uncurated; the chain's
  `curate-memory` row answers retryable with the plain reason and, after `maxAttempts: 3`, ends
  failed with it (D-17).
- **A refused production request no longer reports a missing plugin.** The refusal comes first,
  so `PluginNotInstalledError` is reported only for a request that is allowed to run.

### Persisted values the narrowed contract governs

No migration and no compatibility code (D-03).

| Persisted value | Disposition | Evidence |
|---|---|---|
| `.agent-qa/runs.db` at user_version 1, 2, 3 or 4 | **Refused by path, left untouched.** The version check runs before `journal_mode = WAL`, so the header is not rewritten and no `-wal` file appears. | `C442-SCHEMA-V5 a version 4 file is refused naming the file and left untouched`; `C442-SCHEMA-V5 a version 3 file is refused naming the file and left untouched` |
| `.agent-qa/runs.db` at a version above 5 | **Refused** with the incompatible wording, the path prepended. | `C442-SCHEMA-V5 a newer file is refused naming the file` |
| a v5 `running` row | **Always carries an owner.** `CHECK (status <> 'running' OR owner_pid IS NOT NULL)` refuses an owner-less insert and a status-only flip to `running`. | `C442-SCHEMA-V5 an owner-less running row is refused by the store`; `C442-CENSUS … C442-OWNER-REQUIRED` |
| a `pending` row left by an earlier dashboard | **Owned by the dashboard that runs it**, stamped at the queue flip (D-01). | `C442-OWNER-STAMP the queue flip stamps the dashboard`; `C442-ORPHAN pending rows are untouched by the startup sweep` |
| run directories without `.agent-qa/runs/<id>/run-config.json` (every run before 442-10), or with a record that has an extra key, is a symlink or names another run | **Never curated by another run's tail** (D-17); handed back with `Run <id> has no config record (it ran before agent-qa recorded one), so no other run curates it.` | `C442-RUN-CONFIG-CURATION a run with no config record is never curated by another run's tail` |
| `run-config.json` (`{ schemaVersion: 1, runId, configPath }`, mode 0o600) | **New, written by every run's post-verdict step**; it names a path and holds no secret, and is declared in the 401-11 parity ledger. A second write of the same config is silent; a different config is refused and the file kept. | `C442-RUN-CONFIG-CURATION a run's post-verdict step records its own config`; `C442-RUN-CONFIG-CURATION writing the same record twice is success, a different one is refused` |

### The instruments that notice a return

- **`pnpm validate:arch`** runs the 442 census beside the earlier ones:
  `C442-CENSUS — no path finalizes runs it does not own (442 D-05)` with `C442-UNIVERSE-FLOORS`,
  `C442-NO-RUNNING-SWEEP`, `C442-STATUS-WRITERS-CLASSIFIED` and `C442-OWNER-REQUIRED`, and
  `C442-CENSUS instruments` with `C442-PLANTED-POSITIVE` and `C442-SELF-MATCH`. A returning sweep
  over the `running` rows, a bulk `UPDATE runs` by status, an unclassified status writer, or an
  owner-less `running` row reds by name on the commit that adds it.
- **The 434 gate** (`pnpm run gate:local`) must execute and pass all 104 listed `C442-` cells,
  each with its `442 D-NN` origin: `C442-SCHEMA-V5` 5, `C442-OWNER-STAMP` 4,
  `C442-OWNER-CLASSIFY` 12, `C442-ORPHAN` 9, `C442-OWN-RUN-ONLY` 6, `C442-DASHBOARD-START` 2,
  `C442-CENSUS` 6, `C442-CANCEL-OWNER` 4, `C442-CANCEL-ORPHAN` 3, `C442-CANCEL-SENTENCE` 4,
  `C442-ENQUEUE-REFUSAL` 6, `C442-PLUGINS-AFTER-REFUSAL` 9, `C442-DOOR-TABLE` 22, `C442-ABSENCE`
  1, `C442-RUN-CONFIG-CURATION` 11. It must also pass the 79 `C432-RETURN` cells (origin
  `442 D-12`), so a returning approval, permission, token, scope or proposal member reds the gate,
  not only `validate:arch`.
- **Not spelled by any needle:** the names `sweepSuiteDbs`, `activeSuiteDbs`, `fromV3Sql` and
  `upgradingV3`, and the "server restarted" sentence. Their behaviour returning is caught by the
  cells in the table above; the names alone returning are not.

### Not observed, stated as such

- **win32 liveness was not run.** No Windows host ran the probe; the `unknown` answer for a live
  pid there is covered only by cells with an injected probe (
  `C442-OWNER-CLASSIFY answers unknown when the start time of a live pid cannot be read`). The cells that spawn processes or send
  signals throw `POSIX run lifecycle required; never skip` on win32, so Windows signal handling
  was not observed.
- **No live model ran.** Every cell uses a stub model or none.
- **No user workspace was inspected.** The persisted-value dispositions are what the cells and
  the code show for files in the old formats.

### Reconciliation

None needed. V2-RUN-01 and V2-RUN-04 were built as written. SC3's "distinct environment-bound
secrets" was read under reconciliation 23 (2026-10-12) as distinct `secretsFile`s before planning
(442-CONTEXT D-14), so `.planning/REQUIREMENTS.md` was not edited.

### Gate at the time of writing

The record gate runs on Phase 442's final agent-qa SHA, the commit that adds this section, which
`.planning/phases/442-run-ownership-and-production-refusal/442-RECORD.md` § Final SHA names. Its
legs, counts and verdict are recorded in that file's § Gate rather than quoted here, so no
agent-qa commit follows the gate run.

### Gap closure round 1 (442-12 to 442-18), 2026-10-16

This subsection appends to the Phase 442 section and rewrites none of it; written by 442-19. It
follows `.planning/phases/442-run-ownership-and-production-refusal/442-VERIFICATION.md` (agent-qa
`a7bfd355d`, 10 of 13 truths). Its three failed truths share one root cause, CR-01: on a non-Linux
POSIX host the stamped start time was the raw `ps -p <pid> -o lstart=` text, rendered in the
reading process's time zone and locale by whichever `ps` came first on its `PATH`, and any
difference read as a reused pid. The orchestrator decided the gaps, with review WR-01 to WR-03 and
IN-02 and UI review fixes 1 and 2 and item 5, as GAP-D1 to GAP-D8 on 2026-10-16, with the owner's
delegation. Every commit below is in agent-qa on `version-0.2` and signed. Every new cell is listed
in `scripts/gate/inputs/regressions.json` with its `442 GAP-D<n>` origin, after the 1816 rows
listed at `a7bfd355d`, which are unchanged and in order. 442-23 corrected this subsection's second
What-degrades bullet (rows whose host is stamped in another format), and gap closure round 2
(below) replaced the Linux host identity, so its statements that Linux keeps `os.hostname()` now
hold for Windows only.

**How it is measured.** Baseline `a7bfd355d` (Phase 442's earlier final SHA). Closing SHA
`1fdabe92d` (442-19's gate list commit, the parent of this subsection's commit).
`git -C agent-qa diff --shortstat a7bfd355d 1fdabe92d`: 26 files changed, 1,772 insertions, 125
deletions (under `packages/`: 25 files, +1,586/−125). `--diff-filter=D`: no file deleted.
`--diff-filter=A`: three files added, one production module
(`dashboard-server/src/db/run-owner-host.ts`) and two test files
(`cli/src/__tests__/conformance/442-cross-environment-owner.e2e.test.ts`,
`dashboard-server/src/db/__tests__/run-owner-host.test.ts`). 19 commits, every one signed: two
tests-only RED commits (442-12 `6f87f5b67`, 442-13 `f82a62fe5`), the fixes and their RED cells
(442-14 to 442-18) and 442-19's gate list. The removed lines below are read from each deleting
commit's diff, not transcribed from a summary.

#### What was deleted

| Member (file at `a7bfd355d`) | What it did | Deleting commit | The cell that notices its return |
|---|---|---|---|
| the `ps-lstart:` token producer and the `PATH`-resolved spawn in `resolveProcessIncarnation` (`spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], …)` with the inherited environment, returning `` `ps-lstart:${lstart}` ``; `knowledge-local/src/lease/writer-lease.ts`) | stamped and read a start time in the caller's own time zone, locale and `ps`, so two readers of one live process could disagree (CR-01) | `85b59ca60` (442-14), replaced by `/bin/ps` under `{ LC_ALL: 'C', LANG: 'C', TZ: 'UTC0' }` emitting `ps-lstart-utc:` | `C442-INCARNATION-FORMAT C442-INCARNATION-FORMAT a ps host stamps ps-lstart-utc read by /bin/ps in UTC and the C locale, and Linux stamps proc-starttime`; `C442-CROSS-ENV C442-CROSS-ENV one live process reads as one start-time token from readers with different time zones, locales and a shadowing ps`; `C442-CROSS-ENV the composed probe reads a live run stamped under another time zone, locale or ps as alive` |
| `classifyRunOwner`'s `current === owner.incarnation ? 'alive' : 'gone'` for a token in another format, and the matching `mismatch` in `verifyMutationLockOwnerIdentity` and `verifyEmbedderWorkerIncarnation` (`dashboard-server/src/db/run-owner.ts`, `writer-lease.ts`, `embedder-worker/worker-incarnation.ts`) | read a differing start-time format as proof of reuse | `85b59ca60`, `9d89e7f03` (442-14) | `C442-INCARNATION-FORMAT a live owner stamped in another start-time format is unknown, never gone`; `C442-INCARNATION-FORMAT C442-INCARNATION-FORMAT an embedder registration stamped in another start-time format is unverifiable, and an equal-format different one is a mismatch`; `C442-CROSS-ENV C442-CROSS-ENV a mutation-lock holder stamped under another time zone, locale or ps is read as itself, never as a reused pid` |
| the whole-process memo of the CLI's own start time (`composeRunOwnership`'s first-call `resolveProcessIncarnation(process.pid) ?? null`, kept for the process even when it was `null`, with no read bound; `cli/src/composition/run-owner-probe.ts`) | a failed first read stamped every later run with no start time (WR-01) | `1ea4b05bb` (442-15), replaced by `createRunOwnership`, which keeps only a start time it read and bounds every read at `RUN_OWNER_START_TIME_TIMEOUT_MS` | `C442-OWN-START-TIME the CLI retries an unread own start time and keeps the first one it reads`; `C442-OWN-START-TIME the CLI bounds both start-time reads, and a ps that never answers reads as unknown` |
| `classifyRunOwner`'s `owner.pid === self.pid && owner.incarnation === self.incarnation` `self` arm, which matched `null` to `null` (`run-owner.ts`), and the queue cancel's `self` read through it (`queue/job-queue.ts`) | let a process on a reused pid with no start time cancel or finalize a dead process's run as its own | `875a3034e` (442-15); an own row is now the stamp the handle recorded (`isOwnStamp`, `finalizeOwnRun` on that stamp) | `C442-OWN-START-TIME a start time missing on both sides is never self, even for this pid on this host`; `C442-OWN-START-TIME a dashboard on a reused pid with no start time does not cancel a dead dashboard's run as its own` |
| the unguarded `probe.incarnationOf(owner.pid)` in `classifyRunOwner` (`run-owner.ts`) | a probe that threw rejected the dashboard start and turned a cancel into a 500 (WR-03) | `dad11c3fc` (442-16) | `C442-PROBE-THROWS a start-time read that throws answers unknown`; `C442-PROBE-THROWS a dashboard starts and leaves the run running when the start-time read throws`; `C442-PROBE-THROWS a cancel answers 409, not 500, when the start-time read throws` |
| the macOS host identity `os.hostname()` in `defaultRunOwnership()` (`run-owner.ts`, `import { hostname } from 'node:os'`) | named a run's host by a name that follows the network, so a dead owner's row could never be reaped after a rename (WR-02) | `1c57c47cd` (442-17), replaced by `resolveRunOwnerHost()`: `macos-uuid-sha256:<digest>` on macOS | `C442-HOST-IDENTITY C442-HOST-IDENTITY a macOS host is its hardware UUID digest, unchanged when the host name changes`; `C442-HOST-IDENTITY C442-HOST-IDENTITY a dead owner stamped before the host name changed is still finalized as an orphan` |
| the CLI composition's own host-name read (`host: hostname()` in the composed `self`, and its `node:os` import; `run-owner-probe.ts`) | gave the CLI a host identity of its own beside the store's | `bbcf3ecc9` (442-17); the store now completes the host (`completeRunOwnership`) | `C442-OWNER-STAMP the CLI composes its own pid, start time and host` (the composed `self` has only `pid` and `incarnation`); `C442-HOST-IDENTITY C442-HOST-IDENTITY a handle injected without a host stamps and classifies with this machine's identity` |
| the live-run page's `toast.success(result.message ?? 'Run cancelled')` for every resolved cancel and `toast.error(error.message)` for every `ApiError` (`dashboard-ui/src/pages/live-run.tsx`) | showed the orphan answer as a green success and raw server text for a 404 or 500 | `ceb146d7f` (442-18) | `C442-CANCEL-TOAST an orphan answer shows its sentence as an info toast, never success`; `C442-CANCEL-TOAST only the 409 refusal shows the route's sentence; any other error reads Failed to cancel run` |
| `agent-qa queue cancel`'s `console.log` of a refusal or a missing run, and its unencoded run id in the URL (`cli/src/commands/queue.ts`) | wrote a failure to stdout | `7f63753fc` (442-18) | `C442-QUEUE-CANCEL-OUTPUT queue cancel prints a refusal to stderr and exits 1, and an orphan answer to stdout with exit 0`; `C442-QUEUE-CANCEL-OUTPUT queue cancel encodes the run id in the URL` |

No file was deleted and no test cell was removed. The round's 31 new cells, by area:
`C442-INCARNATION-FORMAT` 6 and `C442-CROSS-ENV` 5 (`442 GAP-D1`), `C442-OWN-START-TIME` 6
(`GAP-D2`), `C442-PROBE-THROWS` 3 (`GAP-D3`), `C442-HOST-IDENTITY` 6 (`GAP-D4`),
`C442-CANCEL-TOAST` 3 (`GAP-D5`), `C442-QUEUE-CANCEL-OUTPUT` 2 (`GAP-D6`).

#### Registered gate rows

The 1816 rows listed at `a7bfd355d` are still listed, unchanged and in order; none was renamed,
removed or moved. These registered cells were re-spelled under their kept names, each named in its
plan's summary: `C442-OWNER-CLASSIFY the composed probe reads real processes` (442-14, 442-17),
`C442-DASHBOARD-START a dashboard started while a run is in flight leaves it running` and
`C442-DASHBOARD-START the run in flight still finishes as itself` (442-14, 442-17),
`C442-OWNER-CLASSIFY the default ownership never answers alive or gone for a live pid` (442-15),
`C442-OWNER-STAMP the CLI composes its own pid, start time and host` and
`C442-OWN-RUN-ONLY each run's row names its own process` (442-17), and
`C442-CANCEL-SENTENCE the refusal toast shows the route's sentence` and
`C442-CANCEL-SENTENCE an orphan answer's toast shows its sentence` (442-18). The unregistered
CR-05 daemon cell was re-spelled to the reader's own start-time format (442-14 `bd678087d`). The
401-07 and 401-08 spawn censuses name `db/run-owner-host.ts` with its reason (442-17); neither was
weakened.

#### What was RETAINED, and why

| Item | Why kept | What pins it |
|---|---|---|
| Linux `proc-starttime:<n>` from `/proc/<pid>/stat` | already one rendering for every reader | `C442-INCARNATION-FORMAT C442-INCARNATION-FORMAT a ps host stamps ps-lstart-utc read by /bin/ps in UTC and the C locale, and Linux stamps proc-starttime` |
| win32's `undefined` start time | Windows has no equivalent builtin; a live pid there stays `unknown` | `C442-OWNER-CLASSIFY answers unknown when the start time of a live pid cannot be read` |
| `os.hostname()` as the host on Linux and Windows | the 442 contract is unchanged there (D-20) | `C442-HOST-IDENTITY C442-HOST-IDENTITY Linux and Windows hosts keep os.hostname()` |
| an equal-format, different start time as proof of reuse | the one case D-02 calls proof | `C442-INCARNATION-FORMAT a live owner with an equal-format different start time is still gone`; `C442-INCARNATION-FORMAT a dead owner is gone whatever its stamp's format` |
| D-04's orphan sentence and D-07's refusal sentence, word for word | locked wording; UI review fix 3 was rejected and the Ctrl+C advice (UI item 4) stays open | `C442-CANCEL-SENTENCE the refusal toast shows the route's sentence`; `C442-CANCEL-SENTENCE an orphan answer's toast shows its sentence` |
| the WR-04 `ps` budget clamp and the `undefined` failure funnel | the escalation path's bound is unchanged; the test-only `psExecutable` seam swaps only the executable, never the environment | the WR-04 describe in `writer-lease.test.ts`, titles kept |

#### What degrades, stated plainly

- **Rows, lock rows and registrations stamped in the old format read as unknown while their
  process lives.** A `runs.db` row, a `mutation_lock` row or an embedder registration written as
  `ps-lstart:` by a pre-fix agent-qa reads `unknown` (`classifyRunOwner`) or `unverifiable` (the
  lock and the embedder) until that process ends, and `gone` once its pid is dead. A dashboard
  start leaves such a row `running`, a cancel on it is refused, and a lock contender may wait until
  its occupant exits.
- **A row whose host is stamped in another format reads `unknown` whether or not its process
  lives.** That is a bare host name written before 442-17 on macOS or before 442-21 on Linux, or a
  `hostname:<name>` written after a failed `ioreg` read. `classifyRunOwner` compares hosts before
  liveness, so a dashboard start leaves such a row `running` and a cancel on it is refused,
  until it is removed from the dashboard. This is review WR-02, deferred as the conservative
  D-02/D-20 direction (442-23).
- **A failed macOS hardware-UUID read names the host `hostname:<name>`**, which never equals a
  UUID identity, so a row written then reads as another host's; the read is retried, never
  remembered.

#### Persisted values the narrowed contract governs

No migration and no compatibility code (D-03).

| Persisted value | Disposition | Evidence |
|---|---|---|
| `runs.owner_incarnation` | **New rows on a ps host carry `ps-lstart-utc:<C-locale UTC lstart>`**; Linux keeps `proc-starttime:<n>`. A stored `ps-lstart:` value is not rewritten and reads `unknown` while its pid lives. | `C442-CROSS-ENV a dashboard started under another time zone and locale leaves a live run running and byte-equal`; `C442-INCARNATION-FORMAT a live owner stamped in another start-time format is unknown, never gone` |
| `runs.owner_host` | **On macOS, `macos-uuid-sha256:<sha256 of the upper-cased IOPlatformUUID>`**, or `hostname:<name>` after a failed read; the raw UUID is never stored. Linux and Windows keep `os.hostname()`. Stored values are not rewritten. | `C442-HOST-IDENTITY C442-HOST-IDENTITY a macOS host is its hardware UUID digest, unchanged when the host name changes`; `C442-HOST-IDENTITY C442-HOST-IDENTITY a macOS read failure names the host name under its own prefix, never equals a UUID identity, and is retried` |
| `mutation_lock.incarnation` (the writer-authority store) | **Written in the canonical format**; a row in another format is `unverifiable`: never reclaimed by a held store, and its live owner never signalled. | `C442-INCARNATION-FORMAT C442-INCARNATION-FORMAT a mutation-lock row stamped in another start-time format is never reclaimed and its live owner never signalled` |
| the embedder worker registration's `incarnation` | **Written in the canonical format**; a registration in another format is `unverifiable`, so no signal reaches its pid. | `C442-INCARNATION-FORMAT C442-INCARNATION-FORMAT an embedder registration stamped in another start-time format is unverifiable, and an equal-format different one is a mismatch` |

#### The instruments that notice a return

- **The 434 gate** must execute and pass the 31 cells above, each with its `442 GAP-D<n>` origin,
  as well as the 1816 earlier rows, the 104 round-1 `C442-` cells and the `C432-RETURN` census
  among them.
- **`pnpm validate:arch`** still runs `C442-CENSUS`; no status writer was added this round.

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands. Its legs, counts and
verdict are recorded in `.planning/phases/442-run-ownership-and-production-refusal/442-RECORD.md`
§ Gate and the SHA in § Final SHA, rather than quoted here, so no agent-qa commit follows it.

### Gap closure round 2 (442-20 to 442-22), 2026-10-16

This subsection appends to the Phase 442 section; written by 442-23, which also corrected one
bullet of gap closure round 1 above and changed no other earlier line. It follows
`.planning/phases/442-run-ownership-and-production-refusal/442-VERIFICATION.md` (agent-qa
`3ffc2838a`, 17 of 18 truths). Its failed truth 18 is review WR-03: on Linux the run owner's host
was `os.hostname()` alone, so a process in another pid namespace that shares the host name (a
container on `--network host`, `--uts=host` or Kubernetes `hostNetwork`, writing to a bind-mounted
`runs.db`) passed `classifyRunOwner`'s host compare, and its namespace-local pid, dead here or
another process here, classified `gone`. The orchestrator decided the gap, with review WR-01 and
the verification's WR-01 and WR-02 advisories, as GAP-D9 to GAP-D13 on 2026-10-16, with the
owner's delegation. Every commit below is in agent-qa on `version-0.2` and signed. Every new cell
is listed in `scripts/gate/inputs/regressions.json` with its `442 GAP-D<n>` origin, after the 1847
rows listed at `3ffc2838a`, which are unchanged and in order except two rows renamed in place
(Registered gate rows, below).

**How it is measured.** Baseline `3ffc2838a` (Phase 442's gap round 1 final SHA). Closing SHA
`f9f86a815` (442-23's gate list commit, the parent of this subsection's commit).
`git -C agent-qa diff --shortstat 3ffc2838a f9f86a815`: 6 files changed, 472 insertions, 25
deletions (under `packages/`: 5 files, +398/−23). `--diff-filter=D`: no file deleted.
`--diff-filter=A`: no file added. 5 commits, every one signed: two tests-only RED commits (442-20
`7eff4ce97`, 442-22 `e0d3061fb`), the two fixes (442-21 `1b392d841`, 442-22 `8d21002a3`) and
442-23's gate list (`f9f86a815`). The removed lines below are read from each deleting commit's
diff, not transcribed from a summary.

#### What was deleted

| Member (file at `3ffc2838a`) | What it did | Deleting commit | The cell that notices its return |
|---|---|---|---|
| the Linux host identity `os.hostname()`, which the non-darwin return (`if (platform !== 'darwin') return hostname()`) served for `linux` in `createRunOwnerHostResolver` (`dashboard-server/src/db/run-owner-host.ts`) | named a Linux run's host by a name a container in another pid namespace can share, so that container's namespace-local pid was probed here and its live run classified `gone`, finalized by the startup sweep and the cancel route (WR-03, truth 18) | `1b392d841` (442-21), replaced on `linux` by GR2-2's `linux-pidns:<inode>:<hostname>` (the inode read from the `/proc/self/ns/pid` link, accepted only as `pid:[<digits>]`, memoised on success), or that resolver's own `linux-pidns-unread:<random UUID>` after a failed read, retried on every call; the non-darwin return still serves win32 and every other platform | the ten `C442-PID-NAMESPACE` cells listed below |
| the cancel arm's undecoded run-id slice (`const runId = path.slice('/api/runs/'.length, path.length - '/cancel'.length)`; `dashboard-server/src/server/routes.ts`) | handed the percent-encoded id to `jobQueue.cancel`, so an id that needs encoding got 404, and a request for an encoded id could cancel a row whose literal id is the encoded text (WR-01) | `8d21002a3` (442-22), replaced by `decodeURIComponent` of the same slice in a try whose catch answers `400 { error: 'invalid_run_id' }` before the queue is asked | `C442-CANCEL-RUN-ID a cancel on a run whose id needs encoding reaches that run`; `C442-CANCEL-RUN-ID a malformed run id is answered 400 and writes nothing` |

No file was deleted and no test cell was removed. The round's 12 new cells, by area:
`C442-PID-NAMESPACE` 10 (`442 GAP-D9`) and `C442-CANCEL-RUN-ID` 2 (`442 GAP-D10`). The ten
`C442-PID-NAMESPACE` cells:
- `C442-PID-NAMESPACE a Linux identity names this pid namespace and this host name, read once`
- `C442-PID-NAMESPACE two pid namespaces never share an identity, even under one host name`
- `C442-PID-NAMESPACE two processes in one pid namespace on one machine share an identity`
- `C442-PID-NAMESPACE an unreadable or malformed pid namespace falls back under its own prefix, never equals a namespace identity, and is retried`
- `C442-PID-NAMESPACE two processes whose pid namespace cannot be read never share an identity`
- `C442-PID-NAMESPACE a row stamped with the bare host name an earlier agent-qa wrote is another host to a Linux reader`
- `C442-PID-NAMESPACE an owner in another pid namespace under this host name is unknown, whether its pid is dead here or another process's`
- `C442-PID-NAMESPACE an owner in this pid namespace whose pid is dead is still gone`
  (`dashboard-server/src/db/__tests__/run-owner-host.test.ts`, the eight above)
- `C442-PID-NAMESPACE a dashboard started beside a container that shares its host name leaves the container's runs running and byte-equal`
  (`dashboard-server/src/__tests__/442-orphan-startup.test.ts`)
- `C442-PID-NAMESPACE a cancel on a run owned from another pid namespace under this host name is refused with 409 and writes nothing`
  (`dashboard-server/src/__tests__/442-cancel-ownership.test.ts`)

#### Registered gate rows

The 1847 rows listed at `3ffc2838a` are still listed and in order; none was removed or moved. Two
were renamed in place (GR2-5), keeping their file, area and origin `442 GAP-D4`, because their old
titles asserted the pre-round-2 Linux identity:
- index 1838: `C442-HOST-IDENTITY C442-HOST-IDENTITY Linux and Windows hosts keep os.hostname()`
  became `C442-HOST-IDENTITY C442-HOST-IDENTITY Windows hosts keep os.hostname(), and Linux hosts name their pid namespace`;
- index 1839: `C442-HOST-IDENTITY C442-HOST-IDENTITY this machine's identity is its UUID digest on macOS and its host name elsewhere`
  became `C442-HOST-IDENTITY C442-HOST-IDENTITY this machine's identity is its UUID digest on macOS, its pid namespace and host name on Linux, and its host name elsewhere`.

One registered cell was re-spelled under its kept name, as 442-21's summary records:
`C442-HOST-IDENTITY C442-HOST-IDENTITY a dead owner stamped before the host name changed is still finalized as an orphan`
now builds its host-name-identity control's resolvers with `platform: 'win32'` instead of
`'linux'`. Every other row is unchanged.

#### What was RETAINED, and why

| Item | Why kept | What pins it |
|---|---|---|
| the darwin identity `macos-uuid-sha256:<digest>` and its `hostname:<name>` fallback | byte-identical to 442-17; the hardware UUID already separates macOS hosts | `C442-HOST-IDENTITY C442-HOST-IDENTITY a macOS host is its hardware UUID digest, unchanged when the host name changes`; `C442-HOST-IDENTITY C442-HOST-IDENTITY a macOS read failure names the host name under its own prefix, never equals a UUID identity, and is retried` |
| `os.hostname()` on win32 and every other platform that is neither darwin nor Linux | no pid-namespace read there; D-20 is unchanged for them | `C442-HOST-IDENTITY C442-HOST-IDENTITY Windows hosts keep os.hostname(), and Linux hosts name their pid namespace` |
| `classifyRunOwner` and its host-before-liveness order | another host is `unknown`, the conservative direction (D-02); only the Linux host string changed | `C442-PID-NAMESPACE an owner in another pid namespace under this host name is unknown, whether its pid is dead here or another process's`; `C442-PID-NAMESPACE an owner in this pid namespace whose pid is dead is still gone` |
| the cancel arm's outcomes: 503 `Queue not available`, `200 { cancelled: true }`, `200 { cancelled: false, message }`, D-07's 409 and the 404 | only how the id is read changed | `C442-CANCEL-OWNER another live process's run is refused and nothing is written`; `C442-CANCEL-ORPHAN a cancel on a run whose process is gone finalizes it as an orphan` |
| D-04's orphan sentence and D-07's refusal sentence, word for word | locked wording; the Ctrl+C advice (UI item 4) and the refusal's other-host wording stay open | `C442-CANCEL-SENTENCE the refusal toast shows the route's sentence`; `C442-CANCEL-SENTENCE an orphan answer's toast shows its sentence` |
| the two clients, `agent-qa queue cancel` and the dashboard UI's API client (`dashboard-ui/src/lib/api.ts`), which already encode the id | their diff against `3ffc2838a` is empty | `C442-QUEUE-CANCEL-OUTPUT queue cancel encodes the run id in the URL` |

#### What degrades, stated plainly

- **A Linux row stamped before 442-21 with a bare host name reads `unknown` and stays `running`
  until it is removed.** Its host no longer equals any Linux reader's, and hosts are compared
  before liveness, so a dashboard start leaves it and a cancel on it is refused (review WR-02,
  deferred by GAP-D12). `C442-PID-NAMESPACE a row stamped with the bare host name an earlier agent-qa wrote is another host to a Linux reader`
  pins it.
- **A process whose pid namespace cannot be read stamps `linux-pidns-unread:<random UUID>`**,
  which no other process shares, so its rows are `unknown` to every other reader and stay
  `running` until removed. Its own handle still finalizes them through the stamp it recorded
  (442-15).
- **Known limitations.** Windows keeps `os.hostname()`, so a Windows container carrying the host's
  name is not told apart. A `--pid=host` container with its own host name reads as another host
  (`unknown`, conservative). Two Linux machines with one host name, both in their initial pid
  namespace, sharing one `runs.db` are still equated (the pre-existing D-20 limitation). No real
  Linux container was run: there is no Linux host or Docker daemon here, so the cells model both
  sides through the identity module's seams, and the Linux branch's default reader runs only on
  Linux.

#### Persisted values the narrowed contract governs

No migration and no compatibility code (D-03).

| Persisted value | Disposition | Evidence |
|---|---|---|
| `runs.owner_host` | **On Linux, `linux-pidns:<inode>:<host name>`**, or `linux-pidns-unread:<random UUID>` after a failed namespace read; only the namespace inode and the host name are stored, and no machine identifier file is read. macOS and Windows values are unchanged. Stored values are not rewritten. | `C442-PID-NAMESPACE a Linux identity names this pid namespace and this host name, read once`; `C442-PID-NAMESPACE an unreadable or malformed pid namespace falls back under its own prefix, never equals a namespace identity, and is retried` |

#### The instruments that notice a return

- **The 434 gate** must execute and pass the 12 cells above, each with its `442 GAP-D<n>` origin,
  as well as the 1847 earlier rows, the two renamed rows under their new names.
- **`pnpm validate:arch`** still runs `C442-CENSUS`; no status writer was added this round.

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands. Its legs, counts and
verdict are recorded in `.planning/phases/442-run-ownership-and-production-refusal/442-RECORD.md`
§ Gate and the SHA in § Final SHA, rather than quoted here, so no agent-qa commit follows it.

## 2026-10-17 — Phase 443: One run through every door (V2-RUN-02)

This section appends to the register and rewrites no earlier section. Phase 443 made one rule
true: every run writes its row to the project's runs.db through one record builder, whichever door
starts it, stamped with the process that runs it, so every id a door hands out resolves in
`agent-qa runs overview`, MCP `agent_qa_get_run_overview` and the dashboard. The phase owner's
rule for it was a hard removal with no backward compatibility (D-01): "pls don't do any backward
compatiblity etc, do a hard removal of things as there are no users". What the one record made
obsolete was deleted outright: the `dashboard` reporter name, the `services.dashboard` gate on
writing a row, both warn-and-continue paths, the ingest's environment correlation and its id-less
insert, the bridge's subscriber member, the daemon's no-record rule, the dead log storage, the
five arms that took over a handed row, and the suite-queue and parent-run environment variables.
The section follows the 2026-10-16 Phase 442 shape. Dated 2026-10-17; written by 443-11.

### The ruling

> V2-RUN-02: A run started through any existing door reaches the same durable run store and
> dashboard ingestion through the shared run bridge, with no new execution path.

From `.planning/REQUIREMENTS.md`. The phase's decisions are in
`.planning/phases/443-one-run-through-every-door/443-CONTEXT.md`: one record builder on every
door, no replay (D-02, D-22); a row for every run, whatever the config holds (D-03); a run that
cannot be recorded does not start (D-05); the process that executes a run stamps its row (D-06);
a `running` write never takes over another live process's row (D-07, review IN-04); a run naming
another config writes that config's runs.db (D-08); verify runs are marked (D-09); each row records
its door in `agent-qa.trigger` (D-10); the suite-queue variable is removed and WINDOWS #557 is
unsupported (D-11, D-25); the ingest takes the run's own id (D-12).

### How this inventory is measured

| Instrument | What it claims | Where |
|---|---|---|
| the census | `C443-ONE-RECORD`: the CLI constructs the ingest only inside `createRunRecord`; five drive calls, each passing a record from that builder, and the scan saw every door; no door gains an execution path; every runs.db handle the CLI opens names its owner; the dashboard bridge has no subscriber member; a planted-positive and a self-match cell. `C443-ENV-RETIRED no production source or script names a retired run-id input` (the two variables, the ingest's old correlation type, field, suite spelling and reader). 8 cells, in `validate:arch`. | `packages/arch/src/__tests__/443-one-record-census.test.ts` (443-10 `cd6770b5b`) |
| the type cells | `src/composition/__tests__/443-run-record-option.test-d.ts C443-ONE-RECORD the drive's runRecord option is required and never undefined` and `… the CLI host's run bridge has no subscriber member` | `packages/cli/src/composition/__tests__/443-run-record-option.test-d.ts` (443-10 `cd6770b5b`) |
| the 442 census | `C442-STATUS-WRITERS-CLASSIFIED` lists every `runs.status` writer; `WRITER_FLOOR` went 35 to 26 across the phase (443-04 −2, 443-05 +1, 443-08 −8) | `packages/arch/src/__tests__/442-run-ownership-census.test.ts` |
| the door matrix | ten doors (the eight V2-RUN-02 doors, the standalone MCP server as stdio and HTTP, the dashboard Run control as control row), one project, one runs.db, real headless Chromium: each run has an owner-stamped row and its trigger, the three readers agree on member, verdict and decision screenshots, and the run-detail page never shows "Run not found" (43 cells) | `packages/cli/src/__tests__/conformance/443-door-matrix.test.ts` (443-01 `d0df05373`, instrument corrected in 443-10 `c23df3c18`) |
| the gate list | 120 `C443-` cells listed in `scripts/gate/inputs/regressions.json` after the 1859 rows listed at `3e4f9fcc9` (unchanged and in order), each with its `443 D-NN` origin, so `gate:local` must execute and pass every one | `scripts/gate/inputs/regressions.json` (443-11 `77a273980`) |

**Both ends of the derivation, stated so it can be re-run.** Baseline `3e4f9fcc9` (agent-qa
`version-0.2`, Phase 442's final SHA and 443-01's base). Closing SHA `77a273980` (443-11's gate list
commit, the parent of this section's commit). `git -C agent-qa diff --shortstat 3e4f9fcc9
77a273980`: 70 files changed, 5,588 insertions, 896 deletions (under `packages/`: 67 files,
+4,867/−893). `--diff-filter=D`: no file deleted. `--diff-filter=A`: 11 files added, every one a
test file (`443-one-record-census.test.ts`, `443-cli-record.test.ts`, `443-debug-stdout.test.ts`,
`443-door-matrix.test.ts`, `443-door-trigger.test.ts`, `443-record-refusal.test.ts`,
`443-run-record-option.test-d.ts`, `443-run-record.test.ts`, `443-verify-run-record.e2e.test.ts`,
`443-claim.test.ts`, `443-fresh-open.test.ts`); no production module was added, because the
builder lives in `cli/src/commands/run.ts`, the CLI's only file the surface-firewall ledger lets
name the dashboard package. 23 commits, every one signed (`%G?` = `G`): 22 from 443-01 to 443-11's
orchestrator-directed fix, and 443-11's gate list. The removed lines below are read from each
deleting commit's diff (`git -C agent-qa show <sha>`) and the plan summaries, not transcribed from
memory. Line numbers are at `3e4f9fcc9`.

### What was deleted

#### Members removed from surviving files

| Member (file at `3e4f9fcc9`) | What it did | Deleting commit | The cell that notices its return |
|---|---|---|---|
| `'dashboard'` in `SUPPORTED_REPORTERS` (`cli/src/commands/run.ts:665`) | let `--reporter dashboard` select the runs.db ingest | `0917b5bae` (443-09) | `C443-REPORTER --reporter dashboard is an unknown reporter` (the existing "Unknown reporter" refusal, exit 2, no run directory, no row) |
| `ReporterSelection.dashboard` (`run.ts:672`), `AgentQaUpdateNoticeReporterSelection.dashboard` (`cli/src/version-notice.ts:10`), and the producers' `reporterSelection` inputs with their pass-throughs (`PatternMemberProductionContext`, `SuiteRunMemberProductionInput`, `DirectRunMemberProductionInput`; the default `{ …, dashboard: false }` at `run.ts:3819`) | carried the selection into the producers, where only the capture decision read it | `0917b5bae` (443-09) | `C443-REPORTER screenshot capture follows only its own flags` |
| the `services.dashboard` row gate: `resolveReporterSelection`'s and `requireReporterSelection`'s `dashboardConfigured` argument (`run.ts:773`, `:786`, `:1152-1156`, the callers at `:1867` and `:4791`) and the `dashboardEnabled` checks that decided whether a runs.db handle opened (`run.ts:2462-2467`, `:3839`, `:4835-4840`) | wrote a row only when the config held a dashboard block | `84ad1f6f6` (443-08, direct), `b05533644` (443-08, suite), `0917b5bae` (443-09, the argument and the dead `dashboardEnabled`) | `C443-CLI-ROW a single-test run with no dashboard block writes its row under the printed id`; `C443-CLI-ROW a suite run with no dashboard block writes one row under the printed id` |
| `requiredDashboard` (`run.ts:774`, `:786`, `:807`) | forced the dashboard selection on whenever `AGENT_QA_RUN_ID` or the suite-queue variable was set | `0917b5bae` (443-09) | the field it forced is gone (`C443-REPORTER --reporter dashboard is an unknown reporter`); the variable's name is a needle of `C443-ENV-RETIRED no production source or script names a retired run-id input` |
| both `Warning: Could not load dashboard reporter: …` paths (`run.ts:2477`, suite; `:4851`, direct) | warned and ran on without a record when runs.db could not be opened | `84ad1f6f6` (443-08, direct), `b05533644` (443-08, suite) | `C443-RECORD-REFUSAL agent-qa run refuses a run whose runs.db cannot be opened, exit 2, no id`; `C443-RECORD-REFUSAL a suite run whose runs.db cannot be opened is refused before its plugins load`; for the runs.start doors, the `C443-RECORD-REFUSAL` version-4, unwritable and corrupt cells |
| the direct path's eager `DashboardDatabase` open before the refusal (`run.ts:4834-4849`: the handle, `logStorage`, `dashboardEnabled` and the "Product preflight above is intentionally before dashboard creation" comment) | opened runs.db before the production refusal and before the drive | `84ad1f6f6` (443-08) | `C443-RECORD-REFUSAL a refused production agent-qa run creates no runs.db file` |
| `buildDashboardIngestSubscriber`, its `DashboardIngestAttach` interface and its comment (`run.ts:836-878`), with the direct path's `singleDashboardIngest` (`:5083`, `:5139-5141`) and the suite's run-level ingest (`runLevelDashboardDb`, `suiteDashboardIngest`, `ownSuiteRow`; `:1882-1895`) | the CLI's second ingest builder, and its catch that warned and continued | `84ad1f6f6` (443-08, direct caller), `b05533644` (443-08, the builder and the suite caller) | `C443-ONE-RECORD the CLI constructs the ingest only inside createRunRecord` |
| `createSuiteDashboardResources` (the per-suite open, `run.ts:2466-2480`), `closeSuiteDashboardDb` (`:2482-2485`) and its teardown call, `PreparedSuite.dashboardDb` (`:2534`), `subscriberSeed.dashboardDb`, and `createSuiteRunId` (`:982-984`) | opened one handle per suite and minted a suite id from the environment | `b05533644` (443-08) | `C443-CLI-ROW a suite run with no dashboard block writes one row under the printed id`; `C443-ONE-RECORD every runs.db handle the CLI opens names its owner` |
| `readDashboardCorrelationEnv` and its comment (`run.ts:816-825`), `buildDashboardIngestSubscriber`'s `runCorrelation` input and its environment-first precedence | read the run's dashboard id from the environment | `1aaf0fce9` (443-04) | `C443-ENV-RETIRED no production source or script names a retired run-id input` (the reader's name is a needle) |
| `DashboardRunIngestCorrelationEnv` (`dashboard-server/src/reporter/dashboard-subscriber.ts:84-97`) and its export (`reporter/index.ts:6`, so the package barrel), `DashboardRunIngestDeps.correlationEnv` (`:107`) and its read (`:195`), and the `suiteQueueId` second spelling of the run id (`:96`, `:237`) | let the ingest file a row under an id other than the one it was built with | `1aaf0fce9` (443-04) | `C443-INGEST-ID every row the ingest writes is filed under the id it was built with`; `C443-INGEST-ID an ingest built for a suite files the suite run under the same id`; the needles of `C443-ENV-RETIRED no production source or script names a retired run-id input` |
| the ingest's id-less `insertRun` that minted a row id of its own (`dashboard-subscriber.ts:269-280`) | wrote a row whose id no door had handed out (F-433-20) | `1aaf0fce9` (443-04) | `C443-INGEST-ID every row the ingest writes is filed under the id it was built with` (it also holds the type claim that a construction without `runId` does not compile) |
| the ingest's adopt arm that rewrote any existing row as `running` through `updateRun`, and its explicit-id `insertRun` arm (`dashboard-subscriber.ts:234-266`) | took over a row another live process owned (review IN-04) | `30e2dea0d` (443-04), replaced by one `claimRunningRow` | `C443-CLAIM an ingest for an id another live process owns writes nothing under it`; `C443-CLAIM a running row another process owns is refused and left as it was` |
| `updateRun`'s `running` write and its owner stamp (`dashboard-server/src/db/database.ts:513`) | let any caller flip a row to `running` and stamp it | `30e2dea0d` (443-04), now a throw | `C442-OWNER-STAMP the queue flip stamps the dashboard` (asserts the `updateRun` form throws); `C442-CENSUS … C442-STATUS-WRITERS-CLASSIFIED` |
| the dashboard bridge's `subscribers` member and its no-row path (`cli/src/commands/dashboard.ts:607-624`, `if (entry === undefined) return undefined`), the queue entry's own `createDashboardRunIngest` construction (`:670-676`) and `DashboardRunEntry.ingest` (`:490`), and the bridge's `cliRunSubscribers` deferred import and ingest destructure (`:574`, `:580`) | recorded only the dashboard's own queued runs; `POST /run` and the co-hosted MCP endpoint wrote no row | `8dd69102f` (443-05) | `C443-ONE-RECORD the dashboard bridge has no subscriber member of its own`; `C443-RUN-RECORD a POST /run run gets a row through the dashboard's own handle`; `C443-RUN-RECORD a queued dashboard run keeps its one row and its routes' attributes`; `C443-ONE-RECORD the CLI constructs the ingest only inside createRunRecord` |
| `runBridge.subscribers` and its pass-through to the drive (`cli/src/composition/local-agent-host.ts:363-365`, `:574-575`), the header sentence that a host asking for no subscribers keeps no record (`:282`), and the `subscribers` option doc's "Absent ⇒ none … the typed bus event log is the run's record" (`in-process-run-execution.ts:233-236`) | let a host decide whether its runs had a record | `8dd69102f` (443-05) | `src/composition/__tests__/443-run-record-option.test-d.ts C443-ONE-RECORD the CLI host's run bridge has no subscriber member`; `C443-RUN-RECORD a runs.start through the shared host writes one row under the returned id, stamped with this process` |
| the daemon's "no subscribers" rule, the comment `NO \`subscribers\` either — D-04. The typed bus event log is the run's record; …` (`cli/src/daemon/host.ts:727-728`) | kept the daemon's runs out of runs.db | `368cc9a2d` (443-06) | `C443-DAEMON-RECORD a run the daemon dispatches writes its row, stamped with the daemon, trigger cli`; `C443-ONE-RECORD every drive call passes a record from the one builder, and the scan saw every door` |
| the shared host's fixed `doorRunAttributes('cli')` | labelled every runs.start row `cli` | `4d2216079` (443-06), now the resolved door | the six `C443-DOOR-TRIGGER` cells; the ten `C443-DOOR-MATRIX <row>: the row records its door in agent-qa.trigger` cells |
| the `logStorage` plumbing (D-21): `createSuiteDashboardResources().logStorage` (`run.ts:2466`, `:2475`, `:2553`), the suite `LogManager`'s `storage: logStorage` (`:2930`), `DirectRunMemberProductionInput.logStorage` (`:3662`), its local (`:3822`), the direct `LogManager`'s `storage:` (`:3875`), and the direct door's pass (`:4834`, `:4848`, `:5046`) | handed runs.db to a log storage whose `flush()` has no production caller and whose `insertLogs` the store never had | `84ad1f6f6` (443-08, the direct door's source), `b05533644` (443-08, the suite source), `0917b5bae` (443-09, the input and the direct storage) | not pinned by a cell; `git -C agent-qa grep -n logStorage -- packages/cli/src` prints nothing at this section's commit |
| the five "row handed to this process" arms (D-26): the direct parse-error arm that adopted the `AGENT_QA_RUN_ID` row (`updateRun(existingRunId, …)` and `artifactRunId`) and the four suite-preparation arms that adopted an `AGENT_QA_RUN_ID` or suite-queue row (`run.ts:2571-2585`, `:2621`, `:2656`, `:2702`) | the last paths where an environment-named row was taken over | `84ad1f6f6` (443-08, direct), `b05533644` (443-08, the four suite arms; now one `insertRun` under the run's own id through `recordPreparationFailure`) | `C443-HANDED-ROW a parse error writes one failed row under the printed id`; `C443-HANDED-ROW a suite preparation failure writes one failed row under the printed id`; `C443-HANDED-ROW an AGENT_QA_RUN_ID naming another process's row is refused and the row is untouched`; `C442-CENSUS … C442-STATUS-WRITERS-CLASSIFIED` (the ten census rows went) |
| `_crashDb` and `_ownRunRowId` (`run.ts:4661`, `:5279-5319`) | the direct path's crash-catch handle | `84ad1f6f6` (443-08), replaced by `_crashRecord` (the record's handle and its own row id) | the five `C442-OWN-RUN-ONLY` cells |
| `runRecord?` as an optional drive option | let a drive call run with no record | `b05533644` (443-08) | `src/composition/__tests__/443-run-record-option.test-d.ts C443-ONE-RECORD the drive's runRecord option is required and never undefined` |
| the two run-id environment variables (D-11, D-25): the suite-queue variable's reads (`run.ts:774`, `:823`, `:983`, `:1267`, `:2573`, `:2621`, `:2656`, `:2702`, `:3088`, among them `preparedSuiteRunId`) and the parent-run variable's read (`:1268`) in the inherited-attributes check; their cleanup lines (`scripts/401-11-capture-parity.mjs:262-263`, `cli/src/__tests__/run.test.ts`); their names in history comments (`dashboard-subscriber.ts:88-94`, `:292`; `dashboard-server/src/server/server.ts:427`) | named a run id or a parent run from the environment; nothing in agent-qa or any other caller has set either since the dashboard stopped spawning child runs (402, 433) | `1aaf0fce9` (443-04, the ingest's read), `b05533644` (443-08, the handed-row arms and `createSuiteRunId`), `0917b5bae` (443-09, `requiredDashboard`), `347c11aec` (443-09, the rest) | `C443-ENV-RETIRED no production source or script names a retired run-id input`; `C443-ENV-RETIRED inherits run attributes only under AGENT_QA_RUN_ID` |
| "suite queue" in the run-command rule (`cli/AGENTS.md:41`, D-28) | asked run changes to keep the variable's behaviour | `347c11aec` (443-09), in the same commit as the variable | read from the file; not pinned by a cell |
| the `reporterSelection.dashboard ||` term of both `captureScreenshots` lines (`run.ts:2996`, suite; `:3868`, direct; D-20) and the "363-09/363-11 … dashboard ingest …" comment above the direct one | turned on the after-step `Buffer` that nothing outside tests reads | `0917b5bae` (443-09) | `C443-REPORTER screenshot capture follows only its own flags` |
| the runs-database sentence `… which holds only runs recorded with the dashboard reporter or by agent-qa dashboard` and its doc line (`agent/src/functions/ops/runs-get.ts:39`) | told a reader that most doors' runs were never recorded | `0917b5bae` (443-09); `IN_RUNS_DATABASE` is `' in the runs database'` | the two not-found assertions in `cli/src/__tests__/431-knowledge-run-reads.test.ts` (not listed in the gate) |
| the producers' direct prints on every door: `produceSuiteRunMembers`' four preparation-failure arms' `printRunId(runId)` / `printRunAttributes(…)`, `suiteTeardown`'s `printRunAttributes(prepared.suiteAttributes)`, `produceDirectRunMembers`' two `printRunAttributes(testAttributes)` calls | wrote `Run ID:` and `Run attributes:` lines into the MCP stdio server's JSON-RPC stream and ahead of `fn --json`'s document | `5f72b4509` (443-10), now through `RunTerminal`, which only `agent-qa run` passes | `C443-DOOR-MATRIX the stdio MCP door's stdout stays JSON-RPC through its run`; `C443-SUITE-PREP-STDOUT a suite preparation failure through fn --json leaves stdout one JSON document and files its row` |
| `produceDirectRunMembers`' two debug-level `console.log` lines, `  Platform: …` and `  Model: …` | printed on a protocol door's stdout when the project's config set `services.logging.level: debug` | `610b14d50` (443-11, orchestrator-directed; RED `ceadf152a`), now `RunTerminal.printDebugLine` | `C443-DEBUG-STDOUT fn --json on a project at debug log level leaves stdout one JSON document through its run` |

No file was deleted. Test cells deleted with their subject, none listed in `regressions.json`:
`createDashboardRunIngest correlation env — a suiteQueueId is just another spelling of runId`
(`dashboard-subscriber.test.ts`, `1aaf0fce9`, D-12); `run command — DashboardReporter wiring does
not create DashboardReporter when services.dashboard is absent` and `run command — DashboardReporter
wiring warns but continues when dashboard-server import fails` (`run.test.ts`, `84ad1f6f6`, D-03 and
D-05); `run command — reporter integration wires the dashboard bus ingest (not the v1
DashboardReporter) for dashboard selection` (`0917b5bae`, D-03) and `run command — run attributes
inherits retry-child attributes from AGENT_QA_PARENT_RUN_ID without a child run id` (`347c11aec`,
D-25), both in `run.test.ts`. The test mock `mockCreateDashboardRunIngest` (`dashboard.test.ts`)
went in `8dd69102f`. The cells re-spelled in place, titles kept except the unregistered
`dashboard door (suiteQueueId)` label (443-04), are listed in each plan's summary.

#### Registered gate rows

The 1859 rows listed at `3e4f9fcc9` are still listed, unchanged and in order; none was renamed,
removed or moved. These registered cells were re-spelled under their kept names, each named in its
plan's summary: `C442-OWNER-STAMP the ingest stamps its own row`, `C442-OWNER-STAMP the queue flip
stamps the dashboard` and `C442-ORPHAN exactly one finalizer wins a race` (443-04); the three
`in-process-run-execution.test.ts` `C441-RUN-RECORDS` cells (443-08, a record on every drive call);
`the INVK-06 consumer census is frozen and self-checking (D-15) THE MARKER SCAN EQUALS THE FROZEN
CENSUS — n in, n classified, no silent drops` (443-07, two carrier rows); `C442-CENSUS … 
C442-STATUS-WRITERS-CLASSIFIED` (443-04, 443-05, 443-08, the writer rows and floor); and the
`C442-DOOR-TABLE … refuses a declared production run before any effect, plugin loading included`
cells and `C442-ABSENCE no door asks, requires a token or scope, or offers an inbox` (443-10: every
door now writes its row, and a refused run leaves no runs.db file).

### What was RETAINED, and why

| Item | Where (at this section's commit) | Why kept | What pins it |
|---|---|---|---|
| `AGENT_QA_RUN_ID` | `cli/src/commands/run.ts` | the one way to choose a run id from the environment (D-11); its shape and unused-id refusals stay, and it now gives the row and the run directory one id on both paths | `C433-RUN-ONE-ID: AGENT_QA_RUN_ID is still the run's id` (in `433-run-identity.test.ts`, not listed in the gate); `C443-HANDED-ROW an AGENT_QA_RUN_ID naming another process's row is refused and the row is untouched`; `C443-ENV-RETIRED inherits run attributes only under AGENT_QA_RUN_ID` |
| reporter selection for `console`, `junit` and `stdout-live` | `run.ts` (`SUPPORTED_REPORTERS`, `resolveReporterSelection(opts)`) | they print or write files; none decides the row (D-03) | `C443-REPORTER a run still records its row under the default reporters`; the `in-process-run-execution.test.ts` unsupported-reporter cell |
| `services.dashboard`'s other keys (`port`, `dbPath`, `artifactsDir` and the entity-card URL keys) | `core/src/schema/services-schema.ts` | `dbPath` now names where every run's row goes (D-03, D-08); the block only stopped deciding whether a row is written | `C443-RECORD-PATH a run naming another config writes that config's runs.db` |
| core's `LogStorage` and `LogManager.flush` | `core/src/logging/` | a core public export (agent-qa AGENTS.md: preserve public exports); only the CLI's dead plumbing went (D-21) | `git diff 3e4f9fcc9 HEAD -- packages/core/src/logging` is empty |
| `insertRun`'s fresh `running` insert, stamped with the handle's owner | `dashboard-server/src/db/database.ts` | an insert under an existing id fails on the primary key, so it cannot take a row over; tests seed rows through it | `C442-CENSUS … C442-STATUS-WRITERS-CLASSIFIED` |
| `InProcessCliRunExecutionOptions.subscribers` | `cli/src/composition/in-process-run-execution.ts` | `agent-qa run` still attaches its console, junit, stdout-live and analytics subscribers through it; the record is attached by the drive, never through it (its wire reporter can print to stdout) | `C443-ONE-RECORD every drive call passes a record from the one builder, and the scan saw every door` |
| the `--config-debug` block's `console.log` lines in the direct producer | `run.ts` | it reads a door flag only `agent-qa run` sets, so no protocol door reaches it | read from code; not pinned by a cell |

### What degrades, stated plainly

- **Every run writes `.agent-qa/runs.db`.** `agent-qa run` with no `services.dashboard` block, and
  every `runs.start` door, now creates and writes the project's runs.db (or `services.dashboard.dbPath`
  of the run's own config). A run whose runs.db cannot be opened (an older version, an unwritable
  folder, a corrupt file) is refused before any effect with a plain sentence, exit 2 on
  `agent-qa run`, and no run id; it no longer runs on without a record.
- **Runs from before 443 have no rows.** Nothing replays `events.jsonl` (D-02): a run directory
  written by a `runs.start` door, the daemon or `agent-qa run` without a dashboard block before this
  phase stays absent from the dashboard and reads "Run not found" there.
- **`--reporter dashboard` is refused** with `Unknown reporter "dashboard". Supported reporters:
  console, junit, stdout-live`, exit 2. No alias or message names a replacement (D-01).
- **The owner's local miniwob bench driver is refused until it drops the name.** The local
  checkout beside `agent-qa/` (`agent-qa-miniwob-bench/src/agent_qa_miniwob_bench/product.py`)
  appends `--reporter console stdout-live dashboard` when it publishes artifacts; from `0917b5bae`
  those runs end with the unknown-reporter refusal. It belongs to neither repository and was not
  edited.

### Persisted values the narrowed contract governs

No schema bump, no migration and no compatibility code (D-01).

| Persisted value | Disposition | Evidence |
|---|---|---|
| `runs.attributes` key `agent-qa.gate-run` | **New, value `'true'` only**, written by the record's subscriber from the request's gate-run flag (authoring verify and repair gate runs); an unmarked run has no such key, never `'false'`. Refused as a user attribute by the reserved `agent-qa.` prefix. | `C443-VERIFY-MARK the gate-run mark is an internal attribute with one value`; `C443-VERIFY-RUN a verify run started through authoring keeps its flag and exclusion and has a marked row`; `C443-VERIFY-RUN an ordinary run in the same project has no mark` |
| `runs.attributes` key `agent-qa.trigger` | **Now the door**, with the four existing values: `cli` (`agent-qa run`, `fn`, `ask`, `chat`, the daemon), `mcp` (the standalone server over stdio and HTTP, the co-hosted endpoint), `api` (`POST /run`), and the queue's own value for queued runs. | the six `C443-DOOR-TRIGGER` cells; the ten `C443-DOOR-MATRIX <row>: the row records its door in agent-qa.trigger` cells |
| a `running` row another live process owns | **Never taken over**: the claim inserts a fresh row or adopts this handle's own, and the queue flips only `pending` rows. | the twelve `C443-CLAIM` cells; the four `C443-QUEUE-FLIP` cells |
| a fresh `.agent-qa/runs.db` opened by many processes at once | **Created once, by whichever opener wins**: a bounded `SQLITE_BUSY` retry on the WAL switch and a `BEGIN IMMEDIATE` migration that re-reads `user_version` (D-23). An older file is still refused before anything touches it. | the four `C443-FRESH-OPEN` cells |

### The instruments that notice a return

- **`pnpm validate:arch`** runs `C443-ONE-RECORD` and `C443-ENV-RETIRED` beside the 442 census. A
  second ingest construction, a drive call without the builder's record, a new execution path, an
  owner-less runs.db handle, a bridge subscriber member, or a returning run-id variable, correlation
  type, field, suite spelling or reader reds by name on the commit that adds it.
- **The 434 gate** (`pnpm run gate:local`) must execute and pass all 120 listed `C443-` cells, each
  with its `443 D-NN` origin: `C443-DOOR-MATRIX` 43 (`443 D-13` 12, `443 D-06` 10, `443 D-10` 10,
  `443 D-20` 10, `443 D-14` 1), `C443-CLAIM` 12, `C443-QUEUE-FLIP` 4, `C443-OWN-FINALIZE` 1,
  `C443-FRESH-OPEN` 4, `C443-INGEST-ID` 2, `C443-RUN-RECORD` 3, `C443-RECORD-PATH` 2,
  `C443-RECORD-REFUSAL` 10, `C443-RECORD-INCOMPLETE` 1, `C443-DAEMON-RECORD` 2,
  `C443-DOOR-TRIGGER` 6, `C443-VERIFY-RUN` 2, `C443-VERIFY-MARK` 5, `C443-CLI-ROW` 2,
  `C443-HANDED-ROW` 3, `C443-REPORTER` 3, `C443-ENV-RETIRED` 2, `C443-ONE-RECORD` 9,
  `C443-SUITE-PREP-STDOUT` 2 (`443 D-26`) and `C443-DEBUG-STDOUT` 2 (`443 D-13`).
- **Not spelled by any needle:** the names `requiredDashboard`, `createSuiteDashboardResources`,
  `closeSuiteDashboardDb`, `createSuiteRunId`, `singleDashboardIngest` and `logStorage`. Their
  behaviour returning is caught by the cells in the table above, except the log storage's, which no
  cell observes; the names alone returning are not.

### Not observed, stated as such

- **win32 was not run.** No Windows host ran the new writers or the matrix; the cells that spawn
  processes throw `POSIX run lifecycle required; never skip` there, as 442 recorded.
- **No live model ran.** Every cell uses a stub model or none.
- **No user workspace was inspected.** The degrade statements are what the cells and the code show.

### Reconciliation

None needed. V2-RUN-02 was built as written, and WINDOWS #557's door is recorded as unsupported, as
the requirement's ownership line allows ("#557 → V2-RUN-02, if its door is supported"), so
`.planning/REQUIREMENTS.md` was not edited.

### Gate at the time of writing

The record gate runs on Phase 443's final agent-qa SHA, the commit that adds this section, which
`.planning/phases/443-one-run-through-every-door/443-RECORD.md` § Final SHA names. Its legs, counts
and verdict are recorded in that file's § Gate rather than quoted here, so no agent-qa commit
follows the gate run.

### Gap closure round 1 (443-12 to 443-18), 2026-10-17

This subsection appends to the Phase 443 section; written by 443-19, which changed no earlier line.
It follows `.planning/phases/443-one-run-through-every-door/443-VERIFICATION.md` (agent-qa
`03a489165`, 43 of 44 truths). Its failed truth 20 is D-27's own-row close-out after a failed
write: the record closed its own row only in the window between the artifact insert and the first
member status write, so a write that failed right after the claim left the row `running` (review
WR-02), and one that failed after a member had finished left the row at the member's status
(review WR-03). The orchestrator decided the round, with the code review's WR-01 to WR-05 and
IN-01 to IN-06 and the UI review's three badge warnings, as GAP-D1 to GAP-D8 on 2026-10-17, with
the owner's delegation; the round's own code review (`443-REVIEW.md`, 0 critical, 1 warning, 5
info) ran before 443-19, and its four fixes are in the range below. Every commit below is in
agent-qa on `version-0.2` and signed. Every new cell is listed in
`scripts/gate/inputs/regressions.json` with its `443 GAP-D<n>` origin, after the 1979 rows listed
at `03a489165`, which are unchanged and in order (Registered gate rows, below).

**How it is measured.** Baseline `03a489165` (Phase 443's first final SHA, 443-11's inventory
commit). Closing SHA `ab17e4817` (443-19's gate list commit, the parent of this subsection's
commit). `git -C agent-qa diff --shortstat 03a489165 ab17e4817`: 22 files changed, 1,155
insertions, 113 deletions (under `packages/`: 21 files, +1,029/−113). `--diff-filter=D`: no file
deleted. `--diff-filter=A`: 3 files added, every one a test file (`443-record-drive.test.ts`,
`443-record-open.test.ts`, `443-wal-retry.test.ts`). 21 commits, every one signed (`%G?` = `G`):
the round's tests-only RED commits (443-12 `7995fa803`, 443-14 `f0ba79dd3`, 443-15 `43b6bc0c6`,
443-16 `6b3614e90`, 443-18 `86e563685`), its fixes and removals (443-13 `f8c438dda`,
`c910ee7f3`; 443-14 `c768dc05e`, `cef467aa4`; 443-15 `d28a58eb9`; 443-16 `0cde406f4`,
`83fc08836`; 443-18 `22b6405be`), 443-17's two test-harness commits (`8df542972`, `a569603ee`),
the round review's five (`a1b702a71` RED and `79a85f252` for IN-07, `7a2c0126f` for IN-09's
comment, `3a2d30de2` for WR-06, `e80181c1e` for IN-11) and 443-19's gate list (`ab17e4817`).
Production files changed: `cli/src/commands/run.ts`,
`cli/src/composition/in-process-run-execution.ts`, `core/src/run-attributes.ts`,
`dashboard-server/src/db/database.ts`, `dashboard-server/src/reporter/dashboard-subscriber.ts`,
`dashboard-server/src/server/routes.ts` and `dashboard-ui/src/components/runs-table.tsx`. The
removed lines below are read from each deleting commit's diff (`git -C agent-qa show <sha>`), not
transcribed from a summary. Line numbers are at `03a489165`.

#### What was deleted

| Member (file at `03a489165`) | What it did | Deleting commit | The cell that notices its return |
|---|---|---|---|
| `incomplete(): string \| undefined` on the `RunRecord` interface (`cli/src/commands/run.ts:887`) and its implementation `incomplete: () => incompleteReason` on the object `createRunRecord` returns (`run.ts:1057`) | exposed the record's incomplete reason to a caller; no production code called it (review IN-01). The reason stays private and still feeds the D-27 line | `0cde406f4` (443-16) | `C443-DEAD-SURFACE a run record has no incomplete reader` |
| `buildInternalRunAttributes`' `gateRun?: true` option (`core/src/run-attributes.ts:141`) and its conditional spread `...(input.gateRun === true ? { [ATTR_GATE_RUN]: 'true' } : {})` (`:146`) | a second spelling of the gate-run mark; the record's own `{ ...own, [ATTR_GATE_RUN]: 'true' }` spread is the one production writes (IN-01) | `0cde406f4` (443-16) | `C443-DEAD-SURFACE the internal attribute builder takes no gate-run option` |
| `export function createInProcessCliRunExecution(…)` and its doc block (`The RunExecutionPort a door composes. …`) (`cli/src/composition/in-process-run-execution.ts:711-736`), with the drive module's value imports of `createRunRecord` and `doorRunAttributes` from `../commands/run.js` (`:80-81`) | the drive module's run-execution port; no door composed it (IN-01). The drive is now called only by `agent-qa run` (twice), the shared host and the daemon | `83fc08836` (443-16) | `C443-ONE-RECORD every drive call passes a record from the one builder, and the scan saw every door` (four pinned sites; a fifth caller reds it by name); `git -C agent-qa grep -n createInProcessCliRunExecution -- packages` prints nothing |
| the port's pins: `'createRunRecord'` and `'doorRunAttributes'` in `PINNED_RUN_TS_IMPORTS` and the dated 443-08 line above them (`cli/src/composition/__tests__/in-process-exit-census.test.ts:159-161`); the census's drive-call floor of 5 (`arch/src/__tests__/443-one-record-census.test.ts:410`, now 4, with `DRIVE_CALLS`) | counted the port as a drive caller and an importer of the builder | `83fc08836` (443-16, the pins); `6b3614e90` (443-16 RED, the floor and `DRIVE_CALLS`) | the exit census's `ROUTE 2` set-equality cell (not listed in the gate); `C443-ONE-RECORD every drive call passes a record from the one builder, and the scan saw every door` |
| the record flush's running-only close-out call `handle.finalizeOwnRun(runId, { status: finalRunStatus(verdict), endedAt: … })` (`run.ts:1044`) | closed the run's own row only while it still read `running`, so a member's status write before the failed write turned it into a no-op (WR-03), and a row the record had not yet learned it owned was never reached (WR-02) | `c910ee7f3` (443-13), replaced by `handle.closeOwnRun(…)` with the same arguments (GR-2) | `C443-RECORD-CLOSE a two-member run whose second member's write fails ends at the run's verdict status`; `C443-RECORD-CLOSE an artifact write that fails right after the claim still closes the row with the verdict status` |
| the `"agent-qa.gate-run"` entry of the Runs list's `INTERNAL_ATTRIBUTE_ORDER` (`dashboard-ui/src/components/runs-table.tsx:81`), and with it the mark's line in `AttributeSummary` (`:131`, the summary built from every sorted entry) | listed the mark a second time as a raw `agent-qa.gate-run=true` in the Attributes cell, its `+N more` count, its tooltip and its `aria-label`, beside the badge (UI review warning 2) | `22b6405be` (443-18); `AttributeSummary` now drops `GATE_RUN_ATTRIBUTE` after sorting, and nothing reads the order entry | `C443-VERIFY-BADGE the attributes cell does not list the gate-run mark again` |

**Replaced behaviour, and what each became** (no member left; each read from its commit):

| Before (file at `03a489165`) | After | Commit | The cell that pins it |
|---|---|---|---|
| the ingest fired `onRunCreated?.(id)` after the artifact insert and the snapshot replay (`dashboard-server/src/reporter/dashboard-subscriber.ts:277`) | fired directly after the claim succeeds, before any write that can throw (WR-02); a refused claim still fires nothing | `f8c438dda` (443-13) | `C443-RECORD-CLOSE an ingest whose artifact write fails after its claim still reports the claimed row`; `C443-CLAIM an ingest for an id another live process owns writes nothing under it` |
| no closing write for a row a member status write had moved off `running` | `DashboardDatabase.closeOwnRun(id, { status, endedAt })`: one `UPDATE runs SET status = ?, ended_at = ? WHERE id = ? AND owner_pid = ? AND owner_incarnation IS ? AND owner_host = ?` against `this.ownStamps.get(id) ?? this.readOwnStamp()`, no status condition, the stamp dropped on success; `routes.ts` lists it in `RUN_READS_WITHOUT_ROWS` | `f8c438dda` (443-13) | `C443-RECORD-CLOSE the closing write lands the verdict status after a member status write`; `C443-RECORD-CLOSE the closing write never touches a row another process stamped`; `C442-CENSUS — no path finalizes runs it does not own (442 D-05) C442-STATUS-WRITERS-CLASSIFIED: every runs.status writer is listed with whose row it writes` |
| the drive flushed the record only on its success path | the drive's `finally` first runs `try { await startedRecord?.flush() } catch {}`, so a run that rejects after its session started still finalizes its record and closes its own row after a failed write (WR-01); its comment was corrected by `7a2c0126f` (review IN-09) | `c768dc05e` (443-14) | `C443-RECORD-FLUSH a run that rejects after its session started still finalizes its record`; `C443-RECORD-FLUSH a rejected run whose write failed leaves no running row it owns` |
| a row's attributes were `queued === undefined ? input.attributes : queued.attributes` (`run.ts:985`), so a suite recorded the door's `agent-qa.runner: local` whatever the producer resolved (WR-04, a 443-08 regression) | the queue's attributes win; else `RunRecordAttach.attributes` (the drive passes `produced.subscriberSeed.attributes`) with `agent-qa.trigger` taken from the door's own attributes; else the door's | `cef467aa4` (443-14) | `C443-RECORD-RUNNER a suite whose producer resolved a BrowserStack runner records browserstack under the door's trigger`; `C443-RECORD-RUNNER a queued run keeps its routes' attributes over the producer's` |
| the record set `openedFor = runId` at the top of `open` (`run.ts:945`), before the handle opened, so a failed open left it marked open (IN-02) | set after `db = handle`; then (`79a85f252`, review IN-07) `open` keeps one in-flight open, `opening: { runId, done }`: a concurrent open of the same id joins it, another id is refused with the existing `belongs to` sentence, and a failed open clears it | `d28a58eb9` (443-15), `79a85f252` (round review) | `C443-RECORD-OPEN a record whose open failed refuses the same run again`; `C443-RECORD-OPEN two concurrent opens of one record share one handle` |
| `host.db.dbPath === dbPath` (`run.ts:959`), a string compare that opened a second connection to the dashboard's own file under another spelling (IN-05) | `namesOneRunsDb(a, b)`: `realpathSync.native` of both, else the resolved strings | `d28a58eb9` (443-15) | `C443-RECORD-OPEN a record shares the host's handle when the two paths name one file through a symlink`; `C443-RECORD-PATH a run naming another config writes that config's runs.db` |
| `errcode === SQLITE_BUSY` in `enableWalMode` (`dashboard-server/src/db/database.ts:409`) (IN-04) | `typeof errcode === 'number' && (errcode & 0xff) === SQLITE_BUSY`, so 261 and 517 retry within the same 5 s bound | `d28a58eb9` (443-15) | `C443-WAL-BUSY a fresh open retries the WAL switch on an extended busy code`; `C443-WAL-BUSY a WAL switch that fails for another reason is not retried` |
| the badge `<Badge variant="secondary">Verify run</Badge>` inside an `items-center` name wrapper (`runs-table.tsx:903`, `:923`) | the `TooltipTrigger asChild` of `Started by authoring verify. Not used for learning.`, with `tabIndex={0}` and `mt-0.5`, inside an `items-start` wrapper; its condition reads `GATE_RUN_ATTRIBUTE` (UI review warnings 1 and 3) | `22b6405be` (443-18) | `C443-VERIFY-BADGE the Verify run badge explains itself and takes keyboard focus`; `C443-VERIFY-BADGE the badge lines up with the first line of a wrapped name` |
| test harness: the fresh-open file checked only that the dashboard and core `dist` existed; the door matrix passed its preload to `NODE_OPTIONS` unquoted | `requireFreshBuild` refuses a missing or stale `dist` with `…; run pnpm build --force in agent-qa before this file` (WR-05; `--force` from `3a2d30de2`, review WR-06); `--require ${JSON.stringify(preload)}` (IN-06) | `8df542972`, `a569603ee` (443-17), `3a2d30de2` (round review) | `C443-FRESH-BUILD a dist older than its source is refused with a rebuild instruction`; `C443-FRESH-BUILD the dashboard and core builds these cells import are current`; `C443-DOOR-MATRIX the stdio MCP door's stdout stays JSON-RPC through its run` |

No file was deleted and no test cell was removed. The round's 21 new cells, by area and origin:
`C443-RECORD-CLOSE` 5 (`443 GAP-D1`), `C443-RECORD-FLUSH` 2 (`443 GAP-D2`), `C443-RECORD-RUNNER` 2
(`443 GAP-D3`), `C443-RECORD-OPEN` 3 and `C443-WAL-BUSY` 2 (`443 GAP-D5`; the third
`C443-RECORD-OPEN` cell is the round review's IN-07 cell), `C443-DEAD-SURFACE` 2 (`443 GAP-D6`),
`C443-FRESH-BUILD` 2 (`443 GAP-D4`) and `C443-VERIFY-BADGE` 3 (`443 GAP-D7`).

#### Registered gate rows

The 1979 rows listed at `03a489165` are still listed, unchanged and in order; none was renamed,
removed or moved. These registered cells were re-spelled under their kept names, each named in
its plan's summary or the round review's fix report:
- `C443-ONE-RECORD every drive call passes a record from the one builder, and the scan saw every door`
  (443-16): `DRIVE_CALLS` is `[RUN_TS, RUN_TS, LOCAL_HOST, DAEMON_HOST]` and its floor is 4.
- `C443-VERIFY-MARK the gate-run mark is an internal attribute with one value` (443-16, then
  `e80181c1e` for review IN-11): it builds the marked attributes as the record does, and its first
  assertion now passes them through `mergeRunAttributes` and `validateTrustedRunAttributes` and
  compares the literal keys, instead of reading back the literal it had built.
- `C442-CENSUS — no path finalizes runs it does not own (442 D-05) C442-STATUS-WRITERS-CLASSIFIED: every runs.status writer is listed with whose row it writes`
  (443-13): `WRITER_CALL` names `closeOwnRun`, and the record flush's writer row is
  `closeOwnRun`, `own`; `WRITER_FLOOR` stays 26.

#### What was RETAINED, and why

| Item | Why kept | What pins it |
|---|---|---|
| `subscriberSeed.attributes` on the suite producer's output (`run.ts`) | read again: the drive hands it to the record as the suite row's attributes (GAP-D3), so the row stores what the CLI prints as `Run attributes:` | `C443-RECORD-RUNNER a suite whose producer resolved a BrowserStack runner records browserstack under the door's trigger` |
| `finalizeOwnRun` and its `status = 'running'` guard (`database.ts`) | the first-signal and crash finalizers need it: a late Ctrl+C must not mark a finished run cancelled (GR-2); only the record flush moved to `closeOwnRun`, and `run.ts` still holds at least three calls | `C443-OWN-FINALIZE the own-row finalizer writes each verdict status once`; the six `C442-OWN-RUN-ONLY` cells; `C442-CENSUS … C442-STATUS-WRITERS-CLASSIFIED` |
| the D-27 line, `The run finished (<verdict>), but its dashboard record is incomplete: <reason>.`, word for word (GR-5), with the verdict and exit code untouched | the one line on stderr or the daemon's logger; no plan added a second reason | `C443-RECORD-INCOMPLETE a write that fails after the start leaves the verdict and says the record is incomplete`; `C443-RECORD-CLOSE a two-member run whose second member's write fails ends at the run's verdict status` |
| `ATTR_GATE_RUN = 'agent-qa.gate-run'` and its `'true'`-only validator arm (core); `buildInternalRunAttributes` as a core export | the mark's one name (D-09); only the builder's second spelling went | `C443-VERIFY-MARK the gate-run mark is an internal attribute with one value`; `C443-VERIFY-RUN a verify run started through authoring keeps its flag and exclusion and has a marked row` |
| `updateRun`'s stamp drop on a status write | keeping the stamp alive until close-out would grow the dashboard's long-lived handle by one stamp per run, because the normal path never reaches a close-out (GR-2) | `C443-RECORD-CLOSE the closing write lands the verdict status after a member status write` |
| `agent-qa.gate-run` as a filterable key | the toolbar's attribute filter does not use the summary, so the key stays filterable; D-09 adds no Runs-list filter | `C443-VERIFY-MARK no filter is added` |

#### What degrades, stated plainly

- **A stale build fails the fresh-open file instead of passing it.** A dashboard-server or core
  `dist` older than its newest product source now fails every `C443-FRESH-OPEN` cell and
  `C443-FRESH-BUILD the dashboard and core builds these cells import are current` from
  `beforeAll`. After a content-neutral source touch (an edit and its revert) a turbo cache hit
  leaves `dist` untouched, so only `pnpm build --force` clears it, as the message says. The gate
  builds in a fresh clone and is unaffected.
- **The closing write can replace a `cancelled` status** this process wrote through the queue's
  cancel or the CLI's interrupt, and it rewrites `ended_at`, but only when the record is also
  incomplete (review IN-08, deferred to Phase 444, V2-RUN-03).
- **A run that ends with no verdict and no failed write leaves its row `running`** under its own
  stamp until the host exits (review IN-09's behaviour, deferred to Phase 444; latent under the
  runner's D-13/D-17 invariant).
- **A dashboard queue row flipped before this process read its start time** carries a NULL
  incarnation; once a member write drops that stamp, `closeOwnRun` compares with the now-read
  start time and writes nothing. The D-27 line still prints (GR-2's residual).
- **A single-test BrowserStack run still records `agent-qa.runner: local`**: the direct producer
  supplies no `subscriberSeed` (review IN-10; it predates 443, agent-qa `3e4f9fcc9`).
- **A caller of the removed members breaks**, with no alias, shim or message naming a replacement
  (D-01): `RunRecord.incomplete()`, `buildInternalRunAttributes({ gateRun })` and
  `createInProcessCliRunExecution`. None had a production caller.

#### Persisted values the narrowed contract governs

No schema bump, no migration and no compatibility code (D-01).

| Persisted value | Disposition | Evidence |
|---|---|---|
| `runs.status` (and `ended_at`) of a run's own row after a failed write | **The verdict's status in every window** (`healed` reads `passed`, `timeout` reads `failed`), written once by `closeOwnRun` on the owner columns, whatever a member wrote before; `ended_at` is the flush time. A row another process stamped, or a pending row, is never written. | the five `C443-RECORD-CLOSE` cells; `C443-RECORD-FLUSH a rejected run whose write failed leaves no running row it owns` |
| a suite's `runs.attributes` | **The producer's resolved attributes** (`agent-qa.runner` among them) under the door's `agent-qa.trigger`; a queued run keeps its routes' attributes; a single-test row is unchanged. Stored values are not rewritten. | the two `C443-RECORD-RUNNER` cells |
| `runs.attributes` key `agent-qa.gate-run` | unchanged, value `'true'` only; written only by the record's spread | `C443-VERIFY-MARK the gate-run mark is an internal attribute with one value`; `C443-DEAD-SURFACE the internal attribute builder takes no gate-run option` |

#### The instruments that notice a return

- **The 434 gate** must execute and pass the 21 cells above, each with its `443 GAP-D<n>` origin,
  as well as the 1979 earlier rows.
- **`pnpm validate:arch`** still runs `C443-ONE-RECORD` (four drive sites) and `C442-CENSUS`
  (`closeOwnRun` classified `own`).

**Gate**

The round's record gate measures agent-qa HEAD after this subsection lands. Its legs, counts and
verdict are recorded in `.planning/phases/443-one-run-through-every-door/443-RECORD.md` § Gate and
the SHA in § Final SHA, rather than quoted here, so no agent-qa commit follows it.
