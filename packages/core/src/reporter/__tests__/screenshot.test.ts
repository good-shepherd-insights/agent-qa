import { describe, it, expect, vi } from 'vitest'
import { captureFailureScreenshot } from '../screenshot.js'
import { makeScreenState, type PlatformAdapter } from '@vostride/agent-qa-runner'

function makeAdapter(overrides?: Partial<PlatformAdapter>): PlatformAdapter {
  return {
    platform: 'web',
    async setup() {},
    async cleanup() {},
    async observe() {
      return makeScreenState({ tree: '', elements: [], refMap: {} })
    },
    async execute() {
      return { success: true }
    },
    ...overrides,
  }
}

describe('captureFailureScreenshot', () => {
  it('returns buffer from adapter.screenshot()', async () => {
    const buf = Buffer.from('fake-png')
    const adapter = {
      ...makeAdapter(),
      screenshot: vi.fn().mockResolvedValue(buf),
    }

    const result = await captureFailureScreenshot(adapter)
    expect(result).toBe(buf)
    expect(adapter.screenshot).toHaveBeenCalled()
  })

  it('returns undefined when adapter has no screenshot method', async () => {
    const adapter = makeAdapter()

    const result = await captureFailureScreenshot(adapter)
    expect(result).toBeUndefined()
  })

  it('returns undefined on error', async () => {
    const adapter = {
      ...makeAdapter(),
      screenshot: vi.fn().mockRejectedValue(new Error('browser crashed')),
    }

    const result = await captureFailureScreenshot(adapter)
    expect(result).toBeUndefined()
  })
})
