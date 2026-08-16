// `init --agent`: the machine entry point (Phase 398 plan 08, D-16 · XPLN-01 / XPLN-03).
//
// WHAT AN EXTERNAL AGENT GETS FROM ONE READ. Every capability this product has, in the words a
// person reads; the v1 tool names that no longer exist and what answers those needs instead; and
// what THIS workspace grants, hides and would accept. Local, non-interactive, idempotent: it opens
// no prompt, writes no file and reaches no network.
//
// THE MANIFEST IS A LOAD, NOT A DERIVATION, and that is the whole of why SC-1's "the same manifest"
// clause is a measurement rather than a promise. `loadCapabilityCatalog()` reads the committed
// bytes; the rows and the migration map cross into the output VERBATIM. There is no second recipe
// here that could be improved out of agreement with the artifact, which is why `manifest ≡ catalog`
// can be a suite cell at all.
//
// 2026-08-17 — UNFILTERED BY DESIGN (D-16, prohibition P1). Every row is emitted, for every caller,
// with no scope filter applied anywhere below. This is DELIBERATE and it is not a hole: the manifest
// documents what EXISTS and what unlocks it, while per-caller filtering is enforced live at the MCP
// `tools/list` seam and nowhere else (D-05's visibility law). Filtering here would put the
// visibility law in a second place, and the two would agree until the day one of them was improved.
// Reading this file as a grant list is the misreading T-398-03 names; the emitted `$note` says so in
// the document itself, so a reader who never opens this source still learns it.
//
// REFS-ONLY IS STRUCTURAL, NOT REMEMBERED (395 D-11, T-398-17). The posture reports declared
// credentials by env-var NAME. It gets them from the CONFIGURATION, whose schema has no member a
// value could occupy, and it never calls `resolveMcpTokens` — the one function in this product that
// turns a declared name into a credential. So there is no code path from this module to a secret,
// rather than a rule about one; the sentinel-absence cell in `conformance/manifest.test.ts` is what
// keeps that true as the file changes.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import type {
  AgentManifest,
  AgentManifestPosture,
  AgentManifestTokenRef,
} from '@vostride/agent-qa-schema'

import { resolveConfig } from '../config.js'
import { CLI_FUNCTION_CALLER } from '../composition/local-agent-host.js'
import { DEFAULT_MCP_SCOPES } from '../composition/mcp-token-resolution.js'
import { loadCapabilityCatalog } from './loader.js'

/**
 * What the manifest says about itself, appended to the catalog's own note.
 *
 * IN THE DOCUMENT AND NOT ONLY IN THIS SOURCE, deliberately. The reader this file exists for is an
 * agent that will never open a `.ts` file; a warning it cannot see is a warning aimed at the wrong
 * person. The catalog's note already carries the describes-does-not-gate law for the rows; these two
 * lines carry it for the manifest as a whole, including the posture.
 */
export const AGENT_MANIFEST_NOTE: readonly string[] = Object.freeze([
  'THIS MANIFEST IS UNFILTERED AND IT IS NOT A GRANT LIST (2026-08-17, D-16). Every capability is',
  'listed for every reader. What a particular caller may SEE and DO is decided live at the MCP',
  '`tools/list` seam from that caller\'s scopes, and nowhere else — so a row appearing here is not a',
  'permission, and `posture.defaultScopes` describes the local unauthenticated default rather than',
  'your grant. `posture.tokenEnvRefs` names environment VARIABLES, never their contents.',
])

/** What `buildAgentManifest` needs from the outside: a config path, or nothing. */
export interface AgentManifestInput {
  /** Where this workspace's configuration lives. Defaults to the conventional file under `cwd`. */
  readonly configPath?: string
}

/**
 * The declared credentials, as names.
 *
 * The config entries are ALREADY refs-only by schema (`McpTokenEntrySchema` has no member a value
 * could occupy and refuses one strictly), so this is a projection of names onto names. It is written
 * as an explicit field-by-field copy rather than a spread for one reason worth stating: a spread
 * would silently carry whatever member the config schema grew next, and the member this manifest
 * must never carry is precisely the one somebody would add in a hurry.
 */
function tokenEnvRefsOf(
  entries: readonly { name: string; tokenEnvVar: string; scopes: readonly string[] }[],
): readonly AgentManifestTokenRef[] {
  return entries.map((entry) => ({
    name: entry.name,
    tokenEnvVar: entry.tokenEnvVar,
    scopes: [...entry.scopes] as AgentManifestTokenRef['scopes'],
  }))
}

/**
 * The whole manifest: the committed catalog, the projected map, and this workspace's posture.
 *
 * TOLERANT OF A MISSING OR BROKEN CONFIGURATION, AND SAYS WHICH OF THE TWO. `init --agent` is the
 * command an agent runs in a directory that is not a project yet — that is what `init` is for — so
 * neither state is an error here. They are told apart by whether the FILE EXISTS, which is a fact
 * about the filesystem rather than a fact read out of an exception message: `absent` means run
 * `init`, `unresolved` means fix the file, and reporting either as `resolved` with no credentials
 * would say "this workspace declares none" about a workspace nobody could read.
 *
 * NOT TOLERANT OF A MISSING CATALOG. A broken install throws {@link
 * CapabilityCatalogUnavailableError} with the regen instruction, because the alternative — an empty
 * manifest — presents a broken install as a product that can do nothing, which is the one failure
 * mode this artifact's loader was written to refuse.
 */
export async function buildAgentManifest(
  input: AgentManifestInput = {},
): Promise<AgentManifest> {
  const catalog = loadCapabilityCatalog()

  const configPath = resolve(input.configPath ?? 'agent-qa.config.yaml')
  let tokenEnvRefs: readonly AgentManifestTokenRef[] = []
  // The two failing arms are told apart BEFORE the read, by whether the file is there. Deciding it
  // afterwards would mean reading the failure's message to classify it, and a message is exactly
  // what must not travel here.
  let configuration: AgentManifestPosture['configuration'] =
    existsSync(configPath) ? 'unresolved' : 'absent'
  if (configuration === 'unresolved') {
    try {
      // `loadAuthPlugins: false` keeps the read a read: resolving a posture must not load and
      // execute plugin code, on the reasoning `createMaskedConfigReader` already states next door.
      const config = await resolveConfig({ configPath, loadAuthPlugins: false })
      configuration = 'resolved'
      tokenEnvRefs = tokenEnvRefsOf(config.services?.mcp?.tokens ?? [])
    } catch {
      // The reason is deliberately NOT carried into the manifest — see the doc comment above.
      configuration = 'unresolved'
    }
  }

  return {
    $note: [...catalog.$note, ...AGENT_MANIFEST_NOTE],
    // VERBATIM, both of them. No filter, no re-sort, no re-shape — see this file's header.
    rows: catalog.rows,
    migrationMap: catalog.migrationMap,
    posture: {
      // THE SHIPPED CONSTANT, IMPORTED. A scope list spelled here would be a second answer to
      // "what does a local caller get", and it would be right on the day it was written: 396 D-07's
      // set is DERIVED from the closed scope union by excluding `config-write`, so a scope minted
      // tomorrow joins it there and would not join a copy.
      defaultScopes: [...DEFAULT_MCP_SCOPES],
      // Likewise read from the composition that mints it rather than restated. Every local
      // composition root in this product mints `false` — safe mode is a listing filter a HOST turns
      // on, and no local host does — and reading the constant is what keeps this line honest on the
      // day one of them starts.
      safeMode: CLI_FUNCTION_CALLER.safeMode,
      tokenEnvRefs: [...tokenEnvRefs],
      configuration,
    },
  }
}
