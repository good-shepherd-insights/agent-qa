// C439-FARM-WAITS (439 D-13, D-14, SC3): the farm adapter's waitFor fails with the same
// self-correcting messages as the local adapter and the mobile adapters, and its network read
// peeks at the log without consuming it. Driven against a mocked page, like farm-adapter.test.ts.

import { describe, expect, it, vi } from 'vitest'
import type { NetworkLogEntry } from '@vostride/agent-qa-runner'
import { FarmWebAdapter } from '../farm-adapter.js'

vi.mock('playwright-core', () => ({ chromium: { connect: vi.fn() } }))

function timeout(): Error {
  return new Error('Timeout 300ms exceeded.')
}

function primeWaits(adapter: FarmWebAdapter, waitFor: () => Promise<void>, waitForSelector: () => Promise<void>) {
  const locator = { first: vi.fn().mockReturnThis(), waitFor: vi.fn(waitFor) }
  const page = {
    getByText: vi.fn().mockReturnValue(locator),
    waitForSelector: vi.fn(waitForSelector),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('x')),
  }
  ;(adapter as unknown as { page: unknown }).page = page
  return { page, locator }
}

function logEntry(url: string): NetworkLogEntry {
  return {
    url,
    method: 'GET',
    status: 200,
    requestHeaders: {},
    responseHeaders: {},
    startTime: 1,
    endTime: 2,
  } as NetworkLogEntry
}

describe('C439-FARM-WAITS', () => {
  it('a wait whose condition never holds fails and names what it waited for', async () => {
    const adapter = new FarmWebAdapter()
    primeWaits(adapter, () => Promise.reject(timeout()), () => Promise.reject(timeout()))

    await expect(adapter.execute({ type: 'waitFor', on: 'text', text: 'Order placed', timeoutMs: 300 }))
      .resolves.toEqual({ success: false, error: 'waitFor: text "Order placed" did not appear within 300ms.' })
    await expect(adapter.execute({ type: 'waitFor', on: 'gone', text: 'Loading', timeoutMs: 300 }))
      .resolves.toEqual({ success: false, error: 'waitFor: text "Loading" was still present after 300ms.' })
    await expect(adapter.execute({ type: 'waitFor', on: 'selector', selector: '#done', timeoutMs: 300 }))
      .resolves.toEqual({ success: false, error: 'waitFor: selector "#done" did not appear within 300ms.' })
  })

  it('a wait whose condition holds succeeds', async () => {
    const adapter = new FarmWebAdapter()
    primeWaits(adapter, () => Promise.resolve(), () => Promise.resolve())

    await expect(adapter.execute({ type: 'waitFor', on: 'text', text: 'Order placed', timeoutMs: 300 }))
      .resolves.toEqual({ success: true })
  })

  it('a network assertion peeks at the log and leaves it for the step-end drain', async () => {
    const adapter = new FarmWebAdapter()
    const { page } = primeWaits(adapter, () => Promise.resolve(), () => Promise.resolve())
    const buffers = {
      consoleLogs: [],
      networkLogs: [logEntry('http://x.test/api/ping')],
      consoleDrainIndex: 0,
      networkDrainIndex: 0,
      pendingRequests: new Map(),
    }
    ;(adapter as unknown as { pageLogBuffers: Map<unknown, unknown> }).pageLogBuffers.set(page, buffers)

    const first = await adapter.execute({ type: 'assertValue', source: 'network', op: 'contains', expected: '/api/ping' })
    const second = await adapter.execute({ type: 'assertValue', source: 'network', op: 'contains', expected: '/api/ping' })

    expect(first.success).toBe(true)
    expect((first.data as NetworkLogEntry[]).map((each) => each.url)).toEqual(['http://x.test/api/ping'])
    expect(second.data).toEqual(first.data)
    expect(adapter.peekNetworkLogs().map((each) => each.url)).toEqual(['http://x.test/api/ping'])
    expect(adapter.drainNetworkLogs().map((each) => each.url)).toEqual(['http://x.test/api/ping'])
    expect(adapter.drainNetworkLogs()).toEqual([])
  })
})
