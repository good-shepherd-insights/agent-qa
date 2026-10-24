import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_TOOLS_LOCAL_PACKAGE_NAME = '@vostride/agent-qa-tools-local'
export const AGENT_QA_TOOLS_LOCAL_PACKAGE_DIR = 'packages/tools-local'
export const AGENT_QA_TOOLS_LOCAL_PACKAGE_CLASSES = ['storageImplementation'] as const
export const AGENT_QA_TOOLS_LOCAL_ALLOWED_RESPONSIBILITIES = [
  'local tool execution and host-IO adapter implementation behind the agent ToolsPort',
  'filesystem access for local tool adapters',
  'process and host-IO access for local tool adapters',
] as const
export const AGENT_QA_TOOLS_LOCAL_FORBIDDEN_RESPONSIBILITIES = [
  'provider invocation ownership',
  'agent decision or planning logic',
  'knowledge-store persistence',
  'agent-store persistence',
] as const
export const AGENT_QA_TOOLS_LOCAL_EXTERNAL_DEPENDENCIES = [] as const
export const AGENT_QA_TOOLS_LOCAL_INTERNAL_DEPENDENCIES = ['@vostride/agent-qa-agent'] as const

export const AGENT_QA_TOOLS_LOCAL_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_TOOLS_LOCAL_PACKAGE_NAME,
  packageDir: AGENT_QA_TOOLS_LOCAL_PACKAGE_DIR,
  packageClasses: AGENT_QA_TOOLS_LOCAL_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_TOOLS_LOCAL_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_TOOLS_LOCAL_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_TOOLS_LOCAL_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_TOOLS_LOCAL_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
