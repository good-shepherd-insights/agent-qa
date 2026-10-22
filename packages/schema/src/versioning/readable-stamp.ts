import { z } from 'zod'

// 2026-10-22, 449.1: the one stamp a durable format wrote before V2 renumbered it to 2 (D-04).
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
