import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PlatformAdapter, RecordingCapability } from '@vostride/agent-qa-runner'
import { remote } from 'webdriverio'
import { AndroidPlatformAdapter } from '../adapter.js'

vi.mock('webdriverio', () => ({ remote: vi.fn() }))

let adapter: AndroidPlatformAdapter
let videoDir: string
const driver = {
  startRecordingScreen: vi.fn(),
  stopRecordingScreen: vi.fn(),
  deleteSession: vi.fn(),
}

beforeEach(async () => {
  vi.resetAllMocks()
  vi.mocked(remote).mockResolvedValue(driver as unknown as WebdriverIO.Browser)
  videoDir = await mkdtemp(join(tmpdir(), 'agent-qa-android-recording-'))
  adapter = new AndroidPlatformAdapter()
  await adapter.setup({
    platform: 'android',
    recording: { enabled: true, videoDir, videoSize: { width: 1080, height: 1920 } },
  })
})

afterEach(async () => {
  await adapter.cleanup()
  await rm(videoDir, { recursive: true, force: true })
})

function recording(): RecordingCapability {
  const capability = (adapter as PlatformAdapter<'android'>).recording
  expect(capability, 'initialized Android adapter exposes recording').toBeDefined()
  return capability!
}

it('REC-ANDROID-PER-MEMBER: two members write distinct mp4 files without setup recording', async () => {
  const capability = recording()
  expect(recording()).toBe(capability)
  expect(driver.startRecordingScreen).not.toHaveBeenCalled()
  const paths: string[] = []
  for (const contents of ['first member', 'second member']) {
    driver.stopRecordingScreen.mockResolvedValue(Buffer.from(contents).toString('base64'))
    await capability.start()
    const stopped = await capability.stop()
    expect(stopped?.contentType).toBe('video/mp4')
    expect(dirname(stopped!.stagingPath)).toBe(videoDir)
    expect(stopped!.stagingPath).toMatch(/[a-f0-9-]{36}\.mp4$/)
    expect(await readFile(stopped!.stagingPath, 'utf8')).toBe(contents)
    paths.push(stopped!.stagingPath)
  }
  expect(new Set(paths).size).toBe(2)
  expect(driver.startRecordingScreen).toHaveBeenCalledTimes(2)
  expect(driver.startRecordingScreen).toHaveBeenNthCalledWith(1, {
    videoSize: '1080x1920', timeLimit: 1800, forceRestart: true,
  })
  expect(driver.startRecordingScreen).toHaveBeenNthCalledWith(2, {
    videoSize: '1080x1920', timeLimit: 1800, forceRestart: true,
  })
})

it('REC-ANDROID-NO-ZERO: start does not claim a clock zero', async () => {
  const result = await recording().start()
  expect(result).toEqual({})
  expect(result).not.toHaveProperty('zeroMs')
})

it('REC-ANDROID-THROW-PROPAGATES: stop failure rejects and cleanup still deletes session', async () => {
  const capability = recording()
  await capability.start()
  const error = new Error('device recording failed')
  driver.stopRecordingScreen.mockRejectedValue(error)
  await expect(capability.stop()).rejects.toBe(error)
  await expect(adapter.cleanup()).resolves.toBeUndefined()
  expect(driver.deleteSession).toHaveBeenCalledOnce()
})

it('REC-ANDROID-START-THROWS: start failure rejects and cleanup still stops the driver', async () => {
  const capability = recording()
  const error = new Error('recording start failed')
  driver.startRecordingScreen.mockRejectedValue(error)
  await expect(capability.start()).rejects.toBe(error)
  await adapter.cleanup()
  expect(driver.stopRecordingScreen).toHaveBeenCalledOnce()
  expect(driver.deleteSession).toHaveBeenCalledOnce()
})

it('REC-ANDROID-EMPTY: empty payload produces no staging file', async () => {
  const capability = recording()
  await capability.start()
  driver.stopRecordingScreen.mockResolvedValue('')
  await expect(capability.stop()).resolves.toBeUndefined()
  expect(await readdir(videoDir)).toEqual([])
})

it('REC-ANDROID-IDLE: idle stop does not contact the driver', async () => {
  await expect(recording().stop()).resolves.toBeUndefined()
  expect(driver.stopRecordingScreen).not.toHaveBeenCalled()
})

it('REC-ANDROID-CLEANUP: running capture stops before session deletion', async () => {
  await recording().start()
  await adapter.cleanup()
  expect(driver.stopRecordingScreen).toHaveBeenCalledOnce()
  expect(driver.stopRecordingScreen.mock.invocationCallOrder[0])
    .toBeLessThan(driver.deleteSession.mock.invocationCallOrder[0])
  expect((adapter as PlatformAdapter<'android'>).recording).toBeUndefined()
})
