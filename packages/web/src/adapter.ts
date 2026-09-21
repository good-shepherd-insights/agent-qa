import type { Browser, BrowserContext, CDPSession, Dialog, Page } from 'playwright-core'
import type {
  ActionsFor,
  ActionResult,
  ConsoleLogEntry,
  LiveStreamCapability,
  NetworkLogEntry,
  ObserveOptions,
  PlatformAdapter,
  PlatformConfig,
  RecordingCapability,
} from '@vostride/agent-qa-runner'
import type { LiveFrame } from '@vostride/agent-qa-schema'
import { assertNever, buildScreenState } from '@vostride/agent-qa-runner'
import type { ScreenState } from '@vostride/agent-qa-schema'
import { convertKeysForPlatform, isMacPlatform } from '@vostride/agent-qa-runner'
import { parseAriaSnapshot, enrichWebNodes, captureWebScroll } from './observer.js'
import { extractDom } from './dom-extractor.js'
import { ElementResolver, buildRefMap } from './element-resolver.js'
import { validateAction } from './action-validator.js'
import { waitForPageReady } from './smart-wait.js'
import { runWebFillCompound, runWebScrollCompound, webOpenAppError } from './compound-web.js'
import type { RefMap } from './types.js'
import { formatMissingBrowserError, isPlaywrightMissingBrowserError } from './browser-install-error.js'
import { createScreencastRecording } from './recording.js'

// Browser-context hygiene: hide framework-injected [data-agent-qa-internal] overlays
// from the ARIA snapshot (they would otherwise get ai-mode refs and pollute the state),
// then restore them. `(globalThis as any).document` is used because the Node tsconfig
// carries no DOM lib — these serialize and run in the browser.
function hideAgentQaElements() {
  const doc = (globalThis as any).document
  doc.querySelectorAll('[data-agent-qa-internal]').forEach((el: any) => {
    el.style.display = 'none'
    el.setAttribute('aria-hidden', 'true')
  })
}

function restoreAgentQaElements() {
  const doc = (globalThis as any).document
  doc.querySelectorAll('[data-agent-qa-internal]').forEach((el: any) => {
    el.style.display = ''
    el.removeAttribute('aria-hidden')
  })
}

interface PageLogBuffers {
  consoleLogs: ConsoleLogEntry[]
  networkLogs: NetworkLogEntry[]
  consoleDrainIndex: number
  networkDrainIndex: number
  pendingRequests: Map<string, { url: string; method: string; headers: Record<string, string>; startTime: number; postData?: string }>
}

function clickDelayOption(clickDelay?: number): { delay?: number } {
  return clickDelay !== undefined && clickDelay > 0 ? { delay: clickDelay } : {}
}

// The Plan 10 dispatch seam injects the persisted raw Playwright storage-state blob onto a
// `storageState`/restore action before it reaches the adapter (the schema restore shape carries
// only `{op,name}`; the adapter never reads it off disk — D-14). Reading that seam field lives in
// this `unknown`-typed helper so no cast leaks into the execute switch (no-shims law).
function readSeamStorageState(action: unknown): Parameters<BrowserContext['setStorageState']>[0] {
  return (action as { state: Parameters<BrowserContext['setStorageState']>[0] }).state
}

/**
 * The `Page.startScreencast` parameters this adapter ships (403 discretion D-06).
 *
 * WHAT MAKES THE STREAM CHANGE-DRIVEN is the ack, not a parameter: CDP emits a frame when the
 * compositor produces one and then stalls until `Page.screencastFrameAck` arrives, so a static page
 * produces (almost) nothing — precisely the property a screenshot-polling implementation cannot
 * have. `live-stream.screencast.test.ts` measures both halves on a real Chromium: an animating page
 * yields hundreds of frames in 3 s WITH acks and 3 without, and a static page yields at most one.
 *
 * `maxFramesInFlight` IS NOT A CDP PARAMETER and was removed after being measured to do nothing:
 * with and without it, an unacked stream delivered the same 3 frames per 3 s. Chromium tolerates
 * the unknown key silently, which is how a comment claiming "exactly one in flight" survived — the
 * bound is Chromium's own, and the ack is what releases it.
 */
export const SCREENCAST_PARAMS = {
  format: 'jpeg',
  quality: 60,
  maxWidth: 1280,
  maxHeight: 720,
  everyNthFrame: 1,
} as const

/**
 * How many un-acked CDP ack tokens the producer will remember.
 *
 * Chromium keeps only a couple of frames in flight, so this is generous by two orders of magnitude;
 * it exists so a viewer that stops acking cannot grow the map without bound. An evicted token is
 * ACKED on its way out rather than dropped, because a token nobody acks is a producer that stalls
 * forever — the failure this whole ack path exists to avoid.
 */
const SCREENCAST_ACK_WINDOW = 64

/** Decode a CDP base64 frame payload to bytes without a `Buffer` round-trip in the hot path. */
function decodeBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export class WebPlatformAdapter implements PlatformAdapter<'web'> {
  readonly platform = 'web' as const

  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private page: Page | null = null
  // Execute-time resolution record, re-fed from the builder binding after each observe.
  // The binding itself never crosses the port (observe returns only the ScreenState).
  private lastRefs: RefMap = {}
  private pageLogBuffers = new Map<Page, PageLogBuffers>()
  private logCaptureConfig: { console: boolean; network: boolean } = { console: true, network: true }
  private disconnected = false
  private intentionalClose = false
  // Persistent route interception + one-shot dialog arms live until an explicit unroute or
  // test teardown (D-12/D-18); cleanup() drains both so nothing bleeds across tests (Pitfall 7).
  private armedRoutes = new Set<string>()
  private pendingDialogArm: ((dialog: Dialog) => void) | null = null
  // 403 D-05: the live screencast's CDP session, owned here and never handed out.
  private browserName: 'chromium' | 'firefox' | 'webkit' = 'chromium'
  private screencast: CDPSession | null = null
  private screencastCapability: LiveStreamCapability | null = null
  private recordingCapability: RecordingCapability | undefined
  private recordingPageRevision = 0
  private recordingConfig: PlatformConfig['recording']
  // 403-02: the PRODUCT's frame identity, and the CDP ack token it maps to. See `liveStream`.
  private screencastFrameSeq = 0
  private screencastAckTokens = new Map<number, number>()

  async setup(config: PlatformConfig): Promise<void> {
    this.recordingConfig = config.recording
    const { chromium, firefox, webkit } = await import('playwright-core')
    const launchers = { chromium, firefox, webkit } as const
    const browserName = config.browser?.name ?? 'chromium'
    this.browserName = browserName
    const launcher = launchers[browserName]

    try {
      this.browser = await launcher.launch({
        headless: config.browser?.headless ?? true,
        ...(browserName === 'chromium' ? { args: ['--disable-blink-features=AutomationControlled'] } : {}),
      })
    } catch (error) {
      if (isPlaywrightMissingBrowserError(error)) {
        throw new Error(formatMissingBrowserError(browserName))
      }
      throw error
    }

    this.disconnected = false
    this.intentionalClose = false
    this.browser.on('disconnected', () => {
      if (!this.intentionalClose) {
        this.disconnected = true
      }
    })

    const contextOptions: Record<string, unknown> = {
      viewport: config.browser?.viewport ?? { width: 1280, height: 720 },
    }
    if (config.authState?.storageStatePath) {
      contextOptions.storageState = config.authState.storageStatePath
    }
    this.context = await this.browser.newContext(contextOptions)

    // Clipboard write permission — chromium only (firefox/webkit reject this permission per Pitfall 3)
    if (browserName === 'chromium') {
      await this.context.grantPermissions(['clipboard-write'])
    }

    this.logCaptureConfig = { console: config.logCapture?.console !== false, network: config.logCapture?.network !== false }

    // Hide automation signals so bot-protected sites don't redirect
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false })
    })

    this.page = await this.context.newPage()
    this.attachLogListeners(this.page)
  }

  /**
   * 403 D-05/LIVE-01: the Chromium screencast producer, or ABSENT when this adapter cannot stream.
   *
   * Absence is the honest declaration (`{ kind: 'none' }` downstream) — there is deliberately no
   * `page.screenshot()` fallback anywhere on this path, because polling would satisfy a
   * "frames arrived" test while being a different product (LIVE-01's prohibition).
   *
   * SCOPE (Pitfall 6): the screencast binds to `this.page` at `start`. A step that acts on another
   * tab keeps showing the page the stream started on; multi-tab follow is a follow-up WINDOWS entry,
   * not silent behaviour — the capability is re-created per `start`, so a future page-switch hook
   * only needs to stop-and-start it.
   */
  get liveStream(): LiveStreamCapability | undefined {
    if (this.browserName !== 'chromium') return undefined
    if (!this.page || !this.context) return undefined
    if (this.screencastCapability) return this.screencastCapability
    const capability: LiveStreamCapability = {
      kind: 'cdp-screencast',
      start: async (onFrame: (frame: LiveFrame) => void): Promise<void> => {
        if (this.screencast) return
        const page = this.page
        const context = this.context
        if (!page || !context) return
        const cdp = await context.newCDPSession(page)
        this.screencast = cdp
        this.screencastAckTokens.clear()
        cdp.on('Page.screencastFrame', (event) => {
          const metadata = event.metadata
          // `LiveFrame.id` IS NOT `event.sessionId`, AND CONFLATING THEM WAS A BUG (403-02).
          //
          // `sessionId` is CDP's ack TOKEN. Measured on Chromium 1.59.1 it is `1` for every frame
          // of a stream — 281 frames, one distinct value. `LiveFrame.id` is the PRODUCT's frame
          // identity: the hub keys its per-frame ack quorum on it, the wire protocol pairs a
          // `frame` header with an `ack` by it, and the embed page correlates its pending header
          // with the binary that follows by it. A constant id makes the hub's second
          // `awaiting.set(id, …)` overwrite the first — orphaning its bound timer and dropping the
          // outstanding set, so one frame is acked twice and another never at all.
          //
          // So the adapter mints a monotonic id and remembers which CDP token it stands for.
          const id = ++this.screencastFrameSeq
          this.screencastAckTokens.set(id, event.sessionId)
          // Bound the map. An evicted token is acked on its way out: an un-acked token is a
          // producer stalled forever, which is worse than a frame nobody watched.
          while (this.screencastAckTokens.size > SCREENCAST_ACK_WINDOW) {
            const oldest = this.screencastAckTokens.keys().next()
            if (oldest.done === true) break
            const token = this.screencastAckTokens.get(oldest.value)
            this.screencastAckTokens.delete(oldest.value)
            if (token !== undefined) {
              void cdp.send('Page.screencastFrameAck', { sessionId: token }).catch(() => undefined)
            }
          }
          onFrame({
            id,
            bytes: decodeBase64(event.data),
            metadata: {
              width: metadata.deviceWidth,
              height: metadata.deviceHeight,
              ...(metadata.timestamp === undefined ? {} : { timestamp: metadata.timestamp }),
              scrollOffsetX: metadata.scrollOffsetX,
              scrollOffsetY: metadata.scrollOffsetY,
            },
          })
        })
        await cdp.send('Page.startScreencast', { ...SCREENCAST_PARAMS })
      },
      ack: async (frameId: number): Promise<void> => {
        const cdp = this.screencast
        if (!cdp) return
        const sessionId = this.screencastAckTokens.get(frameId)
        this.screencastAckTokens.delete(frameId)
        // An ack for a frame this producer never minted (a stale viewer, a re-started stream) is
        // dropped rather than forwarded: acking an arbitrary token is worse than acking nothing.
        if (sessionId === undefined) return
        try {
          await cdp.send('Page.screencastFrameAck', { sessionId })
        } catch {
          // Acking after stop (or after the page navigated away) is expected, never an error.
        }
      },
      stop: async (): Promise<void> => {
        const cdp = this.screencast
        this.screencast = null
        this.screencastAckTokens.clear()
        if (!cdp) return
        try { await cdp.send('Page.stopScreencast') } catch { /* best-effort */ }
        try { await cdp.detach() } catch { /* best-effort */ }
      },
    }
    this.screencastCapability = capability
    return capability
  }

  get recording(): RecordingCapability | undefined {
    if (!this.page || !this.context || !this.recordingConfig) return undefined
    return this.recordingCapability ??= createScreencastRecording(
      () => this.page,
      this.recordingConfig,
      () => this.recordingPageRevision,
    )
  }

  async cleanup(): Promise<void> {
    this.intentionalClose = true
    try { await this.recordingCapability?.stop() } catch { /* best-effort */ }
    this.recordingCapability = undefined
    this.recordingConfig = undefined
    // 403: stop the screencast before the browser goes away so the CDP session is detached cleanly.
    try { await this.screencastCapability?.stop() } catch { /* best-effort */ }
    this.screencastCapability = null
    // Pitfall 7: clear persistent route interception, network emulation, and any pending
    // dialog arm BEFORE closing the browser so state never bleeds into the next test.
    if (this.context) {
      try { await this.context.unrouteAll({ behavior: 'ignoreErrors' }) } catch { /* best-effort */ }
      try { await this.context.setOffline(false) } catch { /* best-effort */ }
    }
    if (this.page && this.pendingDialogArm) {
      try { this.page.off('dialog', this.pendingDialogArm) } catch { /* best-effort */ }
    }
    this.armedRoutes.clear()
    this.pendingDialogArm = null
    if (this.browser) {
      await this.browser.close()
    }
    this.browser = null
    this.context = null
    this.page = null
    this.lastRefs = {}
    this.pageLogBuffers.clear()
    this.disconnected = false
    this.intentionalClose = false
    this.screencast = null
    this.screencastAckTokens.clear()
  }

  get isBrowserDisconnected(): boolean {
    return this.disconnected
  }

  async observe(options?: ObserveOptions): Promise<ScreenState> {
    if (!this.page) {
      throw new Error('WebPlatformAdapter not initialized — call setup() first')
    }
    const page = this.page

    await waitForPageReady(page)

    // ai-mode snapshot: Playwright annotates each element with a native [ref=eN] handle
    // (adapter-PRIVATE) that aria-ref locators resolve against — the enrichment ground
    // truth. Hide framework overlays around the snapshot, always restoring them.
    await page.evaluate(hideAgentQaElements)
    let ariaTree: string
    try {
      ariaTree = await page.locator(':root').ariaSnapshot({ mode: 'ai' })
    } finally {
      await page.evaluate(restoreAgentQaElements)
    }

    // parse -> enrich -> scroll: the interim-node walker (352-03), exact per-element
    // enrichment via aria-ref locators, and exact window scroll/viewport capture.
    const { nodes, nativeRefs } = parseAriaSnapshot(ariaTree)
    if (nodes.length > 0) {
      await enrichWebNodes(page, nodes, nativeRefs)
    }
    const { viewport, scroll } = await captureWebScroll(page)

    // domContext is web-only (D-04), captured only when the loop asks for it.
    let domContext: string | undefined
    if (options?.extractDom) {
      try {
        domContext = await extractDom(page)
      } catch {
        // DOM extraction is best-effort — never block observation.
      }
    }

    // The shared runner builder mints refs, normalizes names, and assembles the schema
    // v2 ScreenState. The binding stays adapter-private; only the state crosses the port.
    const { state, binding } = buildScreenState({
      platform: 'web',
      nodes,
      viewport,
      scroll,
      coordSpace: 'viewport',
      timestamp: Date.now(),
      url: page.url(),
      ...(domContext !== undefined ? { domContext } : {}),
    })

    this.lastRefs = buildRefMap(binding, nodes)
    return state
  }

  async execute(action: ActionsFor<'web'>): Promise<ActionResult> {
    if (!this.page) {
      throw new Error('WebPlatformAdapter not initialized — call setup() first')
    }

    try {
      return await this.executeAction(action)
    } catch (err) {
      let screenshot: Buffer | undefined
      let boundingBox: { x: number; y: number; width: number; height: number } | undefined
      try {
        screenshot = await this.page.screenshot({ scale: 'css' })
      } catch {
        // ignore screenshot failure
      }
      try {
        if ('ref' in action && typeof (action as any).ref === 'string') {
          const resolver = new ElementResolver(this.page, this.lastRefs)
          const box = await resolver.getBoundingBox((action as any).ref)
          if (box) boundingBox = box
        }
      } catch {
        // ignore bounding box failure
      }
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        screenshot,
        boundingBox,
      }
    }
  }

  async screenshot(): Promise<Buffer | undefined> {
    try {
      if (this.page) {
        return await this.page.screenshot({ scale: 'css' })
      }
      return undefined
    } catch {
      return undefined
    }
  }

  getPage(): Page | null {
    return this.page
  }

  drainConsoleLogs(level?: string): ConsoleLogEntry[] {
    const all: ConsoleLogEntry[] = []
    for (const buffers of this.pageLogBuffers.values()) {
      const newLogs = buffers.consoleLogs.slice(buffers.consoleDrainIndex)
      buffers.consoleDrainIndex = buffers.consoleLogs.length
      all.push(...newLogs)
    }
    if (!level) return all
    return all.filter(e => e.level === level)
  }

  drainNetworkLogs(urlPattern?: string): NetworkLogEntry[] {
    const all: NetworkLogEntry[] = []
    for (const buffers of this.pageLogBuffers.values()) {
      const newLogs = buffers.networkLogs.slice(buffers.networkDrainIndex)
      buffers.networkDrainIndex = buffers.networkLogs.length
      all.push(...newLogs)
    }
    if (!urlPattern) return all
    return all.filter(e => e.url.includes(urlPattern))
  }

  private attachLogListeners(page: Page): void {
    const buffers: PageLogBuffers = {
      consoleLogs: [],
      networkLogs: [],
      consoleDrainIndex: 0,
      networkDrainIndex: 0,
      pendingRequests: new Map(),
    }
    this.pageLogBuffers.set(page, buffers)

    if (this.logCaptureConfig.console) {
      page.on('console', (msg) => {
        buffers.consoleLogs.push({
          level: msg.type(),
          text: msg.text(),
          location: msg.location(),
          timestamp: Date.now(),
        })
        if (buffers.consoleLogs.length > 1000) {
          buffers.consoleLogs = buffers.consoleLogs.slice(-500)
        }
      })
    }

    if (this.logCaptureConfig.network) {
      page.on('request', (request) => {
        buffers.pendingRequests.set(request.url() + request.method(), {
          url: request.url(),
          method: request.method(),
          headers: request.headers(),
          startTime: Date.now(),
          postData: request.postData() ?? undefined,
        })
      })

      page.on('response', async (response) => {
        const key = response.url() + response.request().method()
        const pending = buffers.pendingRequests.get(key)
        buffers.pendingRequests.delete(key)

        let body: string | undefined
        try {
          const buf = await response.body()
          const ct = response.headers()['content-type'] ?? ''
          if (ct.includes('image/') && !ct.includes('svg')) {
            body = buf.length > 32768 ? undefined : `data:${ct.split(';')[0]};base64,${buf.toString('base64')}`
          } else {
            const text = buf.toString('utf-8')
            body = text.length > 32768 ? text.slice(0, 32768) + '...[truncated]' : text
          }
        } catch {
          body = undefined
        }

        buffers.networkLogs.push({
          url: response.url(),
          method: response.request().method(),
          status: response.status(),
          requestHeaders: pending?.headers ?? response.request().headers(),
          responseHeaders: response.headers(),
          body,
          requestBody: pending?.postData,
          startTime: pending?.startTime ?? Date.now(),
          endTime: Date.now(),
          timing: response.request().timing(),
        })
        if (buffers.networkLogs.length > 500) {
          buffers.networkLogs = buffers.networkLogs.slice(-250)
        }
      })
    }
  }

  private async resolveTabTargetAsync(tab: { index?: number; title?: string; url?: string }): Promise<Page | undefined> {
    const pages = this.context!.pages()
    if (tab.index !== undefined) {
      return (tab.index >= 0 && tab.index < pages.length) ? pages[tab.index] : undefined
    }
    if (tab.title) {
      for (const p of pages) {
        const t = await p.title()
        if (t.includes(tab.title)) return p
      }
      return undefined
    }
    if (tab.url) {
      return pages.find(p => p.url().includes(tab.url!))
    }
    return undefined
  }

  private async executeAction(action: ActionsFor<'web'>): Promise<ActionResult> {
    const page = this.page!
    const resolver = new ElementResolver(page, this.lastRefs)

    // Validate action-element compatibility for ref-targeting actions
    if ('ref' in action && typeof (action as any).ref === 'string') {
      const refData = this.lastRefs[(action as any).ref]
      const role = refData?.role
      const validation = validateAction(action, role)
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }
    }

    switch (action.type) {
      case 'click': {
        const locator = resolver.resolve(action.ref)
        const box = await resolver.getBoundingBox(action.ref)
        const coordinates = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : undefined
        await locator.click({
          ...clickDelayOption(action.clickDelay),
        })
        return { success: true, coordinates, boundingBox: box ?? undefined }
      }

      case 'fill': {
        const locator = resolver.resolve(action.ref)
        const box = await resolver.getBoundingBox(action.ref)
        return runWebFillCompound(locator, box ?? undefined, action)
      }

      case 'openApp': {
        return webOpenAppError()
      }

      case 'select': {
        const locator = resolver.resolve(action.ref)
        const box = await resolver.getBoundingBox(action.ref)
        await locator.selectOption(action.value)
        return { success: true, boundingBox: box ?? undefined }
      }

      case 'navigate': {
        // Fold re-key: the schema `to` discriminant drives url/history/reload on the proven
        // legacy bodies (goto / goBack|goForward / reload).
        switch (action.to) {
          case 'url':
            await page.goto(action.url, { waitUntil: 'domcontentloaded' })
            break
          case 'back':
            await page.goBack({ waitUntil: 'domcontentloaded' })
            break
          case 'forward':
            await page.goForward({ waitUntil: 'domcontentloaded' })
            break
          case 'reload':
            await page.reload({ waitUntil: 'domcontentloaded' })
            break
        }
        await waitForPageReady(page)
        return { success: true }
      }

      case 'scroll': {
        return runWebScrollCompound(page, this.lastRefs, action)
      }

      case 'waitFor': {
        // Schema on-shapes drive real waiting keyed on `text`/`selector` (the degenerate
        // legacy `{condition,timeout}` read is retired — Pitfall 1). Best-effort: on timeout we
        // still return success so the agent loop re-observes rather than hard-failing the step.
        const timeout = action.timeoutMs
        try {
          switch (action.on) {
            case 'text':
              await page.getByText(action.text).first().waitFor({ state: 'visible', timeout })
              break
            case 'gone':
              await page.getByText(action.text).first().waitFor({ state: 'hidden', timeout })
              break
            case 'selector':
              await page.waitForSelector(action.selector, { timeout })
              break
          }
        } catch {
          // Best-effort — condition never satisfied; let the loop re-observe.
        }
        return { success: true }
      }

      case 'delay': {
        await page.waitForTimeout(action.ms)
        return { success: true }
      }

      case 'waitForUrl': {
        try {
          // Explicit 30s timeout overrides Playwright's infinite default (Pitfall 2)
          await page.waitForURL(action.pattern, { timeout: 30_000 })
          return { success: true }
        } catch (err) {
          return {
            success: false,
            error: `URL pattern "${action.pattern}" did not match within 30s. Hint: use "**" wildcards for substring matching (e.g., "**/dashboard**"). ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      }

      case 'keypress': {
        // Fold re-key of keyDown/keyUp: the schema `mode` selects press / down / up on the
        // platform-normalized keys.
        const effectiveKeys = convertKeysForPlatform(action.keys, {
          enabled: action.convertPlatformKeys !== false,
          isMac: isMacPlatform(),
        })
        for (const key of effectiveKeys) {
          if (action.mode === 'down') {
            await page.keyboard.down(key)
          } else if (action.mode === 'up') {
            await page.keyboard.up(key)
          } else {
            await page.keyboard.press(key)
          }
        }
        return { success: true }
      }

      case 'hover': {
        const locator = resolver.resolve(action.ref)
        const box = await resolver.getBoundingBox(action.ref)
        await locator.hover()
        return { success: true, boundingBox: box ?? undefined }
      }

      case 'paste': {
        const locator = resolver.resolve(action.ref)
        const box = await resolver.getBoundingBox(action.ref)
        await locator.focus()
        await page.evaluate(`(() => {
          const el = document.activeElement;
          if (!el) return;
          const dt = new DataTransfer();
          dt.setData('text/plain', ${JSON.stringify(action.value)});
          el.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: dt,
            bubbles: true,
            cancelable: true,
          }));
        })()`)
        return { success: true, boundingBox: box ?? undefined }
      }

      case 'fileUpload': {
        // Paths are pre-resolved to absolute by runner loop.ts (see Plan 01 Task 2)
        const { existsSync } = await import('node:fs')
        for (const filePath of action.files) {
          if (!existsSync(filePath)) {
            return { success: false, error: `File not found: ${filePath}` }
          }
        }
        const locator = resolver.resolve(action.ref)
        const box = await resolver.getBoundingBox(action.ref)
        await locator.setInputFiles(action.files)
        return { success: true, boundingBox: box ?? undefined }
      }

      case 'copy': {
        const locator = resolver.resolve(action.ref)
        const box = await resolver.getBoundingBox(action.ref)
        const text = (await locator.textContent()) ?? ''
        await page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(text)})`)
        return { success: true, boundingBox: box ?? undefined, data: { copied: text } }
      }

      case 'tab': {
        // Fold re-key of newTab/switchTab: `action` discriminant selects open-new vs switch.
        if (action.action === 'new') {
          const newPage = await this.context!.newPage()
          this.attachLogListeners(newPage)
          await newPage.goto(action.url, { waitUntil: 'domcontentloaded' })
          await waitForPageReady(newPage)
          this.page = newPage
          this.recordingPageRevision++
          return { success: true }
        }
        const pages = this.context!.pages()
        let target: Page | undefined
        if (action.index !== undefined) {
          if (action.index < 0 || action.index >= pages.length) {
            return { success: false, error: `Tab index ${action.index} out of range (${pages.length} tabs open)` }
          }
          target = pages[action.index]
        } else if (action.title !== undefined) {
          for (const p of pages) {
            const t = await p.title()
            if (t.includes(action.title)) { target = p; break }
          }
        } else if (action.url !== undefined) {
          target = pages.find(p => p.url().includes(action.url!))
        }
        if (!target) {
          return { success: false, error: `No tab found matching ${JSON.stringify({ index: action.index, title: action.title, url: action.url })}` }
        }
        this.page = target
        this.recordingPageRevision++
        return { success: true }
      }

      case 'inspect': {
        // Fold re-key of the four read* verbs; output rides ActionResult.data through the
        // existing guardActionData/guardBlob compaction path (no new compaction).
        switch (action.what) {
          case 'console': {
            let entries: ConsoleLogEntry[]
            if (action.tab) {
              const targetPage = await this.resolveTabTargetAsync(action.tab)
              if (!targetPage) {
                return { success: false, error: `No tab found matching ${JSON.stringify(action.tab)}` }
              }
              const buffers = this.pageLogBuffers.get(targetPage)
              entries = buffers ? [...buffers.consoleLogs] : []
            } else {
              entries = []
              for (const buffers of this.pageLogBuffers.values()) {
                entries.push(...buffers.consoleLogs)
              }
            }
            if (action.level) {
              entries = entries.filter(e => e.level === action.level)
            }
            return { success: true, data: entries }
          }
          case 'network': {
            let entries: NetworkLogEntry[]
            if (action.tab) {
              const targetPage = await this.resolveTabTargetAsync(action.tab)
              if (!targetPage) {
                return { success: false, error: `No tab found matching ${JSON.stringify(action.tab)}` }
              }
              const buffers = this.pageLogBuffers.get(targetPage)
              entries = buffers ? [...buffers.networkLogs] : []
            } else {
              entries = []
              for (const buffers of this.pageLogBuffers.values()) {
                entries.push(...buffers.networkLogs)
              }
            }
            if (action.urlPattern) {
              entries = entries.filter(e => e.url.includes(action.urlPattern!))
            }
            return { success: true, data: entries }
          }
          case 'cookies': {
            const cookies = await this.context!.cookies()
            if (action.name) {
              const cookie = cookies.find(c => c.name === action.name) ?? null
              return { success: true, data: cookie }
            }
            return { success: true, data: cookies }
          }
          case 'localStorage': {
            const pageUrl = page.url()
            if (pageUrl === 'about:blank') {
              return { success: true, data: action.key ? null : {} }
            }
            if (action.key) {
              const value = await page.evaluate(
                (k: string) => localStorage.getItem(k), action.key
              )
              return { success: true, data: value }
            }
            const all = await page.evaluate(
              () => Object.fromEntries(
                Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])
              )
            )
            return { success: true, data: all }
          }
        }
        return { success: true }
      }

      case 'setCookies': {
        const cookiesWithDefaults = action.cookies.map(c => ({
          ...c,
          url: !c.domain ? page.url() : undefined,
        }))
        await this.context!.addCookies(cookiesWithDefaults)
        return { success: true }
      }

      case 'setLocalStorage': {
        await page.evaluate((entries: Array<{ key: string; value: string }>) => {
          for (const { key, value } of entries) {
            localStorage.setItem(key, value)
          }
        }, action.entries)
        return { success: true }
      }

      case 'focus': {
        const locator = resolver.resolve(action.ref)
        const box = await resolver.getBoundingBox(action.ref)
        await locator.focus()
        return { success: true, boundingBox: box ?? undefined }
      }

      case 'assertValue': {
        // D-10: the adapter RESOLVES the requested source to a raw value on ActionResult.data;
        // the runner-side comparator applies the op and judges. The adapter never compares.
        let value: unknown
        if ('expr' in action) {
          value = await page.evaluate(action.expr)
        } else {
          switch (action.source) {
            case 'url':
              value = page.url()
              break
            case 'storage':
              value = page.url() === 'about:blank'
                ? {}
                : await page.evaluate(
                    () => Object.fromEntries(
                      Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])
                    )
                  )
              break
            case 'network':
              value = this.drainNetworkLogs()
              break
            case 'expr-result':
              value = undefined
              break
          }
        }
        return { success: true, data: value }
      }

      case 'clearText': {
        const loc = resolver.resolve(action.ref)
        const clearBox = await resolver.getBoundingBox(action.ref)
        await loc.clear()
        return { success: true, boundingBox: clearBox ?? undefined }
      }

      case 'doubleClick': {
        const locator = resolver.resolve(action.ref)
        const box = await resolver.getBoundingBox(action.ref)
        const coordinates = box
          ? action.relativePosition
            ? { x: box.x + action.relativePosition.x, y: box.y + action.relativePosition.y }
            : { x: box.x + box.width / 2, y: box.y + box.height / 2 }
          : undefined
        await locator.dblclick({
          ...(action.relativePosition && { position: action.relativePosition }),
          ...clickDelayOption(action.clickDelay),
        })
        return { success: true, coordinates, boundingBox: box ?? undefined }
      }

      case 'rightClick': {
        const locator = resolver.resolve(action.ref)
        const box = await resolver.getBoundingBox(action.ref)
        const coordinates = box
          ? action.relativePosition
            ? { x: box.x + action.relativePosition.x, y: box.y + action.relativePosition.y }
            : { x: box.x + box.width / 2, y: box.y + box.height / 2 }
          : undefined
        await locator.click({
          button: 'right',
          ...(action.relativePosition && { position: action.relativePosition }),
          ...clickDelayOption(action.clickDelay),
        })
        return { success: true, coordinates, boundingBox: box ?? undefined }
      }

      case 'route': {
        // D-18: persistent interception until an explicit unroute or teardown. Planner-authored
        // status/headers/body fulfil the matched request (a mocked response body crosses into
        // page context — declared destructive in the risk metadata, Plan 09).
        await this.context!.route(action.urlPattern, async (route) => {
          await route.fulfill({
            status: 200,
            ...(action.contentType !== undefined ? { contentType: action.contentType } : {}),
            ...(action.headers !== undefined ? { headers: action.headers } : {}),
            ...(action.body !== undefined ? { body: action.body } : {}),
          })
        })
        this.armedRoutes.add(action.urlPattern)
        return { success: true }
      }

      case 'unroute': {
        if (action.urlPattern !== undefined) {
          await this.context!.unroute(action.urlPattern)
          this.armedRoutes.delete(action.urlPattern)
        } else {
          await this.context!.unrouteAll({ behavior: 'ignoreErrors' })
          this.armedRoutes.clear()
        }
        return { success: true }
      }

      case 'networkState': {
        if (action.mode === 'offline') {
          await this.context!.setOffline(true)
          return { success: true }
        }
        // throttle: Chromium-only via CDP; non-Chromium contexts reject newCDPSession (D-18).
        try {
          const cdp = await this.context!.newCDPSession(page)
          await cdp.send('Network.emulateNetworkConditions', {
            offline: false,
            latency: action.latencyMs,
            downloadThroughput: (action.downloadKbps * 1000) / 8,
            uploadThroughput: (action.uploadKbps * 1000) / 8,
          })
          return { success: true }
        } catch (err) {
          return {
            success: false,
            error: `Network throttling is only available on Chromium (via CDP); this context does not support it. ${err instanceof Error ? err.message : String(err)}`,
          }
        }
      }

      case 'storageState': {
        // D-14: the adapter only PRODUCES/CONSUMES the raw blob. On save it returns the state +
        // name (the Plan 10 seam strips + persists it — never fs here); on restore it applies the
        // seam-injected blob via setStorageState (present in pinned 1.59.1 — never hand-rolled).
        if (action.op === 'save') {
          const state = await this.context!.storageState()
          return { success: true, data: { name: action.name, state } }
        }
        await this.context!.setStorageState(readSeamStorageState(action))
        return { success: true }
      }

      case 'handleDialog': {
        // D-12: one-shot arm for the NEXT dialog; a re-arm REPLACES the pending arm (never stacks).
        if (this.pendingDialogArm) {
          page.off('dialog', this.pendingDialogArm)
          this.pendingDialogArm = null
        }
        const accept = action.accept
        const promptText = action.promptText
        const handler = (dialog: Dialog): void => {
          this.pendingDialogArm = null
          if (accept) {
            void dialog.accept(promptText)
          } else {
            void dialog.dismiss()
          }
        }
        this.pendingDialogArm = handler
        page.once('dialog', handler)
        return { success: true }
      }

      case 'executeScript': {
        return { success: false, error: 'executeScript is a mobile-only action' }
      }

      // Runner-minted / author-channel verbs (D-01/D-15/D-16): reportValue, uniqueValue, assertAI,
      // extractAI, and setVariable are intercepted at the dispatch seam and never reach the adapter.
      // A grouped §7.1 defensive case surfaces a dispatch-routing error if one arrives here;
      // assertNever remains the backstop for a genuinely unknown schema verb.
      case 'reportValue':
      case 'uniqueValue':
      case 'assertAI':
      case 'extractAI':
      case 'setVariable':
        return {
          success: false,
          error: `Action "${action.type}" is handled by the runner dispatch seam and must not reach the web adapter (runner-minted/author-channel verb). This indicates a dispatch routing error.`,
        }

      default:
        return assertNever(action)
    }
  }
}
