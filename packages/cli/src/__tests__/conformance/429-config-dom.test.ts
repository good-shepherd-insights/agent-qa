/// <reference lib="dom" />
// Phase 429 on the shipped bundle (429-33): the built `agent-qa dashboard` serving the built
// dashboard-ui to a real Chromium, in a hermetic HOME so every auth.json read and write lands in a
// throwaway store. A browser that cannot launch is a red, never a skip. Captures go only where
// AGENT_QA_429_CAPTURE_DIR points. Run with --maxWorkers=1: the cells share one spawned dashboard.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { CONFIG_MASK_PLACEHOLDER } from '@vostride/agent-qa-schema'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  DASHBOARD_ANCHORED_BUILDS,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  hermeticEnv,
  reserveEphemeralPort,
  spawnDashboard,
  trackTempRoot,
  type SpawnedDashboard,
} from './spawned-chat.js'

const DESKTOP = { width: 1280, height: 800 }
const NARROW = { width: 400, height: 800 }
type Viewport = typeof DESKTOP
const labelOf = (viewport: Viewport) => `${String(viewport.width)}x${String(viewport.height)}`

const TABS = ['models', 'targets', 'execution', 'project', 'advanced'] as const
const TAB_LABELS = ['Models', 'Targets', 'Execution', 'Project', 'Advanced']
const INNER_MAIN = 'main main'

// The 21 live legacy links, written out rather than imported, each with the tab it lands on and the
// section heading that must hold focus there.
const LEGACY_LINKS = [
  ['workspace', 'discovery', 'project', 'test-discovery', 'Test discovery'],
  ['workspace', 'files', 'project', 'files', 'Hooks, env and secrets files'],
  ['knowledge', 'store', 'project', 'knowledge', 'Knowledge store'],
  ['services', 'dashboard', 'project', 'dashboard', 'Dashboard'],
  ['services', 'cache', 'execution', 'cache', 'Cache'],
  ['services', 'auth-states', 'targets', 'login-states', 'Saved login states'],
  ['services', 'logging', 'project', 'logging', 'Logging'],
  ['services', 'recording', 'execution', 'recording', 'Recording'],
  ['services', 'accessibility', 'execution', 'accessibility', 'Accessibility'],
  ['services', 'vision', 'models', 'screenshot-size', 'Screenshot size'],
  ['registry', 'llms', 'models', 'models', 'Models'],
  ['registry', 'targets', 'targets', 'targets', 'Targets'],
  ['registry', 'devices', 'targets', 'devices', 'Devices'],
  ['registry', 'providers', 'targets', 'device-farms', 'Device farms'],
  ['use', 'browser', 'execution', 'browser', 'Browser'],
  ['use', 'timeouts', 'execution', 'timeouts', 'Timeouts'],
  ['use', 'planner', 'models', 'planner-limits', 'Planner limits'],
  ['use', 'log-capture', 'execution', 'log-capture', 'Log capture'],
  ['use', 'mobile', 'targets', 'mobile-app-state', 'Mobile app state'],
  ['use', 'execution-defaults', 'models', 'models', 'Models'],
  ['analytics', 'pass-rate-scope', 'project', 'pass-rate-scope', 'Pass-rate scope'],
] as const

// Invented sentinels only (T-429-33-02): nothing here exists outside this file.
const SENTINELS = {
  header: 'zz-429-33-HEADER-SENTINEL-4c1e',
  farm: 'zz-429-33-FARM-ACCESS-KEY-9b27',
  udid: 'zz-429-33-UDID-SENTINEL-0d61',
  auth: 'zz-429-33-AUTH-JSON-SENTINEL-73fa',
} as const
const MCP_TOKEN_ENV_VAR = 'AGENT_QA_MCP_TOKEN'
const PLUGIN_PACKAGE = '@example/agent-qa-auth'
const LONG_TARGET = 'checkout-staging-with-a-deliberately-long-target-name'

const TASK1_CONFIG = [
  'workspace:',
  '  testMatch:',
  '    - tests/**/*.test.yaml',
  '  suiteMatch:',
  '    - suites/**/*.suite.yaml',
  '  hooksFile: hooks.yaml',
  '  envFile: .env',
  '  secretsFile: .env.secrets.local',
  'knowledge:',
  '  dir: agent-qa-knowledge',
  '  commitArtifacts: none',
  'services:',
  '  mcp:',
  '    tokens:',
  '      - name: ci',
  `        tokenEnvVar: ${MCP_TOKEN_ENV_VAR}`,
  '        scopes:',
  '          - read',
  'registry:',
  '  llms:',
  '    - name: gpt',
  '      provider: anthropic-compatible',
  '      model: claude-proxy',
  '      baseURL: https://llm.example.invalid/v1',
  '      providerHeaders:',
  `        x-org-route: ${SENTINELS.header}`,
  '  targets:',
  '    conformance:',
  '      platform: web',
  '      url: https://conformance.invalid',
  `    ${LONG_TARGET}:`,
  '      platform: web',
  '      url: https://checkout-staging.invalid',
  '  providers:',
  '    farm:',
  `      accessKey: ${SENTINELS.farm}`,
  '  devices:',
  '    phone:',
  '      platform: ios',
  '      transport: local',
  '      match:',
  `        udid: ${SENTINELS.udid}`,
  'plugins:',
  '  auth:',
  `    - package: "${PLUGIN_PACKAGE}"`,
  'use:',
  '  llm: gpt',
  '  mobile:',
  '    appState: preserve',
  '',
].join('\n')

const BROWSER_INSTALL_INSTRUCTION =
  'Chromium could not be launched by the pinned playwright-core. Run '
  + '`node node_modules/playwright-core/cli.js install chromium` from packages/cli and re-run; '
  + 'these cells must not be skipped when the browser is absent.'

interface Project {
  readonly root: string
  readonly configPath: string
  readonly authPath: string
}

/** A project the shipped dashboard opens, with its HOME (and so its auth.json) inside the temp root. */
function writeProject(label: string, config: string, auth?: Record<string, unknown>): Project {
  const root = trackTempRoot(mkdtempSync(join(tmpdir(), `agent-qa-429-33-${label}-`)))
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(configPath, config, 'utf8')
  writeFileSync(join(root, 'hooks.yaml'), 'hooks: []\n', 'utf8')
  writeFileSync(join(root, '.env'), '', 'utf8')
  writeFileSync(join(root, '.env.secrets.local'), '', 'utf8')
  mkdirSync(join(root, '.agent-qa'), { recursive: true })
  mkdirSync(join(root, 'agent-qa-knowledge'), { recursive: true })
  const authPath = join(hermeticEnv(root).HOME, '.agent-qa', 'auth.json')
  if (auth !== undefined) writeFileSync(authPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 })
  if (config.includes(PLUGIN_PACKAGE)) plantEmptyAuthPlugin(root)
  return { root, configPath, authPath }
}

/** The declared plugin must resolve or the dashboard refuses to start; this one registers nothing. */
function plantEmptyAuthPlugin(root: string) {
  const dir = join(root, 'node_modules', ...PLUGIN_PACKAGE.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: PLUGIN_PACKAGE, version: '0.0.0', type: 'module', exports: './index.js' })}\n`, 'utf8')
  writeFileSync(join(dir, 'index.js'), 'export const providers = []\n', 'utf8')
}

/** The operator's own auth.json, fingerprinted so a cell can prove the run never touched it. */
function realAuthFingerprint(): string {
  const path = process.env.XDG_DATA_HOME
    ? join(process.env.XDG_DATA_HOME, 'agent-qa', 'auth.json')
    : join(homedir(), '.agent-qa', 'auth.json')
  if (!existsSync(path)) return 'absent'
  const stat = statSync(path)
  return `${String(stat.size)}:${String(stat.mtimeMs)}`
}

async function launchBrowser(dashboard: SpawnedDashboard): Promise<Browser> {
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    await dashboard.stop()
    throw new Error(`${BROWSER_INSTALL_INSTRUCTION} underlying error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const PRODUCT_TOUR_COOKIE = 'agent_qa_product_tour_state'
const TOUR_SKIPPED = encodeURIComponent(JSON.stringify({
  schemaVersion: 1, tourVersion: 'foundation-v1', skippedAt: '2026-09-27T00:00:00.000Z',
}))

// Every page records any dialog that ever mounts, and every uncaught error, from its first byte.
const DIALOG_WATCH = `(() => {
  const seen = []
  window.__dialogsSeen = seen
  const scan = () => {
    for (const element of document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal]')) {
      const text = element.outerHTML.slice(0, 160)
      if (!seen.includes(text)) seen.push(text)
    }
  }
  new MutationObserver(scan).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['role', 'aria-modal'] })
})()`

interface OpenedPage {
  readonly page: Page
  readonly context: BrowserContext
  readonly errors: string[]
}

class Harness {
  readonly dialogs: string[] = []
  private readonly open = new Set<OpenedPage>()

  constructor(readonly browser: Browser, readonly origin: string) {}

  async page(viewport: Viewport): Promise<OpenedPage> {
    const context = await this.browser.newContext({ viewport })
    // A returning person: the first-visit product tour (a global, non-modal overlay outside Config)
    // was skipped, so it neither covers the captures nor counts as a Config dialog.
    await context.addCookies([{ name: PRODUCT_TOUR_COOKIE, value: TOUR_SKIPPED, url: this.origin }])
    await context.addInitScript(DIALOG_WATCH)
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => { errors.push(String(error)) })
    const opened = { page, context, errors }
    this.open.add(opened)
    return opened
  }

  async close(opened: OpenedPage): Promise<void> {
    if (!this.open.delete(opened)) return
    for (const page of opened.context.pages()) {
      const seen = await page.evaluate(() => (window as unknown as { __dialogsSeen?: string[] }).__dialogsSeen ?? []).catch(() => [])
      this.dialogs.push(...seen)
    }
    await opened.context.close()
  }

  async closeAll(): Promise<void> {
    for (const opened of [...this.open]) await this.close(opened)
    await this.browser.close()
  }
}

async function frames(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}

async function openConfig(harness: Harness, page: Page, path: string) {
  await page.goto(`${harness.origin}${path}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-config-page][data-config-state="ready"]').waitFor({ timeout: 30_000 })
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await frames(page)
}

async function openTab(harness: Harness, page: Page, tab: string) {
  await openConfig(harness, page, `/config/${tab}`)
  await page.locator(`[data-config-panel="${tab}"][data-state="active"]`).waitFor({ timeout: 15_000 })
  await frames(page)
}

function captureDir(): string | undefined {
  const directory = process.env.AGENT_QA_429_CAPTURE_DIR
  if (!directory) return undefined
  mkdirSync(directory, { recursive: true })
  return directory
}

/** The whole page in one picture: the viewport grown by whatever the inner main scrolls. */
async function captureFullPage(page: Page, name: string) {
  const directory = captureDir()
  if (!directory) return
  const size = page.viewportSize()!
  const extra = await page.evaluate((selector) => {
    const main = document.querySelector<HTMLElement>(selector)
    return main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0
  }, INNER_MAIN)
  await page.setViewportSize({ width: size.width, height: size.height + extra })
  await frames(page)
  await page.screenshot({ path: join(directory, `${name}.png`), animations: 'disabled' })
  await page.setViewportSize(size)
  await frames(page)
}

async function captureViewport(page: Page, name: string) {
  const directory = captureDir()
  if (!directory) return
  await page.screenshot({ path: join(directory, `${name}.png`), animations: 'disabled' })
}

const UNNAMED_CONTROL = /^\s*- (button|textbox|checkbox|switch|radio|tab|combobox|spinbutton|slider|link)\b(?! ")/

function unnamedControls(snapshot: string): string[] {
  return snapshot.split('\n').filter((line) => UNNAMED_CONTROL.test(line))
}

describe('Config tabs, links, geometry, masking and names on the shipped bundle (429-33 task 1)', () => {
  let dashboard: SpawnedDashboard | undefined
  let harness: Harness | undefined
  let project: Project | undefined
  let realAuthBefore = ''

  beforeAll(async () => {
    const freshness = buildFreshness(DASHBOARD_ANCHORED_BUILDS)
    expect(freshness, REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })

    realAuthBefore = realAuthFingerprint()
    project = writeProject('tabs', TASK1_CONFIG, {
      gpt: { type: 'api', provider: 'anthropic-compatible', key: SENTINELS.auth },
    })
    const spawned = await spawnDashboard(project.root, project.configPath, await reserveEphemeralPort())
    expect(spawned.ready, `the built dashboard never listened. stdout: ${spawned.stdout().slice(-1200)} stderr: ${spawned.stderr().slice(-1200)}`).toBe(true)
    dashboard = spawned
    harness = new Harness(await launchBrowser(spawned), spawned.origin)
  }, 180_000)

  afterAll(async () => {
    await harness?.closeAll()
    await dashboard?.stop()
    cleanupTempRoots()
  })

  function live(): Harness {
    expect(harness, 'the shipped dashboard or the browser did not stand up; see beforeAll').toBeDefined()
    return harness!
  }

  it('TABS-FIVE-IN-ORDER-SHIPPED', async () => {
    const h = live()
    for (const viewport of [DESKTOP, NARROW]) {
      const opened = await h.page(viewport)
      const { page } = opened
      await openConfig(h, page, '/config')
      await page.waitForURL((url) => url.pathname === '/config/models', { timeout: 10_000 })
      const read = await page.evaluate(() => {
        const root = document.querySelector('[data-config-page]')!
        const lists = [...root.querySelectorAll('[role="tablist"]')]
        return {
          lists: lists.length,
          label: lists[0]?.getAttribute('aria-label') ?? null,
          tabs: [...(lists[0]?.querySelectorAll('[role="tab"]') ?? [])].map((tab) => (tab.textContent ?? '').trim()),
          selected: [...root.querySelectorAll('[role="tab"][aria-selected="true"]')].map((tab) => tab.getAttribute('data-config-tab')),
          selects: document.querySelectorAll('select').length,
          stripCombos: root.querySelectorAll('[data-config-tabbar] select, [data-config-tabbar] [role="combobox"]').length,
          tourNav: document.querySelectorAll('[data-tour-id="tour-config-nav"]').length,
          tourSection: document.querySelectorAll('[data-tour-id="tour-config-section"]').length,
          fileIssues: document.querySelectorAll('[data-config-file-issues], [data-config-load-error]').length,
        }
      })
      const where = `${labelOf(viewport)}: ${JSON.stringify(read)}`
      expect(read.lists, where).toBe(1)
      expect(read.label, where).toBe('Config sections')
      expect(read.tabs, where).toEqual(TAB_LABELS)
      expect(read.selected, where).toEqual(['models'])
      expect(read.selects, where).toBe(0)
      expect(read.stripCombos, where).toBe(0)
      expect(read.tourNav, where).toBe(1)
      expect(read.tourSection, where).toBe(1)
      expect(read.fileIssues, `${where}: the fixture config must load clean`).toBe(0)
      expect(opened.errors, where).toEqual([])
      await h.close(opened)
    }
  }, 120_000)

  it('LEGACY-LINKS-SHIPPED', async () => {
    const h = live()
    const opened = await h.page(DESKTOP)
    const { page } = opened
    const landed: string[] = []
    for (const [bucket, item] of LEGACY_LINKS) {
      await openConfig(h, page, `/config?bucket=${bucket}&item=${item}`)
      await page.waitForFunction(() => location.search === '' && location.pathname.startsWith('/config/'), undefined, { timeout: 10_000 })
      await page.waitForFunction(() => document.activeElement?.tagName === 'H2', undefined, { timeout: 5_000 }).catch(() => undefined)
      const at = await page.evaluate(() => {
        const active = document.activeElement
        return `${location.pathname} ${active?.tagName.toLowerCase() ?? 'none'}#${active?.id ?? ''} ${(active?.textContent ?? '').trim()}`
      })
      landed.push(`${bucket}:${item} -> ${at}`)
    }
    const expected = LEGACY_LINKS.map(([bucket, item, tab, section, heading]) =>
      `${bucket}:${item} -> /config/${tab} h2#config-section-${section}-heading ${heading}`)
    expect(landed).toEqual(expected)
    expect(landed).toHaveLength(21)
    expect(opened.errors).toEqual([])
    await h.close(opened)
  }, 240_000)

  it('STATUS-NEVER-SCROLLS-AWAY', async () => {
    const h = live()
    const reads: string[] = []
    for (const viewport of [NARROW, DESKTOP]) {
      const opened = await h.page(viewport)
      const { page } = opened
      await openTab(h, page, 'targets')
      await page.getByRole('button', { name: `Delete target ${LONG_TARGET}`, exact: true }).click()
      await page.locator('[data-save-status="undo"]').waitFor({ timeout: 10_000 })
      // Scroll whichever element owns the page's vertical scroll all the way down.
      await page.evaluate((selector) => {
        const main = document.querySelector<HTMLElement>(selector)!
        main.scrollTop = main.scrollHeight
        document.scrollingElement!.scrollTop = document.scrollingElement!.scrollHeight
      }, INNER_MAIN)
      await frames(page)
      await frames(page)
      const read = await page.evaluate(() => {
        const box = (selector: string) => {
          const rect = document.querySelector(selector)!.getBoundingClientRect()
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width }
        }
        return {
          innerWidth, innerHeight,
          status: box('[data-save-status]'),
          strip: box('[data-config-tabs-scroll]'),
          active: box('[data-config-tab][aria-selected="true"]'),
          line: document.querySelector('[data-save-undo-line]')?.getAttribute('aria-label') ?? null,
          scrolled: document.querySelector('main main')!.scrollTop + document.scrollingElement!.scrollTop,
        }
      })
      await captureViewport(page, `status-undo-${labelOf(viewport)}`)
      const where = `${labelOf(viewport)}: ${JSON.stringify(read)}`
      reads.push(where)
      expect(read.line, where).toBe(`Deleted target ${LONG_TARGET}`)
      expect(read.scrolled, `${where}: the page must actually have scrolled`).toBeGreaterThan(0)
      expect(read.status.left, where).toBeGreaterThanOrEqual(0)
      expect(read.status.top, `${where}: the status scrolled away`).toBeGreaterThanOrEqual(0)
      expect(read.status.right, where).toBeLessThanOrEqual(read.innerWidth)
      expect(read.status.bottom, where).toBeLessThanOrEqual(read.innerHeight)
      const overlaps = read.status.left < read.strip.right && read.strip.left < read.status.right
        && read.status.top < read.strip.bottom && read.strip.top < read.status.bottom
      expect(overlaps, `${where}: the status box overlaps the tab scroll box`).toBe(false)
      // As much of the active tab as the strip can hold is inside it: all of it when it fits.
      const visible = Math.min(read.active.right, read.strip.right) - Math.max(read.active.left, read.strip.left)
      expect(visible, `${where}: the active tab is not scrolled into view`).toBeGreaterThanOrEqual(Math.min(read.active.width, read.strip.width) - 1)
      expect(readFileSync(project!.configPath, 'utf8')).not.toContain(`${LONG_TARGET}:`)

      await page.getByRole('button', { name: 'Undo', exact: true }).click()
      await page.locator(`[data-target="${LONG_TARGET}"]`).waitFor({ timeout: 10_000 })
      await expect.poll(() => readFileSync(project!.configPath, 'utf8'), { timeout: 10_000 }).toContain(`${LONG_TARGET}:`)
      expect(opened.errors).toEqual([])
      await h.close(opened)
    }
    process.stderr.write(`429-33 STATUS-NEVER-SCROLLS-AWAY measured:\n${reads.join('\n')}\n`)
  }, 120_000)

  it('NO-SIDEWAYS-SCROLL', async () => {
    const h = live()
    const measured: string[] = []
    for (const viewport of [DESKTOP, NARROW]) {
      const opened = await h.page(viewport)
      const { page } = opened
      for (const tab of TABS) {
        await openTab(h, page, tab)
        const read = await page.evaluate(() => {
          const scroll = (element: Element | null) => ({ scrollWidth: element?.scrollWidth ?? -1, clientWidth: element?.clientWidth ?? -1 })
          return {
            document: scroll(document.scrollingElement),
            inset: scroll(document.querySelector('main[data-slot="sidebar-inset"]')),
            main: scroll(document.querySelector('main main')),
            innerWidth,
          }
        })
        measured.push(`${labelOf(viewport)} ${tab} ${JSON.stringify(read)}`)
        const where = `${labelOf(viewport)} ${tab}: ${JSON.stringify(read)}`
        expect(read.innerWidth, where).toBe(viewport.width)
        for (const box of [read.document, read.inset, read.main]) {
          expect(box.clientWidth, where).toBeGreaterThan(0)
          expect(box.scrollWidth, where).toBeLessThanOrEqual(box.clientWidth + 1)
        }
        await captureFullPage(page, `config-${tab}-${labelOf(viewport)}`)
      }
      expect(opened.errors).toEqual([])
      await h.close(opened)
    }
    process.stderr.write(`429-33 NO-SIDEWAYS-SCROLL measured:\n${measured.join('\n')}\n`)
  }, 240_000)

  it('FILE-VIEW-MASKING-SHIPPED', async () => {
    const h = live()
    const opened = await h.page(DESKTOP)
    const { page } = opened
    const leaks: string[] = []
    for (const tab of TABS) {
      await openTab(h, page, tab)
      const html = await page.evaluate(() => document.documentElement.outerHTML)
      for (const [kind, sentinel] of Object.entries(SENTINELS)) if (html.includes(sentinel)) leaks.push(`${tab}: ${kind}`)
    }
    expect(leaks, 'a sentinel reached the page unmasked').toEqual([])

    const view = page.locator('[data-config-file-view]')
    await view.waitFor({ timeout: 10_000 })
    const lines = await view.locator('li[data-line]').evaluateAll((items) => items.map((item) => ({
      text: (item.textContent ?? '').trim(),
      masking: item.getAttribute('data-masking-class'),
    })))
    const lineWith = (fragment: string) => lines.find((line) => line.text.includes(fragment))
    expect(lineWith('tokenEnvVar:'), JSON.stringify(lines)).toEqual({ text: `tokenEnvVar: ${MCP_TOKEN_ENV_VAR}`, masking: 'env-var-name' })
    expect(lineWith('x-org-route:')?.masking).toBe('secret')
    expect(lineWith('x-org-route:')?.text).toContain(CONFIG_MASK_PLACEHOLDER)
    expect(lineWith('accessKey:')?.masking).toBe('secret')
    expect(lineWith('accessKey:')?.text).toContain(CONFIG_MASK_PLACEHOLDER)
    expect(lineWith('plugins:'), 'the plugins block is missing from the file view').toBeDefined()
    expect(lineWith(PLUGIN_PACKAGE), 'the plugin entry is missing from the file view').toBeDefined()
    expect(await view.isVisible()).toBe(true)
    await captureFullPage(page, `config-file-masked-${labelOf(DESKTOP)}`)

    const accessKey = view.locator('li[data-masking-class="secret"]').filter({ hasText: 'accessKey:' })
    await accessKey.getByRole('button', { name: 'Show accessKey', exact: true }).click()
    await accessKey.and(page.locator('[data-reveal-state="revealed"]')).waitFor({ timeout: 10_000 })
    expect(await accessKey.textContent()).toContain(SENTINELS.farm)
    expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(SENTINELS.header)
    expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(SENTINELS.auth)
    await captureViewport(page, `config-file-revealed-${labelOf(DESKTOP)}`)
    expect(opened.errors).toEqual([])
    await h.close(opened)
  }, 120_000)

  it('ARIA-NAMES-SHIPPED', async () => {
    const h = live()
    const found: string[] = []
    for (const viewport of [DESKTOP, NARROW]) {
      const opened = await h.page(viewport)
      const { page } = opened
      for (const tab of TABS) {
        await openTab(h, page, tab)
        const snapshot = await page.locator(INNER_MAIN).ariaSnapshot()
        expect(snapshot.length, `${tab}: an empty ARIA snapshot measures nothing`).toBeGreaterThan(200)
        expect(snapshot, `${tab}: the snapshot holds no tab at all`).toContain('- tab "Models"')
        for (const line of unnamedControls(snapshot)) found.push(`${labelOf(viewport)} ${tab}: ${line.trim()}`)
      }
      expect(opened.errors).toEqual([])
      await h.close(opened)
    }
    expect(found, 'unnamed controls in the Config ARIA snapshot').toEqual([])
  }, 180_000)

  it('NO-DIALOG-SHIPPED', async () => {
    const h = live()
    const opened = await h.page(NARROW)
    const { page } = opened
    await openTab(h, page, 'targets')
    const probe = await page.evaluate(() => (window as unknown as { __dialogsSeen?: unknown }).__dialogsSeen)
    expect(Array.isArray(probe), 'the dialog watch did not install, so this cell would measure nothing').toBe(true)
    await h.close(opened)
    expect(h.dialogs, 'a dialog mounted in Config during this task').toEqual([])
    expect(realAuthFingerprint(), "the operator's own auth.json changed during the run").toBe(realAuthBefore)
  }, 60_000)
})
