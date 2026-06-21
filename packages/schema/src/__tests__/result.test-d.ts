import { expectTypeOf } from 'vitest'
import type { ActionAnnotation, ActionResult, Viewport } from '../index'

expectTypeOf<ActionResult>().toEqualTypeOf<{
  success: boolean
  error?: string
  screenshot?: Uint8Array
  data?: unknown
  metadata?: Record<string, unknown>
  annotation?: ActionAnnotation
}>()

expectTypeOf<ActionResult['screenshot']>().toEqualTypeOf<Uint8Array | undefined>()
expectTypeOf<Viewport>().toEqualTypeOf<{ width: number; height: number }>()

// @ts-expect-error removed positional result key is rejected.
const invalidResultA: ActionResult = { success: true, coordinates: { x: 1, y: 2 } }

// @ts-expect-error removed positional result key is rejected.
const invalidResultB: ActionResult = { success: true, boundingBox: { x: 1, y: 2, width: 3, height: 4 } }

// @ts-expect-error removed positional result key is rejected.
const invalidResultC: ActionResult = { success: true, startCoordinates: { x: 1, y: 2 } }

// @ts-expect-error removed positional result key is rejected.
const invalidResultD: ActionResult = { success: true, endCoordinates: { x: 1, y: 2 } }

void invalidResultA
void invalidResultB
void invalidResultC
void invalidResultD
