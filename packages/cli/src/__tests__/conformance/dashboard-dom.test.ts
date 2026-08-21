/// <reference lib="dom" />
// The DOM lib is referenced HERE and nowhere else in this package, because this is the one file
// whose `page.evaluate` callbacks are compiled as TypeScript and EXECUTED in a browser. Without it
// `getComputedStyle` and `HTMLAnchorElement` are unresolved names under `tsc --noEmit` while
// running perfectly under vitest — the TS6059-shaped trap plan 400-08 hit from the other side: a
// green that only one of the two compilers ever saw.

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

import { publishBundleForTest } from '@vostride/agent-qa-knowledge-local'
import { ENTITY_IDENTITY_FACT_LABELS } from '@vostride/agent-qa-schema'
import type { BundleStoreConfig, PublishBundleInput } from '@vostride/agent-qa-knowledge-local'
import { chromium } from 'playwright-core'
import type { Browser, Page, Route } from 'playwright-core'
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
import {
  BENIGN_IMAGE_ALT,
  BENIGN_IMAGE_DESTINATION,
  BENIGN_LINK_DESTINATION,
  HOSTILE_IMAGE_ALT,
  HOSTILE_LINK_TEXT,
  REFUSED_IMAGE_DESTINATIONS,
  REFUSED_LINK_DESTINATIONS,
  RELATIVE_LOOKALIKE_DESTINATION,
  XSS_WITNESS,
  hostileMarkdownDocument,
} from './hostile-markdown-fixture.js'

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
  // ONE REAL ENTITY, PUBLISHED THROUGH THE SHIPPED WRITER, before anything is spawned. Without it
  // `entities.get` has nothing to find and the card cell below would be asserting about a refusal.
  // A memory bundle is the entity this build can actually mint an address for: the composition
  // wires exactly one sighting source (`createMemorySightingSource`), so MEM is the only kind a
  // real drive can produce here — which is itself half of what the card cells report.
  seedMemoryBundle(project)
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

/**
 * Publish ONE real knowledge bundle into a fixture's knowledge root.
 *
 * THROUGH THE SHIPPED WRITER (`publishBundleForTest`), never by writing files. A hand-written
 * manifest is a second producer of the bundle format, free to describe a bundle this build cannot
 * load — and a card cell driven off one would be reporting about the fixture's idea of a bundle.
 */
function seedMemoryBundle(project: { root: string; knowledgeRoot: string }): void {
  const config: BundleStoreConfig = {
    knowledgeRoot: project.knowledgeRoot,
    productKey: MEMORY_PRODUCT,
    auditBaseDir: join(project.root, '.agent-qa'),
    commitArtifacts: 'none',
  }
  const input: PublishBundleInput = {
    draft: {
      kind: 'fact',
      subtype: 'selector',
      anchors: [{ t: 'el', role: 'button', name: MEMORY_ANCHOR_NAME }],
      scope: { tier: 'product', key: MEMORY_PRODUCT },
      summary: MEMORY_SUMMARY,
      body: 'The verified checkout control.',
      distilledEvidenceRef: { id: 'dom-cell-evidence', sha: 'a'.repeat(64) },
      originStage: 'run-curation',
    },
    discriminant: {
      kind: 'fact',
      subtype: 'selector',
      elementRef: { role: 'button', name: MEMORY_ANCHOR_NAME },
    },
    originClass: 'agent-verified',
    createdAtOrdinal: 5,
    screenStates: [],
    initialEvents: [],
    relations: [],
    provenance: {
      mode: 'run-linked',
      runId: 'dom-cell-run',
      testId: 'dom-cell-test',
      stepIndex: 0,
      sourceBuildOrdinal: 5,
    },
    artifacts: [],
  }
  const published = publishBundleForTest(config, input)
  expect(
    published.kind,
    'the DOM fixture could not publish its one knowledge bundle, so no real entity card can be '
    + 'driven below',
  ).toBe('published')
}

const MEMORY_PRODUCT = 'dom-cell-product'
const MEMORY_ANCHOR_NAME = 'Checkout'
const MEMORY_SUMMARY = 'Checkout summary'

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
async function openApp(path: string, ready: string): Promise<Page> {
  const { browser, origin } = live()
  const page = await browser.newPage()
  const failures: string[] = []
  page.on('pageerror', (error) => { failures.push(String(error)) })
  await page.goto(`${origin}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(ready, { timeout: 30_000 })
  expect(
    failures,
    `the built bundle threw while mounting ${path}, so everything below would be measuring a `
    + 'half-rendered page',
  ).toEqual([])
  return page
}

async function openChat(): Promise<Page> {
  return await openApp('/chat', '[data-chat-input]')
}

/**
 * Type one utterance into the transcript's own input and send it the way a person does.
 *
 * THROUGH THE FORM, NEVER THROUGH `fetch` FROM THE PAGE. The claim these cells carry is about what
 * a person sees after doing what a person does; a cell that POSTed from the console would be
 * driving the door and then asserting about a render nothing had driven.
 */
async function sendUtterance(page: Page, utterance: string): Promise<void> {
  await page.fill('[data-chat-input]', utterance)
  await page.click('[data-chat-send]')
}

/** Send, and wait for the transcript to gain one more RECEIPT row than it had. */
async function sendTurn(page: Page, utterance: string): Promise<void> {
  const before = await page.locator('[data-receipt-status]').count()
  await sendUtterance(page, utterance)
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

// ---- The differential cells (400-09 task 3, D-11) ----------------------------------------------
//
// FOUR VISUAL CLAIMS, EACH IN THE MEDIUM A PERSON SEES THEM IN. Two of them are driven end to end
// through the door — a person types, the turn runs, the render happens. Two of them cannot be,
// and where that is so this file says which boundary the content was injected at and why no wire
// channel reaches it in this build. An injected cell that pretended to be a drive would be worse
// than either.

/**
 * The two utterances that produce the two statuses this door actually emits.
 *
 * `refused` COMES FROM THE GUARDRAIL, NOT FROM THE GATE, and getting that right is the whole cell.
 * A gate denial (`/pin` then the pinned op) files `failed` / `FunctionDeniedError` — measured on the
 * wire in `dashboard-anchors.test.ts` — so keying the "refused" arm on a pin would have keyed it on
 * a value nothing produces. What DOES produce `refused` is `config.field.set` blocked by the secret
 * scan: `classifyConfigProposeOutput` folds the `blocked` arm to `refused` because the CONTROL
 * WORKED and nothing happened. The planted value is 399.1's own synthetic key — enough shape for
 * the `apiKey` detector and a value nowhere in existence.
 */
const REFUSED_UTTERANCE = `/fn config.field.set ${JSON.stringify({
  path: 'use.buildTag',
  value: 'sk-PROBE-0000000000000000000000000000',
})}`

/** An op registered nowhere: the turn's own record is what says so, on a 200. */
const FAILED_UTTERANCE = '/fn control.absent.400.09 {}'

/** One rendered receipt row, as a person and a screen reader read it. */
interface RenderedReceipt {
  readonly status: string
  readonly accessibleText: string
  readonly color: string
  readonly backgroundColor: string
  readonly borderColor: string
}

/**
 * Read one receipt row's PRESENTATION out of the live page.
 *
 * COMPUTED, NOT DECLARED. `getComputedStyle` is what the browser resolved after the bundle's CSS
 * ran, so a build whose two statuses reached the same painted colour is red here even though the
 * two class names differ in the source. That is the difference this file exists for: a class-name
 * assertion is a contract assertion in a browser costume.
 */
async function readReceipt(page: Page, status: string): Promise<RenderedReceipt> {
  const row = page.locator(`[data-receipt-status="${status}"]`).first()
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  return await row.evaluate((element) => {
    const badge = element.querySelector('span')
    const style = getComputedStyle(badge ?? element)
    return {
      status: element.getAttribute('data-receipt-status') ?? '',
      accessibleText: (badge?.textContent ?? '').trim(),
      color: style.color,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
    }
  })
}

describe('refused is visibly a different thing from failed (400-09, D-11 / DASH-01)', () => {
  it('renders the two statuses with different words AND different computed presentation',
    async () => {
      const page = await openChat()
      try {
        // BOTH DRIVEN, IN ONE CONVERSATION. Nothing is injected here: a person types two lines and
        // the door answers each with the status its own classifier folded.
        await sendTurn(page, REFUSED_UTTERANCE)
        await sendTurn(page, FAILED_UTTERANCE)

        const refused = await readReceipt(page, 'refused')
        const failed = await readReceipt(page, 'failed')

        // NON-VACUITY: both rows are really there, and they are really the two statuses.
        expect(refused.status, 'the guardrail drive did not produce a `refused` row').toBe('refused')
        expect(failed.status, 'the unknown-op drive did not produce a `failed` row').toBe('failed')

        // THE WORDS. Colour alone is not a distinction for a person who cannot see the difference
        // between the reds and the ambers, so each status carries its own text and this is the
        // assertion that says so.
        expect(refused.accessibleText, 'the refused row rendered no words at all').not.toBe('')
        expect(failed.accessibleText, 'the failed row rendered no words at all').not.toBe('')
        expect(
          refused.accessibleText,
          'a guardrail refusal and a failure read the SAME WORDS in the browser — a person cannot '
          + 'tell a control that worked from something that broke',
        ).not.toBe(failed.accessibleText)
        // And the refusal says what happened rather than only that it did not run.
        expect(refused.accessibleText.toLowerCase()).toContain('refused')

        // THE PRESENTATION, computed by the browser rather than read off a class list. At least one
        // painted channel must differ; asserting all three would pin a palette this cell must not
        // own, and asserting none would let two statuses paint identically.
        const channels = (['color', 'backgroundColor', 'borderColor'] as const)
          .filter((channel) => refused[channel] !== failed[channel])
        expect(
          channels,
          'the two statuses resolved to the SAME computed colour, background AND border in the '
          + `built bundle: refused=${JSON.stringify(refused)} failed=${JSON.stringify(failed)}`,
        ).not.toEqual([])
      } finally {
        await page.close()
      }
    }, 180_000)
})

// ---- The entity card, in the browser (DASH-03's visual half) -----------------------------------

/**
 * A turn body this file fulfils a request with, in place of the door's own answer.
 *
 * WHERE THE INJECTION HAPPENS AND WHY IT IS HONEST. The boundary is the door's HTTP RESPONSE — the
 * exact channel the render treats as untrusted, and the exact channel a real defect would arrive
 * on. Everything downstream of it is real: the built bundle, the reducer, the schema-driven card
 * detection, the markdown guards, the browser's own URL parser and its own painting.
 *
 * WHY IT IS USED AT ALL, STATED PLAINLY RATHER THAN BURIED. Two of this plan's four visual claims
 * name content THIS BUILD CANNOT PRODUCE OVER THE WIRE:
 *
 *   1. A ROUTED card. `compose-local-agent.ts` wires exactly one sighting source, so the entity
 *      directory can only mint MEM addresses — and MEM is unrouted by contract. No `entities.get`
 *      this build can answer returns a TST/RUN/TGT card (filed as WINDOWS #196).
 *   2. HOSTILE MARKDOWN. `ChatMarkdown` renders the turn's `answer` and `chat_present` text, and in
 *      a model-free composition the only producers of either are the shipped directive lines and
 *      the confirm cost preview. Attacker-authored prose reaches that render only from a model,
 *      which a hermetic, credential-free cell must not bind.
 *
 * The alternative to injecting was to assert those two claims in jsdom, which is precisely the
 * substitution 399.1 ruled out. So they are driven in the real browser at the boundary the guard
 * defends, and the cells say so in their own names.
 */
interface InjectedConversation {
  /** The turn's `answer` — the POST's own channel, and the ONE input `ChatMarkdown` renders. */
  readonly answer?: string
  /** `clause_receipt` events, which is where a RECEIPT ROW comes from. */
  readonly receipts?: readonly {
    clause: string
    functionId: string
    origin: string
    status: string
    outcome: string
  }[]
  /** `clause_result` events, which is where a PAYLOAD BLOCK — and any entity card — comes from. */
  readonly results?: readonly { functionId: string; payload: unknown }[]
}

const INJECTED_SESSION = 'chat-400-09-injected'
const INJECTED_TURN = 'turn-400-09-injected'

/**
 * Serve this page's conversation from crafted, contract-shaped bytes.
 *
 * BOTH CHANNELS, BECAUSE THE PRODUCT USES BOTH. The POST answers with the typed result and the
 * SSE stream carries the session's own events — and the transcript's reducer takes receipts and
 * results ONLY from the stream (a `clause_result` is a durable session fact; the POST's copy is
 * not what the render reads). An injection that fulfilled only the POST would put nothing on the
 * screen, which is how the first draft of these cells failed.
 *
 * THE STREAM IS SERVED ONCE AND THEN REFUSED. `EventSource` reconnects when a body ends, and a
 * second delivery of the same frames would double every entry — so later connections are aborted,
 * which the client treats as a transport error and retries, exactly as it would against a server
 * that went away.
 */
async function injectConversation(
  page: Page,
  injected: InjectedConversation,
): Promise<void> {
  await page.route('**/api/chat/turn', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: {
          sessionId: INJECTED_SESSION,
          turnId: INJECTED_TURN,
          status: 'completed',
          ...(injected.answer === undefined ? {} : { answer: injected.answer }),
          receipts: injected.receipts ?? [],
          results: injected.results ?? [],
          denials: [],
        },
        folds: [],
      }),
    })
  })

  const at = '2026-08-21T00:00:00.000Z'
  const events: unknown[] = [
    ...(injected.results ?? []).map((result) => ({
      kind: 'clause_result',
      turnId: INJECTED_TURN,
      at,
      functionId: result.functionId,
      payload: result.payload,
    })),
    ...(injected.receipts ?? []).map((receipt) => ({
      kind: 'clause_receipt',
      turnId: INJECTED_TURN,
      at,
      ...receipt,
    })),
    { kind: 'turn_complete', turnId: INJECTED_TURN, at, status: 'completed' },
  ]
  const body = events
    .map((event, index) =>
      `id: ${String(index + 1)}\nevent: ${String((event as { kind: string }).kind)}\n`
      + `data: ${JSON.stringify(event)}\n\n`)
    .join('')

  let served = false
  await page.route('**/api/chat/sessions/**', async (route: Route) => {
    if (served) {
      await route.abort()
      return
    }
    served = true
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body,
    })
  })
}

/** The machine id a routed TST card publishes, and the route it must therefore link to. */
const ROUTED_MACHINE_ID = 'tst-machine-400-09'

/**
 * A TST card, spelled the way the producer spells one.
 *
 * The three address fields agree (the card schema's `superRefine` refuses them when they do not),
 * and the machine id rides on the key fact `ENTITY_IDENTITY_FACT_LABELS` names — which is the
 * contract by which the render reads it. A card assembled with the id anywhere else would render
 * unrouted and this cell would pass for the wrong reason.
 */
function routedTestCard(): unknown {
  return {
    kind: 'TST',
    status: 'active',
    id: 'TST-001',
    uri: 'agentqa://test/TST-001',
    title: 'Checkout flow',
    keyFacts: [{ label: ENTITY_IDENTITY_FACT_LABELS.TST, value: ROUTED_MACHINE_ID }],
    actions: [],
  }
}

describe('the entity card, rendered in the browser (400-09, DASH-03)', () => {
  it('DRIVEN: a real entities.get card renders, and its unrouted kind offers nothing to click',
    async () => {
      const page = await openChat()
      try {
        // A REAL DRIVE, END TO END. The list verb is what SIGHTS the published bundle and mints its
        // address (the D-01 list-verb sighting site), so the two turns together are the shipped
        // path by which a person reaches a card at all.
        await sendTurn(page, '/fn knowledge.bundles.list {}')
        await sendTurn(page, '/fn entities.get {"ref":"MEM-001"}')

        const card = page.locator('[data-entity-card]').first()
        await card.waitFor({ state: 'visible', timeout: 30_000 })

        // THE CARD IS A CARD: its own address, its state, and the fact the producer projected.
        expect(await card.getAttribute('data-entity-kind')).toBe('MEM')
        expect((await card.locator('[data-entity-id]').textContent())?.trim()).toBe('MEM-001')
        expect((await card.locator('[data-entity-uri]').textContent())?.trim())
          .toBe('agentqa://memory/MEM-001')
        expect((await card.locator('[data-entity-status]').textContent())?.trim()).toBe('active')
        expect(await card.textContent()).toContain(MEMORY_SUMMARY)
        expect(
          await card.locator('[data-key-fact]').count(),
          'the card rendered none of the key facts the producer computed',
        ).toBeGreaterThan(0)

        // AND NOT A LINK ANYWHERE IN IT. MEM has no page in this build, so the honest render offers
        // no anchor at all — not a disabled one, not a `#`, not a span dressed as one. The count is
        // over EVERY anchor inside the card, so a link added anywhere in it reds this.
        expect(
          await card.locator('a').count(),
          'an unrouted card rendered something to click; this build serves no MEM page, so every '
          + 'one of those clicks is a 404 minted with confidence',
        ).toBe(0)
        expect(await card.locator('[data-entity-card-link]').count()).toBe(0)

        // The card is a FOLD, never a replacement: the complete payload is still below it.
        expect(
          await page.locator('[data-payload-block]').count(),
          'the card replaced the payload instead of riding above it (399.1 D-04 / D-14)',
        ).toBeGreaterThan(0)
      } finally {
        await page.close()
      }
    }, 180_000)

  it('INJECTED at the door\'s response: a routed card links to the route this app registers',
    async () => {
      // See `InjectedTurn` for why this arm cannot be driven: no source in this composition mints a
      // TST address, so no turn this build can answer returns a routed card.
      const page = await openChat()
      try {
        await injectConversation(page, {
          receipts: [{
            clause: '/fn entities.get {"ref":"TST-001"}',
            functionId: 'entities.get',
            origin: 'human',
            status: 'executed',
            outcome: 'found TST TST-001',
          }],
          results: [{ functionId: 'entities.get', payload: routedTestCard() }],
        })
        await sendTurn(page, '/fn entities.get {"ref":"TST-001"}')

        const card = page.locator('[data-entity-card]').first()
        await card.waitFor({ state: 'visible', timeout: 30_000 })
        expect(await card.getAttribute('data-entity-kind')).toBe('TST')

        const link = card.locator('[data-entity-card-link]')
        expect(
          await link.count(),
          'a routed card rendered no link at all, so DASH-03\'s clickable half is not shipped',
        ).toBe(1)
        // THE HREF IS THE MAPPED ROUTE FILLED WITH THE MACHINE ID, and both halves matter: the
        // template is the one `app.tsx` registers, and the parameter is the grain that page is
        // keyed by. A short-ID in that slot would be a 404 minted with confidence.
        const href = await link.getAttribute('href')
        expect(href, 'the card link does not address the route this dashboard serves for a test')
          .toBe(`/test/${ROUTED_MACHINE_ID}`)
        expect(href, 'the href was minted from the card\'s published short-ID, not its machine id')
          .not.toContain('TST-001')

        // AND IT NAVIGATES. A link a person can see and cannot follow is not the claim.
        await link.click()
        await page.waitForURL(`**/test/${ROUTED_MACHINE_ID}`, { timeout: 30_000 })
        expect(new URL(page.url()).pathname).toBe(`/test/${ROUTED_MACHINE_ID}`)
      } finally {
        await page.close()
      }
    }, 180_000)
})

// ---- One component, two placements (D-13) ------------------------------------------------------

/** The module identity the shared transcript renders, read off whichever mount is on screen. */
async function transcriptModuleIds(page: Page): Promise<readonly string[]> {
  return await page.locator('[data-chat-transcript]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-chat-transcript-module') ?? ''),
  )
}

describe('the panel and the page are two mounts of ONE module (400-09, D-13)', () => {
  it('renders the SAME module identity in the global panel and on the /chat page', async () => {
    // WHAT MAKES THIS MORE THAN AN ATTRIBUTE CHECK. `data-chat-transcript` would be carried by any
    // second renderer that copied the markup; `data-chat-transcript-module` carries a value the
    // transcript MODULE minted for itself when it was evaluated. Two mounts of one instance report
    // the same value. A second copy of the component — or a bundle that duplicated the module into
    // two chunks — reports two.
    //
    // MEASURED ACROSS ONE PAGE LOAD, NOT ONE SCREEN. Both mounts co-present would need the panel
    // open on `/chat`, and the panel's launcher is deliberately hidden there (a launcher for a
    // smaller view of the conversation already filling the screen). A reload would re-evaluate the
    // module and mint a new id, so the navigation below is the app's OWN client-side routing —
    // asserted, not assumed, by the id of the page mount being read after it.
    const page = await openApp('/runs', '[data-chat-panel-open]')
    try {
      await page.click('[data-chat-panel-open]')
      await page.waitForSelector('[data-chat-panel]', { timeout: 30_000 })

      const inPanel = await transcriptModuleIds(page)
      expect(
        inPanel,
        'the opened panel rendered no transcript, or more than one',
      ).toHaveLength(1)
      expect(inPanel[0], 'the transcript rendered no module identity at all').not.toBe('')

      // Close it, then navigate the way a person does — the sidebar link, client-side, no reload.
      await page.keyboard.press('Escape')
      await page.waitForSelector('[data-chat-panel]', { state: 'detached', timeout: 30_000 })
      await page.click('a[href="/chat"]')
      await page.waitForSelector('[data-chat-page]', { timeout: 30_000 })

      const onPage = await transcriptModuleIds(page)
      expect(onPage, 'the /chat page rendered no transcript, or more than one').toHaveLength(1)
      expect(
        onPage[0],
        'the panel and the page render TWO DIFFERENT transcript modules — DASH-01\'s forbidden '
        + 'second entry, arrived at as a duplicated module rather than as a second file',
      ).toBe(inPanel[0])

      // The reload control: it is the SAME id only because nothing reloaded. A fresh document
      // evaluates the module again and mints a different one — which is what makes the equality
      // above a statement about module identity rather than about a constant.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-chat-input]', { timeout: 30_000 })
      const afterReload = await transcriptModuleIds(page)
      expect(
        afterReload[0],
        'the module identity survived a full reload, so it is a constant somebody could copy into '
        + 'a second renderer rather than a per-instance mint',
      ).not.toBe(inPanel[0])
    } finally {
      await page.close()
    }
  }, 180_000)

  it('offers no panel launcher on /chat, where the same conversation already fills the screen',
    async () => {
      // The browser found this: the first draft's launcher sat on the transcript's Send button and
      // intercepted every click. The cell is here so the repair cannot be undone silently.
      const page = await openChat()
      try {
        expect(await page.locator('[data-chat-panel-open]').count()).toBe(0)
      } finally {
        await page.close()
      }
    }, 120_000)
})

// ---- Hostile markdown, rendered inert (T-400-19 / T-400-20, Pitfall 8 / A1) ---------------------

describe('untrusted transcript prose renders inert in a real browser (400-09)', () => {
  it('INJECTED at the door\'s response: escapes raw HTML and neutralises every script protocol',
    async () => {
      // See `InjectedConversation` for why this arm cannot be driven: `ChatMarkdown` renders the
      // turn's `answer`, and in a model-free composition the only producers of one are the shipped
      // directive lines. Attacker-authored prose reaches this render from a MODEL, which a
      // hermetic, credential-free cell must not bind. The injection point is the door's own
      // response — the exact boundary the two guards defend — and everything downstream of it is
      // the real bundle in a real browser.
      const page = await openChat()
      const dialogs: string[] = []
      page.on('dialog', (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss() })
      try {
        await injectConversation(page, {
          answer: hostileMarkdownDocument(),
          receipts: [{
            clause: '/fn agent.ask {}',
            functionId: 'agent.ask',
            origin: 'human',
            status: 'executed',
            outcome: 'answered',
          }],
        })
        await sendTurn(page, 'anything at all')

        const answer = page.locator('[data-entry="answer"]').first()
        await answer.waitFor({ state: 'visible', timeout: 30_000 })

        // NON-VACUITY: the renderer really rendered. If the fixture had failed to reach the render
        // at all, every prohibition below would be satisfied by an empty node.
        expect(
          await answer.locator('h1').count(),
          'the markdown never rendered, so the guards below are being asserted about nothing',
        ).toBe(1)
        expect(await answer.textContent())
          .toContain('Some ordinary prose, so the renderer is genuinely rendering.')

        // GUARD ONE: a raw HTML BLOCK is TEXT. No element was created from it, and the source is
        // readable as the characters it was written with.
        // The selector NAMES what the raw block would have produced (`<img src="x" onerror=…>` and
        // a `<script>`) rather than "any img", because the fixture now also carries a BENIGN
        // markdown image that is supposed to render. A blanket `img` count here would have gone
        // red on the control and told a reader the escape had broken.
        expect(
          await answer.locator('script, img[src="x"], img[onerror]').count(),
          'the raw HTML block was INJECTED rather than escaped — an element the transcript\'s '
          + 'author never wrote now exists inside the dashboard\'s own origin',
        ).toBe(0)
        expect(
          await answer.textContent(),
          'the raw HTML did not survive as readable text either, so something dropped it silently',
        ).toContain('onerror')

        // GUARD TWO, PART ONE: every destination whose PARSED protocol is outside the allow-list
        // lost its href and kept its words. Nothing a person was reading disappeared.
        expect(
          await answer.locator('[data-blocked-href]').count(),
          'the refused-destination count does not match the fixture, so either a hostile link '
          + 'survived or the guard deleted a link instead of keeping its text',
        ).toBe(REFUSED_LINK_DESTINATIONS.length)
        expect(
          await answer.locator(`[data-blocked-href]:text-is("${HOSTILE_LINK_TEXT}")`).count(),
        ).toBe(REFUSED_LINK_DESTINATIONS.length)

        // GUARD TWO, PART TWO — THE INVARIANT, and the one assertion here that is not a list. Every
        // href that SURVIVED is resolved by the browser's own parser, in the page, and must come
        // back http(s). This is what the allow-list actually buys, it holds for spellings nobody
        // has invented, and unlike a name check it cannot be defeated by a new one.
        const resolved = await answer.locator('a').evaluateAll(
          (nodes) => nodes.map((node) => {
            const raw = node.getAttribute('href') ?? ''
            let protocol = 'unparseable:'
            try {
              protocol = new URL(raw, globalThis.location.href).protocol
            } catch { /* left as unparseable */ }
            return { raw, protocol, resolved: (node as HTMLAnchorElement).href }
          }),
        )
        for (const link of resolved) {
          expect(
            link.protocol,
            `a surviving link resolves to a protocol this surface must never follow: `
            + `${JSON.stringify(link)}`,
          ).toMatch(/^https?:$/u)
        }
        expect(
          resolved.map((link) => link.raw),
          'the benign https link was refused too, so the guard is a blanket rather than an '
          + 'allow-list and no transcript link works at all',
        ).toContain(BENIGN_LINK_DESTINATION)

        // THE ENTITY-COLON ARM, pinned as what it MEASURABLY is rather than as what it looks like.
        // See `RELATIVE_LOOKALIKE_DESTINATION`: it survives, because after one HTML decode it is
        // still not a scheme, so the browser treats it as a same-origin path. The rendered
        // attribute is pinned in its ESCAPED form, because the defect this would become is a second
        // decode — and a second decode would change exactly this string.
        const lookalike = resolved.find((link) => link.raw.includes('&#58;'))
        expect(
          lookalike,
          'the entity-colon fixture reached nothing, so this arm measures no build at all',
        ).toBeDefined()
        expect(
          lookalike?.raw,
          'the rendered attribute is no longer the once-escaped form; if it has been decoded again '
          + 'this destination is a live `javascript:` URL',
        ).toBe(RELATIVE_LOOKALIKE_DESTINATION)
        expect(
          lookalike?.resolved.startsWith(new URL(page.url()).origin),
          'the entity-colon destination resolved OFF this origin',
        ).toBe(true)

        // THE UNPARSED ARM: `marked` never produced a link for it, so it is inert by a different
        // mechanism — and the characters are still on the screen rather than silently dropped.
        expect(
          await answer.textContent(),
          'the destination markdown could not parse as a link vanished instead of rendering as text',
        ).toContain('embedded-newline')

        // GUARD THREE: the IMAGE vector, which needs no click at all — the browser fetches an
        // `img src` the moment the entry paints. Before this guard existed the `data:` row below
        // reached an `img src` verbatim in this very cell's render.
        expect(
          await answer.locator('[data-blocked-src]').count(),
          'the refused image count does not match the fixture, so either a hostile image '
          + 'destination survived or the guard deleted the node instead of keeping its alt text',
        ).toBe(REFUSED_IMAGE_DESTINATIONS.length)
        expect(
          await answer.locator('img[src^="data:"]').count(),
          'a `data:` destination reached an `img src` inside the dashboard\'s own origin',
        ).toBe(0)
        expect(
          await answer.textContent(),
          'the refused image lost its alt text as well as its destination',
        ).toContain(HOSTILE_IMAGE_ALT)
        // AND THE CONTROL: the guard is a filter, not a blanket. A benign https image still
        // renders, with the destination the document named.
        const benignImages = await answer.locator('img').evaluateAll(
          (nodes) => nodes.map((node) => ({
            src: node.getAttribute('src') ?? '',
            alt: node.getAttribute('alt') ?? '',
          })),
        )
        expect(
          benignImages,
          'the benign https image was refused too, so no transcript image renders at all',
        ).toEqual([{ src: BENIGN_IMAGE_DESTINATION, alt: BENIGN_IMAGE_ALT }])

        // AND NOTHING RAN. The witness a successful injection would have set is absent, and no
        // dialog was raised — the two observable effects every payload above was written to have.
        expect(
          await page.evaluate(
            (witness: string) => (globalThis as unknown as Record<string, unknown>)[witness],
            XSS_WITNESS,
          ),
          'a payload from the hostile fixture EXECUTED in the dashboard\'s origin',
        ).toBeUndefined()
        expect(dialogs, 'the hostile fixture raised a dialog').toEqual([])

        // Clicking a refused link goes nowhere: it is not an anchor at all.
        const before = page.url()
        await answer.locator('[data-blocked-href]').first().click()
        expect(page.url(), 'a refused link navigated the dashboard somewhere').toBe(before)
      } finally {
        await page.close()
      }
    }, 180_000)
})
