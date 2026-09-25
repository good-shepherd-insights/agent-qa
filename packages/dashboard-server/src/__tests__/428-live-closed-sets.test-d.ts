import { expectTypeOf, test } from 'vitest'

import { LIVE_VIEW_END_REASONS, LIVE_VIEW_REFUSAL_REASONS } from '../live-view/protocol.js'
import type {
  LiveViewEndReason,
  LiveViewRefusalReason,
  LiveViewServerMessage,
} from '../live-view/protocol.js'

test('C428-REFUSAL-REASONS-EXACT', () => {
  type Expected =
    | 'malformed'
    | 'bad_signature'
    | 'expired'
    | 'scope_mismatch'
    | 'unknown_run'
    | 'unknown_handle'
    | 'unknown_session'
  expectTypeOf<LiveViewRefusalReason>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof LIVE_VIEW_REFUSAL_REASONS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<LiveViewRefusalReason, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, LiveViewRefusalReason>>().toEqualTypeOf<never>()
  expectTypeOf<Extract<LiveViewServerMessage, { type: 'refused' }>['reason']>()
    .toEqualTypeOf<Expected>()
})

test('C428-END-REASONS-EXACT', () => {
  type Expected = 'runFinished' | 'handleFinished' | 'sessionEnded'
  expectTypeOf<LiveViewEndReason>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof LIVE_VIEW_END_REASONS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<LiveViewEndReason, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, LiveViewEndReason>>().toEqualTypeOf<never>()
  expectTypeOf<Extract<LiveViewServerMessage, { type: 'ended' }>['reason']>()
    .toEqualTypeOf<Expected>()
})
