import { expectTypeOf, test } from 'vitest'

import { GATE_REMEDY_SURFACES, GATE_REMEDY_SURFACES_BY_KIND } from '../../index'
import type { GateRemedySurface, RemedyKindFor } from '../../index'

type Members<K extends keyof typeof GATE_REMEDY_SURFACES_BY_KIND> =
  (typeof GATE_REMEDY_SURFACES_BY_KIND)[K][number]

test('C430-REMEDY-MEMBERSHIPS-EXACT', () => {
  expectTypeOf<Members<'answer-confirm'>>().toEqualTypeOf<'cli' | 'chat'>()
  expectTypeOf<Exclude<Members<'answer-confirm'>, 'cli' | 'chat'>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<'cli' | 'chat', Members<'answer-confirm'>>>().toEqualTypeOf<never>()

  expectTypeOf<Members<'trust-session-flag'>>().toEqualTypeOf<'cli'>()
  expectTypeOf<Exclude<Members<'trust-session-flag'>, 'cli'>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<'cli', Members<'trust-session-flag'>>>().toEqualTypeOf<never>()

  expectTypeOf<Members<'session-pin-final'>>().toEqualTypeOf<'chat'>()
  expectTypeOf<Exclude<Members<'session-pin-final'>, 'chat'>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<'chat', Members<'session-pin-final'>>>().toEqualTypeOf<never>()

  expectTypeOf<Members<'present-bearer-scope'>>().toEqualTypeOf<'mcp'>()
  expectTypeOf<Exclude<Members<'present-bearer-scope'>, 'mcp'>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<'mcp', Members<'present-bearer-scope'>>>().toEqualTypeOf<never>()
})

test('C430-REMEDY-SURFACES-EXACT', () => {
  type Expected = 'cli' | 'chat' | 'mcp' | 'dashboard' | 'run-service'
  expectTypeOf<GateRemedySurface>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof GATE_REMEDY_SURFACES)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<GateRemedySurface, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, GateRemedySurface>>().toEqualTypeOf<never>()
})

test('C430-DASHBOARD-PROJECTION-EMPTY', () => {
  expectTypeOf<RemedyKindFor<'dashboard'>>().toEqualTypeOf<never>()
  expectTypeOf<RemedyKindFor<'run-service'>>().toEqualTypeOf<never>()
})
