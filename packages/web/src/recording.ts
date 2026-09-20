import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright-core'
import type { PlatformConfig, RecordingCapability } from '@vostride/agent-qa-runner'

export const RECORDING_DEFAULT_SIZE = { width: 1280, height: 720 }

export function createScreencastRecording(
  getPage: () => Page | null,
  config: NonNullable<PlatformConfig['recording']>,
): RecordingCapability {
  let active: { page: Page; stagingPath: string; starting: Promise<unknown> } | undefined
  return {
    async start() {
      if (active) throw new Error('Recording already started')
      const page = getPage()
      if (!page) throw new Error('Recording requires an initialized page')
      const stagingPath = join(config.videoDir, `${randomUUID()}.webm`)
      const starting = (async () => {
        await mkdir(config.videoDir, { recursive: true })
        await page.screencast.start({
          path: stagingPath,
          size: config.videoSize ?? page.viewportSize() ?? RECORDING_DEFAULT_SIZE,
        })
      })()
      active = { page, stagingPath, starting }
      try {
        await starting
      } catch (error) {
        try { await page.screencast.stop() } catch { /* best-effort */ }
        active = undefined
        throw error
      }
      return { zeroMs: performance.now() }
    },
    async stop() {
      const recording = active
      if (!recording) return undefined
      await recording.starting
      await recording.page.screencast.stop()
      active = undefined
      return { stagingPath: recording.stagingPath, contentType: 'video/webm' }
    },
  }
}
