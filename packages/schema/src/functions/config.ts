import { z } from 'zod'

export const MASKED_RESOLVED_CONFIG_SCHEMA_VERSION = 1

/**
 * The single placeholder a masked configuration value renders as. Kept a constant so the
 * masker (plan 03), the surfaces, and the conformance suite all agree on one literal and a
 * reader can never mistake a mask for a real value.
 */
export const CONFIG_MASK_PLACEHOLDER = '[masked]'

/**
 * Which layer supplied the winning value for a resolved configuration key.
 *
 * A clean machine vocabulary rather than the CLI's existing human debug labels
 * (`global config` / `test yaml` / `cli flag`): those are display strings with spaces,
 * and this union crosses surface boundaries and projects into JSON Schema.
 */
export type ConfigValueSource =
  | 'default'
  | 'config-file'
  | 'env'
  | 'cli-flag'
  | 'test-file'

/**
 * One resolved configuration key/value pair, already masked (Phase 384, D-06/D-16).
 *
 * SECURITY CONTRACT (T-384-06, masked-at-the-boundary): when `masked` is true, the
 * operator's raw value is ABSENT from this entry, and it was absent from the moment the
 * entry was constructed — never carried in this DTO and redacted downstream. It is absent
 * by one of THREE routes:
 *   - the whole PATH is opaque, and `value` is {@link CONFIG_MASK_PLACEHOLDER};
 *   - the path is visible but the RENDER could not reduce the value — an address field with
 *     no absolute rendering — and `value` is {@link CONFIG_MASK_PLACEHOLDER} too;
 *   - the path is visible and the render REDUCED the value, so `value` is present but is a
 *     structural remainder of what the operator wrote (today, an address field rendered as
 *     `scheme://host[:port]`).
 *
 * `masked: true` therefore means exactly one thing — "this is not the operator's raw value"
 * — and carries no information about WHICH rule removed it. In particular the placeholder no
 * longer implies path opacity: a fully visible, schema-constrained path can render as the
 * placeholder, so a consumer must not read a cause out of it.
 *
 * What that guarantees, stated as the relation it actually is rather than as a totality:
 * masking is applied while the entry is CONSTRUCTED, under the composition's visibility,
 * census and render rules, so a surface holding a `MaskedResolvedConfig` cannot undo it —
 * there is nothing to undo, the raw value was never placed here. The guarantee is therefore
 * the CONSTRUCTION rule's, and it is exactly as wide as that rule: the masker names its own
 * residual limitations where they live (its census note carries one, with a reproducible
 * example), and this DTO inherits whatever bound those state rather than asserting a
 * narrower one of its own. It does not claim the masker has exactly one blind spot.
 *
 * `value` is always a rendered string (numbers, booleans, and nested values are stringified
 * at construction) so masking is total and uniform: there is no value type that bypasses it.
 */
export interface MaskedConfigEntry {
  /** Dot-path key into the resolved configuration tree. */
  key: string
  /** The rendered value, the mask placeholder, or a reduced render — see `masked`. */
  value: string
  source: ConfigValueSource
  /**
   * True iff `value` is NOT the operator's raw value — the mask placeholder (by either
   * route above), or a render that structurally reduced it.
   */
  masked: boolean
}

/**
 * The `config.get` result: the masked, provenance-annotated resolved configuration read
 * that seeds 395's config class (Phase 384, D-06/D-16).
 *
 * A flat entry list rather than a nested tree — provenance is per-leaf, and a flat list is
 * the shape both a table renderer and a JSON-Schema projection want.
 */
export interface MaskedResolvedConfig {
  schemaVersion: number
  /** The configuration file the read resolved against, as the caller addressed it. */
  configPath: string
  entries: MaskedConfigEntry[]
}

const configValueSourceValues = [
  'default',
  'config-file',
  'env',
  'cli-flag',
  'test-file',
] as const satisfies readonly ConfigValueSource[]

export const MaskedConfigEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
  source: z.enum(configValueSourceValues),
  masked: z.boolean(),
}).strict() satisfies z.ZodType<MaskedConfigEntry>

export const MaskedResolvedConfigSchema = z.object({
  schemaVersion: z.number().int().positive(),
  configPath: z.string(),
  entries: z.array(MaskedConfigEntrySchema),
}).strict() satisfies z.ZodType<MaskedResolvedConfig>

/**
 * `config.get` takes no arguments in the seed slice. A `.strict()` empty object rather than
 * `z.void()` so a key-path filter becomes an additive field later without changing the op's
 * input contract shape.
 */
export const ConfigGetInputSchema = z.object({}).strict()

export type ConfigGetInput = z.infer<typeof ConfigGetInputSchema>
