import { expectTypeOf, test } from 'vitest'
import { LIVE_FRAME_END_REASONS, LIVE_STREAM_KINDS } from '../index'
import type { LiveFrameEndReason, LiveStreamDeclaration, LiveStreamKind } from '../index'

test('C428-LIVE-STREAM-KINDS-EXACT', () => {
  type Expected = 'cdp-screencast' | 'snapshot' | 'mjpeg' | 'webrtc'
  expectTypeOf<LiveStreamKind>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof LIVE_STREAM_KINDS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<LiveStreamKind, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, LiveStreamKind>>().toEqualTypeOf<never>()
  expectTypeOf<LiveStreamDeclaration['kind']>().toEqualTypeOf<Expected | 'none'>()
})

test('C428-FRAME-END-REASONS-EXACT', () => {
  type Expected = 'withdrawn' | 'closed'
  expectTypeOf<LiveFrameEndReason>().toEqualTypeOf<Expected>()
  expectTypeOf<(typeof LIVE_FRAME_END_REASONS)[number]>().toEqualTypeOf<Expected>()
  expectTypeOf<Exclude<LiveFrameEndReason, Expected>>().toEqualTypeOf<never>()
  expectTypeOf<Exclude<Expected, LiveFrameEndReason>>().toEqualTypeOf<never>()
})
