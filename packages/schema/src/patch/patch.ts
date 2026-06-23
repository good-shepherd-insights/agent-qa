import { z } from 'zod'

import { asPatchId } from './patch-id'
import type { PatchId } from './patch-id'

export type PatchStatus = 'proposed' | 'approved' | 'applied' | 'rejected' | 'failed'

export interface Hunk {
  header: string
  lines: string[]
}

export interface FileChange {
  path: string
  changeKind: 'add' | 'modify' | 'delete'
  hunks: Hunk[]
}

export interface Patch {
  id: PatchId
  status: PatchStatus
  summary: string
  changes: FileChange[]
  payloadHash?: `sha256:${string}`
}

const patchStatusValues = [
  'proposed',
  'approved',
  'applied',
  'rejected',
  'failed',
] as const satisfies readonly PatchStatus[]

const changeKindValues = ['add', 'modify', 'delete'] as const satisfies readonly FileChange['changeKind'][]

const patchIdSchema = z.string().transform(asPatchId)

const payloadHashSchema = z
  .string()
  .regex(/^sha256:/)
  .transform((value) => value as `sha256:${string}`)

const hunkSchema = z.object({
  header: z.string(),
  lines: z.array(z.string()),
}).strict()

const fileChangeSchema = z.object({
  path: z.string(),
  changeKind: z.enum(changeKindValues),
  hunks: z.array(hunkSchema),
}).strict()

export const patchSchema = z.object({
  id: patchIdSchema,
  status: z.enum(patchStatusValues),
  summary: z.string(),
  changes: z.array(fileChangeSchema),
  payloadHash: payloadHashSchema.optional(),
}).strict()
