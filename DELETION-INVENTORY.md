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
| Web context `recordVideo` wiring and videos-directory resolver | Source census: `rg -n 'recordVideo|getVideoPath|videosDir|resolveVideosDir' packages/web/src/adapter.ts packages/web/src/farm-adapter.ts` must have no matches. The pre-existing videos-dir debris needles remain in `405-debris-deleted.test.ts`; `424-recording.screencast.test.ts` proves finalization before artifact persistence. |
| `RunArtifactRuntimeSnapshot.videoPath` | Source census: `rg -n 'videoPath' packages/schema/src/run/run-artifact.ts` must have no matches; member recording schema/runtime/type cells live in `424-recording-contracts.test.ts` and its test-d twin. |
| Drawer Attributes and Screenshot tabs | `artifact-drawer.test.tsx` pins the remaining tabs and Attributes absence; `artifact-drawer.screenshot.test.tsx` pins no Screenshot tab. Screenshot citations now select the playhead or open the dedicated lightbox; the unchanged failure-view gate exercises the retargeted citation cells. |
| Seventh `data-evidence-state` value, `incomplete` | `EVIDENCE-STATE-SIX-VALUES` in `evidence-state-census.test.ts` scans all production UI literals; `C424-STATES-EXACT` runtime/type walls and playback P03 prove the closed set. Incomplete evidence retains its inline label through the shared unavailable state. |

WINDOWS 285's constant ARIA stub is fixed by Plan 09: `ARIA-READS-SUB-ACTION` reads the selected sha-addressed document as masked text; `TAB-LOAD-FAILURE-ARIA` proves retry and never-empty behavior. Historical empty documents are not silently substituted for failed loads.

SC1's added run-detail mutation proof is P01/P02/P22 in `scripts/424-playback-mutation.sh`; phase-range git log and diff confirm `scripts/405-run-detail-mutation.sh` and its inventory are unchanged. Database option A refuses unreleased v2 and retains only the locked v3-to-v4 additive step. No old section's historical v2-to-v3 account is rewritten.
