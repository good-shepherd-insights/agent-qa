import { expectTypeOf, test } from 'vitest'
import { MODEL_USAGE_ROLES, ModelUsageRoleSchema } from '../index'
import type { ModelUsage, ModelUsageRole, ModelUsageObservations } from '../index'
import type { z } from 'zod'

test('C423-MODEL-ROLES-EXACT: type roles are literally planner and verifier', () => {
  type Expected = 'planner' | 'verifier'
  expectTypeOf<ModelUsageRole>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof MODEL_USAGE_ROLES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<z.infer<typeof ModelUsageRoleSchema>>().toEqualTypeOf<Expected>()
  expectTypeOf<keyof ModelUsage['roles']>().toEqualTypeOf<Expected>()
  expectTypeOf<ModelUsageObservations['attempts'][number]['role']>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<ModelUsageRole, (typeof MODEL_USAGE_ROLES)[number]>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<(typeof MODEL_USAGE_ROLES)[number], ModelUsageRole>>().toEqualTypeOf<never>()
})
