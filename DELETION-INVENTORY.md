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
