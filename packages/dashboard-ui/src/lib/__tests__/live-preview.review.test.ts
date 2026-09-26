// 428 code review (428-REVIEW.md) on the preview machine. Each cell pins a report or refusal that
// used to leave the corner saying something the facts did not support.

import { describe, expect, it } from 'vitest'

import {
  LIVE_RECONNECT_BACKOFF_MS,
  PREVIEW_UNAVAILABLE_TEXT,
  createInitialLivePreview,
  deriveLivePreview,
  reduceLivePreview,
} from '@/lib/live-preview'

const T = 1_700_000_000_000

describe('the live preview machine after review (428)', () => {
  it('WR-05 TRANSIENT-MINT-FAILURE-RECONNECTS: a failed fetch or a 5xx gets the quiet reconnect, not a dead end', () => {
    for (const word of ['live_url_mint_failed', 'Failed to fetch', 'API error 502']) {
      const state = reduceLivePreview(createInitialLivePreview(), { type: 'mint-refused', word }, T)
      expect(deriveLivePreview(state, T), word).toMatchObject({
        state: 'reconnecting',
        retryInMs: LIVE_RECONNECT_BACKOFF_MS[0],
      })
    }
  })

  it('WR-05 TRANSIENT-MINT-FAILURE-RECONNECTS: repeated failures end on Reconnect, never on a state with no action', () => {
    let state = createInitialLivePreview()
    for (let attempt = 0; attempt <= LIVE_RECONNECT_BACKOFF_MS.length; attempt += 1) {
      state = reduceLivePreview(state, { type: 'mint-refused', word: 'live_url_mint_failed' }, T + attempt)
    }
    expect(deriveLivePreview(state, T + 10)).toMatchObject({ state: 'disconnected', action: 'reconnect' })
  })

  it('WR-05 DEFINITE-REFUSAL-UNAVAILABLE: only a host that will not serve a live view says unavailable', () => {
    for (const word of ['live_view_unavailable', 'invalid_handle', 'cross_site_refused']) {
      const state = reduceLivePreview(createInitialLivePreview(), { type: 'mint-refused', word }, T)
      expect(deriveLivePreview(state, T), word).toMatchObject({ state: 'unavailable', words: PREVIEW_UNAVAILABLE_TEXT })
    }
  })
})
