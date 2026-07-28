// CLI composition root for the function layer (Phase 384, Plan 01).
//
// `packages/agent` is storageNeutral — it may not touch `node:*`. Every host capability
// the ops need is built HERE over the concrete storage implementations and handed to the
// registry as an injected port. Phase 386's `composeLocalAgent()` supersedes this file.

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { createFunctionRegistry } from '@vostride/agent-qa-agent'
import type { FunctionRegistry, RunsReaderPort } from '@vostride/agent-qa-agent'
import {
  HANDOFF_FILE,
  RUNS_SUBDIR,
  loadCompletedRunHandoff,
} from '@vostride/agent-qa-runner-local'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import type { CompletedRunHandoff, FunctionCaller } from '@vostride/agent-qa-schema'

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
  return {
    list(): Promise<readonly CompletedRunHandoff[]> {
      const runsDir = join(agentQaRoot, RUNS_SUBDIR)
      if (!existsSync(runsDir)) {
        return Promise.resolve([])
      }

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
      return Promise.resolve(documents)
    },
  }
}

export interface FunctionRegistryCompositionInput {
  /** The project's runtime root, i.e. `<configDir>/.agent-qa`. */
  agentQaRoot: string
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
    deps: { runs: createRunsReader(input.agentQaRoot) },
    auditSink: new JsonlAuditSink(input.agentQaRoot),
  })
}
