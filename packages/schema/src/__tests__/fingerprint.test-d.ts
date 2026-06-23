import { expectTypeOf } from 'vitest'
import { screenIdentityHash, screenStateHash } from '../determinism/screen-hash'
import type { ScreenState } from '../screen/screen-state'

expectTypeOf(screenIdentityHash).parameter(0).toEqualTypeOf<ScreenState>()
expectTypeOf(screenIdentityHash).returns.toEqualTypeOf<string>()

expectTypeOf(screenStateHash).parameter(0).toEqualTypeOf<ScreenState>()
expectTypeOf(screenStateHash).returns.toEqualTypeOf<string>()

const fingerprintExports = {
  screenIdentityHash,
  screenStateHash,
}

expectTypeOf(fingerprintExports).toEqualTypeOf<{
  screenIdentityHash: (state: ScreenState) => string
  screenStateHash: (state: ScreenState) => string
}>()

void fingerprintExports
