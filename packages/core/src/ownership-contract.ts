import type { OwnershipContract } from '@vostride/agent-qa-arch'

export const AGENT_QA_CORE_PACKAGE_NAME = '@vostride/agent-qa-core'
export const AGENT_QA_CORE_PACKAGE_DIR = 'packages/core'
export const AGENT_QA_CORE_PACKAGE_CLASSES = ['transitional'] as const
export const AGENT_QA_CORE_ALLOWED_RESPONSIBILITIES = [
  'transitional home for v1 runner / memory / agent code pending re-derivation into bounded v2 packages',
] as const
export const AGENT_QA_CORE_FORBIDDEN_RESPONSIBILITIES = [
  'new responsibilities or new boundary violations beyond what the ledger already enumerates',
] as const
export const AGENT_QA_CORE_EXTERNAL_DEPENDENCIES = [
  '@ai-sdk/anthropic',
  '@ai-sdk/google',
  '@ai-sdk/openai',
  'ai',
  'better-sqlite3',
  'bytes',
  'fast-xml-parser',
  'glob',
  'id-agent',
  'ms',
  'picocolors',
  'playwright-core',
  'posthog-node',
  'semver',
  'sharp',
  'yaml',
  'zod',
] as const
export const AGENT_QA_CORE_INTERNAL_DEPENDENCIES = [
  '@vostride/agent-qa-ids',
  '@vostride/agent-qa-schema',
] as const
export const AGENT_QA_CORE_MIGRATION_LEDGER = [
  {
    rule: 'modelOwner',
    target: '@ai-sdk/anthropic',
    clearedBy: 'v47/Phase 340 MIG-02',
    reason: 'v1 provider switch in src/agent/provider.ts',
  },
  {
    rule: 'modelOwner',
    target: '@ai-sdk/openai',
    clearedBy: 'v47/Phase 340 MIG-02',
    reason: 'v1 provider switch in src/agent/provider.ts',
  },
  {
    rule: 'modelOwner',
    target: '@ai-sdk/google',
    clearedBy: 'v47/Phase 340 MIG-02',
    reason: 'v1 provider switch in src/agent/provider.ts',
  },
  {
    rule: 'storageImplementation',
    target: 'better-sqlite3',
    clearedBy: 'M1 Runner spine / M2 Knowledge store',
    reason: 'cache/memory subsystems still in core',
  },
  {
    rule: 'storageImplementation',
    target: 'sharp',
    clearedBy: 'M1 Runner spine / M2 Knowledge store',
    reason: 'screenshot pipeline still in core',
  },
] as const

export const AGENT_QA_CORE_OWNERSHIP_CONTRACT = {
  packageName: AGENT_QA_CORE_PACKAGE_NAME,
  packageDir: AGENT_QA_CORE_PACKAGE_DIR,
  packageClasses: AGENT_QA_CORE_PACKAGE_CLASSES,
  allowedResponsibilities: AGENT_QA_CORE_ALLOWED_RESPONSIBILITIES,
  forbiddenResponsibilities: AGENT_QA_CORE_FORBIDDEN_RESPONSIBILITIES,
  externalDependencies: AGENT_QA_CORE_EXTERNAL_DEPENDENCIES,
  internalDependencies: AGENT_QA_CORE_INTERNAL_DEPENDENCIES,
  ledger: AGENT_QA_CORE_MIGRATION_LEDGER,
} as const satisfies OwnershipContract
