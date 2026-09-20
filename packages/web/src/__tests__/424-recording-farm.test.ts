import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Page, BrowserContext } from 'playwright-core'
import type { PlatformAdapter, PlatformConfig, RecordingCapability } from '@vostride/agent-qa-runner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FarmWebAdapter } from '../farm-adapter.js'

let videoDir: string
let adapter: FarmWebAdapter
let page: Page
const start = vi.fn()
const stop = vi.fn()

beforeEach(async () => {
  vi.resetAllMocks()
  videoDir = await mkdtemp(join(tmpdir(), 'agent-qa-farm-recording-'))
  page = {
    viewportSize: () => ({ width: 800, height: 600 }),
    screencast: { start, stop },
  } as unknown as Page
  adapter = new FarmWebAdapter()
  Object.assign(adapter, {
    page,
    context: {} as BrowserContext,
    recordingConfig: { enabled: true, videoDir } satisfies PlatformConfig['recording'],
  })
})

afterEach(async () => {
  await adapter.cleanup()
  await rm(videoDir, { recursive: true, force: true })
})

function recording(): RecordingCapability {
  const capability = (adapter as PlatformAdapter<'web'>).recording
  expect(capability, 'initialized farm adapter exposes recording').toBeDefined()
  return capability!
}

it('REC-FARM-CAPABILITY: farm uses the shared per-member screencast lifecycle', async () => {
  const capability = recording()
  expect(recording()).toBe(capability)
  await capability.start()
  const options = start.mock.calls[0][0]
  expect(options.size).toEqual({ width: 800, height: 600 })
  expect(options).not.toHaveProperty('onFrame')
  expect(dirname(options.path)).toBe(videoDir)
  expect(options.path).toMatch(/[a-f0-9-]{36}\.webm$/)
  await expect(capability.stop()).resolves.toEqual({
    stagingPath: options.path, contentType: 'video/webm',
  })
  expect(stop).toHaveBeenCalledOnce()
})

it('REC-FARM-THROW-PROPAGATES: remote stop rejection remains a rejection', async () => {
  const capability = recording()
  const error = new Error('remote artifact save failed')
  await capability.start()
  stop.mockRejectedValue(error)
  await expect(capability.stop()).rejects.toBe(error)
})

it('REC-FARM-START-THROWS: start failure propagates without returning a staging file', async () => {
  const capability = recording()
  const error = new Error('remote ffmpeg unavailable')
  start.mockRejectedValue(error)
  await expect(capability.start()).rejects.toBe(error)
  await expect(capability.stop()).resolves.toBeUndefined()
})

it('REC-FARM-PAGE-BOUND: stop finalizes the page on which recording started', async () => {
  const capability = recording()
  await capability.start()
  const otherStop = vi.fn()
  Object.assign(adapter, { page: { screencast: { stop: otherStop } } })
  await capability.stop()
  expect(stop).toHaveBeenCalledOnce()
  expect(otherStop).not.toHaveBeenCalled()
})

it('REC-FARM-CLEANUP: cleanup stops recording even when finalization rejects', async () => {
  await recording().start()
  stop.mockRejectedValue(new Error('connection closed'))
  await expect(adapter.cleanup()).resolves.toBeUndefined()
  expect(stop).toHaveBeenCalledOnce()
  expect((adapter as PlatformAdapter<'web'>).recording).toBeUndefined()
})
