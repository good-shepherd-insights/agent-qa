import { expectTypeOf } from 'vitest'
import type { ModelCapabilities } from '../capability/model-capabilities'
import type { ElementBounds } from '../screen/element-bounds'
import type { ScreenStateMetadata } from '../screen/metadata'
import type { BoundingBox, Point } from '../primitives/index'

const full: ScreenStateMetadata = {
  captureMode: 'full',
  coordSpace: 'viewport',
  viewportWidth: 1,
  viewportHeight: 1,
  scroll: { offsetX: 0, offsetY: 0, contentWidth: 1, contentHeight: 1 },
  imageWidth: 1920,
  imageHeight: 1080,
}

// @ts-expect-error textOnly captures carry no image dimensions (SC5 / D-01 / D-03).
const bad: ScreenStateMetadata = { captureMode: 'textOnly', coordSpace: 'viewport', viewportWidth: 1, viewportHeight: 1, scroll: { offsetX: 0, offsetY: 0, contentWidth: 1, contentHeight: 1 }, imageWidth: 1920 }

expectTypeOf<ModelCapabilities>().toEqualTypeOf<{ vision: boolean }>()
expectTypeOf<ElementBounds['bounds']>().toEqualTypeOf<BoundingBox>()
expectTypeOf<ElementBounds['center']>().toEqualTypeOf<Point>()

// SCR-01/02/03 assertions are added in 311-03 with ScreenState and ElementInfo.

void full
void bad
