import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_CLI_PACKAGE_NAME = 'agent-qa'
export const AGENT_QA_CLI_PACKAGE_DIR = 'packages/cli'
export const AGENT_QA_CLI_PACKAGE_CLASSES = ['surface'] as const
export const AGENT_QA_CLI_ALLOWED_RESPONSIBILITIES = [
  'public CLI entry and packaged skills; composition root with broad first-party imports and full host access',
] as const
export const AGENT_QA_CLI_FORBIDDEN_RESPONSIBILITIES = [
  'none - surface is a composition root with full host/storage access per spec section 4',
] as const
export const AGENT_QA_CLI_EXTERNAL_DEPENDENCIES = [
  '@inquirer/checkbox',
  '@inquirer/input',
  '@inquirer/password',
  '@inquirer/select',
  'ai',
  'commander',
  'picocolors',
  'playwright-core',
  'yaml',
  'zod',
] as const
export const AGENT_QA_CLI_INTERNAL_DEPENDENCIES = [
  // 384 FUNC-01: the function layer the CLI invokes capabilities through.
  '@vostride/agent-qa-agent',
  // 2026-07-29 (Phase 385 plan 08, D-13): the local composition root. The CLI no longer builds a
  // run session itself; it supplies presentation ports and delegates.
  '@vostride/agent-qa-agent-local',
  '@vostride/agent-qa-android',
  '@vostride/agent-qa-core',
  '@vostride/agent-qa-dashboard',
  '@vostride/agent-qa-dashboard-ui',
  '@vostride/agent-qa-eval',
  '@vostride/agent-qa-eval-local',
  '@vostride/agent-qa-ids',
  '@vostride/agent-qa-ios',
  '@vostride/agent-qa-knowledge-local',
  '@vostride/agent-qa-mcp',
  '@vostride/agent-qa-model',
  '@vostride/agent-qa-runner',
  '@vostride/agent-qa-runner-local',
  '@vostride/agent-qa-safety',
  '@vostride/agent-qa-safety-local',
  '@vostride/agent-qa-schema',
  '@vostride/agent-qa-web',
] as const

export const AGENT_QA_CLI_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_CLI_PACKAGE_NAME,
  packageDir: AGENT_QA_CLI_PACKAGE_DIR,
  packageClasses: AGENT_QA_CLI_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_CLI_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_CLI_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_CLI_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_CLI_INTERNAL_DEPENDENCIES,
} as const satisfies OwnershipContract
