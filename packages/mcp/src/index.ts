// The `@vostride/agent-qa-mcp` public surface, emptied of v1 (Phase 396 plan 01, D-15 / MCPS-02).
//
// Every v1 export — `startMcpServer`, `createAgentQaMcpServer`, the `agent-qa://schema/*` reference
// tables, the hand-rolled loopback HTTP bridge — was deleted with the 33-tool server in this same
// commit. What each one carried, and whether 396 projects it or 397 adjudicates it, is recorded row
// by row in `DELETION-INVENTORY.md` beside this file; nothing was dropped without a row.
//
// The ownership contract is the one v1 file that survives, because it describes THIS package rather
// than the server that used to live in it. Plan 01's later commits add the projection surface
// (`buildAgentQaMcpServer` and the three layers under it) to this barrel.

export {
  AGENT_QA_MCP_OWNERSHIP_CONTRACT,
  AGENT_QA_MCP_PACKAGE_NAME,
  AGENT_QA_MCP_PACKAGE_DIR,
} from './ownership-contract.js'
