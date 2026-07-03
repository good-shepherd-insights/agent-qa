import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import type { Ref } from '@vostride/agent-qa-schema'
import { refSchema } from '../actions/index.js'

expectTypeOf<z.infer<ReturnType<typeof refSchema>>>().toEqualTypeOf<Ref>()

const optionalRefSchema = refSchema('Optional current-screen element reference').optional()
expectTypeOf<z.infer<typeof optionalRefSchema>>().toEqualTypeOf<Ref | undefined>()

// @ts-expect-error Zod's literal brand is not assignable to schema Ref.
const literalBrandIsNotSchemaRef: Ref = z.string().brand<'Ref'>().parse('e1')
void literalBrandIsNotSchemaRef
