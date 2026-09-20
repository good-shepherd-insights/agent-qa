import { afterEach, expect, it, vi } from 'vitest'
import * as api from '@/lib/api'

afterEach(() => vi.unstubAllGlobals())

it('API-RUN-EVIDENCE-URL encodes the id once and returns the typed answer verbatim', async () => {
  expect(api).toHaveProperty('fetchRunEvidence', expect.any(Function))
  const address = { runId: 'r 1/x%2F', testIndex: 2, stepIndex: 3, kind: 'a11y' as const }
  const result = { address, outcome: 'read-error', code: 'storage-read-failed' }
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => result })
  vi.stubGlobal('fetch', fetch)
  expect(await api.fetchRunEvidence(address)).toEqual({ kind: 'read', result })
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/runs/r%201%2Fx%252F/evidence?testIndex=2&stepIndex=3&kind=a11y')
})

it.each(['network', 'http', 'json'])('API-RUN-EVIDENCE-FAILURE contains %s errors', async (failure) => {
  expect(api).toHaveProperty('fetchRunEvidence', expect.any(Function))
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (failure === 'network') throw new Error('offline')
    return { ok: failure !== 'http', status: 500, statusText: 'failed', json: async () => { throw new Error('invalid JSON') } }
  }))
  expect(await api.fetchRunEvidence({ runId: 'r 1/x', testIndex: 0, stepIndex: 0, kind: 'a11y' })).toEqual({ kind: 'failed', error: expect.any(String) })
})
