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
 * in one of two ways: `value` is {@link CONFIG_MASK_PLACEHOLDER} because the whole path is
 * masked, or `value` is a structurally reduced render of the real value — today, a URL
 * re-rendered as `scheme://host[:port]/path` with its userinfo, query string and fragment
 * dropped. Either way a reader holding `masked: true` knows not to treat `value` as what
 * the configuration says. Masking is applied while the entry is CONSTRUCTED, so a
 * `MaskedResolvedConfig` that exists cannot leak a secret regardless of what a surface does
 * with it.
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
   * True iff `value` is NOT the operator's raw value — either the mask placeholder, or a
   * render that structurally reduced it (a URL stripped of userinfo, query and fragment).
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
