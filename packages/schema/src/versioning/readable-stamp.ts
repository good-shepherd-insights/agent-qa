import { z } from 'zod'

export const PRE_V2_STAMP = 1 as const

export type ReadableStamp<C extends number> = typeof PRE_V2_STAMP | C

export function readableStamp<const C extends number>(current: C) {
  return z.union([z.literal(PRE_V2_STAMP), z.literal(current)])
}

export function isReadableStamp<C extends number>(
  value: unknown,
  current: C,
): value is ReadableStamp<C> {
  return value === PRE_V2_STAMP || value === current
}
