// The `config.get` masker (Phase 384, Plan 03 — T-384-07; Plan 08 — CR-01; Plan 10 — BL-02;
// Plan 13 — CR-02/CR-03; Phase 429 Plan 07 — D-08).
//
// Masking happens HERE, while each entry is constructed, and the secret is dropped rather
// than carried and redacted later: a `MaskedResolvedConfig` that exists cannot leak a secret
// regardless of what a surface does with it. Every value is rendered to a string at
// construction precisely so no value type can bypass the mask.
//
// The rule, stated positively and completely, with no clause carrying an unlisted
// exception (429 D-08):
//
//   One hard-coded, path-keyed map decides masking. `classifyConfigPath` from the shared
//   contract package classifies each leaf as secret, env-var-name or plain by its schema path,
//   and the dashboard masks through the same map. A value is masked exactly when its path
//   classifies secret.
//
// Nothing is guessed from a key's spelling. Two classes of path are masked because the map
// says so, not because anyone recognised a word:
//   - a path through an open-ended container (provider headers, device-farm provider settings,
//     device `match` values, pass-rate attributes), which the map marks secret wholesale;
//   - a path the map does not describe at all, which classifies secret (fail closed).
// An env-var-name leaf names a variable and is shown in clear; its value is never read here.
// Paths are carried as segment arrays, so a dotted record key or model name is one segment.
//
// A value that survives the map is then RENDERED, and the render reads exactly one thing: the
// leaf's SCHEMA-DECLARED NAME. A leaf whose name is registered below as a URL address is
// reduced to `scheme://host[:port]`. Every other leaf is returned byte-for-byte, uninspected.
// The reduction is a `config show` render rule, never a masking class (429 A4): the dashboard
// edits the same address fields and does not apply it.
//
// That the render reads the NAME and never the value's own characters is the whole design,
// and it is the correction of a defect this module carried through three rewrites. "Does
// this string carry a secret" is not decidable from the string, and every attempt to decide
// it anyway lost on BOTH sides at once: the rule second-guessed values the path decision had
// already cleared — hiding a glob wildcard and a CSS selector from the one capability whose
// purpose is configuration triage — while a credential written into a component the
// reduction KEPT rode out under a rule that ran and reported success. What makes a field
// credential-bearing is its IDENTITY, the same evidence class the path map uses; and because
// a credential can ride in ANY component of a URL, the reduction keeps only the origin and
// discards path, userinfo, query and fragment together, as one act rather than as a list of
// parts to keep enumerating.
//
// Both failure directions then die structurally instead of by patch. An ordinary
// configuration string is never looked at, so no character an operator writes can hide it.
// A registered field keeps nothing but its origin — path, userinfo, query and fragment all
// go together, so there is no next component to discover. What the origin itself still
// carries is the HOST, and that is deliberate: an operator triaging a config has to see
// which host their LLM or target points at. A host is therefore trusted to be public, and a
// secret written into a hostname (a credential-bearing tunnel subdomain, say) is disclosed —
// a residue bounded and stated rather than denied. This file names no example URL
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
// What the pin does NOT reach is a plain leaf whose own name is innocuous. The pin makes a
// leaf's ARRIVAL visible; it cannot decide that an arrived leaf holds an address. An earlier
// revision of this comment named `services.mcp.host` as the example and was wrong in both
// directions — that field is refined to exactly `localhost`, `127.0.0.1` or `::1`, so the
// schema REFUSES a URL there, and it is the most constrained string leaf in the config rather
// than a plain one. The fields that would actually publish a credential URL if handed one are
// the ordinary plain leaves — a path, a directory, a build tag — and each is plain because the
// map says so, a class a human chose when the leaf arrived.
//
// Over-masking remains the accepted direction wherever the map decides, and the rule makes it
// concrete: `registry.providers.<name>.baseURL` is masked ENTIRELY because it sits inside a
// free-form record, while the sibling `registry.llms.<n>.baseURL` is plain and is reduced to
// its origin rather than dropped. An over-masked entry is visibly flagged `masked: true`; an
// under-masked one is a silent disclosure.
//
// This module imports nothing but the shared contract vocabulary package, so it is legal
// under the FUNC-02 surface firewall with no ledger entry — new-in-384 code must never need
// one.

import {
  CONFIG_MASK_PLACEHOLDER,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  classifyConfigPath,
} from '@vostride/agent-qa-schema'
import type {
  ConfigValueSource,
  MaskedConfigEntry,
  MaskedResolvedConfig,
} from '@vostride/agent-qa-schema'

/** One config path as segments: a string is an object key, a number an array index. */
export type ConfigPathSegments = readonly (string | number)[]

function normalizeSegment(segment: string): string {
  return segment.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
}

/** The whole disclosure decision for one path: the map alone, failing closed. */
export function isMaskedConfigPath(segments: ConfigPathSegments): boolean {
  return classifyConfigPath(segments) === 'secret'
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
 * Stored in NORMALIZED form, so a name is matched however the schema author cased or
 * punctuated it. Membership is arbitrated by what a name MEANS rather than by where a
 * credential has been seen — every one of these declares "this value is an address", and an
 * address can carry a credential in any of its components:
 *   - `url`, `baseurl` — the two the shipped config schema declares today, on the web
 *     target and on a model's compatible-provider base.
 *   - `appiumurl`, `webdriveragenturl` — declared on the platform and remote-device schemas,
 *     plain strings whose canonical device-farm value carries an access key in its userinfo.
 *     Registered because a name list is cheap and a disclosure is not.
 *   - `endpoint`, `uri`, `webhook` — registered PRE-EMPTIVELY, before the schema declares
 *     any of them. A name list costs over-masking when it is early and a disclosure when it
 *     is late, so it is deliberately early.
 *
 * The guard against this set going stale is a test, not a promise — and it guards ARRIVAL,
 * not membership: the companion suite pins every string-leaf PATH the shipped schema declares
 * and fails when the schema grows one, whatever the new leaf is called. It never consults this
 * set. So a NEW address leaf cannot land unnoticed, but a leaf already pinned and not
 * registered here stays visible and publishes what it is given.
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
 * Split, drop purely numeric segments, normalize and read the value-bearing leaf, so an array
 * index or an operator-chosen record key cannot change the answer —
 * `registry.targets.<name>.url` and `registry.llms.<n>.baseURL` are decided by `url` and
 * `baseURL`, exactly as their schema declares them.
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

interface FlatLeaf {
  segments: ConfigPathSegments
  value: unknown
}

/**
 * Flatten a configuration tree to dot-paths, keeping each path's segments beside it.
 *
 * Arrays are DESCENDED INTO with numeric index segments rather than treated as leaves, so a
 * secret sitting inside an array element is reached by the mask instead of being stringified
 * whole into a visible value. Empty containers stay leaves so they remain visible.
 */
function flatten(value: unknown): Map<string, FlatLeaf> {
  const flat = new Map<string, FlatLeaf>()

  const visit = (node: unknown, path: string, segments: (string | number)[]): void => {
    if (isPlainObject(node) && Object.keys(node).length > 0) {
      for (const [key, child] of Object.entries(node)) {
        visit(child, path === '' ? key : `${path}.${key}`, [...segments, key])
      }
      return
    }
    if (Array.isArray(node) && node.length > 0) {
      node.forEach((child, index) => {
        visit(child, path === '' ? String(index) : `${path}.${index}`, [...segments, index])
      })
      return
    }
    if (path !== '') flat.set(path, { segments, value: node })
  }

  visit(value, '', [])
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
    .map(([key, leaf]) => {
      const pathMasked = isMaskedConfigPath(leaf.segments)
      // The path decision comes first and is unconditional; only a value that survives it is
      // rendered at all, and the render — which reads the KEY, never the value's characters —
      // can still reduce it.
      const rendered = pathMasked ? undefined : renderValue(key, leaf.value)
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
