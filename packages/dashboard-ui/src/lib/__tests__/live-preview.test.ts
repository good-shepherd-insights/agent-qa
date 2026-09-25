// THE LIVE PREVIEW'S ONE MACHINE, PROVEN WHERE TIME IS FREE (428 D-14/D-15/D-16/D-17 · SC2, SC3).
//
// Every clock is a parameter: `reduceLivePreview(state, event, now)` and `deriveLivePreview(state,
// now)`. The window cells below sit on either side of a half-open boundary, the shape a wall clock
// would turn into a flake.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  LIVE_DOT_MEANINGS,
  LIVE_DOT_NAMES,
  LIVE_DOT_STATES,
  LIVE_EDITOR_SESSION_GONE_CLOSE_CODE,
  LIVE_EMBED_END_REASONS,
  LIVE_EMBED_REFUSAL_REASONS,
  LIVE_EMBED_REPORT_EVENTS,
  LIVE_EMBED_STREAM_KINDS,
  LIVE_FRESHNESS_WINDOW_MS,
  LIVE_PREVIEW_ACTION_LABELS,
  LIVE_PREVIEW_ACTIONS,
  LIVE_PREVIEW_HOST_QUERY,
  LIVE_PREVIEW_STATES,
  LIVE_RECONNECT_BACKOFF_MS,
  NO_STREAM_RETRY_MS,
  NO_STREAM_TEXT,
  PREVIEW_DELAYED_TEXT,
  PREVIEW_DISCONNECTED_TEXT,
  PREVIEW_EXPIRED_TEXT,
  PREVIEW_LOADING_TEXT,
  PREVIEW_MEMBER_ENDED_TEXT,
  PREVIEW_RECONNECTING_TEXT,
  PREVIEW_RUN_ENDED_TEXT,
  PREVIEW_SESSION_ENDED_TEXT,
  PREVIEW_UNAVAILABLE_TEXT,
  SNAPSHOT_PREVIEW_LABEL,
  WAITING_ATTEMPT_LIMIT,
  WAITING_GAVE_UP_LABEL,
  WAITING_GAVE_UP_TEXT,
  parseEmbedReport,
} from '../live-preview'

describe('the preview vocabulary (428-14 Task 1)', () => {
  it('CLOSED-SETS-428: the states, dots, report events and actions are exactly the published sets', () => {
    expect(LIVE_PREVIEW_STATES).toEqual([
      'loading',
      'waiting',
      'live',
      'delayed',
      'reconnecting',
      'disconnected',
      'expired',
      'session-ended',
      'run-ended',
      'member-ended',
      'no-stream',
      'unavailable',
    ])
    expect(LIVE_DOT_STATES).toEqual(['green', 'amber', 'red'])
    expect(LIVE_EMBED_REPORT_EVENTS).toEqual(['ready', 'frame', 'ended', 'refused', 'lost'])
    expect(LIVE_PREVIEW_ACTIONS).toEqual(['reconnect', 'refresh', 'start-fresh'])
    expect(LIVE_EMBED_STREAM_KINDS).toEqual(['cdp-screencast', 'snapshot', 'mjpeg', 'webrtc'])
    expect(LIVE_EMBED_END_REASONS).toEqual(['runFinished', 'handleFinished', 'sessionEnded'])
    expect(LIVE_EMBED_REFUSAL_REASONS).toEqual([
      'malformed',
      'bad_signature',
      'expired',
      'scope_mismatch',
      'unknown_run',
      'unknown_handle',
      'unknown_session',
    ])
    expect(Object.keys(LIVE_PREVIEW_ACTION_LABELS).sort()).toEqual([...LIVE_PREVIEW_ACTIONS].sort())
    expect(Object.keys(LIVE_DOT_NAMES).sort()).toEqual([...LIVE_DOT_STATES].sort())
    expect(Object.keys(LIVE_DOT_MEANINGS).sort()).toEqual([...LIVE_DOT_STATES].sort())
    for (const text of [
      ...Object.values(LIVE_PREVIEW_ACTION_LABELS),
      ...Object.values(LIVE_DOT_NAMES),
      ...Object.values(LIVE_DOT_MEANINGS),
    ]) {
      expect(text.trim().length, 'every label is a real sentence').toBeGreaterThan(0)
    }
  })

  it('COPY-428: the constants and the corner copy are the recorded defaults', () => {
    expect(LIVE_FRESHNESS_WINDOW_MS).toBe(5_000)
    expect(LIVE_RECONNECT_BACKOFF_MS).toEqual([1_000, 2_000, 4_000])
    expect(NO_STREAM_RETRY_MS).toBe(2_500)
    expect(WAITING_ATTEMPT_LIMIT).toBe(24)
    expect(LIVE_PREVIEW_HOST_QUERY).toBe('?host=dashboard')
    expect(LIVE_EDITOR_SESSION_GONE_CLOSE_CODE).toBe(4404)
    expect(SNAPSHOT_PREVIEW_LABEL).toBe('Snapshot preview · updates every 1s')
    expect(PREVIEW_LOADING_TEXT).toBe('Connecting to the preview…')
    expect(PREVIEW_DELAYED_TEXT).toBe('Preview delayed')
    expect(PREVIEW_RECONNECTING_TEXT).toBe('Reconnecting…')
    expect(PREVIEW_DISCONNECTED_TEXT).toBe('Disconnected')
    expect(PREVIEW_EXPIRED_TEXT).toBe('Link expired')
    expect(PREVIEW_SESSION_ENDED_TEXT).toBe('Session ended')
    expect(PREVIEW_RUN_ENDED_TEXT).toBe('Run ended')
    expect(PREVIEW_MEMBER_ENDED_TEXT).toBe('This test finished while the run goes on')
    expect(PREVIEW_UNAVAILABLE_TEXT).toBe('Live preview is not available here')
    expect(NO_STREAM_TEXT).toBe('no live preview for this target — the step list keeps advancing')
    expect(WAITING_GAVE_UP_TEXT).toBe('waited for the live view, but nothing arrived — the step list keeps advancing')
    expect(WAITING_GAVE_UP_LABEL).toBe('gave up')
    expect(LIVE_PREVIEW_ACTION_LABELS).toEqual({ reconnect: 'Reconnect', refresh: 'Refresh', 'start-fresh': 'Start fresh' })
    expect(LIVE_DOT_NAMES).toEqual({
      green: 'Live preview healthy',
      amber: 'Live preview delayed',
      red: 'Live preview stopped',
    })
  })

  it('PARSE-EMBED-REPORT-CLOSED: only the closed report shapes parse, into fresh objects', () => {
    expect(parseEmbedReport({ event: 'frame', ts: 1, kind: 'snapshot', width: 2, height: 3 })).toEqual({
      event: 'frame',
      ts: 1,
      kind: 'snapshot',
      width: 2,
      height: 3,
    })

    const stringTs = parseEmbedReport({ event: 'frame', ts: '1', kind: 'snapshot', width: 2, height: 3 })
    expect(stringTs, 'a mistyped optional field is dropped, not trusted').toEqual({
      event: 'frame',
      kind: 'snapshot',
      width: 2,
      height: 3,
    })
    expect(stringTs).not.toHaveProperty('ts')

    const withToken = parseEmbedReport({ event: 'frame', token: 'v1.x', ts: 1, width: 2, height: 3 })
    expect(withToken).toEqual({ event: 'frame', ts: 1, width: 2, height: 3 })
    expect(withToken, 'an extra field is never carried').not.toHaveProperty('token')
    expect(JSON.stringify(withToken)).not.toContain('v1.')

    const input = { event: 'ended', reason: 'sessionEnded' }
    const ended = parseEmbedReport(input)
    expect(ended).toEqual({ event: 'ended', reason: 'sessionEnded' })
    expect(ended, 'the parsed report is a fresh object').not.toBe(input)

    expect(parseEmbedReport({ event: 'ready', kind: 'cdp-screencast' })).toEqual({ event: 'ready', kind: 'cdp-screencast' })
    expect(parseEmbedReport({ event: 'ready', kind: 'none' })).toEqual({ event: 'ready', kind: 'none' })
    expect(parseEmbedReport({ event: 'refused', reason: 'expired' })).toEqual({ event: 'refused', reason: 'expired' })
    expect(parseEmbedReport({ event: 'lost', extra: 1 })).toEqual({ event: 'lost' })

    expect(parseEmbedReport({ event: 'hello' })).toBeUndefined()
    expect(parseEmbedReport(null)).toBeUndefined()
    expect(parseEmbedReport('frame')).toBeUndefined()
    expect(parseEmbedReport({ event: 'refused', reason: 'nonsense' })).toBeUndefined()
    expect(parseEmbedReport({ event: 'ended', reason: 'finished' })).toBeUndefined()
    expect(parseEmbedReport({ event: 'ready', kind: 'vnc' })).toBeUndefined()
    expect(parseEmbedReport({ event: 'frame', ts: 1, width: '2', height: 3 })).toBeUndefined()
    expect(parseEmbedReport({ event: 'frame', ts: 1, width: Number.NaN, height: 3 })).toBeUndefined()
    expect(parseEmbedReport(['frame'])).toBeUndefined()
  })

  it('NO-BUS-IMPORT: the machine source names no bus, liveness source, socket state or run-stream opener', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/live-preview.ts'), 'utf8')
    const needles = [
      'run-stream' + '-reducer',
      'RunEvent' + 'Envelope',
      'Liveness' + 'Source',
      'openRun' + 'Stream',
      'ready' + 'State',
    ]
    for (const needle of needles) {
      expect(source, `live-preview.ts must not mention ${needle}`).not.toContain(needle)
    }
  })
})
