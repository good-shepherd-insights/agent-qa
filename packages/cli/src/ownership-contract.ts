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
  // 2026-08-15 (Phase 396 plan 01, D-09): the MCP stdio serving entry. It lives on THIS package and
  // not on `packages/mcp` because it owns a process — it takes over this process's stdin and stdout
  // and negotiates the protocol era for the connection — and owning the process is what a host does.
  // The projection package stays free of every host API, which is what keeps its own two-dep
  // allow-list (D-20) honest.
  '@modelcontextprotocol/server',
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
  // 2026-08-17 (Phase 398 plan 10, D-17/D-20): the bounded analytics package. Every host in this
  // surface binds it at its own composition root through `composition/analytics-host.ts`, which is
  // the only file here that names `composeAnalytics`. It arrives on THIS list rather than staying
  // an implementation detail of `core` because the whole point of D-17 is that telemetry is a
  // dependency a host declares, not an ambient capability any file can reach.
  '@vostride/agent-qa-analytics',
  '@vostride/agent-qa-android',
  '@vostride/agent-qa-core',
  '@vostride/agent-qa-dashboard',
  '@vostride/agent-qa-dashboard-ui',
  '@vostride/agent-qa-eval',
  '@vostride/agent-qa-eval-local',
  '@vostride/agent-qa-ios',
  // 2026-08-12 (Phase 394 plan 11, FUNC-02): the ids package is GONE from this list for exactly
  // the reason recorded below it. `create-test` and `create-suite` were the CLI's only shipped
  // source naming it — they minted a test or suite id locally to stamp into a scaffolded YAML file
  // — and both verbs are retired behind the authoring loop, which mints nothing on a surface. The
  // workspace dependency STAYS: this package's tests still construct and check canonical ids, and
  // the contract describes what the shipped source names.
  //
  // 2026-08-02 (Phase 387 plan 09, D-20): knowledge-local is GONE from this list, not moved. The
  // CLI's last direct reach into the knowledge package was `knowledge-read.ts`'s inspect/diff, and
  // those verbs are now thin clients over `knowledge.records.*`. The package is still a workspace
  // dependency because this package's TESTS construct real stores; the contract describes what the
  // shipped source names, which is why the two lists differ here and legitimately so.
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
