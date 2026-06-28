import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_MCP_PACKAGE_NAME = '@vostride/agent-qa-mcp'
export const AGENT_QA_MCP_PACKAGE_DIR = 'packages/mcp'
export const AGENT_QA_MCP_PACKAGE_CLASSES = ['adapter', 'surface'] as const
export const AGENT_QA_MCP_ALLOWED_RESPONSIBILITIES = [
  'MCP server exposing the typed function layer (the QA-agent function surface)',
] as const
export const AGENT_QA_MCP_FORBIDDEN_RESPONSIBILITIES = [
  'any knowledge-write path beyond the read-only reader (the L2 forbidden surface)',
] as const
export const AGENT_QA_MCP_EXTERNAL_DEPENDENCIES = [
  '@modelcontextprotocol/sdk',
  'glob',
  'yaml',
  'zod',
] as const
export const AGENT_QA_MCP_INTERNAL_DEPENDENCIES = [
  '@vostride/agent-qa-core',
  '@vostride/agent-qa-ids',
] as const

export const AGENT_QA_MCP_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_MCP_PACKAGE_NAME,
  packageDir: AGENT_QA_MCP_PACKAGE_DIR,
  packageClasses: AGENT_QA_MCP_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_MCP_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_MCP_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_MCP_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_MCP_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
