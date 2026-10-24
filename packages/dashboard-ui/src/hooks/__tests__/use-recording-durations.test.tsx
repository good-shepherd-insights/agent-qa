// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { readDecodedDuration, useRecordingDurations } from '../use-recording-durations'
import type { RunDetailGroup } from '@/lib/run-detail-view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => vi.restoreAllMocks())

test('DECODED-DURATION cleans up finite, failed and cancelled reads without guessing', async () => {
  for (const result of ['finite', 'error', 'abort'] as const) {
    const video = document.createElement('video')
    const load = vi.spyOn(video, 'load')
    const controller = new AbortController()
    const value = readDecodedDuration('/media', controller.signal, video)
    Object.defineProperty(video, 'duration', { value: Infinity, configurable: true })
    video.dispatchEvent(new Event('loadedmetadata'))
    expect(video.getAttribute('src')).toBe('/media')
    if (result === 'finite') {
      Object.defineProperty(video, 'duration', { value: 2.44 })
      video.dispatchEvent(new Event('durationchange'))
    } else if (result === 'error') video.dispatchEvent(new Event('error'))
    else controller.abort()
    expect(await value).toBe(result === 'finite' ? 2440 : undefined)
    expect(video.hasAttribute('src')).toBe(false)
    expect(load).toHaveBeenCalledTimes(1)
    video.dispatchEvent(new Event('loadedmetadata'))
    expect(load).toHaveBeenCalledTimes(1)
  }
})

test('DECODED-SUITE batches bounded reads, caches by recording and refuses stale run completions', async () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  const videos: HTMLVideoElement[] = []
  const create = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
    const element = create(tag, options)
    if (tag === 'video') videos.push(element as HTMLVideoElement)
    return element
  })
  const groups = Array.from({ length: 5 }, (_, testIndex) => ({ member: { testIndex, attempts: 1, recording: {
    state: 'present', ref: { id: `recording:${String(testIndex).repeat(64)}`, sha: String(testIndex).repeat(64) },
    contentType: 'video/webm', byteLength: 10, durationMs: 100,
  } }, steps: [] })) as RunDetailGroup[]
  let observed: ReturnType<typeof useRecordingDurations>
  function Probe({ runId }: { runId: string }) { observed = useRecordingDurations(groups, runId); return null }
  const finish = (video: HTMLVideoElement, seconds: number) => {
    Object.defineProperty(video, 'duration', { value: seconds, configurable: true })
    video.dispatchEvent(new Event('loadedmetadata'))
  }
  try {
    await act(async () => root.render(<Probe runId='first' />))
    expect(videos).toHaveLength(3)
    await act(async () => { for (const video of videos.slice(0, 3)) finish(video, 2) })
    expect(videos).toHaveLength(5)
    expect(observed!.ready).toBe(false)
    expect(observed!.decodedDurations.size).toBe(0)
    await act(async () => { for (const video of videos.slice(3)) finish(video, 3) })
    expect(observed!.ready).toBe(true)
    expect([...observed!.decodedDurations.values()]).toEqual([2000, 2000, 2000, 3000, 3000])
    expect(observed!.groups.map(group => group.member.recording?.state === 'present' && group.member.recording.durationMs)).toEqual([2000, 2000, 2000, 3000, 3000])
    expect(groups[0]!.member.recording).toMatchObject({ durationMs: 100 })
    await act(async () => root.render(<Probe runId='first' />))
    expect(videos).toHaveLength(5)
    await act(async () => root.render(<Probe runId='second' />))
    const stale = videos.slice(5)
    await act(async () => root.render(<Probe runId='third' />))
    expect(stale.every(video => !video.hasAttribute('src'))).toBe(true)
    await act(async () => { for (const video of stale) finish(video, 99) })
    expect(observed!.ready).toBe(false)
    expect(observed!.decodedDurations.size).toBe(0)
    expect(observed!.groups[0]!.member.recording).toMatchObject({ durationMs: 100 })
  } finally { await act(async () => root.unmount()) }
  expect(videos.every(video => !video.hasAttribute('src'))).toBe(true)
})
