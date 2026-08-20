// The `@vostride/agent-qa-mcp` public surface (Phase 396 plan 01, D-15 / MCPS-02).
//
// WHY THIS FILE LOOKS LIKE THIS. Every v1 export — `startMcpServer`, `createAgentQaMcpServer`, the
// `agent-qa://schema/*` reference tables, the hand-rolled loopback HTTP bridge — was deleted with
// the 33-tool server. What each one carried, and whether 396 projects it or 397 adjudicates it, is
// recorded row by row in `DELETION-INVENTORY.md` beside this file; nothing was dropped without a
// row. Nothing v1 survives here.
//
// THE V1 ENTRY POINTS ARE GONE RATHER THAN RENAMED, because the wire has no place left for them.
// `startMcpServer` served one long-lived session; SEP-2575 removed the `initialize` handshake, the
// `Mcp-Session-Id` header and SSE resumability outright, so a session is no longer a thing a server
// can hold on this revision. What replaces it is a per-request factory plus the declared data
// behind it, with every cross-call handle travelling as an ordinary tool argument (SEP-2567) — this
// product's `proposal_id` is exactly that pattern, and it is why nothing below mints state.
//
// What a HOST needs is the factory and the data behind it. What a TEST needs is the two predicates,
// so they can be driven directly rather than only observed through a running server — the layers
// below `buildAgentQaMcpServer` are exported for that reason and not because anything else calls
// them. The ownership contract is exported because it describes this package.

export { buildAgentQaMcpServer, AGENT_QA_MCP_SERVER_VERSION } from './catalog.js'
export type { AgentQaMcpServerDeps } from './catalog.js'

export { createAgentQaMcpNodeHandler } from './http.js'
export type { AgentQaMcpDepsResolver } from './http.js'

// 2026-08-16 (Phase 397 D-06): the schema-comparison lens, published for the SAME reason the two
// predicates above it are — so it can be driven directly rather than only observed through a
// running server. Three pure normalisations over plain objects; nothing here builds, converts or
// reaches anything, so publishing them hands a consumer no capability. They are on the barrel
// because 397's conformance suite compares an advertised document against the function layer's own
// projection from a different package, and the alternative to sharing this object is a second
// conversion recipe for one comparison — which D-06 rules out by name.
export {
  armWithoutDiscriminant,
  stripRedundantObjectStamp,
  withoutDialect,
} from './conformance-support.js'
export type { JsonDocument } from './conformance-support.js'

// 2026-08-20 (Phase 399.1 plan 06, D-08). `maskedToolResult` joins the barrel on the paragraph
// above's reasoning, extended one door further: it IS this surface's render — the single masking
// from which both `structuredContent` and the text a person reads are answered — and 399.1's
// rendered-output matrix compares it against the chat and `fn` renders for every capability. The
// alternative to publishing it is a second serialization recipe inside the suite, which would make
// the suite's idea of this door the subject and leave the shipped one unmeasured. It hands a
// consumer no capability: it is a pure function of a value the consumer already holds.

export {
  advertisedContracts,
  AGENT_QA_COMPOSED_CONTRACTS,
  AGENT_QA_OP_CONTRACTS,
  AGENT_QA_TOOL_PROJECTIONS,
  compositionOf,
  DEGRADED_OUTPUT_CONTRACTS,
  UNPROJECTED_OPS,
} from './mapping.js'
export type {
  OutputSchemaDegradation,
  ToolComposition,
  ToolOpContracts,
  ToolProjection,
  ToolProjectionKind,
  UnprojectedOp,
} from './mapping.js'

// 2026-08-17 (Phase 398 plan 02, D-13/D-14 · XPLN-03): the v1 -> v2 tool-name migration map. It is
// on the barrel because two consumers outside this package read it — the redirect at the unknown-
// tool seam and the regen script that PROJECTS it into the committed capability manifest — and a
// second transcription for the second consumer is exactly the drift the census cell forbids.
// Publishing declared data hands a consumer no capability: these are the names of tools that no
// longer exist and the rulings that retired them.
export { V1_TOOL_MIGRATION_MAP } from './migration-map.js'
export type { V1MigrationArm, V1ToolMigrationEntry } from './migration-map.js'

export { maskedToolResult } from './masked-result.js'

export { McpProjectionError, toRegisterToolConfig } from './projection.js'
export type { ProjectedOpSpec, RegisterToolConfig } from './projection.js'

export { visibleToCaller } from './visibility.js'

// The dormant task seam (plan 03, D-12). Published on the barrel and reached by NOTHING in the
// server build — the two facts are not in tension: a later phase registering the tasks extension is
// a consumer of this package, so the projection has to be reachable from outside it, while the
// coupling MCPS-06 forbids is `catalog.ts` importing it. That absence is import-anchored by an
// acceptance grep rather than by this comment.
export { JOB_STATUS_TO_MCP_TASK_STATE, projectJobAsTask } from './task-seam.js'
export type { McpTaskProjection, McpTaskState } from './task-seam.js'

// THE OWNERSHIP CONTRACT IS DELIBERATELY NOT RE-EXPORTED, and a running guard is why. Plan 01 first
// published it here on the reasoning that it describes this package; `pnpm validate:publish` refused
// the build outright — "dist must not ship the ownership contract" — because the contract is an
// internal architectural declaration and a published one becomes something a consumer can read and
// depend on. `packages/arch`'s manifest imports it by relative path, which is the sanctioned route
// and needs no barrel entry.
