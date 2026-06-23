import { describe, expect, it } from 'vitest'
import { toRecordedActionResult } from '../result/index'
import type { ActionResult, RecordedActionResult } from '../result/index'

describe('toRecordedActionResult', () => {
  it('drops inline screenshot bytes from live action results', () => {
    const screenshot = new Uint8Array([1, 2, 3])
    const live: ActionResult = {
      success: true,
      screenshot,
      data: { kind: 'ok' },
      metadata: { source: 'adapter' },
    }

    const recorded: RecordedActionResult = toRecordedActionResult(live)

    expect(recorded).toEqual({
      success: true,
      data: { kind: 'ok' },
      metadata: { source: 'adapter' },
    })
    expect(Object.prototype.hasOwnProperty.call(recorded, 'screenshot')).toBe(false)
    expect(live.screenshot).toBe(screenshot)
  })
})
