// Chromium download and app-clipboard capture, armed per action (436 D-19..D-21). A download is
// awaited, streamed into sha-256 and deleted here; only its name, extension, size, digest and
// state leave. `path()` and `saveAs()` are never called and no path is ever recorded.
//
// Clipboard: a page-world hook reports the text the app writes through the binding. Only while an
// action other than agent-qa's own `copy` / `paste` is armed is a write kept, and only after a
// kept write is the clipboard read back. The text leaves raw; the loop masks and bounds it
// (CLIPBOARD_TEXT_LIMIT).
// 2026-10-08 (436-14): the read-back runs in an agent-qa-owned probe context at a reserved origin,
// never on an app origin, and only the index of the claimed write equal to the clipboard leaves
// the probe page (CR-01, IN-08). No app origin is ever granted `clipboard-read`.
// 2026-10-08 (436-15): the download wait of one action ends at the step's remaining time when the
// loop hands one over, else at DOWNLOAD_COMPLETION_CAP_MS (WR-07).

import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import type { BrowserContext, Download, Frame, Page } from 'playwright-core'
import type { ClipboardEvidence, DownloadEvidence } from '@vostride/agent-qa-schema'
import type { ExecuteOptions } from '@vostride/agent-qa-runner'

export { CLIPBOARD_TEXT_LIMIT } from '@vostride/agent-qa-runner'

/** How long an activation action is given to start a download after it returns. */
export const DOWNLOAD_START_GRACE_MS = 500
/** The download wait's bound for an action dispatched with no step deadline. */
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
/** The reserved origin of the read-back probe page; nothing else loads in the probe context. */
export const CLIPBOARD_READBACK_ORIGIN = 'https://agent-qa-readback.invalid'
const READ_BACK_UNREADABLE = -2

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
  // 2026-10-08 (436-14): a write is reported only once the browser accepted it; the app still
  // gets the original promise, rejections included.
  const proto = typeof Clipboard === 'function' ? Clipboard.prototype : undefined;
  if (proto && typeof proto.writeText === 'function') {
    const writeText = proto.writeText;
    proto.writeText = function (data) {
      let text;
      try { text = String(data); } catch {}
      const result = writeText.apply(this, arguments);
      try { Promise.resolve(result).then(() => report('writeText', text), () => {}); } catch {}
      return result;
    };
  }
  if (proto && typeof proto.write === 'function') {
    const write = proto.write;
    proto.write = function (items) {
      const texts = [];
      try {
        for (const item of Array.from(items || [])) {
          if (!item || !Array.from(item.types || []).includes('text/plain')) continue;
          texts.push(item.getType('text/plain').then((blob) => blob.text()).catch(() => undefined));
        }
      } catch {}
      const result = write.apply(this, arguments);
      try {
        Promise.resolve(result).then(
          () => Promise.all(texts).then((all) => { for (const text of all) report('write', text); }),
          () => {},
        );
      } catch {}
      return result;
    };
  }
  // A copy event is tracked from window's capture phase, which runs before any app handler can
  // stop propagation, and settled once dispatch is over: a prevented copy writes what the app
  // set (seen through setData), an unprevented one writes the selection taken at dispatch.
  let pending = null;
  const selected = (event) => {
    for (const el of [event.target, document.activeElement]) {
      if (!el || (el.tagName !== 'TEXTAREA' && el.tagName !== 'INPUT')) continue;
      try {
        const start = el.selectionStart, end = el.selectionEnd;
        if (typeof start === 'number' && typeof end === 'number' && end > start) return el.value.slice(start, end);
      } catch {}
    }
    const selection = document.getSelection();
    return selection ? selection.toString() : '';
  };
  const settle = () => {
    const copy = pending;
    pending = null;
    if (!copy) return;
    if (!copy.event.defaultPrevented) return report('copy-event', copy.selection);
    if (copy.set !== undefined) return report('copy-event', copy.set);
    try { report('copy-event', copy.event.clipboardData ? copy.event.clipboardData.getData('text/plain') : ''); } catch {}
  };
  if (typeof DataTransfer === 'function' && typeof DataTransfer.prototype.setData === 'function') {
    const setData = DataTransfer.prototype.setData;
    DataTransfer.prototype.setData = function (format, data) {
      if (pending && this === pending.event.clipboardData && /^text(\\/plain)?$/i.test(String(format))) pending.set = String(data);
      return setData.apply(this, arguments);
    };
  }
  window.addEventListener('copy', (event) => {
    settle();
    pending = { event, selection: selected(event), set: undefined };
    setTimeout(settle, 0);
  }, true);
})();`

export interface OperationCaptureOptions {
  /** The bound when the action carries no remaining step time. */
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
  private boundAt = 0
  private abortSignal: AbortSignal | undefined
  private notify: (() => void) | null = null
  private appContext: BrowserContext | null = null
  private probe: Promise<Page | undefined> | null = null
  private probeContext: BrowserContext | null = null
  private probeGeneration = 0

  constructor(options: OperationCaptureOptions = {}) {
    this.completionCapMs = options.completionCapMs ?? DOWNLOAD_COMPLETION_CAP_MS
    this.startGraceMs = options.startGraceMs ?? DOWNLOAD_START_GRACE_MS
  }

  async attach(context: BrowserContext): Promise<void> {
    this.appContext = context
    for (const page of context.pages()) this.attachPage(page)
    context.on('page', (page) => this.attachPage(page))
    await context.exposeBinding(CLIPBOARD_BINDING, (source, payload: unknown) => {
      this.onClipboardWrite(source.frame, payload)
    })
    await context.addInitScript(CLIPBOARD_HOOK)
  }

  arm(action: { type: string }, options: ExecuteOptions = {}): void {
    this.downloads = []
    this.clipboardWrites = []
    this.armed = true
    this.clipboardArmed = !CLIPBOARD_EXCLUDED_ACTIONS.has(action.type)
    this.activation = ACTIVATION_ACTIONS.has(action.type)
    const remaining = options.remainingStepMs
    this.boundAt = Date.now()
      + (typeof remaining === 'number' && Number.isFinite(remaining) ? Math.max(0, remaining) : this.completionCapMs)
    this.abortSignal = options.abortSignal
  }

  private timeLeft(): number {
    return this.boundAt - Date.now()
  }

  async collect(): Promise<CapturedOperations | undefined> {
    if (!this.armed) return undefined
    try {
      const deadline = Date.now() + (this.activation ? Math.min(this.startGraceMs, this.timeLeft()) : 0)
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
      this.abortSignal = undefined
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
    const index = await this.readClipboard(writes[last]!.frame, writes.map((write) => write.text))
    const matched = index !== undefined && index >= 0 ? writes[index]!.text : undefined
    return writes.map(({ source, text }, position) => ({
      source,
      text,
      readBack: index === undefined
        ? 'unavailable'
        : text === matched ? 'matched' : position === last ? 'mismatched' : 'unavailable',
    }))
  }

  // The index of the last claimed text equal to the clipboard, -1 for none, undefined when the
  // clipboard cannot be read. The clipboard text itself never leaves the probe page.
  private async readClipboard(frame: Frame, texts: string[]): Promise<number | undefined> {
    if (frame.isDetached()) return undefined
    try {
      if (new URL(frame.url()).origin === 'null') return undefined
    } catch {
      return undefined
    }
    const secure = await frame
      .evaluate('window.isSecureContext && !!(navigator.clipboard && navigator.clipboard.readText)')
      .catch(() => false)
    if (secure !== true) return undefined
    const probe = await this.openProbe()
    if (!probe) return undefined
    if (probe.isClosed()) {
      await this.dispose()
      return undefined
    }
    const index = await withTimeout(
      probe.evaluate(async (claimed: string[]) => {
        const scope = globalThis as unknown as {
          isSecureContext?: boolean
          navigator?: { clipboard?: { readText?: () => Promise<string> } }
        }
        const clipboard = scope.navigator?.clipboard
        if (scope.isSecureContext !== true || typeof clipboard?.readText !== 'function') return -2
        let text: string
        try {
          text = await clipboard.readText()
        } catch {
          return -2
        }
        return claimed.lastIndexOf(text)
      }, texts),
      READ_BACK_TIMEOUT_MS,
    ).catch(() => undefined)
    if (typeof index !== 'number' || index === READ_BACK_UNREADABLE || index >= texts.length) return undefined
    return index < 0 ? -1 : index
  }

  private openProbe(): Promise<Page | undefined> {
    this.probe ??= this.createProbe(this.probeGeneration)
    return this.probe
  }

  // A separate context of the app's browser: only the reserved origin loads (a blank document, no
  // init script), every other request is aborted, and only that origin may read the clipboard.
  private async createProbe(generation: number): Promise<Page | undefined> {
    let context: BrowserContext | undefined
    try {
      const browser = this.appContext?.browser()
      if (!browser) return undefined
      context = await browser.newContext()
      if (generation !== this.probeGeneration) {
        await context.close().catch(() => undefined)
        return undefined
      }
      this.probeContext = context
      await context.route('**/*', (route) => {
        let origin = ''
        try {
          origin = new URL(route.request().url()).origin
        } catch { /* aborted below */ }
        return origin === CLIPBOARD_READBACK_ORIGIN
          ? route.fulfill({ contentType: 'text/html', body: '<!doctype html>' })
          : route.abort()
      })
      await context.grantPermissions(['clipboard-read'], { origin: CLIPBOARD_READBACK_ORIGIN })
      const page = await context.newPage()
      await page.goto(`${CLIPBOARD_READBACK_ORIGIN}/`)
      return page
    } catch {
      if (generation === this.probeGeneration) {
        this.probe = null
        this.probeContext = null
      }
      await context?.close().catch(() => undefined)
      return undefined
    }
  }

  /** Closes the read-back probe context; the next read-back opens a fresh one. */
  async dispose(): Promise<void> {
    const context = this.probeContext
    this.probeGeneration += 1
    this.probe = null
    this.probeContext = null
    await context?.close().catch(() => undefined)
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
        timer = setTimeout(() => resolve(UNFINISHED), Math.max(0, this.timeLeft()))
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
