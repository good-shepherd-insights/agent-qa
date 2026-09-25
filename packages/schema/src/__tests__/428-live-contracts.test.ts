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

test('EDITOR-LIVE-URL-DTOS-STRICT', () => {
  const input = api.EditorLiveUrlInputSchema
  expect(input.parse({ sessionId: 's1' })).toEqual({ sessionId: 's1' })
  expect(input.safeParse({ sessionId: '' }).success).toBe(false)
  expect(input.safeParse({ sessionId: 's1', runId: 'r' }).success).toBe(false)
  const result = {
    liveUrl: 'http://127.0.0.1:1/live/s1#v1.a.b',
    expiresAt: 1,
    stream: { kind: 'snapshot' },
  }
  expect(api.EditorLiveUrlResultSchema.parse(result)).toEqual(result)
  expect(api.EditorLiveUrlResultSchema.safeParse({ ...result, handle: 0 }).success).toBe(false)
})

test('C428-LIVE-VIEW-SUBJECT-KINDS-EXACT', () => {
  expect(api.LIVE_VIEW_SUBJECT_KINDS).toEqual(['run', 'editor'])
})
