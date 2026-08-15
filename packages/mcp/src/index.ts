// The `@vostride/agent-qa-mcp` public surface (Phase 396 plan 01, D-15 / MCPS-02).
//
// WHY THIS FILE LOOKS LIKE THIS. Every v1 export — `startMcpServer`, `createAgentQaMcpServer`, the
// `agent-qa://schema/*` reference tables, the hand-rolled loopback HTTP bridge — was deleted with
// the 33-tool server. What each one carried, and whether 396 projects it or 397 adjudicates it, is
// recorded row by row in `DELETION-INVENTORY.md` beside this file; nothing was dropped without a
// row. Nothing v1 survives here.
//
// What a HOST needs is the factory and the data behind it. What a TEST needs is the two predicates,
// so they can be driven directly rather than only observed through a running server — the layers
// below `buildAgentQaMcpServer` are exported for that reason and not because anything else calls
// them. The ownership contract is exported because it describes this package.

export { buildAgentQaMcpServer, AGENT_QA_MCP_SERVER_VERSION } from './catalog.js'
export type { AgentQaMcpServerDeps } from './catalog.js'

export { createAgentQaMcpNodeHandler } from './http.js'
export type { AgentQaMcpDepsResolver } from './http.js'

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
