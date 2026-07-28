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
// A value that survives both is then RENDERED, and the render is itself a rule. Anything
// whose rendered string parses as a URL is re-rendered as `scheme://host[:port]/path` and
// nothing else: userinfo, query string and fragment are dropped UNCONDITIONALLY, whatever
// they are called. Those three are the parts of a URL that belong to no key, so nothing
// that reads key names reaches them; the decision here reads the VALUE's own structure
// instead, which is why it does not depend on recognising the next parameter name. An
// entry whose render altered the value is flagged `masked: true`, because the operator's
// raw value is not what the caller is reading. A visible URL carrying none of the three is
// returned byte-identical.
//
// Over-masking is the accepted cost, and the schema rule makes it concrete: a provider's
// `baseURL` is masked because it sits inside a free-form record. An over-masked entry is
// visibly flagged `masked: true`; an under-masked one is a silent disclosure.
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
 * Re-render anything that parses as a URL as `scheme://host[:port]/path` and nothing else.
 *
 * Userinfo, query string and fragment are dropped UNCONDITIONALLY. All three are parts of a
 * URL that belong to no configuration key, so no rule that reads key names can reach them —
 * which is how a password in the userinfo, a credential in a query parameter and a token in
 * a fragment each rode out in turn through schema-constrained, legitimately-visible fields.
 *
 * The decision reads the VALUE's own structure — does it parse as a URL, and does it carry
 * any of those three parts — and never a parameter's name. A vocabulary of credential-ish
 * parameter names is the same object that failed three times at the path level: whatever it
 * lists, an operator's next parameter is called something else. This rule has nothing to be
 * stale about, and it is deliberately written with no example parameter name in it, so a
 * test corpus can be measured against these bytes and shown to come from outside them.
 *
 * Only a URL that actually carries one of the three is re-rendered; everything else is
 * returned byte-identical, so no ordinary value is normalised behind an operator's back.
 */
function renderUrlWithoutSecrets(value: string): RenderedValue {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { value, altered: false }
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
