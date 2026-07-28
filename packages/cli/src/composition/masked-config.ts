// The `config.get` masker (Phase 384, Plan 03 — T-384-07; hardened in Plan 08 — CR-01).
//
// Masking happens HERE, while each entry is constructed, and the secret is dropped rather
// than carried and redacted later: a `MaskedResolvedConfig` that exists cannot leak a secret
// regardless of what a surface does with it. Every value is rendered to a string at
// construction precisely so no value type can bypass the mask.
//
// The rule an entry is judged by, in the order it is applied:
//   1. a named carve-out list, checked first, which is the only way a path stays visible
//      once a later rule would have matched it;
//   2. PROVENANCE — a path under either of the two free-form credential records (a provider
//      config, or a provider-headers map) is masked unconditionally, because the operator
//      names those keys and so the name carries no information about secrecy;
//   3. the key NAME — an exact match against a set of whole credential segments, plus a
//      substring scan for the longer credential terms, over every non-numeric segment.
// Values that survive all three are still rendered with any URL userinfo stripped, so a
// credential smuggled into a visible URL does not ride out on a field no rule masks.
//
// Over-masking is the accepted cost, and rule 2 makes that concrete: a provider's `baseURL`
// is masked even though it is not a secret. An over-masked entry is visibly flagged
// `masked: true`; an under-masked one is a silent disclosure.
//
// This module imports nothing but the schema package, so it is legal under the FUNC-02
// surface firewall with no ledger entry — new-in-384 code must never need one.

import {
  CONFIG_MASK_PLACEHOLDER,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  ConfigValueSource,
  MaskedConfigEntry,
  MaskedResolvedConfig,
} from '@vostride/agent-qa-schema'

/**
 * Substrings that make a configuration key secret-shaped.
 *
 * One of the three rules `isSecretConfigKey` applies. It runs over every non-numeric path
 * segment, not just the leaf, so a secret nested under a `credentials` block is masked even
 * when its own key is innocuous. Being a SUBSTRING relation, it only reaches names that
 * contain a term — a bare `key` segment is caught by the exact-segment set below instead.
 */
const SECRET_KEY_TERMS = [
  'accesskey',
  'apikey',
  'authorization',
  'bearer',
  'credential',
  'passphrase',
  'passwd',
  'password',
  'privatekey',
  'secret',
  'sessionkey',
  'token',
] as const

/**
 * Named carve-outs from the term scan above — a deliberate, auditable list, never a
 * weakening of the rule.
 *
 * `knowledge.contextBudgetTokens` is a token COUNT: it has no relation to a credential and
 * masking it would hide a number an operator needs to read. `workspace.secretsFile` is
 * deliberately NOT excepted — it names a file that holds credentials, so masking its path is
 * defence in depth rather than a false positive.
 */
const NON_SECRET_KEYS: ReadonlySet<string> = new Set([
  'knowledge.contextBudgetTokens',
])

/**
 * Whole credential segments, matched EXACTLY rather than as substrings.
 *
 * The term scan above is a containment relation, so it never reaches a name shorter than
 * its terms: `'key'.includes('apikey')` is false, and a config leaf literally called `key`,
 * `pwd`, or `pat` therefore rendered in plaintext. These are the short names that carry the
 * whole meaning by themselves.
 */
const SECRET_KEY_SEGMENTS: ReadonlySet<string> = new Set([
  'key',
  'keys',
  'auth',
  'pass',
  'pwd',
  'pat',
  'sig',
  'cred',
  'creds',
])

/**
 * The free-form records whose keys an OPERATOR names, not the schema.
 *
 * Everything beneath one of these is masked unconditionally. Both subtrees exist precisely
 * to carry provider credentials under names the schema cannot anticipate, so the key name
 * is not evidence of anything: a rule that consulted it would be guessing. Judging by
 * PROVENANCE instead is what makes the masker fail closed over them, and it is why a
 * provider's `baseURL` is masked — under an opaque subtree there are no exceptions.
 */
const PROVIDER_HEADERS_SEGMENT = 'providerheaders'
const PROVIDER_CONFIG_PATH = ['registry', 'providers'] as const

function normalizeSegment(segment: string): string {
  return segment.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
}

/** True when the path lies inside one of the operator-named credential records. */
function isUnderOpaqueSubtree(segments: readonly string[]): boolean {
  if (segments.includes(PROVIDER_HEADERS_SEGMENT)) return true
  return (
    segments.length > PROVIDER_CONFIG_PATH.length &&
    PROVIDER_CONFIG_PATH.every((expected, index) => segments[index] === expected)
  )
}

/** True when a dot-path names, or lives beneath, a secret-shaped key. */
export function isSecretConfigKey(key: string): boolean {
  if (NON_SECRET_KEYS.has(key)) return false

  const segments = key
    .split('.')
    .filter((segment) => !/^\d+$/u.test(segment))
    .map(normalizeSegment)

  if (isUnderOpaqueSubtree(segments)) return true

  return segments.some((segment) => (
    SECRET_KEY_SEGMENTS.has(segment) ||
    SECRET_KEY_TERMS.some((term) => segment.includes(term))
  ))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Strip the credential a URL can carry in its userinfo.
 *
 * A password sitting between the scheme and the host belongs to no key, so no name-based
 * rule can ever see it — which is exactly how one rode out through a schema-constrained,
 * legitimately-visible `baseURL`. Only a URL that actually carries userinfo is re-rendered;
 * everything else is returned byte-identical, so no ordinary value is normalised behind an
 * operator's back.
 */
function stripUrlUserinfo(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return value
  }
  if (url.username === '' && url.password === '') return value
  url.username = ''
  url.password = ''
  return url.toString()
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') return stripUrlUserinfo(value)
  const serialized = JSON.stringify(value)
  return serialized ?? String(value)
}

/**
 * Flatten a configuration tree to dot-paths.
 *
 * Arrays are DESCENDED INTO with numeric index segments rather than treated as leaves, so a
 * secret sitting inside an array element is reached by the mask instead of being stringified
 * whole into a visible value. Empty containers stay leaves so they remain visible.
 */
function flatten(value: unknown, prefix = ''): Map<string, unknown> {
  const flat = new Map<string, unknown>()

  const visit = (node: unknown, path: string): void => {
    if (isPlainObject(node) && Object.keys(node).length > 0) {
      for (const [key, child] of Object.entries(node)) {
        visit(child, path === '' ? key : `${path}.${key}`)
      }
      return
    }
    if (Array.isArray(node) && node.length > 0) {
      node.forEach((child, index) => {
        visit(child, path === '' ? String(index) : `${path}.${index}`)
      })
      return
    }
    if (path !== '') flat.set(path, node)
  }

  visit(value, prefix)
  return flat
}

export interface ConfigLayer {
  source: ConfigValueSource
  /** The raw, unflattened contribution of this layer. */
  values: unknown
}

export interface BuildMaskedResolvedConfigInput {
  /** The configuration file the read resolved against, as the caller addressed it. */
  configPath: string
  /** The merged, schema-validated configuration the entries describe. */
  resolved: unknown
  /**
   * Contributing layers in ASCENDING precedence order — the last layer carrying a key owns
   * its provenance. A key no layer supplied came from a schema default.
   */
  layers: readonly ConfigLayer[]
}

export function buildMaskedResolvedConfig(
  input: BuildMaskedResolvedConfigInput,
): MaskedResolvedConfig {
  const layers = input.layers.map((layer) => ({
    source: layer.source,
    keys: new Set(flatten(layer.values).keys()),
  }))

  const entries: MaskedConfigEntry[] = [...flatten(input.resolved).entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => {
      const masked = isSecretConfigKey(key)
      let source: ConfigValueSource = 'default'
      for (const layer of layers) {
        if (layer.keys.has(key)) source = layer.source
      }
      return {
        key,
        // The secret is DROPPED here. It is never placed in the DTO and removed downstream.
        value: masked ? CONFIG_MASK_PLACEHOLDER : renderValue(value),
        source,
        masked,
      }
    })

  return {
    schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
    configPath: input.configPath,
    entries,
  }
}
