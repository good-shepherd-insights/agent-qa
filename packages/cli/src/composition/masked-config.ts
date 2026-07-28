// The `config.get` masker (Phase 384, Plan 03 — T-384-07; Plan 08 — CR-01; Plan 10 — BL-02).
//
// Masking happens HERE, while each entry is constructed, and the secret is dropped rather
// than carried and redacted later: a `MaskedResolvedConfig` that exists cannot leak a secret
// regardless of what a surface does with it. Every value is rendered to a string at
// construction precisely so no value type can bypass the mask.
//
// The rule, stated positively and completely, with no clause carrying an unlisted
// exception:
//
//   A configuration value is VISIBLE only where the config schema constrains both its key
//   and its value type. Everywhere else it is masked.
//
// That sentence is decided by the injected visibility oracle, which derives the answer by
// walking the config schema itself (see the sibling config-visibility module). Two classes
// of path are therefore masked UNCONDITIONALLY, and neither is a list this file maintains:
//   - a path through an operator-named record with a free-form value — the free-form
//     credential records the schema declares, whichever ones exist on the day it runs;
//   - a path the schema does not describe at all, which the walk cannot vouch for.
//
// A second, ADDITIVE credential-name census then runs over the schema-constrained
// remainder, where it is a heuristic over a small closed key space rather than the
// load-bearing rule. It reads the value-bearing LEAF segment, so a constrained leaf is
// judged by its own name: `plugins.auth.<n>.package` names in-process code and stays
// visible, while `services.auth.token` does not. The single named carve-out is applied
// before it. The census can only ADD masking; it can never make an opaque path visible.
//
// A value that survives both is then RENDERED, and the render is itself a rule — one with
// a PRECONDITION, stated here rather than assumed away. Userinfo, query string and fragment
// are the parts of a URL that belong to no key, so nothing that reads key names reaches
// them; every decision below is taken from the VALUE's own structure instead, which is why
// none of it depends on recognising the next parameter name. The rule has two branches, and
// which one runs is decided by whether the URL parser will resolve the value ABSOLUTELY:
//
//   - RESOLVES. The value is re-rendered as `scheme://host[:port]/path` when it carries any
//     of the three parts, and the three are dropped regardless of their names. A value
//     carrying none of them is returned unchanged, so nothing is normalised behind an
//     operator's back. One case inside this branch is not what it looks like: a scheme the
//     parser treats as OPAQUE resolves with an empty host and no userinfo slot, so a
//     credential written before the first `@` lands in the path where the three-part check
//     cannot see it. An empty host together with an `@` in the raw value therefore DROPS.
//
//   - DOES NOT RESOLVE. A protocol-relative, host-relative or path-relative value has no
//     absolute rendering to reduce it to, and it can still carry all three parts. It is
//     re-probed against a placeholder base; if the probe finds userinfo, a query string or
//     a fragment, the value is DROPPED to the mask placeholder rather than returned
//     unchanged. Only if even the based probe throws does a scan for the three characters
//     that introduce those parts decide it. This is the module's own doctrine applied to
//     the parser: a value it cannot vouch for is not published.
//
// An entry whose render altered the value is flagged `masked: true`, because the operator's
// raw value is not what the caller is reading.
//
// Over-masking is the accepted cost, and the schema rule makes it concrete:
// `registry.providers.<name>.baseURL` is masked because it sits inside a free-form record,
// while the sibling `registry.llms.<n>.baseURL` is schema-constrained and stays visible
// under the render rule above. An over-masked entry is visibly flagged `masked: true`; an
// under-masked one is a silent disclosure. What no part of this file reaches is named where
// it lives rather than restated here: see the census note below for the one residual class
// — a credential subtree the schema fully constrains whose leaf names are innocuous — with
// a reproducible example.
//
// This module imports nothing but the shared contract vocabulary package and a sibling
// type, so it is legal under the FUNC-02 surface firewall with no ledger entry —
// new-in-384 code must never need one.

import {
  CONFIG_MASK_PLACEHOLDER,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
} from '@vostride/agent-qa-schema'
import type {
  ConfigValueSource,
  MaskedConfigEntry,
  MaskedResolvedConfig,
} from '@vostride/agent-qa-schema'

import type { ConfigVisibilityOracle } from './config-visibility.js'

/**
 * Substrings that make a configuration key secret-shaped.
 *
 * Half of the ADDITIVE census. Being a SUBSTRING relation, it only reaches names that
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
 * Named carve-outs from the CENSUS — a deliberate, auditable list, never a weakening of the
 * schema rule, which no carve-out can reach.
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
 * The other half of the census. The term scan above is a containment relation, so it never
 * reaches a name shorter than its terms: `'key'.includes('apikey')` is false, and a config
 * leaf literally called `key`, `pwd`, or `pat` therefore rendered in plaintext. These are
 * the short names that carry the whole meaning by themselves.
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

function normalizeSegment(segment: string): string {
  return segment.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
}

/**
 * The ADDITIVE credential-name census: does this path's own leaf name a credential?
 *
 * Scope is deliberate. The census reads the VALUE-BEARING leaf — the last non-numeric
 * segment — and not its ancestors, because a name census cannot tell a credential from a
 * package name and an ancestor scan made it guess: `plugins.auth.<n>.package` is the
 * identity of code that runs in-process with full Node access, and the word `auth` three
 * segments up was the entire reason it was hidden.
 *
 * What the narrowing costs, stated rather than denied. The ancestor property this used to
 * carry — a secret nested under a credentials block masked even when its own key is
 * innocuous — is carried by the schema rule for the paths the schema does NOT vouch for: an
 * undeclared path is masked whatever its segments are called, and a path inside a free-form
 * record is masked whatever its leaf is called. Those two cases are covered more strongly
 * than before, because they no longer depend on any list of words.
 *
 * The case that is NOT covered is the remainder: a credential subtree the schema fully
 * constrains, whose leaf names are innocuous. Extending the config schema with
 * `vault: z.object({ region, value, clientId }).strict()` yields `vault.value` and
 * `vault.clientId` VISIBLE — the schema vouches for the path and the census does not
 * recognise either leaf. Nothing in this file detects that; it is closed by the schema
 * describing such a block as free-form, or by the census learning the leaf, and it is named
 * here so the limitation is read rather than assumed away.
 */
export function isSecretConfigKey(key: string): boolean {
  if (NON_SECRET_KEYS.has(key)) return false

  const segments = key
    .split('.')
    .filter((segment) => !/^\d+$/u.test(segment))
    .map(normalizeSegment)

  const leaf = segments.at(-1)
  if (leaf === undefined) return false

  return (
    SECRET_KEY_SEGMENTS.has(leaf) ||
    SECRET_KEY_TERMS.some((term) => leaf.includes(term))
  )
}

/**
 * The whole disclosure decision for one dot-path, in the order the header states it.
 *
 * The schema verdict comes first and is unconditional; the name census is additive over the
 * schema-constrained remainder. There is no third clause and no carve-out that can rescue
 * an opaque path — `NON_SECRET_KEYS` is a carve-out from the CENSUS only.
 */
export function isMaskedConfigPath(
  key: string,
  visibility: ConfigVisibilityOracle,
): boolean {
  return visibility.isOpaque(key) || isSecretConfigKey(key)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A rendered value, and whether rendering it altered what the operator wrote. */
interface RenderedValue {
  value: string
  altered: boolean
}

/**
 * Does this value carry a part that belongs to no configuration key?
 *
 * Asked of values the parser will not resolve absolutely, where there is no host to read
 * and no scheme to trust. Re-probing against a placeholder base gives the platform parser
 * back the one thing it was missing — an origin — and lets it answer from the value's own
 * structure: a protocol-relative value keeps its userinfo, a relative one keeps its query
 * and fragment, and an ordinary string acquires none of them by being resolved. The base is
 * a reserved-TLD name, so nothing here can resolve to a host that exists.
 *
 * The character scan is the last resort, and only for a value even that probe rejects. It
 * over-masks by construction, which is the direction this module accepts.
 *
 * A scoped package name is the collision worth stating: `@scope/name` carries an `@` and is
 * not a URL, but resolved against a base its `@` lands in the PATH and all four parts come
 * back empty, so it stays visible — a package that loads in-process with full Node access is
 * exactly what a configuration triage read must show.
 */
function carriesSecretBearingParts(value: string): boolean {
  try {
    const probe = new URL(value, 'https://placeholder.invalid')
    return probe.username !== ''
      || probe.password !== ''
      || probe.search !== ''
      || probe.hash !== ''
  } catch {
    return value.includes('@') || value.includes('?') || value.includes('#')
  }
}

/**
 * Reduce a value the parser vouches for to `scheme://host[:port]/path`; drop one it does not.
 *
 * Userinfo, query string and fragment are dropped from an absolute URL regardless of the
 * names they were given. All three are parts of a URL that belong to no configuration key,
 * so no rule that reads key names can reach them — which is how a password in the userinfo,
 * a credential in a query parameter and a token in a fragment each rode out in turn through
 * schema-constrained, legitimately-visible fields.
 *
 * Every decision here reads the VALUE's own structure and never a parameter's name. A
 * vocabulary of credential-ish parameter names is the same object that failed three times at
 * the path level: whatever it lists, an operator's next parameter has a different name. This
 * rule has nothing to be stale about, and it is deliberately written with no example
 * parameter name in it, so a test corpus can be measured against these bytes and shown to
 * come from outside them.
 *
 * The PRECONDITION is the part that was missing, and stating it is the point: the reduce
 * branch only ever ran for values `new URL(value)` accepts with no base. Three ordinary
 * forms it rejects — protocol-relative, host-relative, path-relative — reached the catch and
 * were published unchanged, and a fourth (an opaque scheme, whose credential rides in the
 * path with an empty host) satisfied the all-empty early return. Both now DROP to the mask
 * placeholder: a value with no absolute rendering to reduce to is not returned unaltered,
 * because publishing what the parser could not read is the failure this module exists to
 * prevent. A value carrying no such part is still returned byte-for-byte as written.
 */
function renderUrlWithoutSecrets(value: string): RenderedValue {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return carriesSecretBearingParts(value)
      ? { value: CONFIG_MASK_PLACEHOLDER, altered: true }
      : { value, altered: false }
  }
  // An opaque-path URL has no userinfo slot and no host, so anything written before the
  // first `@` sits in the path where the four-field check below cannot see it.
  if (url.host === '' && value.includes('@')) {
    return { value: CONFIG_MASK_PLACEHOLDER, altered: true }
  }
  if (url.username === '' && url.password === '' && url.search === '' && url.hash === '') {
    return { value, altered: false }
  }
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return { value: url.toString(), altered: true }
}

/**
 * Render one leaf, then apply the URL rule to the RENDERED string.
 *
 * The order is the point. An earlier version tested `typeof value === 'string'` before
 * stripping, so a leaf that renders as a URL without being a string skipped the rule
 * entirely. The rule now reads what a caller will actually see, so the input's runtime type
 * decides nothing.
 */
function renderValue(value: unknown): RenderedValue {
  const rendered = typeof value === 'string'
    ? value
    : JSON.stringify(value) ?? String(value)
  return renderUrlWithoutSecrets(rendered)
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
  /**
   * The schema-derived verdict for every dot-path. REQUIRED, and deliberately so: a
   * default would be a masker that silently stops applying its own primary rule.
   */
  visibility: ConfigVisibilityOracle
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
      const pathMasked = isMaskedConfigPath(key, input.visibility)
      // The path decision comes first and is unconditional; only a value that survives it is
      // rendered at all, and the render can still alter it.
      const rendered = pathMasked ? undefined : renderValue(value)
      let source: ConfigValueSource = 'default'
      for (const layer of layers) {
        if (layer.keys.has(key)) source = layer.source
      }
      return {
        key,
        // The secret is DROPPED here. It is never placed in the DTO and removed downstream.
        value: rendered?.value ?? CONFIG_MASK_PLACEHOLDER,
        source,
        // True whenever the operator's raw value is ABSENT — the placeholder, or a URL the
        // render structurally reduced. An alteration a caller cannot see is a caller
        // trusting bytes that are not what the config says.
        masked: rendered === undefined || rendered.altered,
      }
    })

  return {
    schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
    configPath: input.configPath,
    entries,
  }
}
