import { describe, expect, it } from 'vitest'
import {
  createTimeoutAbortReason,
  getTimeoutAbortReason,
  withAbort,
  type AgentTimeoutAbortReason,
} from '../abort.js'

describe('withAbort', () => {
  it('rejects with the abort reason when the signal aborts before the wrapped promise resolves', async () => {
    const controller = new AbortController()
    const reason = createTimeoutAbortReason('step', 1234)
    // A promise that never resolves on its own — only the abort can settle the race.
    const never = new Promise<string>(() => {})
    const wrapped = withAbort(never, controller.signal)
    controller.abort(reason)
    await expect(wrapped).rejects.toBe(reason)
  })

  it('resolves the wrapped value when no abort occurs', async () => {
    const controller = new AbortController()
    const result = await withAbort(Promise.resolve('done'), controller.signal)
    expect(result).toBe('done')
  })

  it('resolves without a signal', async () => {
    const result = await withAbort(Promise.resolve(42), undefined)
    expect(result).toBe(42)
  })
})

describe('createTimeoutAbortReason / getTimeoutAbortReason round-trip', () => {
  it('recognizes a reason created for a step timeout and recovers its payload', () => {
    const reason = createTimeoutAbortReason('step', 5000)
    const controller = new AbortController()
    controller.abort(reason)

    const recovered = getTimeoutAbortReason(controller.signal)
    expect(recovered).toEqual<AgentTimeoutAbortReason>({
      type: 'agent-qa-timeout',
      scope: 'step',
      timeoutMs: 5000,
      message: 'Step timed out after 5000ms',
    })
  })

  it('round-trips a test-scoped timeout reason', () => {
    const reason = createTimeoutAbortReason('test', 60000)
    const controller = new AbortController()
    controller.abort(reason)
    expect(getTimeoutAbortReason(controller.signal)).toBe(reason)
    expect(reason.message).toBe('Test timed out after 60000ms')
  })

  it('returns undefined for a non-timeout abort reason', () => {
    const controller = new AbortController()
    controller.abort(new Error('unrelated'))
    expect(getTimeoutAbortReason(controller.signal)).toBeUndefined()
  })

  it('returns undefined for an un-aborted signal', () => {
    const controller = new AbortController()
    expect(getTimeoutAbortReason(controller.signal)).toBeUndefined()
  })
})
