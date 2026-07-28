// The `config.get` masker (Phase 384, Plan 03 — T-384-07).
//
// Masking happens HERE, while each entry is constructed, and the secret is dropped rather
// than carried and redacted later: a `MaskedResolvedConfig` that exists cannot leak a secret
// regardless of what a surface does with it. Every value is rendered to a string at
// construction precisely so no value type can bypass the mask.
//
// This module imports nothing but `@vostride/agent-qa-schema`, so it is legal under the
// FUNC-02 surface firewall with no ledger entry — new-in-384 code must never need one.

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
 * The check is FAIL-CLOSED: it runs over every non-numeric path segment, not just the leaf,
 * so a secret nested under a `credentials` block is masked even when its own key is
 * innocuous. Over-masking a path-shaped key such as `workspace.secretsFile` is the accepted
 * cost — an over-masked entry is visibly flagged `masked: true`, while an under-masked one
 * is a silent disclosure.
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

function normalizeSegment(segment: string): string {
  return segment.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
}

/** True when a dot-path names, or lives beneath, a secret-shaped key. */
export function isSecretConfigKey(key: string): boolean {
  if (NON_SECRET_KEYS.has(key)) return false
  return key
    .split('.')
    .filter((segment) => !/^\d+$/u.test(segment))
    .map(normalizeSegment)
    .some((segment) => SECRET_KEY_TERMS.some((term) => segment.includes(term)))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') return value
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
