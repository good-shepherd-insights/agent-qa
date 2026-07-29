// The CLI's half of the local host (Phase 384 plan 01, superseded in place by 385 plan 09, D-15).
//
// What used to live here — the runs reader, the knowledge listing binding and the registry
// assembly — moved to `composeLocalAgent()` in `@vostride/agent-qa-agent-local`, which 386's daemon
// calls too. What stays is what only THIS host can answer: who the caller is, how a configuration
// file is resolved and masked, and which model a job would author with. Each of those is a port the
// composition takes, so the two hosts share a composition rather than each writing one.

import { dirname, resolve } from 'node:path'

import type { ConfigReaderPort } from '@vostride/agent-qa-agent'
import { composeLocalAgent } from '@vostride/agent-qa-agent-local'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { AgentQaConfigSchema, resolveKnowledgeRoot } from '@vostride/agent-qa-core'
import type { FunctionCaller } from '@vostride/agent-qa-schema'

import { loadConfigFile, loadEnvOverrides, resolveConfig } from '../config.js'
import { resolveCliJobModel } from '../llm-utils.js'
import { buildConfigVisibilityOracle } from './config-visibility.js'
import { buildMaskedResolvedConfig } from './masked-config.js'

/**
 * The CLI's caller record.
 *
 * Full local grants: an operator at their own terminal already has every power the CLI can
 * exercise, so withholding a scope here would be theatre. Grant ISSUANCE — who may mint which
 * scopes, and how a remote caller proves them — is the M5 run-invocation / cloud-auth model's job;
 * this constant is the local composition's minting site.
 */
export const CLI_FUNCTION_CALLER: FunctionCaller = {
  surface: 'cli',
  grantedScopes: ['read', 'run', 'config-write'],
  safeMode: false,
}

/**
 * The `config.get` binding, and the T-384-07 / T-384-17 mitigation site.
 *
 * The resolved configuration is flattened and masked HERE, so the only configuration value that
 * ever crosses into the function layer is already masked. `loadAuthPlugins: false` keeps the read a
 * read: resolving a capability must not load and execute plugin code.
 *
 * This is also where the disclosure rule gets its authority. `AgentQaConfigSchema` is walked ONCE,
 * here at the composition root, into the visibility oracle the masker consults per entry — so the
 * masker decides what is secret by what the schema declares free-form rather than by a list of
 * paths it would have to keep correct.
 */
export function createMaskedConfigReader(configPath: string): ConfigReaderPort {
  const visibility = buildConfigVisibilityOracle(AgentQaConfigSchema)
  return {
    async getMasked() {
      const resolved = await resolveConfig({ configPath, loadAuthPlugins: false })
      return buildMaskedResolvedConfig({
        configPath,
        resolved,
        visibility,
        // Ascending precedence, mirroring `resolveConfig`'s own merge order. `cli-flag` is
        // absent because the `fn` invoker passes no configuration flags; `test-file` never
        // participates in a project-level config read.
        layers: [
          { source: 'config-file', values: await loadConfigFile(configPath) },
          { source: 'env', values: loadEnvOverrides() },
        ],
      })
    },
  }
}

export interface ComposeCliLocalAgentInput {
  /** The project's runtime root, i.e. `<configDir>/.agent-qa`. */
  agentQaRoot: string
  /** The configuration file this invocation resolves against. */
  configPath: string
}

/**
 * Compose the local host as the CLI supplies it.
 *
 * The three arguments are the three host decisions the shared composition refuses to make on a
 * host's behalf: which configuration is in force and how it is masked, where knowledge is served
 * from, and which model a job authors with. Everything else — the runs reader, the knowledge
 * listing, the registry, the queue, the store — is the shared function, so the CLI and 386's
 * daemon cannot drift.
 */
export function composeCliLocalAgent(input: ComposeCliLocalAgentInput): LocalAgentHost {
  return composeLocalAgent({
    agentQaRoot: input.agentQaRoot,
    config: createMaskedConfigReader(input.configPath),
    knowledgeRoot: async () => {
      const config = await resolveConfig({ configPath: input.configPath, loadAuthPlugins: false })
      return resolveKnowledgeRoot(config.knowledge, dirname(resolve(input.configPath)))
    },
    // Deferred, and never called by a host that only invokes a function op: the queue is opened by
    // `jobs()` and nothing else resolves a provider handle.
    model: () => resolveCliJobModel(input.configPath),
  })
}
