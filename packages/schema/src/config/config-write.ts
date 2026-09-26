// 2026-09-26, 429-01 D-19/D-22: the field-merge write DTO behind PATCH /api/config. A change
// names one field by segments, never a dotted string, so a key holding a dot stays addressable
// and an outside edit to a sibling field is never rewritten.
import { z } from 'zod'

/** What one change does to the field its path names. */
export type ConfigWriteOp = 'set' | 'unset' | 'append'
// prettier-ignore
export const CONFIG_WRITE_OPS = [
  'set',
  'unset',
  'append',
] as const satisfies readonly ConfigWriteOp[]

/**
 * Why a write was refused, as the route answers it.
 * - `invalid_write_input`: the body is not a well-formed change set.
 * - `file_invalid`: the file does not parse as YAML.
 * - `path_not_found`: a `{ name }` selector names no entry.
 * - `validation_failed`: the merged config fails whole-config validation.
 * - `mask_written_back`: a value carries the mask placeholder (Plan 05's guard).
 * - `write_failed`: the atomic write itself failed.
 */
export type ConfigWriteRefusal =
  | 'invalid_write_input'
  | 'file_invalid'
  | 'path_not_found'
  | 'validation_failed'
  | 'mask_written_back'
  | 'write_failed'
// prettier-ignore
export const CONFIG_WRITE_REFUSALS = [
  'invalid_write_input',
  'file_invalid',
  'path_not_found',
  'validation_failed',
  'mask_written_back',
  'write_failed',
] as const satisfies readonly ConfigWriteRefusal[]

/**
 * The only arrays a `{ name }` segment may select inside. Selecting by name rather than index
 * keeps a change on its entry when an outside edit reorders the list.
 */
export type ConfigNamedArray = 'registry.llms' | 'services.mcp.tokens' | 'services.dashboard.runServiceTokens'
// prettier-ignore
export const CONFIG_NAMED_ARRAYS = [
  'registry.llms',
  'services.mcp.tokens',
  'services.dashboard.runServiceTokens',
] as const satisfies readonly ConfigNamedArray[]

/** A mapping key, an array index, or a `{ name }` selector inside a named array. */
export type ConfigPathSegment = string | number | { name: string }

export const ConfigPathSegmentSchema = z.union([
  z.string().min(1),
  z.number().int().nonnegative(),
  z.object({ name: z.string().min(1) }).strict(),
])

const ConfigPathSchema = z.array(ConfigPathSegmentSchema).min(1)

const [SET_OP, UNSET_OP, APPEND_OP] = CONFIG_WRITE_OPS

export const ConfigChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal(SET_OP), path: ConfigPathSchema, value: z.unknown() }).strict(),
  z.object({ op: z.literal(UNSET_OP), path: ConfigPathSchema }).strict(),
  z.object({ op: z.literal(APPEND_OP), path: ConfigPathSchema, value: z.unknown() }).strict(),
])

export type ConfigChange = z.infer<typeof ConfigChangeSchema>

export const ConfigWriteRequestSchema = z.object({
  changes: z.array(ConfigChangeSchema).min(1),
  undoable: z.boolean().optional(),
}).strict()

export type ConfigWriteRequest = z.infer<typeof ConfigWriteRequestSchema>

export type ConfigWriteIssue = { path: (string | number)[]; message: string }

export type ConfigWriteResult = { revision: string; undo?: { token: string; expiresAt: number } }

/** The revision a config file that does not exist yet reports. */
export const CONFIG_REVISION_ABSENT = 'absent'
