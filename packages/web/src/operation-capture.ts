// Chromium download and app-clipboard capture, armed per action (436 D-19..D-21). A download is
// awaited, streamed into sha-256 and deleted here; only its name, extension, size, digest and
// state leave. `path()` and `saveAs()` are never called and no path is ever recorded.
//
// Clipboard: a page-world hook reports the text the app writes through the binding. Only while an
// action other than agent-qa's own `copy` / `paste` is armed is a write kept, and only after a
// kept write is the clipboard read back, under a `clipboard-read` grant that lasts for that read.
// The text leaves raw; the loop masks and bounds it (CLIPBOARD_TEXT_LIMIT).

import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type { BrowserContext, Download, Frame, Page } from 'playwright-core'
import type { ClipboardEvidence, DownloadEvidence } from '@vostride/agent-qa-schema'

export { CLIPBOARD_TEXT_LIMIT } from '@vostride/agent-qa-runner'

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

/** The binding the page-world hook reports app clipboard writes through. */
export const CLIPBOARD_BINDING = '__agentQaAppClipboardWrite'
/** agent-qa's own clipboard actions; their writes are never the app's. */
const CLIPBOARD_EXCLUDED_ACTIONS: ReadonlySet<string> = new Set(['copy', 'paste'])
const CLIPBOARD_SOURCES: ReadonlySet<string> = new Set(['writeText', 'write', 'copy-event'])
const READ_BACK_TIMEOUT_MS = 2_000

export type CapturedClipboardWrite = Pick<ClipboardEvidence, 'source' | 'text' | 'readBack'>

/** What one armed action produced; the clipboard text is raw until the loop masks it. */
export interface CapturedOperations {
  downloads?: DownloadEvidence[]
  clipboard?: CapturedClipboardWrite[]
}

interface PendingClipboardWrite {
  source: ClipboardEvidence['source']
  text: string
  frame: Frame
}

const CLIPBOARD_HOOK = `(() => {
  const binding = ${JSON.stringify(CLIPBOARD_BINDING)};
  const report = (via, text) => {
    const send = window[binding];
    if (typeof send !== 'function' || typeof text !== 'string' || text.length === 0) return;
    try { Promise.resolve(send({ via, text })).catch(() => {}); } catch {}
  };
  const proto = typeof Clipboard === 'function' ? Clipboard.prototype : undefined;
  if (proto && typeof proto.writeText === 'function') {
    const writeText = proto.writeText;
    proto.writeText = function (data) {
      report('writeText', String(data));
      return writeText.apply(this, arguments);
    };
  }
  if (proto && typeof proto.write === 'function') {
    const write = proto.write;
    proto.write = function (items) {
      try {
        for (const item of Array.from(items || [])) {
          if (!item || !Array.from(item.types || []).includes('text/plain')) continue;
          item.getType('text/plain').then((blob) => blob.text()).then((text) => report('write', text), () => {});
        }
      } catch {}
      return write.apply(this, arguments);
    };
  }
  window.addEventListener('copy', (event) => {
    if (!event.defaultPrevented || !event.clipboardData) return;
    report('copy-event', event.clipboardData.getData('text/plain'));
  }, false);
})();`

export interface OperationCaptureOptions {
  completionCapMs?: number
  startGraceMs?: number
}

export class OperationCapture {
  private readonly completionCapMs: number
  private readonly startGraceMs: number
  private readonly attachedPages = new WeakSet<Page>()
  private downloads: Download[] = []
  private clipboardWrites: PendingClipboardWrite[] = []
  private armed = false
  private clipboardArmed = false
  private activation = false
  private notify: (() => void) | null = null

  constructor(options: OperationCaptureOptions = {}) {
    this.completionCapMs = options.completionCapMs ?? DOWNLOAD_COMPLETION_CAP_MS
    this.startGraceMs = options.startGraceMs ?? DOWNLOAD_START_GRACE_MS
  }

  async attach(context: BrowserContext): Promise<void> {
    for (const page of context.pages()) this.attachPage(page)
    context.on('page', (page) => this.attachPage(page))
    await context.exposeBinding(CLIPBOARD_BINDING, (source, payload: unknown) => {
      this.onClipboardWrite(source.frame, payload)
    })
    await context.addInitScript(CLIPBOARD_HOOK)
  }

  arm(action: { type: string }): void {
    this.downloads = []
    this.clipboardWrites = []
    this.armed = true
    this.clipboardArmed = !CLIPBOARD_EXCLUDED_ACTIONS.has(action.type)
    this.activation = ACTIVATION_ACTIONS.has(action.type)
  }

  async collect(): Promise<CapturedOperations | undefined> {
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
      const writes = this.clipboardWrites
      this.clipboardArmed = false
      this.clipboardWrites = []
      const clipboard = writes.length > 0 ? await this.readBack(writes) : []
      if (evidence.length === 0 && clipboard.length === 0) return undefined
      return {
        ...(evidence.length > 0 ? { downloads: evidence } : {}),
        ...(clipboard.length > 0 ? { clipboard } : {}),
      }
    } finally {
      this.armed = false
      this.clipboardArmed = false
      this.downloads = []
      this.clipboardWrites = []
    }
  }

  private onClipboardWrite(frame: Frame, payload: unknown): void {
    if (!this.armed || !this.clipboardArmed) return
    if (!payload || typeof payload !== 'object') return
    const { via, text } = payload as Record<string, unknown>
    if (typeof via !== 'string' || !CLIPBOARD_SOURCES.has(via) || typeof text !== 'string') return
    this.clipboardWrites.push({ source: via as ClipboardEvidence['source'], text, frame })
  }

  // The clipboard holds only the last write, so the read-back confirms that one; an earlier write
  // whose text differs was overwritten and cannot be confirmed either way.
  private async readBack(writes: PendingClipboardWrite[]): Promise<CapturedClipboardWrite[]> {
    const last = writes.length - 1
    const read = await this.readClipboard(writes[last]!.frame)
    return writes.map(({ source, text }, index) => ({
      source,
      text,
      readBack: read === undefined
        ? 'unavailable'
        : read === text ? 'matched' : index === last ? 'mismatched' : 'unavailable',
    }))
  }

  private async readClipboard(frame: Frame): Promise<string | undefined> {
    if (frame.isDetached()) return undefined
    let origin: string
    try {
      origin = new URL(frame.url()).origin
    } catch {
      return undefined
    }
    if (origin === 'null') return undefined
    const readable = await frame
      .evaluate('window.isSecureContext && !!(navigator.clipboard && navigator.clipboard.readText)')
      .catch(() => false)
    if (readable !== true) return undefined
    const context = frame.page().context()
    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin })
      const text = await withTimeout(frame.evaluate('navigator.clipboard.readText()'), READ_BACK_TIMEOUT_MS)
      return typeof text === 'string' ? text : undefined
    } catch {
      return undefined
    } finally {
      await context.clearPermissions().catch(() => undefined)
      await context.grantPermissions(['clipboard-write']).catch(() => undefined)
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

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms) }),
    ])
  } finally {
    clearTimeout(timer)
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
