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
