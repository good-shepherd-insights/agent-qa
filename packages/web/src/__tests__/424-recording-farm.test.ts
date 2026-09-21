import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Page, BrowserContext } from 'playwright-core'
import type { PlatformAdapter, PlatformConfig, RecordingCapability } from '@vostride/agent-qa-runner'
import { createRunEventBus, createMemberEventSink, runMemberTest } from '@vostride/agent-qa-runner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FarmWebAdapter } from '../farm-adapter.js'
import { createScreencastRecording } from '../recording.js'

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
  expect(options.onFrame).toBeTypeOf('function')
  expect(capability.beginAnnotation?.()).toBeUndefined()
  expect(dirname(options.path)).toBe(videoDir)
  expect(options.path).toMatch(/[a-f0-9-]{36}\.webm$/)
  await expect(capability.stop()).resolves.toEqual({
    stagingPath: options.path, contentType: 'video/webm',
  })
  expect(stop).toHaveBeenCalledOnce()
})

it('REC-ANNOTATION-CLOCK: exact first-frame epoch maps dispatch interval and missing metadata withholds', async () => {
  const capability = createScreencastRecording(() => page, { enabled: true, videoDir }, () => 0)
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000)
  try {
    await capability.start()
    expect(capability.beginAnnotation?.()).toBeUndefined()
    const onFrame = start.mock.calls[0][0].onFrame
    // SOI + SOF0 for a measured 800x600 JPEG header.
    const data = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 2, 88, 3, 32, 1, 1, 0x11, 0])
    await onFrame({ data, timestamp: performance.timeOrigin + 900, viewportWidth: 800, viewportHeight: 600 })
    const finish = capability.beginAnnotation?.()
    clock.mockReturnValue(1040)
    expect(finish?.()).toEqual({ startMs: 100, endMs: 140, scene: 'recorded-page', transform: 'identity', width: 800, height: 600 })
    await onFrame({ data, timestamp: performance.timeOrigin + 1050, viewportWidth: 900, viewportHeight: 600 })
    expect(capability.beginAnnotation?.()).toBeUndefined()
    await capability.stop()
  } finally { clock.mockRestore() }
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
  expect(stop).toHaveBeenCalledTimes(2)
  expect((adapter as PlatformAdapter<'web'>).recording).toBeUndefined()
})

it.each(['shared-web', 'farm'] as const)('REC-WEB-RECOVERY-%s: failed stop discards partial staging and retry finalizes fresh bytes', async producer => {
  const capability = producer === 'farm' ? recording() : createScreencastRecording(() => page, { enabled: true, videoDir })
  start.mockImplementation(async ({ path }: { path: string }) => { await writeFile(path, 'partial') })
  await capability.start()
  const failedPath = start.mock.calls[0][0].path
  stop.mockRejectedValueOnce(new Error('transient save failure'))
  await expect(capability.stop()).rejects.toThrow('transient save failure')
  expect(await readdir(videoDir)).toEqual([])
  await capability.start()
  const successPath = start.mock.calls[1][0].path
  stop.mockImplementationOnce(async () => { await writeFile(successPath, 'final retry') })
  const stopped = await capability.stop()
  expect(stopped?.stagingPath).toBe(successPath)
  expect(successPath).not.toBe(failedPath)
  expect(await readFile(successPath, 'utf8')).toBe('final retry')
})

it('REC-WEB-RECOVERY-EXCLUSIVE: cleanup completes before reuse; persistent failure reaches driver again', async () => {
  const capability = recording()
  await capability.start()
  const error = new Error('remote stop failed')
  let release!: () => void
  stop.mockRejectedValueOnce(error).mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
  const stopping = expect(capability.stop()).rejects.toBe(error)
  await vi.waitFor(() => expect(release).toBeDefined())
  await expect(capability.start()).rejects.toThrow(/already/i)
  release()
  await stopping
  await capability.start()
  stop.mockRejectedValue(error)
  await expect(capability.stop()).rejects.toBe(error)
  await expect(capability.start()).rejects.toBe(error)
  stop.mockResolvedValue(undefined)
  await capability.start()
  await capability.stop()
})

it('REC-FARM-RUNNER-RETRY: real runner persists only the fresh finalized attempt', async () => {
  let path = ''
  start.mockImplementation(async (options: { path: string }) => {
    path = options.path
    await writeFile(path, 'partial')
  })
  stop.mockRejectedValueOnce(new Error('first stop failed'))
    .mockResolvedValueOnce(undefined)
    .mockImplementation(async () => { await writeFile(path, 'retry recording') })
  const ref = { id: `recording:${'a'.repeat(64)}` as const, sha: 'a'.repeat(64) }
  const persistRecording = vi.fn((staged: string) => {
    expect(start).toHaveBeenCalledTimes(2)
    expect(staged).toBe(start.mock.calls[1][0].path)
    expect(readFileSync(staged, 'utf8')).toBe('retry recording')
    return { ref, byteLength: 15 }
  })
  let attempt = 0
  const result = await runMemberTest({ testId: 'synthetic-retry', name: 'Retry', filePath: 'synthetic.yaml',
    steps: ['Run'], meta: { retries: 1 } }, {
    adapter, planner: {} as never, plannerModel: {} as never, verifierModel: {} as never,
    sink: createMemberEventSink({ bus: createRunEventBus({ runId: 'synthetic-retry-run' }),
      masking: { mask: text => text, unmask: text => text }, testIndex: 0 }),
    testIndex: 0, abortSignal: new AbortController().signal, recording: { enabled: true },
    evidenceArtifacts: { persistDecisionScreenshot: () => ({ id: `decision-screenshot:${ref.sha}`, sha: ref.sha }),
      getBlob: () => undefined, persistRecording },
    executeStep: async name => ({ name, status: attempt++ === 0 ? 'failed' : 'passed', duration: 0 }),
  })
  expect(result.status).toBe('passed')
  expect(result.retryCount).toBe(1)
  expect(result.recording).toMatchObject({ state: 'present', ref })
  expect(result.firstFailedAttempt?.result).not.toHaveProperty('recording')
  expect(persistRecording).toHaveBeenCalledOnce()
  expect(await readdir(videoDir)).toHaveLength(1)
})
