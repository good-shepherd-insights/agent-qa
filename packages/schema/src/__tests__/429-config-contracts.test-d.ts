import { expectTypeOf, test } from 'vitest'
import { CONFIG_NAMED_ARRAYS, CONFIG_WRITE_OPS, CONFIG_WRITE_REFUSALS } from '../index'
import type {
  ConfigChange,
  ConfigNamedArray,
  ConfigPathSegment,
  ConfigWriteOp,
  ConfigWriteRefusal,
} from '../index'

test('C429-CONFIG-WRITE-OPS-EXACT', () => {
  type Expected = 'set' | 'unset' | 'append'
  expectTypeOf<ConfigWriteOp>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof CONFIG_WRITE_OPS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<ConfigWriteOp, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, ConfigWriteOp>>().toEqualTypeOf<never>()
  expectTypeOf<ConfigChange['op']>().toEqualTypeOf<Expected>()
  expectTypeOf<ConfigChange['path'][number]>().toEqualTypeOf<ConfigPathSegment>()
})

test('C429-CONFIG-WRITE-REFUSALS-EXACT', () => {
  type Expected =
    | 'invalid_write_input'
    | 'file_invalid'
    | 'path_not_found'
    | 'validation_failed'
    | 'mask_written_back'
    | 'write_failed'
  expectTypeOf<ConfigWriteRefusal>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof CONFIG_WRITE_REFUSALS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<ConfigWriteRefusal, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, ConfigWriteRefusal>>().toEqualTypeOf<never>()
})

test('C429-CONFIG-NAMED-ARRAYS-EXACT', () => {
  type Expected = 'registry.llms' | 'services.mcp.tokens' | 'services.dashboard.runServiceTokens'
  expectTypeOf<ConfigNamedArray>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof CONFIG_NAMED_ARRAYS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<ConfigNamedArray, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, ConfigNamedArray>>().toEqualTypeOf<never>()
})
