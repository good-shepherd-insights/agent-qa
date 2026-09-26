// 2026-09-26, 429-01 D-19/D-22: the field-merge write DTO behind PATCH /api/config. A change
// names one field by segments, never a dotted string, so a key holding a dot stays addressable
// and an outside edit to a sibling field is never rewritten.
import { z } from 'zod'

/** A mapping key, an array index, or a `{ name }` selector inside a named array. */
export type ConfigPathSegment = string | number | { name: string }

export const ConfigPathSegmentSchema = z.union([
  z.string().min(1),
  z.number().int().nonnegative(),
  z.object({ name: z.string().min(1) }).strict(),
])

const ConfigPathSchema = z.array(ConfigPathSegmentSchema).min(1)

export const ConfigChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), path: ConfigPathSchema, value: z.unknown() }).strict(),
  z.object({ op: z.literal('unset'), path: ConfigPathSchema }).strict(),
  z.object({ op: z.literal('append'), path: ConfigPathSchema, value: z.unknown() }).strict(),
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
