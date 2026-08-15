# v1 MCP server — deletion inventory

**Dated 2026-08-15.** Phase 396 plan 01, decision **D-15** (with **D-10**, **D-13**, **D-14**).
Requirement **MCPS-02**.

## Why this file exists

The v1 `packages/mcp` server was **deleted wholesale**, not migrated: 33 per-entity CRUD tools, one
prompt, a private `agent-qa://schema/…` resource scheme, and a hand-rolled loopback HTTP bridge that
reached data through the dashboard's REST API instead of through the function layer. That data path
is exactly the private power the v2 milestone abolishes, so porting it forward was never an option.

Deleting capability silently is, though, and that is what this file exists to prevent. Every v1
capability gets a row here with a **dated disposition**, so nothing leaves the product without a
reader being able to find out what happened to it and who owns the answer.

The two dispositions are:

- **`projected-by-396-tool`** — a registered registry op stands behind this capability, so the
  re-derived server projects it. Plan 01 ships **one** projected tool (`agent_qa_list_proposals`);
  **plan 04 completes the mapping** and is where each row below is discharged. The op named in the
  row is the projection source, not a promise about the final tool name (D-01 folds several sibling
  ops through one tool where the registry is finer than the workflow).
- **`dropped-pending-397-adjudication`** — no registry op stands behind it. Per D-15 these are
  **not** re-implemented as MCP-local handlers, and **no registry ops are minted ad hoc mid-phase**.
  397's parity/conformance walk adjudicates which absences are real gaps deserving function-layer
  ops — which chat then gets for free, because the function layer is the one door.

Recovery pointer: everything deleted is in git history at the parent of the deletion commit. The
three deleted test files (`agent-qa-server.test.ts`, `agent-qa-server-masking.test.ts`,
`credential-surface-parity.test.ts`) carried real masking and credential-surface protections;
**those protections are re-derived against the new wire surface in plan 06** (RESEARCH Pitfall 9,
threat T-396-01), not dropped. Read them out of history when writing that plan.

## Tools (33 rows)

The names are quoted verbatim from the v1 `DISCOVERY.tools` list at `agent-qa-server.ts:66-98`.
The requirement text said 37; the measured list was 33.

| # | v1 tool | Disposition | Registry op / reason |
|---|---------|-------------|----------------------|
| 1 | `agent_qa_discover` | dropped-pending-397-adjudication | No op. The protocol answers this itself now — `tools/list` plus `server/discover` (SEP-2575). A hand-written catalogue tool beside them would be a second, drifting answer to one question. |
| 2 | `agent_qa_get_config` | projected-by-396-tool | `config.get` (`['read']`) — the masked config read, already a registered op. |
| 3 | `agent_qa_schema_reference` | dropped-pending-397-adjudication | No op. Named by D-15 explicitly. The static schema tables it served (`schema-reference.ts`) are deleted with it; op contracts are advertised mechanically as each tool's `inputSchema`/`outputSchema` instead (D-16), so a caller reads the live contract rather than a hand-kept copy of it. |
| 4 | `agent_qa_validate_definition` | dropped-pending-397-adjudication | No op. Named by D-15 explicitly. |
| 5 | `agent_qa_generate_id` | dropped-pending-397-adjudication | No op. Named by D-15 explicitly. Minting a canonical id on a surface is the thing 394-11 removed from the CLI for the same reason. |
| 6 | `agent_qa_validate_id` | dropped-pending-397-adjudication | No op. Named by D-15 explicitly. |
| 7 | `agent_qa_list_tests` | dropped-pending-397-adjudication | No op. `entities.resolve` resolves a reference to an entity; nothing in the registry enumerates the test corpus. A real gap for 397 to adjudicate. |
| 8 | `agent_qa_read_test` | projected-by-396-tool | `entities.get` (`['read']`) — D-02's universal entity read, kind `TST`. |
| 9 | `agent_qa_validate_test` | dropped-pending-397-adjudication | No op. Validation reaches a caller as the authoring funnel's own verdict (`authoring.draft.verify`), never as a standalone linter over arbitrary text. |
| 10 | `agent_qa_create_test` | projected-by-396-tool | `authoring.draft.write` (`['test-write','run','read']`) — workflow-coarse, and the propose+apply path rather than v1's blind write. |
| 11 | `agent_qa_update_test` | projected-by-396-tool | `authoring.draft.edit` (`['test-write','read']`). |
| 12 | `agent_qa_delete_test` | dropped-pending-397-adjudication | No op, and **MCPS-02 forbids a delete tool for irreversible deletes** regardless. Not a gap to close; a rule. |
| 13 | `agent_qa_list_suites` | dropped-pending-397-adjudication | No op. |
| 14 | `agent_qa_read_suite` | dropped-pending-397-adjudication | No op. `ENTITY_KINDS` has no suite kind, so D-02's universal read does not cover it. |
| 15 | `agent_qa_validate_suite` | dropped-pending-397-adjudication | No op. |
| 16 | `agent_qa_create_suite` | dropped-pending-397-adjudication | No op. |
| 17 | `agent_qa_update_suite` | dropped-pending-397-adjudication | No op. |
| 18 | `agent_qa_delete_suite` | dropped-pending-397-adjudication | No op; same MCPS-02 rule as row 12. |
| 19 | `agent_qa_list_hooks` | dropped-pending-397-adjudication | No op. |
| 20 | `agent_qa_read_hook` | dropped-pending-397-adjudication | No op. Hooks are visible inside the masked config read (row 2), not as their own read verb. |
| 21 | `agent_qa_create_hook` | projected-by-396-tool | `config.hook.add` (`['config-write']`) — through the propose+apply path, so a hook arrives as a reviewable diff instead of a written file. |
| 22 | `agent_qa_update_hook` | dropped-pending-397-adjudication | No op. `config.hook.add` adds; editing an existing hook has no registered verb. |
| 23 | `agent_qa_delete_hook` | dropped-pending-397-adjudication | No op; same MCPS-02 rule as row 12. |
| 24 | `agent_qa_run_hook` | dropped-pending-397-adjudication | No op. Named by D-15 explicitly. |
| 25 | `agent_qa_enqueue_test_run` | projected-by-396-tool | `runs.start` (`['run']`) — workflow-coarse. |
| 26 | `agent_qa_enqueue_suite_run` | projected-by-396-tool | `runs.start` (`['run']`), suite scope — the same op, which is why D-01 allows one tool over both. |
| 27 | `agent_qa_get_run` | projected-by-396-tool | `runs.get` (`['read']`). |
| 28 | `agent_qa_get_run_steps` | projected-by-396-tool | `runs.get` / `runs.events` (`['read']`) — plan 04 decides which, and whether it folds with rows 27/29/30. |
| 29 | `agent_qa_get_run_logs` | projected-by-396-tool | `runs.events` (`['read']`). |
| 30 | `agent_qa_get_run_execution_logs` | projected-by-396-tool | `runs.events` (`['read']`). |
| 31 | `agent_qa_get_run_artifact` | dropped-pending-397-adjudication | No op. Named by D-15 explicitly. Artifact bytes over a tool result is also a disclosure surface nobody has scoped (T-396-01's class). |
| 32 | `agent_qa_cancel_run` | dropped-pending-397-adjudication | No op. Named by D-15 explicitly — `runs.cancel` is 397's leading adjudication candidate. |
| 33 | `agent_qa_classify_failure` | dropped-pending-397-adjudication | No op with this contract. Named by D-15 explicitly. `analysis.get` reads an analysis the pipeline produced; it does not classify on demand from dashboard-fetched data the way v1's tool did. |

**Counts:** 33 rows — **12 `projected-by-396-tool`**, **21 `dropped-pending-397-adjudication`**.

## Prompt (1 row)

| v1 capability | Disposition | Reason |
|---|---|---|
| prompt `agent_qa_authoring_context` | dropped-pending-397-adjudication | **D-14: no prompts on the new server.** The authoring brief reaches callers as data through the authoring-funnel tool, and 398's build-time capability catalog owns discoverability. Revisit there if at all. |

## Resource scheme (6 rows)

The v1 `DISCOVERY.resources` list was `SCHEMA_REFERENCE_NAMES.map(name => 'agent-qa://schema/' + name)`.

| v1 resource URI | Disposition | Reason |
|---|---|---|
| `agent-qa://schema/config` | dropped-pending-397-adjudication | The whole `agent-qa://schema/…` **scheme** dies with `schema-reference.ts`. It is a different scheme from 387's `agentqa://<kind>/<id>`, which D-13 ships as entity Resource Templates resolving through `entities.get`; the two were never the same surface. Contracts now travel as advertised tool schemas (D-16). |
| `agent-qa://schema/test` | dropped-pending-397-adjudication | as above |
| `agent-qa://schema/suite` | dropped-pending-397-adjudication | as above |
| `agent-qa://schema/hooks` | dropped-pending-397-adjudication | as above |
| `agent-qa://schema/ids` | dropped-pending-397-adjudication | as above |
| scheme `agent-qa://` itself | dropped-pending-397-adjudication | Retired. `agentqa://` (no hyphen, D-13) is the surviving entity scheme, parsed by the ONE codec at `packages/schema/src/entity/uri.ts`. |

## Retired module exports and defaults

| Retired export / default | Home | Disposition | Reason |
|---|---|---|---|
| `startMcpServer`, `createMcpServer`, `MCP_STDIO_STARTUP_MESSAGE` | `server.ts` | replaced in this plan | The stdio host is re-derived over `serveStdio` in `packages/cli/src/commands/mcp.ts` (D-09). The command name `agent-qa mcp` and the stdio default are deliberately preserved so existing client configs keep working. |
| `createAgentQaMcpServer`, `AgentQaMcpServerOptions`, `resolveDashboardApiUrl`, `classifyRunFailureFromDashboardData`, `validateAgentQaDefinition` | `agent-qa-server.ts` | dropped | The dashboard-HTTP data path is the private power channel D-15 abolishes. Nothing replaces it: the new handlers reach data only through `invokeFunction`. |
| `AGENT_QA_SCHEMA_REFERENCES`, `SCHEMA_REFERENCE_NAMES`, `VALIDATION_KINDS`, `DefinitionValidationResult`, `ValidationIssue` | `schema-reference.ts` | dropped | See rows 3/4 and the resource-scheme table. |
| `createLocalMcpHttpHandler`, `resolveLocalMcpEndpoint`, `resolveMcpEndpointShape`, `LocalMcpEndpoint*`, `McpHttpHandlerOptions`, `LocalMcpTransport` | `local-http.ts` | dropped | Hand-rolled `node:http` ↔ transport bridging. D-10's loopback HTTP is re-derived on `createMcpHandler` + `toNodeHandler` from `@modelcontextprotocol/node`, which is SDK-owned. |
| `DEFAULT_MCP_HOST = '127.0.0.1'`, `DEFAULT_MCP_PORT = 3471`, `DEFAULT_MCP_PATH = '/mcp'` | `local-http.ts` | dropped | The defaults die with the module. Loopback binding itself is not dropped — it is a standing rule for the re-derived endpoint. |
| `Access-Control-Allow-Origin: '*'` on every v1 MCP response and preflight | `local-http.ts` | dropped, and **NOT to be carried forward** | A wildcard CORS header on a loopback JSON-RPC endpoint invites exactly the DNS-rebinding/cross-origin reach the v2 docs put host/origin guards in front of the handler to refuse. Recorded here so a later plan re-adding an HTTP surface cannot reintroduce it by copying. |

## Dashboard edge (D-10, RESEARCH Pitfall 10)

| Item | Disposition | Reason |
|---|---|---|
| `@vostride/agent-qa-mcp` workspace dependency of `packages/dashboard-server` | **removed** | Removed from `package.json` and from that package's `ownership-contract.ts` internal-dependency list, in the same commit as the deletion, so no phantom dep survives the collapse. |
| The MCP `node:http` listener mounted by `startServer` (`server.ts`), its `mcp` option, the returned `mcp: McpStartupInfo` field, and the `agent-qa.mcp.server.lifecycle` analytics emitted from the dashboard | **removed** | D-10: the mount dies with the v1 server. `agent-qa dashboard` no longer reads `services.mcp` either. M5's dashboard rebuild decides whether it wants a mount back, via `/hono` and its own decision — 396 ships no `/hono` dependency, which is what keeps the dep collapse honest. |
| Config key `services.mcp` (`McpConfigSchema` in `packages/core/src/schema/services-schema.ts`) | **RETAINED, INERT** | **This is the plan's open-question-4 decision, and it goes the other way from RESEARCH's guess.** RESEARCH inferred from the `(config as any).services?.mcp` cast that the key was schema-invisible. It is not: `McpConfigSchema` is a real member of `ServicesSchema`, and `ServicesSchema` is `.strict()`. Deleting the key would make **every existing project that declares `services.mcp` fail to parse its configuration** — a breaking change vastly wider than the mount being removed, and in the one direction (a config that stops loading) a user cannot work around. The key therefore stays, read by nothing. Owner: M5's dashboard rebuild re-decides it (re-use for the re-derived endpoint, or retire it behind a deprecation the config loader can warn on). |
| `packages/dashboard-server/src/__tests__/server.mcp.test.ts` | deleted | It tested the mount, the wildcard-CORS preflight and the lifecycle analytics — all three of which are the retired behaviour above. |

## Overrides cleanup (D-20) — added 2026-08-15 by Task 2

Recorded here rather than in `package.json` because JSON carries no comments.

| Override | Decision | `pnpm why` evidence |
|---|---|---|
| _(filled in by Task 2)_ | | |
