import { afterEach, describe, expect, it, vi } from 'vitest'
import { markRun, MarkDeniedError, setRunConfirmScope } from '../api'

afterEach(() => { setRunConfirmScope(undefined); vi.unstubAllGlobals() })
describe('419 mark API scope and outcomes', () => {
  it.each([undefined, 'run-trigger:server-minted'])('sends only the existing scope %s and the supplied mark address', async scope => {
    const outcome = { kind: 'run-not-found', runId: 'opaque/id' }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(outcome)))
    vi.stubGlobal('fetch', fetchMock)
    setRunConfirmScope(scope)
    expect(await markRun('opaque/id', { kind: 'confirmed-bug', testId: 'member', stepIndex: 2 })).toEqual(outcome)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/runs/opaque%2Fid/mark', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        kind: 'confirmed-bug', testId: 'member', stepIndex: 2,
        ...(scope === undefined ? {} : { confirmScope: scope }),
      }),
    })
  })
  it('retains typed denial and canonical remedies on the real helper', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'mark_denied',
      reason: 'The safety gate denied this mark.', remedies: [{ kind: 'answer-confirm' }] }), { status: 403 })))
    await expect(markRun('run', { kind: 'false-fail' })).rejects.toEqual(new MarkDeniedError({
      reason: 'The safety gate denied this mark.', remedies: [{ kind: 'answer-confirm' }],
    }))
  })
})
