// CLI composition root for the function layer (Phase 384, Plan 01).
//
// `packages/agent` is storageNeutral — it may not touch `node:*`. Every host capability
// the ops need is built HERE over the concrete storage implementations and handed to the
// registry as an injected port. Phase 386's `composeLocalAgent()` supersedes this file.

import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { createFunctionRegistry } from '@vostride/agent-qa-agent'
import type {
  ConfigReaderPort,
  FunctionRegistry,
  KnowledgeReaderPort,
  RunsReaderPort,
} from '@vostride/agent-qa-agent'
import { resolveKnowledgeRoot } from '@vostride/agent-qa-core'
import { listBundles } from '@vostride/agent-qa-knowledge-local/reader'
import {
  HANDOFF_FILE,
  RUNS_SUBDIR,
  loadCompletedRunHandoff,
} from '@vostride/agent-qa-runner-local'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import type {
  CompletedRunHandoff,
  FunctionCaller,
  RunId,
} from '@vostride/agent-qa-schema'

import { loadConfigFile, loadEnvOverrides, resolveConfig } from '../config.js'
import { buildMaskedResolvedConfig } from './masked-config.js'

/**
 * The CLI's caller record.
 *
 * Full local grants: an operator at their own terminal already has every power the CLI
 * can exercise, so withholding a scope here would be theatre. Grant ISSUANCE — who may
 * mint which scopes, and how a remote caller proves them — is the M5 run-invocation /
 * cloud-auth model's job; this constant is the local composition's minting site.
 */
export const CLI_FUNCTION_CALLER: FunctionCaller = {
  surface: 'cli',
  grantedScopes: ['read', 'run', 'config-write'],
  safeMode: false,
}

/**
 * Enumerate `<agentQaRoot>/runs/<slug>/handoff.json`. A project with no runs directory
 * is an ordinary empty result, not an error; an individual unreadable or version-rejected
 * document is skipped so one bad run never hides every other run.
 */
export function createRunsReader(agentQaRoot: string): RunsReaderPort {
  function enumerate(): CompletedRunHandoff[] {
    const runsDir = join(agentQaRoot, RUNS_SUBDIR)
    if (!existsSync(runsDir)) return []

    const documents: CompletedRunHandoff[] = []
    for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const handoffPath = join(runsDir, entry.name, HANDOFF_FILE)
      if (!existsSync(handoffPath)) continue
      try {
        documents.push(loadCompletedRunHandoff(handoffPath))
      } catch {
        continue
      }
    }
    return documents
  }

  return {
    list(): Promise<readonly CompletedRunHandoff[]> {
      return Promise.resolve(enumerate())
    },
    /**
     * Resolution runs over the ENUMERATED run documents and matches on the recorded
     * `runId`, never by joining the caller's string onto a path (T-384-08): a `runId` of
     * `../../etc` can therefore address nothing outside the runs directory, because it is
     * never used to build a path at all.
     */
    get(runId: RunId): Promise<CompletedRunHandoff | undefined> {
      return Promise.resolve(enumerate().find((document) => document.runId === runId))
    },
  }
}

/**
 * The knowledge listing is served through the PHYSICALLY read-only `/reader` package entry.
 * The writer-gated main entry is unreachable from this composition, and the arch
 * reader-carve-out rule enforces that rather than leaving it to discipline.
 */
export function createKnowledgeReader(configPath: string): KnowledgeReaderPort {
  return {
    async listBundles() {
      const config = await resolveConfig({ configPath, loadAuthPlugins: false })
      return listBundles(resolveKnowledgeRoot(config.knowledge, dirname(resolve(configPath))))
    },
  }
}

/**
 * The `config.get` binding, and the T-384-07 mitigation site.
 *
 * The resolved configuration is flattened and masked HERE, so the only configuration value
 * that ever crosses into the function layer is already masked. `loadAuthPlugins: false`
 * keeps the read a read: resolving a capability must not load and execute plugin code.
 */
export function createMaskedConfigReader(configPath: string): ConfigReaderPort {
  return {
    async getMasked() {
      const resolved = await resolveConfig({ configPath, loadAuthPlugins: false })
      return buildMaskedResolvedConfig({
        configPath,
        resolved,
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

export interface FunctionRegistryCompositionInput {
  /** The project's runtime root, i.e. `<configDir>/.agent-qa`. */
  agentQaRoot: string
  /** The configuration file this invocation resolves against. */
  configPath: string
}

/**
 * Function-layer invocations audit at the PROJECT root (`<agentQaRoot>/execution_audit.jsonl`),
 * not inside a per-run directory: a capability call is not scoped to any run, and several of
 * them (config reads, registry listings) happen with no run in existence. This follows the v48
 * `execution_audit.jsonl` conventions — same row shape, same sink, project-level file.
 */
export function createFunctionRegistryComposition(
  input: FunctionRegistryCompositionInput,
): FunctionRegistry {
  return createFunctionRegistry({
    deps: {
      runs: createRunsReader(input.agentQaRoot),
      knowledge: createKnowledgeReader(input.configPath),
      config: createMaskedConfigReader(input.configPath),
    },
    auditSink: new JsonlAuditSink(input.agentQaRoot),
  })
}
