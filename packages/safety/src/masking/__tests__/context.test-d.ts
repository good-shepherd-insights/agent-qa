import { expectTypeOf } from 'vitest'
import type { MaskingContext } from '@vostride/agent-qa-schema'

import { createMaskingContext, type MaskCategory } from '../../index'

expectTypeOf(createMaskingContext()).toMatchTypeOf<MaskingContext>()
expectTypeOf<MaskCategory>().toEqualTypeOf<'SECRET' | 'EMAIL'>()
