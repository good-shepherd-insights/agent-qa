// The fourth door's DOM differential: the BUILT UI, in a REAL browser (Phase 400 plan 09, D-11).
//
// WHY THIS FILE EXISTS AT ALL. Every other cell that touches the dashboard chat render — plan 06's
// 40-odd transcript cells, plan 08's 37 entity-card cells — renders React into jsdom and asserts on
// elements, accessible text and data attributes. That is the right instrument for a contract, and
// it is the wrong one for a VISUAL claim: jsdom computes no styles, runs no bundler output, and
// resolves no `import` the way a browser's module graph does. 399.1 paid for that distinction
// explicitly ("a payload assertion cannot carry a visual claim"), and this file is that precedent
// translated to this surface's medium. What runs below is the `vite build` bundle, served by the
// shipped `agent-qa dashboard` command, driven by a real Chromium.
//
// A BROWSER THAT CANNOT LAUNCH IS A RED, NEVER A SKIP. There is no `skipIf` in this file, no
// environment predicate and no try/catch around the launch. If Chromium is missing, `beforeAll`
// throws and every cell in the file fails loudly with the install instruction. The alternative —
// an env-gated skip — turns the phase's entire visual-claim suite into a no-op that exits 0, which
// is the exact shape of vacuous green this project has been bitten by before (a path constant that
// landed on an existing directory, so a control's env predicate skipped itself).
//
// THE FRESHNESS GUARD COVERS THE UI BUNDLE TOO, and that is the whole reason `DASHBOARD_ANCHORED_BUILDS`
// exists. A DOM cell run against a `dashboard-ui/dist` built before today's `.tsx` edit passes and
// reads as proof of the edit. Plan 400-06 lost a mutation to precisely this: a restored mutation was
// not rebuilt and a stale `dist` reported a phantom red.
//
// MODEL-FREE AND CREDENTIAL-FREE, inherited from the spawned instrument. The child is handed a
// constructed environment and an `mkdtemp` project with no token entry, no key and no LLM block, so
// every drive below takes the deterministic resolver route and no provider can be spent against.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { chromium } from 'playwright-core'
import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  ANCHORED_BUILDS,
  CLI_PACKAGE_ROOT,
  DASHBOARD_ANCHORED_BUILDS,
  PACKAGES_ROOT,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  dashboardFixtureProject,
  reserveEphemeralPort,
  spawnDashboard,
  trackTempRoot,
} from './spawned-chat.js'
import type { SpawnedDashboard } from './spawned-chat.js'

/**
 * What a caller is told when Chromium cannot be launched.
 *
 * The pinned `playwright-core` brings its own browser revision, so the fix is that package's own
 * installer rather than a global one — named here because a failure message that says only "browser
 * not found" costs the reader the search.
 */
const BROWSER_INSTALL_INSTRUCTION =
  'Chromium could not be launched by the pinned playwright-core. Run '
  + '`node node_modules/playwright-core/cli.js install chromium` from packages/cli (or the '
  + 'workspace-resolved equivalent) and re-run. THESE CELLS MUST NOT BE SKIPPED WHEN THE BROWSER '
  + 'IS ABSENT: they are the only cells in this repository that measure the fourth door in the '
  + 'medium a person actually sees, and a skip would report a green suite that measured nothing.'

/** The one dashboard every cell in this file drives, and the browser that drives it. */
interface DomFixture {
  readonly dashboard: SpawnedDashboard
  readonly browser: Browser
  readonly origin: string
  readonly root: string
  readonly knowledgeRoot: string
}

let fixture: DomFixture | undefined

/**
 * Stand the whole instrument up once: freshness, dashboard, browser.
 *
 * ONE DASHBOARD AND ONE BROWSER FOR THE FILE, because both cost seconds and the cells below are
 * independent of each other's state — each opens its own page and its own chat session. That is
 * the 397 wall-clock posture applied to a browser: anchors are expensive, so there are few of them
 * and they share their fixture.
 */
beforeAll(async () => {
  // FIRST, AND BEFORE ANYTHING IS SPAWNED. A stale build is worse than an absent one.
  const freshness = buildFreshness(DASHBOARD_ANCHORED_BUILDS)
  expect(freshness, REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })

  const project = dashboardFixtureProject('dom')
  const port = await reserveEphemeralPort()
  const dashboard = await spawnDashboard(project.root, project.configPath, port)
  expect(
    dashboard.ready,
    'the built `agent-qa dashboard` command never reported that it was listening. its stdout: '
    + `${JSON.stringify(dashboard.stdout().slice(-1200))}; its stderr: `
    + `${JSON.stringify(dashboard.stderr().slice(-1200))}`,
  ).toBe(true)

  let browser: Browser
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    await dashboard.stop()
    throw new Error(
      `${BROWSER_INSTALL_INSTRUCTION} underlying error: `
      + `${error instanceof Error ? error.message : String(error)}`,
    )
  }

  fixture = {
    dashboard,
    browser,
    origin: dashboard.origin,
    root: project.root,
    knowledgeRoot: project.knowledgeRoot,
  }
}, 180_000)

afterAll(async () => {
  const held = fixture
  fixture = undefined
  if (held !== undefined) {
    await held.browser.close()
    await held.dashboard.stop()
  }
  cleanupTempRoots()
})

/** The fixture, or a failure that names what did not stand up rather than a `undefined` read. */
function live(): DomFixture {
  expect(fixture, 'the DOM fixture did not stand up; see the beforeAll failure above').toBeDefined()
  if (fixture === undefined) throw new Error('unreachable: the assertion above has already failed')
  return fixture
}

/**
 * Open one page on the served `/chat` route and wait for the transcript to be interactive.
 *
 * WAITING ON THE INPUT rather than on `load`: the app is a client-routed SPA, so the document
 * finishes loading long before React has mounted the route, and a cell that asserted at `load`
 * would be asserting about an empty shell.
 */
async function openChat(): Promise<Page> {
  const { browser, origin } = live()
  const page = await browser.newPage()
  const failures: string[] = []
  page.on('pageerror', (error) => { failures.push(String(error)) })
  await page.goto(`${origin}/chat`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-chat-input]', { timeout: 30_000 })
  expect(
    failures,
    'the built bundle threw while mounting the chat route, so everything below would be measuring '
    + 'a half-rendered page',
  ).toEqual([])
  return page
}

/**
 * Type one utterance into the transcript's own input and send it the way a person does.
 *
 * THROUGH THE FORM, NEVER THROUGH `fetch` FROM THE PAGE. The claim these cells carry is about what
 * a person sees after doing what a person does; a cell that POSTed from the console would be
 * driving the door and then asserting about a render nothing had driven.
 */
async function sendTurn(page: Page, utterance: string): Promise<void> {
  const before = await page.locator('[data-receipt-status]').count()
  await page.fill('[data-chat-input]', utterance)
  await page.click('[data-chat-send]')
  await page
    .locator('[data-receipt-status]')
    .nth(before)
    .waitFor({ state: 'attached', timeout: 60_000 })
}

describe('the dashboard chat UI, in a real browser against the built bundle (400-09)', () => {
  it('smoke: the built /chat route mounts the shared transcript and its input', async () => {
    // THE HARNESS'S OWN TRACER. Everything below depends on four separate things being true at
    // once — the build is fresh, the shipped command bound a port, the server served the bundle,
    // and the bundle mounted in a real browser. If this cell is red, no other cell in the file is
    // reporting about the product.
    const page = await openChat()
    try {
      expect(
        await page.locator('[data-chat-page]').count(),
        'the served /chat route did not render the page frame',
      ).toBe(1)
      expect(
        await page.locator('[data-chat-transcript]').count(),
        'the page frame rendered without the shared transcript component',
      ).toBe(1)
      expect(
        await page.locator('[data-chat-input]').isVisible(),
        'the transcript rendered no visible input, so nothing below could type into it',
      ).toBe(true)
      // The bundle, not a placeholder: the served document has to be the built artifact the
      // freshness guard just vouched for.
      const bundle = `${PACKAGES_ROOT}/dashboard-ui/dist/index.html`
      expect(
        existsSync(bundle),
        `the served bundle is missing at ${relative(PACKAGES_ROOT, bundle)}; ${REBUILD_INSTRUCTION}`,
      ).toBe(true)
    } finally {
      await page.close()
    }
  }, 120_000)
})

describe('the instrument this file runs on, asserted rather than assumed (400-09 task 1)', () => {
  it('drives the AUDITED playwright-core pin and never a version resolved at install time', () => {
    // THE SUPPLY-CHAIN CLAIM (T-400-SC), read off the manifest. The package-legitimacy audit
    // approved `playwright-core@1.59.1` — the version already in this workspace's lockfile, from
    // the canonical `microsoft/playwright` repository, with no postinstall — and `@playwright/test`
    // was explicitly rejected as a net-new root package. A range here (`^1.59.1`) would make the
    // audited artifact and the installed one two different things after the next resolution, so
    // the assertion is on the EXACT pin.
    //
    // THE SECTION IS DELIBERATELY NOT PART OF THE CLAIM. `playwright-core` was already a first-class
    // `dependencies` entry of this package before this plan — `auth-state.ts` and
    // `install-browsers.ts` both reach for it at runtime — so the plan's "add it as a devDependency"
    // was already satisfied by a stronger declaration, and adding a second entry would be two
    // answers to one version question. See the SUMMARY's deviations.
    const manifest = JSON.parse(
      readFileSync(join(CLI_PACKAGE_ROOT, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const declared = {
      ...(manifest.devDependencies ?? {}),
      ...(manifest.dependencies ?? {}),
    }['playwright-core']
    expect(
      declared,
      'this package no longer declares playwright-core, so the browser these cells launch is '
      + 'whatever a hoist happened to leave in node_modules — an unaudited artifact',
    ).toBe('1.59.1')

    // And the runtime the cells actually launched is that package's own browser, not a system one.
    expect(
      typeof chromium.executablePath(),
      'playwright-core resolved no browser executable path at all',
    ).toBe('string')
  })

  it('guards the freshness of the dashboard SERVER and UI dists, not only the chat five', () => {
    // THE STALE-DIST TRAP, named. Every cell in this file reads the `dashboard-ui` bundle through
    // the `dashboard-server` process, and neither package is in the chat anchors' build list. A
    // guard that watched only those five would be green while the bundle a browser was handed was
    // a revision behind — which is exactly how plan 400-06 lost a mutation to a phantom red.
    const guarded = DASHBOARD_ANCHORED_BUILDS.map((build) => `${build.pkg}/${build.artifact}`)
    expect(guarded).toContain(join('dashboard-server', 'dist', 'index.js'))
    expect(guarded).toContain(join('dashboard-ui', 'dist', 'index.html'))
    // The chat five are still in it: this list EXTENDS the shared one rather than replacing it, so
    // a `cli` dist a revision behind still refuses here too.
    for (const build of ANCHORED_BUILDS) {
      expect(guarded).toContain(`${build.pkg}/${build.artifact}`)
    }
  })

  it('REFUSES a missing dashboard dist and a stale one, by name (the guard, driven)', () => {
    // The guard's refusing branches, reached with a synthetic package tree rather than by deleting
    // a real `dist`. `parity-anchors.test.ts` drives the same two branches for the chat list; this
    // drives them for the two entries this plan added, so the extension is measured rather than
    // asserted about.
    const root = trackTempRoot(mkdtempSync(join(tmpdir(), 'agent-qa-400-09-guard-')))
    const builds = [{ pkg: 'dashboard-ui', artifact: join('dist', 'index.html') }]
    mkdirSync(join(root, 'dashboard-ui', 'src'), { recursive: true })
    writeFileSync(join(root, 'dashboard-ui', 'src', 'app.css'), 'body{}', 'utf8')

    expect(
      buildFreshness(builds, root).missing,
      'the guard did not notice an absent bundle',
    ).toEqual([join('dashboard-ui', 'dist', 'index.html')])

    mkdirSync(join(root, 'dashboard-ui', 'dist'), { recursive: true })
    const bundle = join(root, 'dashboard-ui', 'dist', 'index.html')
    writeFileSync(bundle, '<!doctype html>', 'utf8')
    const past = new Date(Date.now() - 60_000)
    utimesSync(bundle, past, past)
    expect(
      buildFreshness(builds, root).stale,
      'the guard did not notice a bundle older than the source it was built from — and a `.css` '
      + 'edit is exactly the kind a computed-style cell depends on',
    ).toEqual([
      `${join('dashboard-ui', 'src', 'app.css')} is newer than `
      + `${join('dashboard-ui', 'dist', 'index.html')}`,
    ])

    // And the passing arm, so the guard is watched agreeing as well as refusing. The stamp is a
    // MINUTE ahead rather than `new Date()`: the source above was written in the same millisecond
    // band, and a guard comparing `newer > artifact` at that resolution reports a stale bundle for
    // a build that really did follow its source — a flake in the control rather than in the guard.
    const built = new Date(Date.now() + 60_000)
    utimesSync(bundle, built, built)
    expect(buildFreshness(builds, root)).toEqual({ missing: [], stale: [] })
  })
})
