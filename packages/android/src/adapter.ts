import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ActionsFor,
  ActionResult,
  AppRegistryEntry,
  ConsoleLogEntry,
  Direction,
  FillRefusalMeta,
  FillSubmitMeta,
  FillVerdictMeta,
  InterimNode,
  ObserveOptions,
  PlatformAdapter,
  LiveStreamCapability,
  PlatformConfig,
  RecordingCapability,
  ScrollPrimitives,
  SwipeSignal,
} from '@vostride/agent-qa-runner'
import {
  assertNever,
  buildScreenState,
  compareFillReread,
  createSnapshotLiveStream,
  resolveAppName,
  runDirectionScroll,
  runToEndScroll,
  runUntilVisibleLoop,
} from '@vostride/agent-qa-runner'
import type { ElementLabels, ElementState, Ref, ScreenState } from '@vostride/agent-qa-schema'
import {
  KEY_MAP,
  MobileElementResolver,
  MobileSetupError,
  WEBVIEW_SCROLLERS_SCRIPT,
  buildRefEntries,
  computeFingerPositions,
  computePinch,
  computeSwipe,
  deriveMobileScroll,
  parseMobileSource,
  parseWebViewScrollers,
  warnIfOutOfBounds,
  webViewSwipeSignal,
} from '@vostride/agent-qa-core'
import type { IdentifiedScrollOffsets, MobileRefMap } from '@vostride/agent-qa-core'
import { createAndroidSession } from './session.js'
import type { AndroidAdapterConfig } from './types.js'

const ANDROID_FILLABLE_ROLES = new Set(['textbox', 'searchbox', 'edittext', 'combobox'])

// UiAutomator2 refuses getAttribute for showing-hint and multiline although it lists them, so they
// are read through XPath over the focused node's page-source attributes (437 Pitfall 5).
const FOCUSED_XPATH = '//*[@focused="true"]'
const FOCUSED_HINT_XPATH = '//*[@focused="true" and @showing-hint="true"]'
const FOCUSED_MULTILINE_XPATH = '//*[@focused="true" and @multiline="true"]'
const FOCUSED_SINGLE_LINE_XPATH = '//*[@focused="true" and @multiline="false"]'
const ENTER_KEYCODE = 66
const MULTI_LINE_SUBMIT_NOTICE =
  'submit not sent: Return would add a new line in this multi-line field; tap its send or submit control'
const LINE_BREAK_RE = /[\r\n]/

// 437 D-11: the WebView fill and clear use page scripts only to probe focus and read the value.
// The probe runs after a trusted tap at the ref's centre and never writes to the page.
const WEB_FOCUS_PROBE_SCRIPT =
  'var a = document.activeElement;'
  + 'var hit = document.elementFromPoint(arguments[0], arguments[1]);'
  + 'if (!a) {'
  + ' return { editable: false, matches: false, multiline: false, secure: false, value: null };'
  + '}'
  + 'var tag = a.tagName;'
  + 'var type = tag === "INPUT" ? String(a.type || "text").toLowerCase() : "";'
  + 'var textual = ["text", "search", "email", "url", "tel", "password", "number"]'
  + '.indexOf(type) >= 0;'
  + 'var field = (tag === "INPUT" && textual) || tag === "TEXTAREA";'
  + 'var rich = !field && a.isContentEditable === true;'
  + 'var v = field ? a.value : (rich ? a.innerText : null);'
  + 'return {'
  + ' editable: (field && !a.readOnly && !a.disabled) || rich,'
  + ' matches: !!hit && (a === hit || a.contains(hit)),'
  + ' multiline: tag === "TEXTAREA" || rich,'
  + ' secure: type === "password",'
  + ' value: typeof v === "string" ? v : null'
  + '};'
const WEB_FIELD_VALUE_SCRIPT =
  'var a = document.activeElement;'
  + 'if (!a) { return null; }'
  + 'var v = (a.tagName === "INPUT" || a.tagName === "TEXTAREA") ? a.value'
  + ' : (a.isContentEditable ? a.innerText : null);'
  + 'return typeof v === "string" ? v : null;'
const ANDROID_NATIVE_SELECT_ROLES = new Set(['combobox', 'spinbutton', 'listbox', 'list'])
const ANDROID_NATIVE_SELECT_TYPES = new Set([
  'android.widget.Spinner',
  'android.widget.NumberPicker',
  'android.widget.DatePicker',
  'android.widget.TimePicker',
  'android.widget.ListView',
  'androidx.recyclerview.widget.RecyclerView',
])

async function safePerform(chain: { perform: () => Promise<void> }): Promise<void> {
  try {
    await chain.perform()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('actions') && msg.includes('DELETE')) return
    throw err
  }
}

const LOGCAT_REGEX = /^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+(.+?)\s*:\s+(.*)/

const ANDROID_LEVEL_MAP: Record<string, string> = {
  V: 'debug',
  D: 'debug',
  I: 'info',
  W: 'warn',
  E: 'error',
  F: 'error',
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (trimmed) return trimmed
  }
  return undefined
}

type TextBox = {
  coordinates: { x: number; y: number }
  boundingBox: { x: number; y: number; width: number; height: number }
}

type FocusedField = {
  getText: () => Promise<string>
  getAttribute: (name: string) => Promise<string | null>
  setValue: (value: string) => Promise<void>
  addValue: (value: string) => Promise<void>
}

type WebFocus = {
  editable: boolean
  matches: boolean
  multiline: boolean
  secure: boolean
  value?: string
}

type InputPath = NonNullable<FillVerdictMeta['path']>

const INPUT_FAILED: FillSubmitMeta = { sent: false, outcome: 'not-sent', reason: 'input-failed' }

function firstErrorLine(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.split('\n')[0]!.trim()
}

function isAndroidWebContextName(context: string): boolean {
  const normalized = context.toUpperCase()
  return normalized.includes('CHROMIUM') || normalized.includes('WEBVIEW')
}

function isTargetWebContext(context: string, appPackage: string | null, explicitBrowserMode: boolean): boolean {
  if (explicitBrowserMode) return isAndroidWebContextName(context)
  if (!appPackage) return false
  return context.toLowerCase().includes(appPackage.toLowerCase())
}

function isAndroidNativeSelectTarget(refData: MobileRefMap[string] | undefined): boolean {
  const role = refData?.role?.toLowerCase()
  return Boolean(
    (role && ANDROID_NATIVE_SELECT_ROLES.has(role))
    || (refData?.nativeType && ANDROID_NATIVE_SELECT_TYPES.has(refData.nativeType))
  )
}

/**
 * Escape untrusted target text for interpolation into a UiAutomator `UiSelector` source string
 * (T-359-01 · Pitfall 9). Backslash-escape backslashes FIRST, then double quotes, so the raw
 * text can never break out of the `textContains("…")` literal. Control characters cannot be
 * represented safely in the selector language, so a target carrying any is rejected with a
 * structured error rather than being interpolated verbatim (T-352-11 posture).
 */
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/
function escapeUiSelectorText(value: string): string {
  if (CONTROL_CHAR_RE.test(value)) {
    throw new Error(
      `scroll target contains a control character and cannot be used as a UiAutomator selector — provide a plain-text target for untilVisible.`,
    )
  }
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** Scroll intent (reveal content toward `direction`) maps to the OPPOSITE finger swipe. */
function fingerDirectionFor(scroll: Direction): 'up' | 'down' | 'left' | 'right' {
  switch (scroll) {
    case 'up':
      return 'down'
    case 'down':
      return 'up'
    case 'left':
      return 'right'
    case 'right':
      return 'left'
  }
}

function androidUiSelectorText(value: string): string {
  return `android=new UiSelector().text(${JSON.stringify(value)})`
}

function androidUiSelectorDescription(value: string): string {
  return `android=new UiSelector().description(${JSON.stringify(value)})`
}

async function findAndroidNativeOption(
  driver: WebdriverIO.Browser,
  value: string,
): Promise<{ element: any; matchedValue: string; matchStrategy: 'text' | 'description' } | null> {
  for (const [selector, matchStrategy] of [
    [androidUiSelectorText(value), 'text'],
    [androidUiSelectorDescription(value), 'description'],
  ] as const) {
    try {
      const element = await driver.$(selector)
      if (await element.isExisting()) {
        return { element, matchedValue: value, matchStrategy }
      }
    } catch {
      // Try the next exact selector.
    }
  }
  return null
}

function parseLogcatLine(message: string, timestamp: number, appPid: string | null): ConsoleLogEntry | null {
  const match = message.match(LOGCAT_REGEX)
  if (!match) return null
  const [, , , pid, , levelChar, tag, text] = match
  if (appPid && pid !== appPid) return null
  return {
    level: ANDROID_LEVEL_MAP[levelChar] ?? 'debug',
    text: `[${tag.trim()}] ${text.trim()}`,
    timestamp,
  }
}

// Injected into the WebView/browser to emit a JSON-serializable array of interim-node
// records from the live DOM (RESEARCH Pitfall #5). It walks the DOM as before but NO
// longer mints refs or renders tree text in-page — the shared runner builder owns ref
// minting, name normalization, and tree rendering (D-01/D-02/D-03). Every record carries
// only real DOM signals (D-08); the builder derives all defaults. Defined as a string
// because this runs in browser context — the Node tsconfig has no DOM lib so a typed
// function would fail compilation.
const WEB_OBSERVER_SCRIPT = `
return (function() {
  var TAG_ROLES = {
    A: 'link', BUTTON: 'button', INPUT: 'textbox', TEXTAREA: 'textbox',
    SELECT: 'combobox', H1: 'heading', H2: 'heading', H3: 'heading',
    H4: 'heading', H5: 'heading', H6: 'heading', IMG: 'image'
  };

  var doc = document;
  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var active = doc.activeElement;

  var all = doc.querySelectorAll(
    'a, button, input, textarea, select, h1, h2, h3, h4, h5, h6, img[alt], [role]'
  );

  var nodes = [];
  var includedEls = [];
  var seen = {};

  // parentIndex is the nearest INCLUDED ancestor (structural/skipped nodes collapse
  // away, matching the mobile/web walkers' Pitfall #7 handling).
  function nearestAncestorIndex(el) {
    var p = el.parentElement;
    while (p) {
      var idx = includedEls.indexOf(p);
      if (idx !== -1) return idx;
      p = p.parentElement;
    }
    return undefined;
  }

  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;

    var style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    var tag = el.tagName;
    var ariaRole = el.getAttribute('role');
    var role = (ariaRole || TAG_ROLES[tag] || '').toLowerCase();
    if (!role) continue;

    var name = '';
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) {
      name = ariaLabel;
    } else if (tag === 'IMG') {
      name = el.alt || '';
    } else if (tag === 'INPUT' || tag === 'TEXTAREA') {
      name = el.getAttribute('placeholder') || el.value || '';
    } else {
      name = (el.textContent || '').trim();
    }

    name = name.slice(0, 100).replace(/[\\n\\r]+/g, ' ').trim();
    if (!name && role !== 'textbox') continue;

    var key = role + ':' + name;
    if (seen[key]) continue;
    seen[key] = true;

    var bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };

    // Real DOM state signals only — the builder derives every default (D-08).
    var state = {};
    var disabled = el.disabled === true
      || el.hasAttribute('disabled')
      || el.getAttribute('aria-disabled') === 'true';
    state.enabled = !disabled;
    state.focused = el === active;
    if (bounds.y + bounds.height < 0 || bounds.y > vh) state.visible = false;
    if (tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      state.checked = el.checked === true;
    }

    var labels = {};
    var testId = el.getAttribute('data-testid');
    if (testId) labels.testId = testId;
    if (ariaLabel) labels.ariaLabel = ariaLabel;
    var placeholder = el.getAttribute('placeholder');
    if (placeholder) labels.placeholder = placeholder;
    var title = el.getAttribute('title');
    if (title) labels.title = title;

    var attributes = {};
    if (el.type) attributes.type = String(el.type);

    var parentIndex = nearestAncestorIndex(el);

    var record = {
      role: role,
      name: name,
      bounds: bounds,
      state: state,
      labels: labels,
      attributes: attributes
    };
    if (parentIndex !== undefined) record.parentIndex = parentIndex;

    nodes.push(record);
    includedEls.push(el);
  }

  var docEl = doc.documentElement;
  return {
    nodes: nodes,
    viewport: { width: vw, height: vh },
    scroll: {
      offsetX: window.scrollX,
      offsetY: window.scrollY,
      contentWidth: docEl.scrollWidth,
      contentHeight: docEl.scrollHeight
    },
    url: location.href
  };
})();
`

/**
 * Coerce one attacker-shaped in-page record into a trusted InterimNode (T-352-11).
 * `driver.execute` results are untrusted; a record without a usable string role is
 * dropped to typed-absence, never thrown into the builder loop.
 */
function coerceWebInterimNode(value: unknown): InterimNode | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const role = coerceString(v.role)
  if (!role) return null

  const node: InterimNode = { role: role.toLowerCase(), attributes: coerceStringBag(v.attributes) }
  const name = coerceString(v.name)
  if (name) node.name = name
  if (typeof v.parentIndex === 'number' && Number.isInteger(v.parentIndex) && v.parentIndex >= 0) {
    node.parentIndex = v.parentIndex
  }
  const bounds = coerceWebBounds(v.bounds)
  if (bounds) node.bounds = bounds
  const state = coerceWebState(v.state)
  if (state) node.state = state
  const labels = coerceWebLabels(v.labels)
  if (labels) node.labels = labels
  return node
}

function coerceString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function coerceStringBag(value: unknown): Record<string, string> {
  const bag: Record<string, string> = {}
  if (!value || typeof value !== 'object') return bag
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') bag[k] = v
    else if (typeof v === 'number' || typeof v === 'boolean') bag[k] = String(v)
  }
  return bag
}

function coerceWebBounds(value: unknown): { x: number; y: number; width: number; height: number } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const { x, y, width, height } = v
  if (
    typeof x === 'number' && Number.isFinite(x) &&
    typeof y === 'number' && Number.isFinite(y) &&
    typeof width === 'number' && Number.isFinite(width) &&
    typeof height === 'number' && Number.isFinite(height)
  ) {
    return { x, y, width, height }
  }
  return undefined
}

function coerceWebState(value: unknown): Partial<ElementState> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const state: Partial<ElementState> = {}
  if (typeof v.enabled === 'boolean') state.enabled = v.enabled
  if (typeof v.focused === 'boolean') state.focused = v.focused
  if (typeof v.visible === 'boolean') state.visible = v.visible
  if (typeof v.checked === 'boolean') state.checked = v.checked
  if (typeof v.selected === 'boolean') state.selected = v.selected
  return Object.keys(state).length > 0 ? state : undefined
}

function coerceWebLabels(value: unknown): ElementLabels | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const labels: ElementLabels = {}
  const testId = coerceString(v.testId)
  if (testId) labels.testId = testId
  const ariaLabel = coerceString(v.ariaLabel)
  if (ariaLabel) labels.ariaLabel = ariaLabel
  const placeholder = coerceString(v.placeholder)
  if (placeholder) labels.placeholder = placeholder
  const title = coerceString(v.title)
  if (title) labels.title = title
  return Object.keys(labels).length > 0 ? labels : undefined
}

function coerceViewport(
  value: unknown,
  fallback: { width: number; height: number },
): { width: number; height: number } {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    const width = typeof v.width === 'number' && Number.isFinite(v.width) ? v.width : fallback.width
    const height = typeof v.height === 'number' && Number.isFinite(v.height) ? v.height : fallback.height
    return { width, height }
  }
  return fallback
}

function coerceWebScroll(
  value: unknown,
  viewport: { width: number; height: number },
): { offsetX: number; offsetY: number; contentWidth: number; contentHeight: number } {
  const num = (x: unknown, fb: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fb)
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>
    return {
      offsetX: num(v.offsetX, 0),
      offsetY: num(v.offsetY, 0),
      contentWidth: num(v.contentWidth, viewport.width),
      contentHeight: num(v.contentHeight, viewport.height),
    }
  }
  return { offsetX: 0, offsetY: 0, contentWidth: viewport.width, contentHeight: viewport.height }
}

/**
 * 2026-10-08 (436-12, live A1): a gesture that starts in a system gesture zone (the home and
 * recents bar at the bottom, the shade at the top, the back edges at the sides) is taken by
 * Android, not the app: the list does not move and scrollGesture answers false, which would read
 * as a boundary. The area is kept to the middle 60% of the screen on the swipe axis, where the
 * swipe ran before 436-02; an area wholly outside that band is used as it is.
 */
function gestureArea(
  bounds: { x: number; y: number; width: number; height: number },
  direction: Direction,
  viewport: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const vertical = direction === 'up' || direction === 'down'
  const length = vertical ? viewport.height : viewport.width
  const start = vertical ? bounds.y : bounds.x
  const end = start + (vertical ? bounds.height : bounds.width)
  const from = Math.max(start, Math.round(length * 0.2))
  const to = Math.min(end, Math.round(length * 0.8))
  if (to - from < 1) return bounds
  return vertical
    ? { ...bounds, y: from, height: to - from }
    : { ...bounds, x: from, width: to - from }
}

export class AndroidPlatformAdapter implements PlatformAdapter<'android'> {
  readonly platform = 'android' as const

  private driver: WebdriverIO.Browser | null = null
  private lastRefs: MobileRefMap = {}
  private config: AndroidAdapterConfig | null = null
  // Tracks the active web context name (e.g. 'CHROMIUM', 'WEBVIEW_...').
  // null means last observation was native-only.
  private activeWebContext: string | null = null
  // Cached so we skip redundant switchContext round-trips.
  private currentContext: string | null = null
  private recordingCapability: RecordingCapability | undefined
  private liveStreamCapability: LiveStreamCapability | undefined
  private consoleLogs: ConsoleLogEntry[] = []
  private consoleDrainIndex = 0
  private captureConsole = true
  private appPackage: string | null = null
  private appPid: string | null = null
  // EXEC-03 session-cached app registry (D-10/D-12): enumerated once per session; null = not yet
  // enumerated (or enumeration failed and may be retried). Reset in cleanup().
  private appRegistry: AppRegistryEntry[] | null = null

  async setup(config: PlatformConfig): Promise<void> {
    this.config = config as AndroidAdapterConfig
    this.captureConsole = config.logCapture?.console !== false
    this.appPackage = this.config.appPackage ?? (config.device?.match?.appPackage as string | undefined) ?? null

    this.driver = await createAndroidSession(this.config, config.farmSession)

    // Explicitly launch the app after session creation.
    // Appium with noReset:true doesn't always auto-launch pre-installed apps
    // even when appPackage+appActivity are set in capabilities.
    const appPackage = this.appPackage
    if (appPackage && !this.config.browserName && !this.config.device?.match?.browserName) {
      try {
        await this.driver.activateApp(appPackage)
      } catch (err) {
        throw new MobileSetupError({
          category: 'app-launch',
          message: `Failed to launch Android app "${appPackage}": ${err instanceof Error ? err.message : String(err)}`,
          platform: 'android',
          deviceName: config.device?.name,
          appId: appPackage,
          cause: err,
        })
      }
    }

    // Resolve app PID for logcat filtering only when explicitly enabled. Appium
    // 3 blocks mobile: shell unless the server is started with adb_shell enabled.
    if (process.env.AGENT_QA_ANDROID_USE_MOBILE_SHELL === '1' && this.appPackage && this.driver) {
      try {
        const result = String(await this.driver.execute('mobile: shell', { command: 'pidof', args: [this.appPackage] }))
        const pid = result?.trim()
        if (pid && /^\d+$/.test(pid)) this.appPid = pid
      } catch {
        // mobile shell may be disabled — logs will be unfiltered
      }
    }

  }

  async cleanup(): Promise<void> {
    try { await this.recordingCapability?.stop() } catch { /* best-effort */ }
    this.recordingCapability = undefined
    try { await this.liveStreamCapability?.stop() } catch { /* best-effort */ }
    this.liveStreamCapability = undefined

    try {
      if (this.driver) {
        await this.driver.deleteSession()
      }
    } catch {
      // session may already be closed
    }
    this.driver = null
    this.lastRefs = {}
    this.config = null
    this.consoleLogs = []
    this.appPackage = null
    this.appPid = null
    this.appRegistry = null
    this.activeWebContext = null
    this.currentContext = null
  }

  // Whether we've ever successfully observed via a web context.
  // Once true, we know a WebView/browser exists and should retry rather than
  // falling back to native (which returns an opaque WebView and can crash UiAutomator2).
  private hasSeenWebContext = false

  async observe(_options?: ObserveOptions): Promise<ScreenState> {
    if (!this.driver) {
      throw new Error('AndroidPlatformAdapter not initialized — call setup() first')
    }

    // Dynamically detect web contexts (handles browserName sessions, native browser
    // apps like Chrome opened via appPackage, and hybrid apps with WebViews).
    const webState = await this.tryObserveWeb()
    if (webState) {
      this.hasSeenWebContext = true
      return webState
    }

    // If we previously had web content, the page is likely transitioning (navigation,
    // new tab, etc.).  Wait for the web context to come back before giving up.
    if (this.hasSeenWebContext) {
      for (const delay of [2000, 3000]) {
        await this.driver.pause(delay)
        const retry = await this.tryObserveWeb()
        if (retry) return retry
      }
    }

    // No web context available — fall back to native XML observation.
    // Wrapped in try-catch because calling getPageSource() on Chrome's native
    // view hierarchy can crash UiAutomator2's instrumentation process.
    this.activeWebContext = null
    try {
      return await this.observeNative()
    } catch {
      this.lastRefs = {}
      // Schema-valid empty state (D-11 honest observe-time modality: textOnly) carrying
      // the diagnostic tree — no elements resolved, so refMap is empty (geometry rule).
      return {
        platform: 'android',
        tree: '(native observation unavailable — WebView content not accessible)',
        elements: [],
        refMap: {},
        timestamp: Date.now(),
        metadata: {
          captureMode: 'textOnly',
          coordSpace: 'viewport',
          viewportWidth: 0,
          viewportHeight: 0,
          scroll: { offsetX: 0, offsetY: 0, contentWidth: 0, contentHeight: 0 },
        },
      }
    }
  }

  async execute(action: ActionsFor<'android'>): Promise<ActionResult> {
    if (!this.driver) {
      throw new Error('AndroidPlatformAdapter not initialized — call setup() first')
    }

    try {
      // Ensure we're in the right context before acting
      if (this.activeWebContext) {
        await this.ensureContext(this.activeWebContext)
      }
      return await this.executeAction(action)
    } catch (err) {
      let screenshot: Buffer | undefined
      try {
        screenshot = await this.captureScreenshot()
      } catch {
        // ignore screenshot failure
      }
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        screenshot,
      }
    }
  }

  async screenshot(): Promise<Buffer | undefined> {
    if (this.activeWebContext) {
      await this.ensureContext(this.activeWebContext)
    } else {
      try { await this.ensureContext('NATIVE_APP') } catch { /* best-effort */ }
    }
    const buf = await this.captureScreenshot()
    if (buf && this.driver) {
      // D-19 / D-20 (Phase 138.1.1): Android screenshot dims differ from getWindowSize() on WebView
      // (1080x2274 image vs 411x810 viewport — ~6% vertical AR drift from URL bar, per D-13/D-14).
      // On native, dims match (1080x2400 == 1080x2400 getWindowSize). Phase 142 removed all
      // scaling code — coords are viewport-space identity. Log kept for diagnostics.
      try {
        // 363 D-08/Q10: sharp image utilities moved to runner-local (sharp left core).
        const { getImageDimensions } = await import('@vostride/agent-qa-runner-local')
        const dims = await getImageDimensions(buf)
        const { width } = await this.driver.getWindowSize()
        if (dims && Math.abs(dims.width - width) > 1) {
          // eslint-disable-next-line no-console
          console.warn(`[android-adapter] screenshot width ${dims.width} != window width ${width} (coord-space divergence, handled by scaleFactor per D-19/D-20)`)
        }
      } catch { /* best-effort assertion */ }
    }
    return buf
  }

  // ---------------------------------------------------------------------------
  // Device log capture
  // ---------------------------------------------------------------------------

  async pollDeviceLogs(): Promise<void> {
    if (!this.captureConsole) return
    if (!this.driver) return
    try {
      const logs = await this.driver.getLogs('logcat') as { message: string; timestamp?: number }[]
      for (const entry of logs) {
        const parsed = parseLogcatLine(entry.message, entry.timestamp ?? Date.now(), this.appPid)
        if (!parsed) continue
        this.consoleLogs.push(parsed)
      }
      if (this.consoleLogs.length > 1000) {
        this.consoleLogs = this.consoleLogs.slice(-500)
      }
    } catch {
      // getLogs may fail in some Appium configurations
    }
  }

  drainConsoleLogs(level?: string): ConsoleLogEntry[] {
    const newLogs = this.consoleLogs.slice(this.consoleDrainIndex)
    this.consoleDrainIndex = this.consoleLogs.length
    if (!level) return newLogs
    return newLogs.filter(e => e.level === level)
  }

  /**
   * 428 D-11: the labelled 1s snapshot preview, over `captureScreenshot()` — `takeScreenshot()`
   * and nothing else. Never `screenshot()`: that one switches the Appium context, and a tick
   * landing between a step's context switch and its command would run the command in the wrong
   * context. Declared before the driver exists (a capture then answers `undefined`), so the
   * composition's selection never falls through to `screenshot()`.
   */
  get liveStream(): LiveStreamCapability {
    this.liveStreamCapability ??= createSnapshotLiveStream({ capture: () => this.captureScreenshot() })
    return this.liveStreamCapability
  }

  get recording(): RecordingCapability | undefined {
    const driver = this.driver
    const config = this.config?.recording
    if (!driver || !config) return undefined
    if (this.recordingCapability) return this.recordingCapability
    let running = false
    let busy = false
    let needsCleanup = false
    async function recover() {
      if (!needsCleanup) return
      await driver!.stopRecordingScreen()
      needsCleanup = false
    }
    this.recordingCapability = {
      async start() {
        if (busy || running) throw new Error('Recording already started')
        busy = true
        try {
          await recover()
          const videoSize = config.videoSize
            ? `${config.videoSize.width}x${config.videoSize.height}`
            : undefined
          needsCleanup = true
          try {
            await driver.startRecordingScreen({ videoSize, timeLimit: 1800, forceRestart: true })
          } catch (error) {
            try { await recover() } catch { /* Retry driver cleanup before reuse. */ }
            throw error
          }
          needsCleanup = false
          running = true
          return {}
        } finally { busy = false }
      },
      async stop() {
        if (busy) throw new Error('Recording operation already in progress')
        busy = true
        try {
          if (!running) { await recover(); return undefined }
          running = false
          let base64Video: string
          try {
            base64Video = await driver.stopRecordingScreen()
          } catch (error) {
            needsCleanup = true
            try { await recover() } catch { /* Retry driver cleanup before reuse. */ }
            throw error
          }
          if (!base64Video) return undefined
          await mkdir(config.videoDir, { recursive: true })
          const stagingPath = join(config.videoDir, `${randomUUID()}.mp4`)
          try {
            await writeFile(stagingPath, Buffer.from(base64Video, 'base64'))
          } catch (error) {
            await rm(stagingPath, { force: true }).catch(() => undefined)
            throw error
          }
          return { stagingPath, contentType: 'video/mp4' }
        } finally { busy = false }
      },
    }
    return this.recordingCapability
  }

  // ---------------------------------------------------------------------------
  // Observation
  // ---------------------------------------------------------------------------

  private async tryObserveWeb(): Promise<ScreenState | null> {
    const driver = this.driver!
    try {
      const contexts = await driver.getContexts() as string[]
      const explicitBrowserMode = Boolean(this.config?.browserName || this.config?.device?.match?.browserName)
      const webCtx = contexts.find(c =>
        typeof c === 'string' && isTargetWebContext(c, this.appPackage, explicitBrowserMode)
      )
      if (!webCtx) return null

      await this.ensureContext(webCtx)

      // The in-page script returns a JSON-serializable interim-node payload — attacker-
      // shaped (T-352-11), so it is Array-guarded and every record/field is primitive-
      // coerced before entering the builder. No refs, no tree text cross the boundary.
      const raw = await driver.execute(WEB_OBSERVER_SCRIPT) as unknown
      if (!raw || typeof raw !== 'object') return null
      const payload = raw as Record<string, unknown>

      const rawNodes = payload.nodes
      if (!Array.isArray(rawNodes) || rawNodes.length === 0) return null

      const nodes: InterimNode[] = []
      for (const candidate of rawNodes) {
        const node = coerceWebInterimNode(candidate)
        if (node) nodes.push(node)
      }
      if (nodes.length === 0) return null

      const windowSize = await driver.getWindowSize()
      const viewport = coerceViewport(payload.viewport, { width: windowSize.width, height: windowSize.height })
      const scroll = coerceWebScroll(payload.scroll, viewport)
      const url = typeof payload.url === 'string' ? payload.url : undefined

      // Same builder pipeline as the native path — hybrid-app WebView runs share the one
      // schema type world. WebView contexts expose exact scroll (window/document reads).
      const { state, binding } = buildScreenState({
        platform: 'android',
        nodes,
        viewport,
        scroll,
        coordSpace: 'viewport',
        timestamp: Date.now(),
        ...(url !== undefined ? { url } : {}),
      })
      this.lastRefs = buildRefEntries(nodes, binding)
      this.activeWebContext = webCtx

      return state
    } catch {
      // Web observation failed — caller will fall back to native
      return null
    }
  }

  private async observeNative(): Promise<ScreenState> {
    const driver = this.driver!

    await this.ensureContext('NATIVE_APP')

    const [xml, viewport] = await Promise.all([
      driver.getPageSource(),
      driver.getWindowSize(),
    ])

    // The shared mobile walk emits platform-neutral interim nodes (352-04); the runner
    // builder mints refs, normalizes names, and renders the tree (D-01/D-02/D-03). Mobile
    // scroll is a documented best-effort approximation (D-10). Execute-time resolution
    // survives via buildRefEntries feeding the adapter-private lastRefs record.
    const { nodes } = parseMobileSource(xml, 'android', viewport)
    const scroll = deriveMobileScroll(nodes, viewport)
    const { state, binding } = buildScreenState({
      platform: 'android',
      nodes,
      viewport,
      scroll,
      coordSpace: 'viewport',
      timestamp: Date.now(),
    })
    this.lastRefs = buildRefEntries(nodes, binding)

    return state
  }

  // ---------------------------------------------------------------------------
  // Context management
  // ---------------------------------------------------------------------------

  private async ensureContext(target: string): Promise<void> {
    if (this.currentContext === target) return
    try {
      await this.driver!.switchContext(target)
      this.currentContext = target
    } catch {
      // If switch fails, clear cache so next call retries
      this.currentContext = null
    }
  }

  // ---------------------------------------------------------------------------
  // Screenshots
  // ---------------------------------------------------------------------------

  private async captureScreenshot(): Promise<Buffer | undefined> {
    try {
      if (this.driver) {
        const base64 = await this.driver.takeScreenshot()
        return Buffer.from(base64, 'base64')
      }
      return undefined
    } catch {
      return undefined
    }
  }

  // ---------------------------------------------------------------------------
  // Compound behaviors (EXEC-01/02/03)
  // ---------------------------------------------------------------------------

  /** Read the live text of a focused element handle; undefined when nothing is readable. */
  private async readElementText(el: { getText: () => Promise<string> }): Promise<string | undefined> {
    try {
      const value = await el.getText()
      return typeof value === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }

  private async focusedMatches(xpath: string): Promise<boolean> {
    try {
      return await (await this.driver!.$(xpath)).isExisting()
    } catch {
      return false
    }
  }

  /** An empty field's getText() returns its hint (437 Pitfall 4), so a showing hint reads ''. */
  private async readFocusedValue(el: { getText: () => Promise<string> }): Promise<string | undefined> {
    if (await this.focusedMatches(FOCUSED_HINT_XPATH)) return ''
    return await this.readElementText(el)
  }

  /** The one submit mechanism on every Android path (437 D-13); pressed once, never retried. */
  private async pressEnter(): Promise<FillSubmitMeta> {
    try {
      await this.driver!.execute('mobile: pressKey', { keycode: ENTER_KEYCODE })
      return { sent: true, outcome: 'sent' }
    } catch (err) {
      return { sent: false, outcome: 'failed', detail: firstErrorLine(err) }
    }
  }

  /** 437 FA-2 (owner, 2026-10-08): line breaks into a single-line field are refused before typing. */
  private refuseLineBreaks(action: { submit: boolean }, box: TextBox): ActionResult {
    const fillRefusal: FillRefusalMeta = {
      verb: 'fill',
      cause: 'single-line-field',
      evidence: 'text-has-line-breaks',
    }
    return {
      success: false,
      error:
        'fill: this field is single-line and the text has line breaks; nothing was typed. '
        + 'Send the text without line breaks, or use a multi-line field.',
      ...box,
      metadata: { fillRefusal, ...(action.submit ? { fillSubmit: { ...INPUT_FAILED } } : {}) },
    }
  }

  /**
   * Native fill from the focused handle (437 D-08..D-10, D-12, D-13, D-15, D-17). Delivers once
   * (addValue for append, setValue for replace), reads back from the same handle and records the
   * shared verdict. An unknown append prior or an unreadable read-back is unverified, which never
   * stops a requested Enter; a mismatch or a multi-line field holds it. A driver error during
   * delivery ends the fill: nothing is typed again and no Enter follows. A secure field yields
   * length sentinels only.
   */
  private async fillNativeCompound(
    el: FocusedField,
    action: { text: string; clearMode: 'replace' | 'append'; submit: boolean },
    box: TextBox,
  ): Promise<ActionResult> {
    const isAppend = action.clearMode === 'append'
    if (LINE_BREAK_RE.test(action.text) && await this.focusedMatches(FOCUSED_SINGLE_LINE_XPATH)) {
      return this.refuseLineBreaks(action, box)
    }
    const multiline = action.submit && await this.focusedMatches(FOCUSED_MULTILINE_XPATH)
    const secure = (await el.getAttribute('password').catch(() => null)) === 'true'
    const prior = isAppend ? await this.readFocusedValue(el) : ''

    try {
      if (isAppend) {
        await el.addValue(action.text)
      } else {
        await el.setValue(action.text)
      }
    } catch {
      const fillVerdict: FillVerdictMeta = {
        verb: 'fill',
        verdict: 'unverified',
        path: 'native',
        ...(secure ? { secure: true as const } : {}),
      }
      return {
        success: false,
        error:
          'fill: typing was interrupted by a driver error; the field may hold part of the text, '
          + 'and it was not typed again. Re-observe the field before filling it again.',
        ...box,
        metadata: { fillVerdict, ...(action.submit ? { fillSubmit: { ...INPUT_FAILED } } : {}) },
      }
    }

    const actual = prior === undefined ? undefined : await this.readFocusedValue(el)
    const verdict = compareFillReread({ expected: (prior ?? '') + action.text, actual, secure })
    return await this.settleFill(action, box, {
      path: 'native',
      verdict,
      multiline,
      enter: () => this.pressEnter(),
    })
  }

  /**
   * The shared end of every Android fill (437 D-09, D-10, D-13, D-15, D-17): records the verdict
   * and, when a submit was requested, holds Enter on a mismatch or a multi-line field and otherwise
   * presses it once through `enter`.
   */
  private async settleFill(
    action: { submit: boolean },
    box: TextBox,
    settle: {
      path: InputPath
      verdict: ReturnType<typeof compareFillReread>
      multiline: boolean
      enter: () => Promise<FillSubmitMeta>
    },
  ): Promise<ActionResult> {
    const { path, verdict, multiline, enter } = settle
    const fillVerdict: FillVerdictMeta = {
      verb: 'fill',
      verdict: verdict.verdict,
      path,
      ...(verdict.secure ? { secure: true as const } : {}),
    }

    let fillSubmit: FillSubmitMeta | undefined
    if (action.submit) {
      if (verdict.verdict === 'mismatch') {
        fillSubmit = { sent: false, outcome: 'not-sent', reason: 'mismatch' }
      } else if (multiline) {
        fillSubmit = { sent: false, outcome: 'not-sent', reason: 'multi-line-field' }
      } else {
        fillSubmit = await enter()
      }
    }
    const notice = fillSubmit?.reason === 'multi-line-field' ? { data: MULTI_LINE_SUBMIT_NOTICE } : {}
    const metadata = {
      ...(verdict.meta ? { fillReread: verdict.meta } : {}),
      fillVerdict,
      ...(fillSubmit ? { fillSubmit } : {}),
    }
    if (!verdict.ok) return { success: false, error: verdict.selfCorrectingError, ...box, metadata }
    if (fillSubmit?.outcome === 'failed') {
      return {
        success: false,
        error:
          'fill typed the text, but Enter failed and was not sent again. Re-observe the screen; '
          + 'if the field still holds the text, submit it without typing it again.',
        ...box,
        metadata,
      }
    }
    return { success: true, ...box, ...notice, metadata }
  }

  /** A real W3C touch tap in the WebView context at the ref's CSS-pixel centre (437 D-11). */
  private async trustedWebTap(center: { x: number; y: number }): Promise<void> {
    await safePerform(this.driver!.action('pointer', { parameters: { pointerType: 'touch' } })
      .move({ x: Math.round(center.x), y: Math.round(center.y), origin: 'viewport' })
      .down({ button: 0 })
      .up({ button: 0 })
      )
  }

  /** Whether the tap left an editable field focused at the ref's point; read-only. */
  private async probeWebFocus(center: { x: number; y: number }): Promise<WebFocus> {
    const none: WebFocus = { editable: false, matches: false, multiline: false, secure: false }
    try {
      const raw = await this.driver!.execute(
        WEB_FOCUS_PROBE_SCRIPT, Math.round(center.x), Math.round(center.y),
      ) as unknown as Record<string, unknown> | null
      if (!raw || typeof raw !== 'object') return none
      return {
        editable: raw.editable === true,
        matches: raw.matches === true,
        multiline: raw.multiline === true,
        secure: raw.secure === true,
        ...(typeof raw.value === 'string' ? { value: raw.value } : {}),
      }
    } catch {
      return none
    }
  }

  private async readWebFieldValue(): Promise<string | undefined> {
    try {
      const value = await this.driver!.execute(WEB_FIELD_VALUE_SCRIPT) as unknown
      return typeof value === 'string' ? value : undefined
    } catch {
      return undefined
    }
  }

  /** Runs a driver call from NATIVE_APP and always returns to the active WebView context. */
  private async withNativeContext<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureContext('NATIVE_APP')
    try {
      return await fn()
    } finally {
      if (this.activeWebContext) await this.ensureContext(this.activeWebContext)
    }
  }

  /**
   * WebView fill as trusted input (437 D-11): a W3C tap on the ref, a read-only focus probe,
   * W3C Ctrl+A and Backspace for replace, `mobile: type` from NATIVE_APP, a read-only read-back,
   * and one `mobile: pressKey 66` from NATIVE_APP. No script writes the field or fires an event.
   */
  private async fillWebViewCompound(
    action: { ref: string; text: string; clearMode: 'replace' | 'append'; submit: boolean },
    box: TextBox,
    center: { x: number; y: number },
  ): Promise<ActionResult> {
    const driver = this.driver!
    const isAppend = action.clearMode === 'append'
    await this.trustedWebTap(center)
    const focus = await this.probeWebFocus(center)
    if (!focus.editable || !focus.matches) {
      return {
        success: false,
        error: `fill: the tap on ${action.ref} did not focus an editable field; nothing was typed.`,
        ...box,
      }
    }
    const prior = isAppend ? focus.value : ''
    if (!isAppend) {
      await driver.keys(['Control', 'a'])
      await driver.keys(['Backspace'])
    }
    await this.withNativeContext(() => driver.execute('mobile: type', { text: action.text }))
    const actual = prior === undefined ? undefined : await this.readWebFieldValue()
    const verdict = compareFillReread({
      expected: (prior ?? '') + action.text,
      actual,
      secure: focus.secure,
    })
    return await this.settleFill(action, box, {
      path: 'webview',
      verdict,
      multiline: focus.multiline,
      enter: () => this.withNativeContext(() => this.pressEnter()),
    })
  }

  /**
   * EXEC-02 platform primitives injected into the shared runner scroll loops (D-02/D-03; 436-02
   * D-25). A native swipe is `mobile: scrollGesture` over the container (the ref's bounds, else the
   * screen), whose boolean is the driver's own boundary signal; in a WebView the touch swipe is
   * measured over every WebView scroller before and after (436-18), paired by identity (436-23).
   * nativeSearchScroll drives the UiAutomator
   * `UiScrollable.scrollIntoView` rung over an injection-escaped selector; readInterimTree is a
   * light page-source parse — NO refMap mint, NO screenshot, lastRefs untouched.
   */
  private async buildAndroidScrollPrimitives(
    scrollDirection: Direction,
    maxSwipes: number,
    factor = 1,
  ): Promise<ScrollPrimitives> {
    const driver = this.driver!
    const viewport = await driver.getWindowSize()
    const axisLength = scrollDirection === 'left' || scrollDirection === 'right' ? viewport.width : viewport.height
    const distance = Math.max(1, Math.round(axisLength * 0.6 * factor))

    const webViewSwipe = async (direction: Direction, ref?: Ref): Promise<SwipeSignal> => {
      let sx = Math.round(viewport.width / 2)
      let sy = Math.round(viewport.height / 2)
      if (ref) {
        const { center } = new MobileElementResolver(this.lastRefs).resolve(ref)
        sx = Math.round(center.x)
        sy = Math.round(center.y)
      }
      const before = await this.readWebViewScrollers()
      const pts = computeSwipe(sx, sy, fingerDirectionFor(direction), distance)
      await safePerform(driver.action('pointer', { parameters: { pointerType: 'touch' } })
        .move({ x: pts.startX, y: pts.startY })
        .down({ button: 0 })
        .move({ x: pts.endX, y: pts.endY, duration: 300 })
        .up({ button: 0 })
        )
      const after = await this.readWebViewScrollers()
      return webViewSwipeSignal(direction, before, after)
    }

    return {
      swipeOnce: async (direction: Direction, ref?: Ref): Promise<SwipeSignal> => {
        if (this.activeWebContext) return webViewSwipe(direction, ref)
        const area = gestureArea(
          ref
            ? new MobileElementResolver(this.lastRefs).resolve(ref).bounds
            : { x: 0, y: 0, width: viewport.width, height: viewport.height },
          direction,
          viewport,
        )
        // A1 (436-RESEARCH), confirmed live by 436-12 on an emulator: true = moved and more remains,
        // false = the scrollable cannot go further.
        const canScrollMore = await driver.execute('mobile: scrollGesture', {
          left: Math.round(area.x),
          top: Math.round(area.y),
          width: Math.max(1, Math.round(area.width)),
          height: Math.max(1, Math.round(area.height)),
          direction,
          percent: 0.75 * factor,
        }) as unknown
        if (canScrollMore === true) return 'moved'
        if (canScrollMore === false) return 'at-boundary'
        return 'unknown'
      },
      nativeSearchScroll: async (target: string): Promise<boolean> => {
        // escapeUiSelectorText re-validates + escapes; a control char here throws and the loop
        // surfaces it (the case already rejected control chars up front, so this is escaping only).
        const escaped = escapeUiSelectorText(target)
        const selector =
          `new UiScrollable(new UiSelector().scrollable(true))`
          + `.scrollIntoView(new UiSelector().textContains("${escaped}"))`
        try {
          await driver.execute('mobile: scroll', { strategy: '-android uiautomator', selector, maxSwipes })
          return true
        } catch {
          return false
        }
      },
      readInterimTree: async (): Promise<InterimNode[]> => {
        const xml = await driver.getPageSource()
        const { nodes } = parseMobileSource(xml, 'android', viewport)
        return nodes
      },
    }
  }

  /**
   * The WebView scrollers a touch swipe may have acted on (436-18 · D-25), read by the shared
   * WEBVIEW_SCROLLERS_SCRIPT. The touch point cannot be mapped into the WebView's CSS coordinates,
   * so the swipe is judged over all of them.
   * 2026-10-08 (436-23): a frame in view reads unknown; members carry an identity and are paired
   * by it; open shadow roots are walked; only on-screen element scrollers are members.
   */
  private async readWebViewScrollers(): Promise<IdentifiedScrollOffsets[] | undefined> {
    try {
      return parseWebViewScrollers(await this.driver!.execute(WEBVIEW_SCROLLERS_SCRIPT) as unknown)
    } catch {
      return undefined
    }
  }

  /**
   * EXEC-03 openApp (D-10/D-11/D-12). Resolve a human name to a package id (or validate an
   * explicit bundleId) over the session-cached registry, then launch via activateApp. On a
   * resolution MISS the registry is re-enumerated exactly once (catches mid-run installs) before
   * erroring with the resolver's candidate ids. Never a best-guess launch (T-359-04).
   */
  private async openApp(
    action: { appName: string } | { bundleId: string },
  ): Promise<ActionResult> {
    const driver = this.driver!
    let registry = await this.ensureAppRegistry()
    if (registry === null) {
      return {
        success: false,
        error:
          'openApp could not enumerate installed apps: "mobile: listApps" failed and the '
          + 'shell fallback is disabled. Retry with an explicit openApp {bundleId}, or set '
          + 'AGENT_QA_ANDROID_USE_MOBILE_SHELL=1 to allow the pm-list fallback.',
      }
    }

    if ('bundleId' in action) {
      // Explicit variant: skip matching, validate membership against the cached registry.
      if (!registry.some((entry) => entry.id === action.bundleId)) {
        return {
          success: false,
          error: `openApp: bundleId "${action.bundleId}" is not installed (not in the app registry). Verify the package id or use openApp {appName}.`,
        }
      }
      await driver.activateApp(action.bundleId)
      return { success: true, metadata: { openApp: { resolvedId: action.bundleId, matchKind: 'explicit' } } }
    }

    let resolution = resolveAppName(action.appName, registry)
    if (resolution.kind === 'unknown' || resolution.kind === 'ambiguous') {
      // Re-enumerate exactly once on a MISS before erroring (D-12).
      const fresh = await this.enumerateApps()
      if (fresh !== null) {
        this.appRegistry = fresh
        registry = fresh
        resolution = resolveAppName(action.appName, registry)
      }
    }

    switch (resolution.kind) {
      case 'exact':
      case 'fuzzy':
        await driver.activateApp(resolution.id)
        return { success: true, metadata: { openApp: { resolvedId: resolution.id, matchKind: resolution.kind } } }
      case 'ambiguous':
      case 'unknown': {
        const ids = resolution.candidates.map((c) => c.id).join(', ')
        const lead =
          resolution.kind === 'ambiguous' ? 'is ambiguous between installed apps' : 'did not match an installed app'
        return {
          success: false,
          error: `openApp: "${action.appName}" ${lead}. Closest candidates: ${ids || '(none)'}. Retry openApp {bundleId} with the exact package id.`,
        }
      }
    }
  }

  /** Return the cached registry, enumerating once on first use. Failed enumeration returns null (uncached). */
  private async ensureAppRegistry(): Promise<AppRegistryEntry[] | null> {
    if (this.appRegistry !== null) return this.appRegistry
    const enumerated = await this.enumerateApps()
    if (enumerated !== null) this.appRegistry = enumerated
    return enumerated
  }

  /**
   * Enumerate installed apps through the driver only (ownership contract — no adb/child_process).
   * `mobile: listApps` maps package ids → AppRegistryEntry (labels only when the same call carries
   * them, D-10 — no per-package round-trips). On failure, fall back to `mobile: shell` pm-list ONLY
   * when the AGENT_QA_ANDROID_USE_MOBILE_SHELL gate is '1' (Pitfall 4). Null = enumeration unavailable.
   */
  private async enumerateApps(): Promise<AppRegistryEntry[] | null> {
    const driver = this.driver!
    try {
      const raw = await driver.execute('mobile: listApps')
      return this.mapListApps(raw)
    } catch {
      if (process.env.AGENT_QA_ANDROID_USE_MOBILE_SHELL === '1') {
        try {
          const out = String(await driver.execute('mobile: shell', { command: 'pm', args: ['list', 'packages'] }))
          return this.parsePmListPackages(out)
        } catch {
          return null
        }
      }
      return null
    }
  }

  /** Coerce a `mobile: listApps` result (package-id-keyed map, or an array of entries) into the registry. */
  private mapListApps(raw: unknown): AppRegistryEntry[] {
    const labelOf = (value: unknown): string | undefined => {
      if (!value || typeof value !== 'object') return undefined
      const v = value as Record<string, unknown>
      for (const key of ['label', 'name', 'appName']) {
        const candidate = v[key]
        if (typeof candidate === 'string' && candidate.length > 0) return candidate
      }
      return undefined
    }
    const entries: AppRegistryEntry[] = []
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const v = item as Record<string, unknown>
        const id = v.packageName ?? v.bundleId ?? v.id
        if (typeof id !== 'string' || id.length === 0) continue
        const label = labelOf(item)
        entries.push(label !== undefined ? { id, label } : { id })
      }
    } else if (raw && typeof raw === 'object') {
      for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!id) continue
        const label = labelOf(value)
        entries.push(label !== undefined ? { id, label } : { id })
      }
    }
    return entries
  }

  /** Parse `pm list packages` output ("package:com.foo\n…") into id-only registry entries. */
  private parsePmListPackages(output: string): AppRegistryEntry[] {
    const entries: AppRegistryEntry[] = []
    for (const line of output.split('\n')) {
      const id = line.trim().replace(/^package:/, '')
      if (id) entries.push({ id })
    }
    return entries
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  private async executeAction(action: ActionsFor<'android'>): Promise<ActionResult> {
    const driver = this.driver!
    const resolver = new MobileElementResolver(this.lastRefs)
    const inWeb = !!this.activeWebContext

    switch (action.type) {
      case 'tap': {
        const { center, bounds } = resolver.resolve(action.ref)
        if (inWeb) {
          await driver.execute(
            'var el = document.elementFromPoint(arguments[0], arguments[1]); if (el) el.click();',
            center.x, center.y,
          )
        } else {
          await safePerform(driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ x: Math.round(center.x), y: Math.round(center.y) })
            .down({ button: 0 })
            .up({ button: 0 })
            )
        }
        return { success: true, coordinates: center, boundingBox: bounds }
      }

      case 'fill': {
        // EXEC-01 fill compound (D-05..D-08): tap-focus → clear/append → type → RE-READ the SAME
        // handle → (Enter keycode 66 if submit). ONE ActionResult carrying fillReread metadata;
        // a mismatch is an honest single-shot failure (no internal retry — the 358 ladder mediates).
        const { center, bounds } = resolver.resolve(action.ref)
        const refData = this.lastRefs[action.ref]
        const role = refData?.role?.toLowerCase()
        if (role && !ANDROID_FILLABLE_ROLES.has(role)) {
          return {
            success: false,
            error: `Element ${action.ref} is not fillable (role: ${role}). Use a textbox or input element instead.`,
          }
        }
        const box = { coordinates: center, boundingBox: bounds }
        if (inWeb) {
          return await this.fillWebViewCompound(action, box, center)
        }
        // Native fill — tap to focus, then run the compound from the focused-element handle.
        await safePerform(driver.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x: Math.round(center.x), y: Math.round(center.y) })
          .down({ button: 0 })
          .up({ button: 0 })
          )
        let focusedEl: FocusedField | undefined
        try {
          const el = await driver.$(FOCUSED_XPATH)
          if (await el.isExisting()) focusedEl = el
        } catch {
          focusedEl = undefined
        }
        // 437-05 (2026-10-08, D-12): the path is chosen here, before any text is delivered.
        if (focusedEl) return await this.fillNativeCompound(focusedEl, action, box)
        // Keyboard path — type via keyboard (pass whole string, not split chars). Attempt a focused
        // re-read; when no element value is readable, return success with NO fillReread block —
        // signal-presence law: never fabricate a re-read pair.
        await driver.keys([action.text])
        try {
          const el = await driver.$(FOCUSED_XPATH)
          if (await el.isExisting()) {
            const secure = (await el.getAttribute('password')) === 'true'
            const actual = await this.readElementText(el)
            if (actual !== undefined) {
              const verdict = compareFillReread({ expected: action.text, actual, secure })
              return verdict.ok
                ? { success: true, ...box, metadata: { fillReread: verdict.meta } }
                : { success: false, error: verdict.selfCorrectingError, ...box, metadata: { fillReread: verdict.meta } }
            }
          }
        } catch {
          // no readable handle — degrade honestly below
        }
        return { success: true, ...box }
      }

      case 'nativeSelect': {
        const { center, bounds } = resolver.resolve(action.ref)
        const refData = this.lastRefs[action.ref]
        if (!isAndroidNativeSelectTarget(refData)) {
          return {
            success: false,
            error: 'nativeSelect only supports native Android picker/dropdown/list controls. Use tap, swipe, or tapCoordinate for custom controls.',
            coordinates: center,
            boundingBox: bounds,
          }
        }

        await safePerform(driver.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x: Math.round(center.x), y: Math.round(center.y) })
          .down({ button: 0 })
          .up({ button: 0 })
          )

        const option = await findAndroidNativeOption(driver, action.value)
        if (!option) {
          return {
            success: false,
            error: `Could not find native Android option "${action.value}". Open the control with tap, then use swipe/tap/tapCoordinate for custom controls.`,
            coordinates: center,
            boundingBox: bounds,
          }
        }

        if (typeof option.element.click === 'function') {
          await option.element.click()
        } else {
          return {
            success: false,
            error: `Could not click native Android option "${action.value}". Use tap, swipe, or tapCoordinate for custom controls.`,
            coordinates: center,
            boundingBox: bounds,
          }
        }

        return {
          success: true,
          coordinates: center,
          boundingBox: bounds,
          data: {
            requestedValue: action.value,
            matchedValue: option.matchedValue,
            matchStrategy: option.matchStrategy,
          },
        }
      }

      case 'scroll': {
        // EXEC-02 scroll (D-02/D-03; 436-02 D-24/D-25): ONE ActionResult carrying scrollUntilVisible
        // metadata. untilVisible prefers the native UiScrollable rung (injection-escaped), then
        // bounded swipes with light page-source probes for target visibility; direction mode is one
        // gesture. Movement and boundaries come only from scrollGesture's result or WebView
        // offsets, never from interim-tree comparisons, and lastRefs is untouched (D-03).
        if (action.mode === 'untilVisible') {
          // Reject a hostile/control-char target up front — never interpolate it (Pitfall 9).
          try {
            escapeUiSelectorText(action.text)
          } catch (err) {
            return { success: false, error: err instanceof Error ? err.message : String(err) }
          }
          const primitives = await this.buildAndroidScrollPrimitives(action.direction, action.maxSwipes)
          const { meta } = await runUntilVisibleLoop(primitives, {
            target: action.text,
            direction: action.direction,
            maxSwipes: action.maxSwipes,
            retryOpposite: action.retryOpposite,
            ...(action.ref ? { ref: action.ref } : {}),
          })
          return { success: true, metadata: { scrollUntilVisible: meta } }
        }

        // direction mode: page / halfPage / toEnd.
        const factor = action.amount === 'halfPage' ? 0.5 : 1
        const primitives = await this.buildAndroidScrollPrimitives(action.direction, 0, factor)
        if (action.amount === 'toEnd') {
          const { meta } = await runToEndScroll(primitives, action.direction, action.ref)
          return { success: true, metadata: { scrollUntilVisible: meta } }
        }
        const { meta } = await runDirectionScroll(primitives, {
          direction: action.direction,
          ...(action.ref ? { ref: action.ref } : {}),
        })
        return { success: true, metadata: { scrollUntilVisible: meta } }
      }

      case 'swipe': {
        if (inWeb) {
          await this.ensureContext('NATIVE_APP')
        }
        const { width, height } = await driver.getWindowSize()

        // Schema shapes: SwipeByPath drives explicit from/to points; SwipeByDirection computes a
        // page-sized gesture from the (optional ref) center (legacy startX..endY reads retired).
        let pts: { startX: number; startY: number; endX: number; endY: number }
        if (action.mode === 'path') {
          pts = {
            startX: Math.round(action.from.x),
            startY: Math.round(action.from.y),
            endX: Math.round(action.to.x),
            endY: Math.round(action.to.y),
          }
        } else {
          let sx = Math.round(width / 2)
          let sy = Math.round(height / 2)
          if (action.ref) {
            const { center } = resolver.resolve(action.ref)
            sx = Math.round(center.x)
            sy = Math.round(center.y)
          }
          const distance = Math.round(height * 0.6)
          pts = computeSwipe(sx, sy, action.direction, distance)
        }
        warnIfOutOfBounds({ x: pts.startX, y: pts.startY }, { width, height }, 'swipe')
        warnIfOutOfBounds({ x: pts.endX, y: pts.endY }, { width, height }, 'swipe')
        const swipeDuration = action.durationMs

        await safePerform(driver.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x: pts.startX, y: pts.startY })
          .down({ button: 0 })
          .move({ x: pts.endX, y: pts.endY, duration: swipeDuration })
          .up({ button: 0 })
          )
        if (inWeb) {
          await this.ensureContext(this.activeWebContext!)
        }
        return {
          success: true,
          startCoordinates: { x: pts.startX, y: pts.startY },
          endCoordinates: { x: pts.endX, y: pts.endY },
        }
      }

      case 'pinch': {
        const { width: pinchW, height: pinchH } = await driver.getWindowSize()
        let pcx = Math.round(pinchW / 2)
        let pcy = Math.round(pinchH / 2)

        if ('ref' in action) {
          const { center } = resolver.resolve(action.ref)
          pcx = Math.round(center.x)
          pcy = Math.round(center.y)
        } else {
          pcx = action.x
          pcy = action.y
        }
        warnIfOutOfBounds({ x: pcx, y: pcy }, { width: pinchW, height: pinchH }, 'pinch')

        const { finger1Start, finger1End, finger2Start, finger2End } = computePinch(pcx, pcy, action.scale)
        const pinchDuration = 500

        await driver.actions([
          driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ x: Math.round(finger1Start.x), y: Math.round(finger1Start.y) })
            .down({ button: 0 })
            .move({ x: Math.round(finger1End.x), y: Math.round(finger1End.y), duration: pinchDuration })
            .up({ button: 0 }),
          driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ x: Math.round(finger2Start.x), y: Math.round(finger2Start.y) })
            .down({ button: 0 })
            .move({ x: Math.round(finger2End.x), y: Math.round(finger2End.y), duration: pinchDuration })
            .up({ button: 0 }),
        ])
        return { success: true, coordinates: { x: pcx, y: pcy } }
      }

      case 'multiTap': {
        const { width: mtW, height: mtH } = await driver.getWindowSize()
        let mtcx = Math.round(mtW / 2)
        let mtcy = Math.round(mtH / 2)

        if ('ref' in action) {
          const { center } = resolver.resolve(action.ref)
          mtcx = Math.round(center.x)
          mtcy = Math.round(center.y)
        } else {
          mtcx = action.x
          mtcy = action.y
        }
        warnIfOutOfBounds({ x: mtcx, y: mtcy }, { width: mtW, height: mtH }, 'multiTap')

        const positions = computeFingerPositions(mtcx, mtcy, action.fingers)
        await driver.actions(
          positions.map(pos =>
            driver.action('pointer', { parameters: { pointerType: 'touch' } })
              .move({ x: Math.round(pos.x), y: Math.round(pos.y) })
              .down({ button: 0 })
              .pause(100)
              .up({ button: 0 })
          )
        )
        return { success: true }
      }

      case 'longpress': {
        const { center } = resolver.resolve(action.ref)
        await safePerform(driver.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x: Math.round(center.x), y: Math.round(center.y) })
          .down({ button: 0 })
          .pause(action.duration ?? 1000)
          .up({ button: 0 })
          )
        return { success: true }
      }

      case 'waitFor': {
        // Schema on-modes replace the legacy {condition,timeout} blind pause. text/gone poll the
        // native accessibility tree; selector-mode is a web-only capability (§7.1, catalog pin).
        if (action.on === 'selector') {
          return {
            success: false,
            error: 'waitFor {on:"selector"} (CSS/XPath) is a web-only mode. On native Android, wait on visible text with waitFor {on:"text"} or {on:"gone"}.',
          }
        }
        const wantPresent = action.on === 'text'
        const needle = action.text
        const deadline = Date.now() + action.timeoutMs
        for (;;) {
          let source = ''
          try {
            source = await driver.getPageSource()
          } catch {
            source = ''
          }
          if (source.includes(needle) === wantPresent) return { success: true }
          if (Date.now() >= deadline) break
          await driver.pause(Math.min(250, Math.max(1, deadline - Date.now())))
        }
        return {
          success: false,
          error: wantPresent
            ? `waitFor: text "${needle}" did not appear within ${action.timeoutMs}ms.`
            : `waitFor: text "${needle}" was still present after ${action.timeoutMs}ms.`,
        }
      }

      case 'delay': {
        await driver.pause(action.ms)
        return { success: true }
      }

      case 'keypress': {
        // Schema adds mode:'press'|'down'|'up'. Only 'press' is meaningful on mobile — key
        // hold/release is a web-only lane (§7.1, catalog pin). convertPlatformKeys is a no-op on
        // mobile (no Meta/Control distinction in Appium key codes per D-13).
        if (action.mode !== 'press') {
          return {
            success: false,
            error: `keypress {mode:"${action.mode}"} (key hold/release) is web-only. On mobile, emit keypress {mode:"press"} to send the key.`,
          }
        }
        for (const rawKey of action.keys) {
          const mapped = KEY_MAP[rawKey] ?? rawKey
          await driver.keys([mapped])
        }
        return { success: true }
      }

      // --- New actions ---

      case 'hideKeyboard': {
        try {
          await driver.hideKeyboard()
        } catch {
          try { await driver.execute('mobile: pressKey', { keycode: 4 }) } catch { /* best-effort */ }
        }
        return { success: true }
      }

      case 'clearText': {
        const { center, bounds } = resolver.resolve(action.ref)
        const clearRefData = this.lastRefs[action.ref]
        const clearRole = clearRefData?.role?.toLowerCase()
        if (clearRole && !ANDROID_FILLABLE_ROLES.has(clearRole)) {
          return {
            success: false,
            error: `Element ${action.ref} is not fillable (role: ${clearRole}). clearText only works on text inputs. Use a textbox or input element instead.`,
          }
        }
        await safePerform(driver.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x: Math.round(center.x), y: Math.round(center.y) })
          .down({ button: 0 })
          .up({ button: 0 })
          )
        try {
          const el = await driver.$(FOCUSED_XPATH)
          if (await el.isExisting()) {
            await el.clearValue()
          }
        } catch {
          // best-effort
        }
        return { success: true, coordinates: center, boundingBox: bounds }
      }

      // --- Android hardware / system verbs (numeric keycodes / typed driver args only) ---

      case 'pressBack':
        await driver.execute('mobile: pressKey', { keycode: 4 })
        return { success: true }

      case 'pressHome':
        await driver.execute('mobile: pressKey', { keycode: 3 })
        return { success: true }

      case 'pressRecent':
        await driver.execute('mobile: pressKey', { keycode: 187 })
        return { success: true }

      case 'openNotifications':
        await driver.execute('mobile: openNotifications')
        return { success: true }

      case 'openQuickSettings':
        // args-array shell (A1) — never a concatenated command string (Pitfall 6).
        await driver.execute('mobile: shell', { command: 'cmd', args: ['statusbar', 'expand-settings'] })
        return { success: true }

      case 'intent': {
        // T-360-02 / Pitfall 6: map the schema fields onto TYPED mobile: startActivity args. Extras
        // become [[typeTag, key, value]] triples (string→s / int→i / long→l / float→f / bool→z);
        // planner-supplied values pass through byte-identical as typed args — NEVER interpolated
        // into an am-start shell string.
        const TYPE_TAG: Record<'string' | 'int' | 'long' | 'float' | 'bool', string> = {
          string: 's', int: 'i', long: 'l', float: 'f', bool: 'z',
        }
        const intentArgs: Record<string, unknown> = { action: action.action }
        if (action.data !== undefined) intentArgs.uri = action.data
        if (action.packageName !== undefined) intentArgs.package = action.packageName
        if (action.extras && action.extras.length > 0) {
          intentArgs.extras = action.extras.map(
            (e): [string, string, string] => [TYPE_TAG[e.type], e.key, e.value],
          )
        }
        await driver.execute('mobile: startActivity', intentArgs)
        return { success: true }
      }

      case 'keyevent': {
        // T-360-02: allow-list the symbolic code BEFORE any driver call (the 359 escapeUiSelectorText
        // posture). A non-matching (hostile) string is rejected with a §7.1 error — never reaches a
        // driver.execute. A matching code runs through an args-array shell lane (no interpolation).
        if (!/^KEYCODE_[A-Z0-9_]+$/.test(action.keycode)) {
          return {
            success: false,
            error: `keyevent: "${action.keycode}" is not a valid Android key code. Provide a symbolic code matching ^KEYCODE_[A-Z0-9_]+$ (e.g. KEYCODE_ENTER, KEYCODE_TAB).`,
          }
        }
        await driver.execute('mobile: shell', { command: 'input', args: ['keyevent', action.keycode] })
        return { success: true }
      }

      case 'assertValue': {
        // D-10: the adapter RESOLVES the requested source to a raw value on ActionResult.data; the
        // runner-side comparator applies the op and judges. The adapter never compares. url/storage/
        // expr read the live WebView (web-context) machinery; sources with no native lane return a
        // §7.1 error naming the platform limitation.
        if ('expr' in action) {
          if (!inWeb) {
            return {
              success: false,
              error: 'assertValue {expr} evaluates JavaScript and is only available in an Android WebView/browser context. Assert on a native signal, or run against a web target.',
            }
          }
          const value = await driver.execute(`return (${action.expr});`)
          return { success: true, data: value }
        }
        switch (action.source) {
          case 'url': {
            if (!inWeb) {
              return {
                success: false,
                error: 'assertValue {source:"url"} reads the browser URL and is only available in an Android WebView/browser context; native screens have no URL.',
              }
            }
            const value = await driver.execute('return window.location.href;')
            return { success: true, data: value }
          }
          case 'storage': {
            if (!inWeb) {
              return {
                success: false,
                error: 'assertValue {source:"storage"} reads Web Storage and is only available in an Android WebView/browser context.',
              }
            }
            const value = await driver.execute(
              'return Object.fromEntries(Object.keys(localStorage).map(function(k){return [k, localStorage.getItem(k)];}));',
            )
            return { success: true, data: value }
          }
          case 'network':
            return {
              success: false,
              error: 'assertValue {source:"network"} (HTTP log inspection) is not available on the Android adapter. Use a web target for network assertions, or assert on visible UI text.',
            }
          case 'expr-result':
            return { success: true, data: undefined }
        }
      }

      case 'drag': {
        const from = resolver.resolve(action.fromRef)
        const to = resolver.resolve(action.toRef)
        if (inWeb) await this.ensureContext('NATIVE_APP')
        await safePerform(driver.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x: Math.round(from.center.x), y: Math.round(from.center.y) })
          .down({ button: 0 })
          .pause(300)
          .move({ x: Math.round(to.center.x), y: Math.round(to.center.y), duration: 500 })
          .up({ button: 0 })
          )
        if (inWeb) await this.ensureContext(this.activeWebContext!)
        return { success: true }
      }

      case 'doubleTap': {
        const { center, bounds } = resolver.resolve(action.ref)
        const x = Math.round(center.x)
        const y = Math.round(center.y)
        await safePerform(driver.action('pointer', { parameters: { pointerType: 'touch' } })
          .move({ x, y })
          .down({ button: 0 })
          .up({ button: 0 })
          .pause(50)
          .down({ button: 0 })
          .up({ button: 0 })
          )
        return { success: true, coordinates: center, boundingBox: bounds }
      }

      case 'openApp':
        // EXEC-03 (D-10/D-12): resolve a human app name (or validate an explicit bundleId) over a
        // session-cached registry, then launch via activateApp. Never a best-guess launch.
        return await this.openApp(action)

      case 'stopApp': {
        await driver.terminateApp(action.bundleId)
        return { success: true }
      }

      case 'setOrientation': {
        await driver.setOrientation(action.orientation === 'landscape' ? 'LANDSCAPE' : 'PORTRAIT')
        return { success: true }
      }

      case 'executeScript': {
        const result = await driver.execute(action.command, action.args ?? {})
        return { success: true, data: result }
      }

      case 'tapCoordinate': {
        const x = action.x
        const y = action.y
        const tcVp = await driver.getWindowSize()
        warnIfOutOfBounds({ x, y }, { width: tcVp.width, height: tcVp.height }, 'tapCoordinate')
        if (inWeb) {
          await driver.execute(
            'var el = document.elementFromPoint(arguments[0], arguments[1]); if (el) el.click();',
            x, y,
          )
        } else {
          await safePerform(driver.action('pointer', { parameters: { pointerType: 'touch' } })
            .move({ x, y })
            .down({ button: 0 })
            .up({ button: 0 })
            )
        }
        return { success: true, coordinates: { x, y } }
      }

      // Runner-minted / author-channel verbs (D-01/D-15): reportValue, assertAI, extractAI, and
      // setVariable are intercepted at the runner dispatch seam and never reach the adapter. A
      // grouped §7.1 defensive case surfaces a dispatch-routing error if one arrives here;
      // assertNever remains the backstop for a genuinely unknown schema verb. (uniqueValue is
      // web-only and is not part of ActionsFor<'android'>.)
      case 'reportValue':
      case 'assertAI':
      case 'extractAI':
      case 'setVariable':
        return {
          success: false,
          error: `Action "${action.type}" is handled by the runner dispatch seam and must not reach the Android adapter (runner-minted/author-channel verb). This indicates a dispatch routing error.`,
        }

      default:
        return assertNever(action)
    }
  }
}
