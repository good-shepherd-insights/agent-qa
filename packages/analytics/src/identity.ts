// The anonymous identity store (Phase 398 plan 06 task 3, D-17 · ANLY-01).
//
// RE-HOMED, NOT RE-INVENTED. This module moves out of `packages/core/src/analytics/identity.ts`
// with its mechanics intact: the same `id-agent` word id, the same `analytics.json` store under
// `~/.agent-qa/` with the `XDG_DATA_HOME` override, the same two-key record. That sameness is the
// whole feature. A re-derivation is free to improve a shape nobody has persisted yet, but this one
// is already on disk in every install that has ever run the CLI, and any drift in the id scheme or
// the path would present as every existing user becoming a brand-new user — an irreversible break
// disguised as a refactor. The one thing that changed is which package owns it.
//
// WHAT IS NOT HERE, and stays not here (prohibition P3). The record is `{distinctId, is_internal}`
// and nothing else. No hostname, no username, no cwd, no repo slug, no project path. Each of those
// is individually defensible and collectively a fingerprint, which is the only reason the boundary
// is stated as an exact set rather than a list of things to avoid: the identity cell reads the
// record back off disk and pins its key set, so a widening is a red rather than a review comment.
//
// The identity is resolved, not decided. Whether anything is SENT is `compose.ts`'s call and only
// `compose.ts`'s call; this module answers "who, anonymously" for a port that has already been told
// it may speak.

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { idAgent } from 'id-agent'
import { ANALYTICS_AGENT_PRODUCTS, ANALYTICS_RUNTIME_CONTEXTS } from './events.js'

/**
 * The runtime contexts and agent products, read off the union's OWN vocabularies.
 *
 * Restating these as a second literal list is how the reported `agent_product` and the accepted
 * `agent_product` drift apart: the union would keep refusing a value this module happily resolved,
 * and the only symptom would be events silently failing to parse. `unknown` is excluded from the
 * detected set on purpose — it is the union's arm for an agent nobody has taught this table about,
 * never something the detector below returns.
 */
export type AnalyticsRuntimeContext = (typeof ANALYTICS_RUNTIME_CONTEXTS)[number]
export type AnalyticsAgentProduct = Exclude<(typeof ANALYTICS_AGENT_PRODUCTS)[number], 'unknown'>

/** The id scheme, named so a cell can assert it rather than a reader having to trust a comment. */
export const ANALYTICS_USER_ID_PREFIX = 'u'
export const ANALYTICS_USER_ID_WORDS = 10

/** What a resolved identity is, before anything decides whether to send on its behalf. */
export interface ResolvedAnalyticsIdentity {
  distinctId: string
  runtimeContext: AnalyticsRuntimeContext
  agentProduct?: AnalyticsAgentProduct
  isInternal?: boolean
}

/** The on-disk record. Two keys, carried verbatim, and the exact set a cell pins. */
export interface AnalyticsIdentityStore {
  distinctId: string
  is_internal: boolean
}

interface ParsedAnalyticsIdentityStore extends AnalyticsIdentityStore {
  needsMigration: boolean
}

export interface ResolveAnalyticsIdentityOptions {
  env?: Record<string, string | undefined>
  identityPath?: string
  homeDir?: string
}

// The shape a stored id must have to be adopted: the prefix, then ten hyphen-joined words. A record
// that fails this is not repaired, it is refused — see `readAnalyticsIdentity`.
const LOCAL_ANALYTICS_ID_PATTERN = /^u_([a-z]+-){9}[a-z]+$/

export function getAnalyticsIdentityPath(
  env: Record<string, string | undefined> = process.env,
  homeDir = homedir(),
): string {
  if (env.XDG_DATA_HOME) return join(env.XDG_DATA_HOME, 'agent-qa', 'analytics.json')
  return join(homeDir, '.agent-qa', 'analytics.json')
}

export function generateAnalyticsUserId(): string {
  return idAgent({ prefix: ANALYTICS_USER_ID_PREFIX, words: ANALYTICS_USER_ID_WORDS })
}

function parseAnalyticsIdentityStore(value: unknown): ParsedAnalyticsIdentityStore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const distinctId = (value as { distinctId?: unknown }).distinctId
  if (typeof distinctId !== 'string' || !LOCAL_ANALYTICS_ID_PATTERN.test(distinctId)) return null
  const rawIsInternal = (value as { is_internal?: unknown }).is_internal
  return {
    distinctId,
    is_internal: rawIsInternal === true,
    needsMigration: typeof rawIsInternal !== 'boolean',
  }
}

async function readAnalyticsIdentityStore(path?: string): Promise<ParsedAnalyticsIdentityStore | null> {
  const identityPath = path ?? getAnalyticsIdentityPath()
  try {
    const data = await readFile(identityPath, 'utf-8')
    const parsed = JSON.parse(data) as unknown
    return parseAnalyticsIdentityStore(parsed)
  } catch {
    return null
  }
}

export async function readAnalyticsIdentity(path?: string): Promise<AnalyticsIdentityStore | null> {
  const parsed = await readAnalyticsIdentityStore(path)
  return parsed ? { distinctId: parsed.distinctId, is_internal: parsed.is_internal } : null
}

export async function writeAnalyticsIdentity(
  distinctId: string,
  path?: string,
  isInternal = false,
): Promise<void> {
  const identityPath = path ?? getAnalyticsIdentityPath()
  await mkdir(dirname(identityPath), { recursive: true })
  // The object literal below IS the record contract — two keys, written whole every time, so a
  // migration cannot leave a stale third key behind from an older writer.
  await writeFile(
    identityPath,
    JSON.stringify({ distinctId, is_internal: isInternal }, null, 2),
    { mode: 0o600 },
  )
  await chmod(identityPath, 0o600)
}

export function resolveAnalyticsAgentProduct(
  env: Record<string, string | undefined> = process.env,
): AnalyticsAgentProduct | undefined {
  if (env.CLAUDECODE !== undefined || env.CLAUDE_CODE_ENTRYPOINT !== undefined) return 'claude_code'
  if (env.CURSOR_AGENT !== undefined) return 'cursor'
  if (env.GEMINI_CLI !== undefined) return 'gemini_cli'
  if (env.AUGMENT_AGENT !== undefined) return 'augment'
  if (env.GOOSE_TERMINAL !== undefined || env.AGENT === 'goose') return 'goose'
  if (env.OPENCODE_CLIENT !== undefined) return 'opencode'
  if (env.CODEX_SANDBOX !== undefined) return 'codex'
  if (env.CLINE_ACTIVE !== undefined) return 'cline'
  if (env.AGENT === 'amp') return 'amp'
  return undefined
}

function hasUnknownAgentSignal(env: Record<string, string | undefined>): boolean {
  return typeof env.AGENT === 'string' && env.AGENT.length > 0
}

/**
 * The one entry point a composition root calls.
 *
 * The CI and agent arms short-circuit BEFORE any disk access, which is what keeps a build runner or
 * a coding agent from minting — and persisting — a per-container identity that would count as a new
 * user on every job. They are shared constants on purpose: they identify a class, not a machine.
 */
export async function resolveAnalyticsIdentity(
  options: ResolveAnalyticsIdentityOptions = {},
): Promise<ResolvedAnalyticsIdentity> {
  const env = options.env ?? process.env
  if (env.CI === 'true') {
    return { distinctId: 'u_CI', runtimeContext: 'ci' }
  }

  const agentProduct = resolveAnalyticsAgentProduct(env)
  if (agentProduct) {
    return {
      distinctId: `u_AGENT-${agentProduct}`,
      runtimeContext: 'agent',
      agentProduct,
    }
  }

  if (hasUnknownAgentSignal(env)) {
    return { distinctId: 'u_AGENT', runtimeContext: 'agent' }
  }

  const identityPath = options.identityPath ?? getAnalyticsIdentityPath(env, options.homeDir)
  const existing = await readAnalyticsIdentityStore(identityPath)
  if (existing) {
    // A pre-`is_internal` install is rewritten in place, keeping its id. Re-minting here would be
    // the data loss this whole module exists to avoid, so the migration is a rewrite, never a reset.
    if (existing.needsMigration) {
      await writeAnalyticsIdentity(existing.distinctId, identityPath, existing.is_internal)
    }
    return {
      distinctId: existing.distinctId,
      runtimeContext: 'user',
      isInternal: existing.is_internal,
    }
  }

  const distinctId = generateAnalyticsUserId()
  await writeAnalyticsIdentity(distinctId, identityPath)
  return { distinctId, runtimeContext: 'user', isInternal: false }
}
