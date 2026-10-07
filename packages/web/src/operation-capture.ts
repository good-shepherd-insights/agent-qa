// Chromium download capture, armed per action (436 D-19, D-20). A download is awaited, streamed
// into sha-256 and deleted here; only its name, extension, size, digest and state leave.
// `path()` and `saveAs()` are never called and no path is ever recorded.

import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type { BrowserContext, Download, Page } from 'playwright-core'
import type { DownloadEvidence, OperationEvidence } from '@vostride/agent-qa-schema'

/** How long an activation action is given to start a download after it returns. */
export const DOWNLOAD_START_GRACE_MS = 500
/** The completion bound when the platform configures no step timeout. */
export const DOWNLOAD_COMPLETION_CAP_MS = 120_000

const ACTIVATION_ACTIONS: ReadonlySet<string> = new Set([
  'click',
  'doubleClick',
  'tap',
  'keypress',
  'press',
  'navigate',
  'select',
])

const UNFINISHED = Symbol('unfinished')

export interface OperationCaptureOptions {
  completionCapMs?: number
  startGraceMs?: number
}

export class OperationCapture {
  private readonly completionCapMs: number
  private readonly startGraceMs: number
  private readonly attachedPages = new WeakSet<Page>()
  private downloads: Download[] = []
  private armed = false
  private activation = false
  private notify: (() => void) | null = null

  constructor(options: OperationCaptureOptions = {}) {
    this.completionCapMs = options.completionCapMs ?? DOWNLOAD_COMPLETION_CAP_MS
    this.startGraceMs = options.startGraceMs ?? DOWNLOAD_START_GRACE_MS
  }

  attach(context: BrowserContext): void {
    for (const page of context.pages()) this.attachPage(page)
    context.on('page', (page) => this.attachPage(page))
  }

  arm(action: { type: string }): void {
    this.downloads = []
    this.armed = true
    this.activation = ACTIVATION_ACTIONS.has(action.type)
  }

  async collect(): Promise<OperationEvidence | undefined> {
    if (!this.armed) return undefined
    try {
      const deadline = Date.now() + (this.activation ? this.startGraceMs : 0)
      const evidence: DownloadEvidence[] = []
      let next = 0
      for (;;) {
        if (next >= this.downloads.length) {
          const remaining = deadline - Date.now()
          if (remaining <= 0) break
          await this.waitForDownloadStart(remaining, next)
          if (next >= this.downloads.length) break
        }
        evidence.push(await this.finish(this.downloads[next++]!))
      }
      return evidence.length > 0 ? { downloads: evidence } : undefined
    } finally {
      this.armed = false
      this.downloads = []
    }
  }

  private attachPage(page: Page): void {
    if (this.attachedPages.has(page)) return
    this.attachedPages.add(page)
    page.on('download', (download) => {
      if (!this.armed) return
      this.downloads.push(download)
      this.notify?.()
    })
  }

  private async waitForDownloadStart(graceMs: number, seen: number): Promise<void> {
    if (this.downloads.length > seen) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, graceMs)
      function done(): void {
        clearTimeout(timer)
        resolve()
      }
      this.notify = done
    })
    this.notify = null
  }

  private async finish(download: Download): Promise<DownloadEvidence> {
    const suggestedFilename = download.suggestedFilename()
    const base: Pick<DownloadEvidence, 'suggestedFilename' | 'extension'> = {
      suggestedFilename,
      extension: extname(suggestedFilename),
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const outcome = await Promise.race([
      download.failure().catch((error: unknown) => (error instanceof Error ? error.message : String(error))),
      new Promise<typeof UNFINISHED>((resolve) => {
        timer = setTimeout(() => resolve(UNFINISHED), this.completionCapMs)
      }),
    ])
    clearTimeout(timer)
    if (outcome === UNFINISHED) {
      await download.cancel().catch(() => undefined)
      await download.delete().catch(() => undefined)
      return { ...base, state: 'unfinished' }
    }
    if (outcome !== null) {
      await download.delete().catch(() => undefined)
      return { ...base, state: outcome === 'canceled' ? 'canceled' : 'failed', failure: outcome }
    }
    try {
      const { size, sha256 } = await digest(download)
      return { ...base, size, sha256, state: 'completed' }
    } catch (error) {
      return { ...base, state: 'failed', failure: error instanceof Error ? error.message : String(error) }
    } finally {
      await download.delete().catch(() => undefined)
    }
  }
}

async function digest(download: Download): Promise<{ size: number; sha256: string }> {
  const stream = await download.createReadStream()
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of stream) {
    const bytes = chunk as Buffer
    size += bytes.length
    hash.update(bytes)
  }
  return { size, sha256: hash.digest('hex') }
}
