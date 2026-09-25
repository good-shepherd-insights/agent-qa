import { expect, test } from 'vitest'
import * as api from '../index'

test('C428-LIVE-STREAM-KINDS-EXACT', () => {
  expect(api.LIVE_STREAM_KINDS).toEqual(['cdp-screencast', 'snapshot', 'mjpeg', 'webrtc'])
  for (const kind of [...api.LIVE_STREAM_KINDS, 'none']) {
    expect(api.LiveStreamDeclarationSchema.parse({ kind })).toEqual({ kind })
  }
  expect(api.LiveStreamDeclarationSchema.safeParse({ kind: 'jpeg-poll' }).success).toBe(false)
  expect(api.LiveStreamDeclarationSchema.safeParse({ kind: 'snapshot', extra: 1 }).success).toBe(false)
})

test('C428-FRAME-END-REASONS-EXACT', () => {
  expect(api.LIVE_FRAME_END_REASONS).toEqual(['withdrawn', 'closed'])
})
