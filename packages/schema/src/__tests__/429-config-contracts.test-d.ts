import { expectTypeOf, test } from 'vitest'
import {
  CONFIG_NAMED_ARRAYS,
  CONFIG_WRITE_OPS,
  CONFIG_WRITE_REFUSALS,
  MASKING_CLASSES,
  PROVIDER_ERROR_CLASSES,
} from '../index'
import type {
  ConfigChange,
  ConfigNamedArray,
  ConfigPathSegment,
  ConfigWriteOp,
  ConfigWriteRefusal,
  MaskingClass,
  ProviderErrorClass,
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

test('C429-MASKING-CLASSES-EXACT', () => {
  type Expected = 'secret' | 'env-var-name' | 'plain'
  expectTypeOf<MaskingClass>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof MASKING_CLASSES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<MaskingClass, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, MaskingClass>>().toEqualTypeOf<never>()
})

test('C429-PROVIDER-ERROR-CLASSES-EXACT', () => {
  type Expected =
    | 'auth_error'
    | 'model_not_found'
    | 'rate_limit'
    | 'network_error'
    | 'invalid_request'
    | 'provider_error'
  expectTypeOf<ProviderErrorClass>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof PROVIDER_ERROR_CLASSES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<ProviderErrorClass, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, ProviderErrorClass>>().toEqualTypeOf<never>()
})
