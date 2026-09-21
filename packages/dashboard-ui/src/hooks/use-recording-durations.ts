import { useEffect, useMemo, useRef, useState } from 'react'
import type { RunDetailGroup } from '@/lib/run-detail-view'
import { routes } from '@/lib/routes'

/** Detached, non-playing metadata read. Every exit releases listeners and the media source. */
export function readDecodedDuration(url: string, signal: AbortSignal, media = document.createElement('video')): Promise<number | undefined> {
  return new Promise(resolve => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (duration?: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      media.removeEventListener('loadedmetadata', loaded)
      media.removeEventListener('durationchange', loaded)
      media.removeEventListener('error', failed)
      signal.removeEventListener('abort', failed)
      media.removeAttribute('src')
      media.load()
      resolve(duration)
    }
    const loaded = () => {
      if (Number.isFinite(media.duration) && media.duration > 0) finish(media.duration * 1000)
    }
    const failed = () => finish()
    if (signal.aborted) { finish(); return }
    media.preload = 'metadata'
    media.muted = true
    media.addEventListener('loadedmetadata', loaded)
    media.addEventListener('durationchange', loaded)
    media.addEventListener('error', failed)
    signal.addEventListener('abort', failed, { once: true })
    timer = setTimeout(failed, 10_000)
    media.src = url
  })
}

/** Publish a single metadata batch so member transitions cannot reshuffle suite spans. */
export function useRecordingDurations(recordedGroups: readonly RunDetailGroup[], runId: string) {
  const recordings = recordedGroups.flatMap(group => {
    const recording = group.member.recording
    return recording?.state === 'present' && !recording.ref.evidenceIncomplete
      ? [{ key: `${runId}:${group.member.testIndex}:${recording.ref.sha}`, sha: recording.ref.sha }] : []
  })
  const signature = recordings.map(recording => recording.key).join('|')
  const cache = useRef(new Map<string, number | undefined>())
  const [batch, setBatch] = useState<{ signature: string; values: ReadonlyMap<string, number | undefined> }>()
  useEffect(() => {
    const controller = new AbortController()
    const keys = new Set(recordings.map(recording => recording.key))
    for (const key of cache.current.keys()) if (!keys.has(key)) cache.current.delete(key)
    const pending = recordings.filter(recording => !cache.current.has(recording.key))
    let next = 0
    const worker = async () => {
      while (!controller.signal.aborted && next < pending.length) {
        const recording = pending[next++]!
        const duration = await readDecodedDuration(routes.runArtifact(runId, recording.sha), controller.signal)
        if (!controller.signal.aborted) cache.current.set(recording.key, duration)
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker)).then(() => {
      if (!controller.signal.aborted) setBatch({ signature, values: new Map(cache.current) })
    })
    return () => controller.abort()
  }, [signature, runId])
  const ready = batch?.signature === signature
  const groups = useMemo(() => recordedGroups.map(group => {
    const recording = group.member.recording
    const duration = ready && recording?.state === 'present' ? batch.values.get(`${runId}:${group.member.testIndex}:${recording.ref.sha}`) : undefined
    return duration === undefined || recording?.state !== 'present' ? group
      : { ...group, member: { ...group.member, recording: { ...recording, durationMs: duration } } }
  }), [recordedGroups, batch, ready, runId])
  return { groups, ready }
}
