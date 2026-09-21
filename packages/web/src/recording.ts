import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import type { PlatformConfig, RecordingCapability } from '@vostride/agent-qa-runner'

export const RECORDING_DEFAULT_SIZE = { width: 1280, height: 720 }

export function createScreencastRecording(
  getPage: () => Page | null,
  config: NonNullable<PlatformConfig['recording']>,
): RecordingCapability {
  let active: { page: Page; stagingPath: string } | undefined
  let recovery: typeof active
  let busy = false
  async function recover() {
    if (!recovery) return
    // Keep the failed session quarantined until the driver confirms it stopped.
    // A subsequent start retries this real cleanup, never publishes these bytes.
    await recovery.page.screencast.stop()
    await rm(recovery.stagingPath, { force: true })
    recovery = undefined
  }
  return {
    async start() {
      if (busy || active) throw new Error('Recording already started')
      busy = true
      try {
        await recover()
        const page = getPage()
        if (!page) throw new Error('Recording requires an initialized page')
        const stagingPath = join(config.videoDir, `${randomUUID()}.webm`)
        recovery = { page, stagingPath }
        try {
          await mkdir(config.videoDir, { recursive: true })
          await page.screencast.start({
            path: stagingPath,
            size: config.videoSize ?? page.viewportSize() ?? RECORDING_DEFAULT_SIZE,
          })
        } catch (error) {
          try { await recover() } catch { /* Retry cleanup before the next start. */ }
          throw error
        }
        active = recovery
        recovery = undefined
        return { zeroMs: performance.now() }
      } finally { busy = false }
    },
    async stop() {
      if (busy) throw new Error('Recording operation already in progress')
      busy = true
      try {
        const recording = active
        if (!recording) { await recover(); return undefined }
        active = undefined
        try {
          await recording.page.screencast.stop()
        } catch (error) {
          recovery = recording
          try { await recover() } catch { /* Retry cleanup before the next start. */ }
          throw error
        }
        return { stagingPath: recording.stagingPath, contentType: 'video/webm' }
      } finally { busy = false }
    },
  }
}
