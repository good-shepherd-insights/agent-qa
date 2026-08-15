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

export { AGENT_QA_OP_CONTRACTS, AGENT_QA_TOOL_PROJECTIONS } from './mapping.js'
export type { ToolOpContracts, ToolProjection, ToolProjectionKind } from './mapping.js'

export { McpProjectionError, toRegisterToolConfig } from './projection.js'
export type { ProjectedOpSpec, RegisterToolConfig } from './projection.js'

export { visibleToCaller } from './visibility.js'

export {
  AGENT_QA_MCP_OWNERSHIP_CONTRACT,
  AGENT_QA_MCP_PACKAGE_NAME,
  AGENT_QA_MCP_PACKAGE_DIR,
} from './ownership-contract.js'
