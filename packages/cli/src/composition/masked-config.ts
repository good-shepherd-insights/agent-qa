// The `config.get` masker (Phase 384, Plan 03 — T-384-07; Plan 08 — CR-01; Plan 10 — BL-02;
// Plan 13 — CR-02/CR-03).
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
// A value that survives both is then RENDERED, and the render reads exactly one thing: the
// leaf's SCHEMA-DECLARED NAME. A leaf whose name is registered below as a URL address is
// reduced to `scheme://host[:port]`. Every other leaf is returned byte-for-byte, uninspected.
//
// That the render reads the NAME and never the value's own characters is the whole design,
// and it is the correction of a defect this module carried through three rewrites. "Does
// this string carry a secret" is not decidable from the string, and every attempt to decide
// it anyway lost on BOTH sides at once: the rule second-guessed values the oracle and the
// census had already cleared — hiding a glob wildcard and a CSS selector from the one
// capability whose purpose is configuration triage — while a credential written into a
// component the reduction KEPT rode out under a rule that ran and reported success. What
// makes a field credential-bearing is its IDENTITY, which is the same evidence class the
// census above already uses and trusts; and because a credential can ride in ANY component
// of a URL, the reduction keeps only the origin and discards path, userinfo, query and
// fragment together, as one act rather than as a list of parts to keep enumerating.
//
// Both failure directions then die structurally instead of by patch. An ordinary
// configuration string is never looked at, so no character an operator writes can hide it.
// A registered field keeps nothing but its origin — path, userinfo, query and fragment all
// go together, so there is no next component to discover. What the origin itself still
// carries is the HOST, and that is deliberate: an operator triaging a config has to see
// which host their LLM or target points at. A host is therefore trusted to be public, and a
// secret written into a hostname (a credential-bearing tunnel subdomain, say) is disclosed —
// the residue named at the census note below, bounded and stated rather than denied. This
// file names no example URL
// parameter and no example credential value, so a test corpus can be measured against these
// bytes and shown to come from outside them.
//
// An entry whose render altered the value is flagged `masked: true`, because the operator's
// raw value is not what the caller is reading. The disclosed cost, stated here rather than
// discovered later: a registered field loses its path even when the path is innocuous, so a
// base address renders as its bare origin and is flagged. The host — the part an operator
// actually triages with — is kept, and a registered value that already IS its origin comes
// back byte-identical and unflagged, so the reduction is never a silent normalisation.
//
// A registered NAME LIST can go stale, and that objection is answered by the build rather
// than by care: the companion test walks the shipped config schema and PINS every dot-PATH it
// declares a string-bearing value at. It does not filter the walk by an address-word pattern
// first, and it does not key on names — either would be tested from inside this file's own
// vocabulary, which is the mistake the render rule stopped making, repeated one level up. A
// pattern catches only a name the vocabulary already knows; a name pin misses a NEW field
// reusing a pinned name. Keyed on paths, ANY leaf added to the schema reddens the pin whatever
// it is called and wherever it sits, and a human then registers it below or records it inert —
// the same move this phase already made for the agent barrel's export set and for the gate's
// call-site count.
//
// What the pin does NOT reach is the class the census note below already states correctly and
// with a reproducible example: a schema-constrained leaf whose own name is innocuous. The pin
// makes a leaf's ARRIVAL visible; it cannot decide that an arrived leaf holds an address. An
// earlier revision of this comment named `services.mcp.host` as the example and was wrong in
// both directions — that field is refined to exactly `localhost`, `127.0.0.1` or `::1`, so the
// schema REFUSES a URL there, and it is the most constrained string leaf in the config rather
// than a plain one. The fields that would actually publish a credential URL if handed one are
// the ordinary constrained leaves — a path, a directory, a build tag — which is precisely the
// census note's class, not a second one.
//
// Over-masking remains the accepted direction wherever the SCHEMA decides, and the rule
// makes it concrete: `registry.providers.<name>.baseURL` is masked ENTIRELY because it sits
// inside a free-form record, while the sibling `registry.llms.<n>.baseURL` is
// schema-constrained and is reduced to its origin rather than dropped. An over-masked entry
// is visibly flagged `masked: true`; an under-masked one is a silent disclosure. The
// census's own blind spot is named where it lives rather than restated here: see the census
// note below, with a reproducible example.
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
 * The leaf NAMES whose values are URL addresses, and are therefore reduced to their origin.
 *
 * Stored in the same NORMALIZED form the census above uses, so a name is matched however the
 * schema author cased or punctuated it. Membership is arbitrated by what a name MEANS rather
 * than by where a credential has been seen — every one of these declares "this value is an
 * address", and an address can carry a credential in any of its components:
 *   - `url`, `baseurl` — the two the shipped config schema declares today, on the web
 *     target and on a model's compatible-provider base.
 *   - `appiumurl`, `webdriveragenturl` — declared on the platform and remote-device schemas,
 *     plain strings whose canonical device-farm value carries an access key in its userinfo.
 *     Registered because a name census is cheap and a disclosure is not.
 *   - `endpoint`, `uri`, `webhook` — registered PRE-EMPTIVELY, before the schema declares
 *     any of them. A name list costs over-masking when it is early and a disclosure when it
 *     is late, so it is deliberately early.
 *
 * The guard against this set going stale is a test, not a promise — and it guards ARRIVAL,
 * not membership: the companion suite pins every string-leaf PATH the shipped schema declares
 * and fails when the schema grows one, whatever the new leaf is called. It never consults this
 * set. So a NEW address leaf cannot land unnoticed, but a leaf already pinned and not
 * registered here stays visible and publishes what it is given — which is the census note's
 * residual class above, reached from the other side.
 */
export const CREDENTIAL_BEARING_URL_LEAVES: ReadonlySet<string> = new Set([
  'appiumurl',
  'baseurl',
  'endpoint',
  'uri',
  'url',
  'webdriveragenturl',
  'webhook',
])

/**
 * Is this path's own leaf one of the registered URL names?
 *
 * The traversal is the census's, deliberately: split, drop purely numeric segments, normalize
 * and read the value-bearing leaf. Reusing it means an array index or an operator-chosen
 * record key cannot change the answer — `registry.targets.<name>.url` and
 * `registry.llms.<n>.baseURL` are decided by `url` and `baseURL`, exactly as their schema
 * declares them.
 */
export function isCredentialBearingUrlField(key: string): boolean {
  const leaf = key
    .split('.')
    .filter((segment) => !/^\d+$/u.test(segment))
    .map(normalizeSegment)
    .at(-1)
  if (leaf === undefined) return false
  return CREDENTIAL_BEARING_URL_LEAVES.has(leaf)
}

/**
 * Reduce a registered address to `scheme://host[:port]`, or drop it.
 *
 * The only value parsing this module performs, and it runs ONLY for a field already known
 * from its name to hold an address — so nothing here is deciding whether a value is secret.
 * It is deciding which part of a known address is safe to show, and the answer is the origin:
 * every other component is somewhere a credential has already been found riding.
 *
 * A value with no absolute rendering to reduce TO is dropped to the placeholder rather than
 * published. That covers the parser's rejections (protocol-relative, host-relative and
 * path-relative forms) and the case that parses but yields no host (a scheme the parser
 * treats as opaque, whose whole remainder lands in the path). Publishing what the parser
 * could not read is the failure this module exists to prevent.
 *
 * `url.host` already carries the port, so it is never appended separately. A value that
 * already IS its origin is returned byte-identical and unaltered; anything else comes back
 * through the parser, which normalises as well as removes — it case-folds the host, drops a
 * default `:443`/`:80`, punycodes an IDN and strips a trailing slash. Those are rewrites of
 * the operator's bytes, not just deletions, which is why every one of them is flagged
 * `masked: true` rather than passed off as unchanged.
 */
function reduceToOrigin(value: string): RenderedValue {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { value: CONFIG_MASK_PLACEHOLDER, altered: true }
  }
  if (url.host === '') return { value: CONFIG_MASK_PLACEHOLDER, altered: true }
  const origin = `${url.protocol}//${url.host}`
  return origin === value ? { value, altered: false } : { value: origin, altered: true }
}

/**
 * Render one leaf to a string, then apply the NAME rule to it.
 *
 * The order is the point, and it is a closed finding rather than an incidental detail. An
 * earlier version tested `typeof value === 'string'` before applying the rule, so a leaf that
 * renders as a URL without being a string skipped it entirely. The rule reads what a caller
 * will actually see, so the input's runtime type decides nothing — and the KEY decides
 * everything, so the rendered characters decide nothing either.
 */
function renderValue(key: string, value: unknown): RenderedValue {
  const rendered = typeof value === 'string'
    ? value
    : JSON.stringify(value) ?? String(value)
  return isCredentialBearingUrlField(key)
    ? reduceToOrigin(rendered)
    : { value: rendered, altered: false }
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
      // rendered at all, and the render — which reads the KEY, never the value's characters —
      // can still reduce it.
      const rendered = pathMasked ? undefined : renderValue(key, value)
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
