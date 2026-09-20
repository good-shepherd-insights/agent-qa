import { expect, test, vi } from 'vitest'
import type { RecordingEntry } from '@vostride/agent-qa-schema'
import { initialPlayerSource, storePlayerSource, PLAYER_SOURCE_STORAGE_KEY, mediaErrorView } from '../player-view'

const recording: RecordingEntry = { state: 'present', ref: { id: `recording:${'a'.repeat(64)}`, sha: 'a'.repeat(64) }, contentType: 'video/webm', byteLength: 10 }

test('PLAYER-STORED-SOURCE', () => {
  const getItem = vi.fn(() => 'frames')
  expect(initialPlayerSource(recording, { getItem })).toBe('frames')
  expect(getItem).toHaveBeenCalledWith(PLAYER_SOURCE_STORAGE_KEY)
  for (const value of ['video', 'bad', null]) expect(initialPlayerSource(recording, { getItem: () => value })).toBe('video')
  const setItem = vi.fn()
  storePlayerSource('video', { setItem })
  expect(setItem).toHaveBeenCalledWith(PLAYER_SOURCE_STORAGE_KEY, 'video')
})
test('PLAYER-NO-OVERWRITE-WITHOUT-RECORDING', () => {
  const storage = { getItem: vi.fn(), setItem: vi.fn() }
  expect(initialPlayerSource(undefined, storage)).toBe('frames')
  expect(initialPlayerSource({ state: 'absent', reason: 'not-captured' }, storage)).toBe('frames')
  expect(storage.getItem).not.toHaveBeenCalled()
  expect(storage.setItem).not.toHaveBeenCalled()
})
test('PLAYER-STORAGE-UNAVAILABLE', () => {
  expect(initialPlayerSource(recording, { getItem: () => { throw Error('denied') } })).toBe('video')
  expect(() => storePlayerSource('frames', { setItem: () => { throw Error('denied') } })).not.toThrow()
})
test('PLAYER-MEDIA-ERROR-CLASSIFICATION', () => {
  for (const kind of ['frame', 'video'] as const) {
    expect(mediaErrorView(kind, { status: 404 })).toMatchObject({ state: 'unavailable', incomplete: true })
    expect(mediaErrorView(kind, { blobAbsent: true })).toMatchObject({ state: 'unavailable', incomplete: true })
    expect(mediaErrorView(kind, { status: 500 })).toMatchObject({ state: 'failed', failure: 'load' })
  }
})
