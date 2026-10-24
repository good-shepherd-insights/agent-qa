import { expectTypeOf } from 'vitest'
import type { Benefit, StateValidity } from '@vostride/agent-qa-schema'
import { PAYLOAD_BENEFITS, PAYLOAD_STATE_VALIDITIES } from '../canary-payload.js'

// 2026-09-07, 418 SC1: deletion from either local persisted list must fail completeness.
expectTypeOf<Exclude<Benefit, (typeof PAYLOAD_BENEFITS)[number]>>().toEqualTypeOf<never>()
expectTypeOf<Exclude<StateValidity, (typeof PAYLOAD_STATE_VALIDITIES)[number]>>().toEqualTypeOf<never>()
