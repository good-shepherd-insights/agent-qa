/// <reference lib="dom" />
// The DOM lib is referenced HERE because this file's `page.evaluate` callbacks are compiled as
// TypeScript and EXECUTED in a browser — `dashboard-dom.test.ts`'s reasoning, unchanged.

// RUN DETAIL, IN THE MEDIUM A PERSON LOOKS AT (Phase 405 plan 12 · DETL-01/02/03, D-04 and D-11).
//
// WHAT THIS FILE IS FOR, AND WHY NOTHING ELSE IN THE REPOSITORY DOES IT. Every other 405 cell
// proves one leg: the subscriber writes a row, the op reads it, the route serves it, the component
// renders it. CONTEXT.md D-04 rejects that stack as the acceptance in as many words — "subscriber
// unit cells over fixture envelopes alone (blind to the op, the route and the page)". Two prior
// plans left the same gap open BY NAME: 405-01's coverage item D6 (`human_judgment: true`, "no cell
// starts the shipped binary and reads the binding from it") and 405-04's identical caveat for the
// token path. This file is the cell both of them named. It drives the BUILT dashboard bundle served
// by the SHIPPED `agent-qa dashboard` binary, over a real socket, in a real headless Chromium,
// against a run that really ran — 405-09's populated-run producer — and asserts on pixels and on
// network responses the browser actually received.
//
// A BROWSER THAT CANNOT LAUNCH IS A RED, NEVER A SKIP — `live-view-dom.test.ts`'s law, and this
// file contains no conditional skip for the same reason: a skipped visual suite exits 0 having
// measured nothing, and the thing it measured nothing about is the phase's entire acceptance.
//
// THE DRIVING HAPPENS ONCE, IN `beforeAll`, AND THE CELLS ASSERT ON WHAT IT RECORDED —
// `post-processing-dom.test.ts`'s idiom, for its load-bearing reason: `scripts/405-run-detail-
// mutation.sh` needs each named claim to be the only red under its own mutation. A cell that drove
// its own run would take the whole file down with it and the mutation script would be measuring
// blast radius instead of a property. The drive RECORDS and never asserts.
//
// ── THE TWO SECRET LANES, AND WHY CRITERION 2 IS SPLIT ACROSS TWO CELLS (WINDOWS #286).
//
// 405-09 measured a fact this file must not paper over. There are TWO ways a value becomes secret
// to this product and they have DIFFERENT observable fates on this page:
//
//   (A) A value seeded into the run's masking context BY NAME — `sensitiveEnvSlice`'s `_SECRET`
//       suffix family. No redactor touches it; the bus projection masks it into `<SECRET_n>`, the
//       run records a keyed digest for it, and 405-10's display-unmask seam re-derives it from the
//       host's current sources and puts the REAL VALUE back at every local human read. This is the
//       lane criterion 2 is about, and cells (2a)/(2d) are its acceptance.
//
//   (B) A value DECLARED in the project's `SecretStore`. The runner builds a `SecretRedactor` from
//       that store and rewrites the value to a generic `[secret]` marker INSIDE THE LOOP, at
//       `plan: reasoning`, before any evidence is recorded. By the time the bus projection masks
//       anything there is no value left to mask, so no placeholder is ever minted and the seam has
//       nothing to match a digest against. The page renders an IRREVERSIBLE `[secret]` where a
//       value belongs.
//
// Criterion 2 as CONTEXT.md D-11 phrases it — "the rebuilt page never renders a masked placeholder
// where a value belongs" — is TRUE for lane (A) and NOT TRUE for lane (B), and a cell that only
// ever exercised (A) would let a reader believe it held for both. So cell (2e) measures lane (B)
// as it actually is: the declared value is absent from the page (which is the at-rest claim
// holding) and the generic marker is what a person sees. That is the honest floor, it is the
// evidence WINDOWS #286 asks the verifier to rule on, and it is deliberately NOT written as a
// failure — the behaviour is correct for a redactor; what is unsettled is whether criterion 2 was
// ever meant to range over it.
//
// ── WHAT THIS FILE DELIBERATELY DOES NOT ASSERT, STATED RATHER THAN IMPLIED.
//
// A/B SCREENSHOT SIDE-SELECTION (WINDOWS #284). 405-11 retired it: the bus records ONE decision
// screenshot per sub-action and no post-action capture, so there is no second side to select. This
// file asserts one `<img>` and one real 200, and nothing about a pair.
//
// THE ARIA-TREE TAB (WINDOWS #285). `TabAriaTree` renders a constant not-captured state because the
// bus collapses a `ScreenState` to a sha256 before the wire. There is no producer, so there is
// nothing here to measure and this file does not pretend otherwise. The screen CONTEXT that IS
// recorded — the hash pair — is cell (1e), on the overview, where 405-11 put it.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { MASKED_MARKER_DELIMITER, PLACEHOLDER_PATTERN, slugBranch } from '@vostride/agent-qa-schema'
import { chromium } from 'playwright-core'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  POPULATED_DECLARED_SECRET_VALUE,
  POPULATED_EMAIL,
  POPULATED_RUN_ANCHORED_BUILDS,
  POPULATED_SECRET_VALUE,
  RUN_BUDGET_MS,
  drivePopulatedRun,
  populatedRunFixtureProject,
  populatedRunSpawnEnv,
  startStubModelServer,
  startTargetPageServer,
} from './populated-run-fixture.js'
import type { FixtureServer, PopulatedRunDrive, StubModelServer } from './populated-run-fixture.js'
import {
  PACKAGES_ROOT,
  buildFreshness,
  cleanupTempRoots,
  reserveEphemeralPort,
  spawnDashboard,
} from './spawned-chat.js'
import type { SpawnedDashboard } from './spawned-chat.js'

// NO PLATFORM SKIP, on `populated-run.test.ts`'s law applied to itself: a conditional `describe`
// that exits 0 having measured nothing is indistinguishable from one that measured everything, and
// this file is the phase's acceptance. Windows is a recorded drive failure naming the reason.
const WINDOWS_REFUSAL =
  'the spawned-binary cells in this directory are POSIX-only: the dashboard child is stopped with '
  + 'SIGTERM and the run writes a POSIX runtime root. This file reds rather than skipping on '
  + 'Windows, because a suite that exits 0 having measured nothing is indistinguishable from one '
  + 'that measured everything.'

const REBUILD_INSTRUCTION =
  'these cells drive the BUILT dashboard UI served by the BUILT `agent-qa dashboard` and the built '
  + 'packages it resolves as external workspace dependencies: run `pnpm turbo run build --force` '
  + 'from the agent-qa root first. `--force` is required — `scripts/405-run-detail-mutation.sh` '
  + 'restores its subjects byte-identically, which turbo treats as a cache hit, so a plain build '
  + 'reports FULL TURBO and refreshes no dist mtime.'

const BROWSER_INSTALL_INSTRUCTION =
  'these cells drive the BUILT dashboard UI in a real Chromium, against a run the shipped binary '
  + 'really executed: run `pnpm exec playwright install chromium` and re-run. THEY MUST NOT BE '
  + 'SKIPPED WHEN THE BROWSER IS ABSENT — they are the only cells in this repository that measure '
  + 'the run-detail page on the artifact a person installs, and they are the acceptance for this '
  + "phase's criteria 1 and 2."

/** How long the page has to mount, paint the tree and settle the overview. */
const PAGE_BUDGET_MS = 60_000

/** How long the respawned dashboard has to say it is listening on the same port. */
const RESPAWN_BUDGET_MS = 60_000

/** How long the detached post-run tail is given before the dashboard is stopped for the scan. */
const TAIL_GRACE_MS = 2_000

/**
 * The artifact route a decision screenshot's `<img>` must be addressed through (D-12).
 *
 * SPELLED AS A SHAPE RATHER THAN AS THE MINTER'S OUTPUT, deliberately: this cell's claim is that
 * the browser requested the RUN-SCOPED, CONTENT-ADDRESSED route and got bytes back, and a check
 * that rebuilt the same string the page built would pass for any string both agreed on.
 */
const ARTIFACT_ROUTE_RE = new RegExp('/api/runs/[^/]+/artifacts/[0-9a-f]{64}$', 'u')

/**
 * A published constant, read out of the module that publishes it.
 *
 * `post-processing-dom.test.ts`'s `publishedRecordSentence`, narrowed to a top-level `export const`.
 * Extracted rather than imported for that file's own reason: importing a `dashboard-ui` module into
 * a Node test would drag a renderer in. Either way the cell fails when the sentence moves, which is
 * the point — a hardcoded copy would go on passing against a page that says something else.
 */
function publishedConstant(relativePath: string, name: string): string {
  const source = readFileSync(join(PACKAGES_ROOT, 'dashboard-ui', 'src', relativePath), 'utf8')
  const entry = new RegExp(`export const ${name}(?::\\s*string)?\\s*=\\s*'([^']*)'`, 'u').exec(source)
  if (entry === null) {
    throw new Error(`${name} is no longer a single-quoted top-level constant in ${relativePath}`)
  }
  return entry[1] as string
}

const TOKENS_NOT_MEASURED_LABEL = publishedConstant('lib/run-detail-view.ts', 'TOKENS_NOT_MEASURED_LABEL')
const MASKED_EMAIL_LABEL = publishedConstant('lib/run-detail-view.ts', 'MASKED_EMAIL_LABEL')

/**
 * The accessible name of one overview reasoning section, read out of the panel that names it.
 *
 * WHY A CELL NEEDS THIS AT ALL. The overview's reasoning sections are collapsibles that start
 * CLOSED, and the content is unmounted rather than hidden — so the plan is not in the document
 * until somebody opens it. That is the page as shipped and this cell does what a person does:
 * clicks the section by its name. Reading the name out of the panel keeps a copy rename from
 * turning into a mystery timeout here.
 */
function publishedSectionLabel(key: string): string {
  const source = readFileSync(
    join(PACKAGES_ROOT, 'dashboard-ui', 'src', 'components', 'run-detail', 'tab-overview.tsx'),
    'utf8',
  )
  const entry = new RegExp(`key:\\s*"${key}",\\s*\\n\\s*label:\\s*"([^"]+)"`, 'u').exec(source)
  if (entry === null) {
    throw new Error(`the overview no longer declares a section keyed \`${key}\` with a label`)
  }
  return entry[1] as string
}

const REASONING_SECTION_LABEL = publishedSectionLabel('reasoning')

/**
 * The generic marker the runner's own redactor leaves where a DECLARED secret stood.
 *
 * READ OUT OF THE PRODUCER rather than typed here, and the producer is `SecretRedactor`'s own
 * `genericMarker` default in the runner loop — the one this run's `SecretStore` construction uses.
 * A redactor that changed its marker then reds cell (2e) with a sentence naming the change, instead
 * of leaving it asserting a string nothing produces any more.
 */
function publishedRedactionMarker(): string {
  const source = readFileSync(join(PACKAGES_ROOT, 'runner', 'src', 'loop', 'secrets.ts'), 'utf8')
  const entry = /genericMarker\s*=\s*'([^']*)'/u.exec(source)
  if (entry === null) {
    throw new Error("`SecretRedactor` no longer defaults `genericMarker` to a single-quoted literal")
  }
  return entry[1] as string
}

/** A fresh, non-global copy of the placeholder pattern — `PLACEHOLDER_PATTERN` carries `lastIndex`. */
const placeholderRe = (): RegExp => new RegExp(PLACEHOLDER_PATTERN.source, 'u')

/** One response the browser actually received, as the cells that read it consume it. */
interface RecordedResponse {
  readonly url: string
  readonly status: number
  readonly contentType: string
  /**
   * The body of an API REFUSAL, bounded.
   *
   * ONLY FOR `status >= 400`, and only under `/api/`. A page that renders nothing renders nothing
   * for a reason the door already named in a one-key body, and a diagnosis that stopped at the
   * status code would send a reader back to reproduce the whole run just to read that word.
   */
  readonly refusalBody?: string
}

/** Everything one page visit recorded. */
interface PageObservation {
  /** Where the browser ended up — a D-07 bounce to `/live` would show here rather than as a hang. */
  readonly finalUrl: string
  /** Why the tree never attached, when it never did. Recorded, so the cells red on the FACT. */
  readonly waitFailure?: string
  /** The `[data-sub-action-plan]` text, as painted. */
  readonly planText: string
  /** How many `[data-sub-action]` rows the durable tree drew. */
  readonly subActionCount: number
  /** How many `[data-step-id]` rows the durable tree drew. */
  readonly stepCount: number
  /** `data-artifact-state` on the screenshot pane, or nothing when neither state rendered. */
  readonly artifactState?: string
  /** The decision screenshot's `src`, if the page rendered an `<img>` at all. */
  readonly screenshotSrc?: string
  /** The `[data-token-summary]` sentence, as painted. */
  readonly tokenSummary?: string
  /** The `[data-run-token-summary]` sentence from the navbar, as painted. */
  readonly runTokenSummary?: string
  /** The raw hash on `[data-screen-state]`, if the chip rendered. */
  readonly screenStateHash?: string
  /** Every `data-masked` category the page painted, in document order. */
  readonly maskedCategories: readonly string[]
  /** Every `[data-masked]` chip's visible text. */
  readonly maskedChipText: readonly string[]
  /** Every non-blank text node under `<body>` — the medium a person reads. */
  readonly textNodes: readonly string[]
  /** `document.body.innerText`, for the whole-page containment questions. */
  readonly bodyText: string
  /** Every response this page received. */
  readonly responses: readonly RecordedResponse[]
}

/** Everything `beforeAll` measured, or the reason it could not. */
interface Recorded {
  drive?: PopulatedRunDrive
  /** Envelope types in arrival order — what every failure message quotes. */
  envelopeTypes: string[]
  /** The first visit, on the process that executed the run. */
  first?: PageObservation
  /** The second visit, on a dashboard process that has never seen this run execute (D-08). */
  afterRestart?: PageObservation
  /** Every run-stream frame the drive collected, serialised — the masked-side wire scan. */
  sseFrames?: string
  /** `runs/<slug>/events.jsonl` as text, read after both dashboards exited. */
  eventsLog?: string
  /** Every byte of the runtime databases and their write-ahead sidecars. */
  dbBytes?: Buffer
  /** The database files scanned, named so a clean scan is not a scan of nothing. */
  scannedDbFiles: string[]
  /** Whether `playwright-core` can name an installed Chromium at all. */
  browserPresent: boolean
  /** Whether the respawned dashboard said it was listening. */
  respawned: boolean
  stub?: StubModelServer
  runDir?: string
  dashboardStderr?: string
  respawnStderr?: string
  failure?: string
}

const recorded: Recorded = {
  envelopeTypes: [],
  scannedDbFiles: [],
  browserPresent: false,
  respawned: false,
}

let targetServer: FixtureServer | undefined
let stubServer: StubModelServer | undefined
let dashboard: (SpawnedDashboard & { readonly ready: boolean }) | undefined
let respawned: (SpawnedDashboard & { readonly ready: boolean }) | undefined
let browser: Browser | undefined
const contexts: BrowserContext[] = []

/** The context every failure message carries: what the run and the page did, in one block. */
function context(): string {
  const drive = recorded.drive
  return [
    '',
    `envelope types: ${recorded.envelopeTypes.join(', ') || '(none)'}`,
    `finished: ${String(drive?.finished ?? false)}; last type: ${drive?.lastType ?? '(none)'}; `
    + `elapsed: ${String(drive?.elapsedMs ?? 0)}ms`,
    `chromium present: ${String(recorded.browserPresent)}`,
    `first visit url: ${recorded.first?.finalUrl ?? '(never opened)'}`,
    `first visit wait failure: ${recorded.first?.waitFailure?.split('\n')[0] ?? '(none)'}`,
    `steps drawn: ${String(recorded.first?.stepCount ?? 0)}; `
    + `sub-actions drawn: ${String(recorded.first?.subActionCount ?? 0)}`,
    // THE PAGE'S OWN API TRAFFIC, because every way this page can be empty is a question it either
    // never asked or got a refusal to — and neither is visible in the DOM it did not draw.
    `page api traffic: ${
      (recorded.first?.responses ?? [])
        .filter((response) => response.url.includes('/api/'))
        .map((response) =>
          `${String(response.status)} ${response.url.replace(/^https?:\/\/[^/]+/u, '')}`
          + (response.refusalBody === undefined ? '' : ` -> ${response.refusalBody}`))
        .join(' | ') || '(none)'
    }`,
    `page text: ${JSON.stringify((recorded.first?.bodyText ?? '').slice(0, 600))}`,
    `artifact state: ${recorded.first?.artifactState ?? '(none)'}; `
    + `screenshot src: ${recorded.first?.screenshotSrc ?? '(none)'}`,
    `token summary: ${JSON.stringify(recorded.first?.tokenSummary ?? null)}`,
    `screen state: ${recorded.first?.screenStateHash ?? '(none)'}`,
    `masked chips: ${(recorded.first?.maskedCategories ?? []).join(', ') || '(none)'}`,
    `respawned: ${String(recorded.respawned)}; `
    + `after-restart url: ${recorded.afterRestart?.finalUrl ?? '(never opened)'}`,
    `warnings: ${
      (drive?.envelopes ?? [])
        .filter((envelope) => envelope.type === 'runWarning' || envelope.type === 'testFinished')
        .map((envelope) => JSON.stringify((envelope as unknown as { payload: unknown }).payload).slice(0, 700))
        .join(' | ') || '(none)'
    }`,
    recorded.failure === undefined ? '' : `drive failure: ${recorded.failure}`,
    `dashboard stderr: ${(recorded.dashboardStderr ?? '').slice(-1_200)}`,
    `respawn stderr: ${(recorded.respawnStderr ?? '').slice(-1_200)}`,
  ].join('\n')
}

/** The recorded drive, or a failure the cells report with their own message. */
function driveOk(): void {
  expect(
    recorded.failure,
    `the measurement drive stopped early. ${BROWSER_INSTALL_INSTRUCTION}${context()}`,
  ).toBeUndefined()
}

/** The first visit's observation, asserted present so every cell below reads a real page. */
function firstVisit(): PageObservation {
  driveOk()
  const observed = recorded.first
  expect(
    observed,
    `the run-detail page was never observed. ${BROWSER_INSTALL_INSTRUCTION}${context()}`,
  ).toBeDefined()
  return observed as PageObservation
}

async function waitUntil(
  predicate: () => Promise<boolean> | boolean,
  what: string,
  budgetMs: number,
  everyMs = 50,
): Promise<void> {
  const deadline = Date.now() + budgetMs
  for (;;) {
    if (await predicate()) return
    if (Date.now() >= deadline) throw new Error(`timed out after ${String(budgetMs)}ms waiting for ${what}`)
    await new Promise<void>((tick) => { setTimeout(tick, everyMs) })
  }
}

/**
 * Open one run's detail page, select the recorded sub-action, and harvest what a person can see.
 *
 * THE SUB-ACTION IS CLICKED RATHER THAN DEEP-LINKED. Run detail's default selection is the first
 * STEP, and the overview renders no reasoning, no screenshot and no screen context for a step
 * selection — those three facts belong to a sub-action. A `?sub=` deep link would reach the same
 * panel while skipping the interaction a person actually performs, and the click is one of the
 * things D-04 says the acceptance must exercise.
 *
 * THE ARTIFACT RESPONSE IS WAITED FOR, NOT ASSUMED. `<img src>` is a request the BROWSER issues
 * after the element mounts; harvesting the moment the pane appears would read the src off an
 * element whose bytes are still in flight, and the network half of cell (1c) would then be a claim
 * about a request nobody watched complete.
 */
async function observeRunDetail(
  context_: BrowserContext,
  origin: string,
  runId: string,
): Promise<PageObservation> {
  const page: Page = await context_.newPage()
  let waitFailure: string | undefined
  const responses: RecordedResponse[] = []
  const pendingBodies: Promise<void>[] = []
  page.on('response', (response) => {
    const record: {
      url: string
      status: number
      contentType: string
      refusalBody?: string
    } = {
      url: response.url(),
      status: response.status(),
      contentType: response.headers()['content-type'] ?? '',
    }
    responses.push(record as RecordedResponse)
    if (record.status >= 400 && record.url.includes('/api/')) {
      pendingBodies.push(
        response.text().then(
          (body) => { record.refusalBody = body.slice(0, 400) },
          () => { record.refusalBody = '(body unreadable)' },
        ),
      )
    }
  })
  try {
    await page.goto(`${origin}/runs/${encodeURIComponent(runId)}`)
    // EVERY WAIT RECORDS RATHER THAN THROWS, and the harvest below runs whatever happened. A drive
    // that threw here would leave every cell reporting "the drive stopped early" and NOTHING about
    // the page a person would have been looking at — which is the one thing a reader needs. A
    // timeout is a fact about the page (`waitFailure`), and the cells red on the missing FACT with
    // the whole observation quoted.
    await page.locator('[data-step-id]').first()
      .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
      .catch((error: unknown) => {
        waitFailure = error instanceof Error ? error.message : String(error)
      })

    const subActions = page.locator('[data-sub-action]')
    if ((await subActions.count()) > 0) {
      await subActions.first().locator('button').first().click()
      // THE REASONING SECTION IS OPENED THE WAY A PERSON OPENS IT. It is a collapsible that starts
      // closed and UNMOUNTS its content, so the plan is not in the document until the section is
      // clicked — a cell that read the DOM without clicking would report "the page painted no
      // reasoning" about a page that paints it perfectly one click away.
      const reasoning = page.getByRole('button', { name: REASONING_SECTION_LABEL }).first()
      if ((await reasoning.count()) > 0) await reasoning.click().catch(() => undefined)
      await page
        .locator('[data-sub-action-plan]')
        .first()
        .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
        .catch(() => undefined)
    }

    // The screenshot pane is the one fact whose completion is a NETWORK event rather than a paint.
    await waitUntil(
      async () => {
        if ((await page.locator('[data-artifact-state]').count()) === 0) return true
        const src = await page.locator('[data-artifact-state="available"] img').first()
          .getAttribute('src').catch(() => null)
        if (src === null) return true
        return responses.some((response) => response.url.endsWith(src))
      },
      'the browser to complete its decision-screenshot request',
      PAGE_BUDGET_MS,
      50,
    ).catch(() => undefined)

    // `textContent` RATHER THAN `innerText`, and the difference is a measured one. The reasoning
    // section lives inside an accordion, and `innerText` answers '' for a node inside a collapsed
    // panel — so a cell reading it would report "the page painted no reasoning" for a page that
    // painted it perfectly and had it one click away. The claim these cells make is about what the
    // page RENDERED for this sub-action; whether a person has expanded the section is a different
    // question, and `bodyText` below is where the visible-medium claims are made.
    const textOf = async (selector: string): Promise<string | undefined> => {
      const node = page.locator(selector).first()
      if ((await node.count()) === 0) return undefined
      return ((await node.textContent()) ?? '').trim()
    }
    const attributeOf = async (selector: string, name: string): Promise<string | undefined> => {
      const node = page.locator(selector).first()
      if ((await node.count()) === 0) return undefined
      return (await node.getAttribute(name)) ?? undefined
    }

    const harvested = await page.evaluate(() => {
      const nodes: string[] = []
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const value = node.nodeValue ?? ''
        if (value.trim() !== '') nodes.push(value)
      }
      const masked = Array.from(document.querySelectorAll('[data-masked]'))
      return {
        textNodes: nodes,
        bodyText: document.body.innerText,
        maskedCategories: masked.map((element) => element.getAttribute('data-masked') ?? '?'),
        maskedChipText: masked.map((element) => (element.textContent ?? '').trim()),
        subActionCount: document.querySelectorAll('[data-sub-action]').length,
        stepCount: document.querySelectorAll('[data-step-id]').length,
      }
    })

    // Every refusal body read before the observation is handed back, so the record is complete.
    await Promise.all(pendingBodies)

    const artifactState = await attributeOf('[data-artifact-state]', 'data-artifact-state')
    const screenshotSrc = await attributeOf('[data-artifact-state="available"] img', 'src')
    const planText = (await textOf('[data-sub-action-plan]')) ?? ''
    const tokenSummary = await textOf('[data-token-summary]')
    const runTokenSummary = await textOf('[data-run-token-summary]')
    const screenStateHash = await attributeOf('[data-screen-state]', 'data-screen-state')

    return {
      finalUrl: page.url(),
      ...(waitFailure === undefined ? {} : { waitFailure }),
      planText,
      subActionCount: harvested.subActionCount,
      stepCount: harvested.stepCount,
      ...(artifactState === undefined ? {} : { artifactState }),
      ...(screenshotSrc === undefined ? {} : { screenshotSrc }),
      ...(tokenSummary === undefined ? {} : { tokenSummary }),
      ...(runTokenSummary === undefined ? {} : { runTokenSummary }),
      ...(screenStateHash === undefined ? {} : { screenStateHash }),
      maskedCategories: harvested.maskedCategories,
      maskedChipText: harvested.maskedChipText,
      textNodes: harvested.textNodes,
      bodyText: harvested.bodyText,
      responses,
    }
  } finally {
    await page.close()
  }
}

describe('the shipped dashboard renders run detail populated and unmasked (405-12)', () => {
  beforeAll(async () => {
    if (process.platform === 'win32') {
      recorded.failure = WINDOWS_REFUSAL
      return
    }
    try {
      recorded.browserPresent = existsSync(chromium.executablePath())
    } catch {
      recorded.browserPresent = false
    }

    // FIRST, AND BEFORE ANYTHING IS SPAWNED OR SERVED: a stale build measures the previous commit,
    // and the bundle these cells read is `dashboard-ui/dist`.
    const freshness = buildFreshness(POPULATED_RUN_ANCHORED_BUILDS)
    if (freshness.missing.length > 0 || freshness.stale.length > 0) {
      recorded.failure =
        `${REBUILD_INSTRUCTION} missing: ${freshness.missing.join(', ') || '(none)'}; `
        + `stale: ${freshness.stale.join(', ') || '(none)'}`
      return
    }

    try {
      browser = await chromium.launch({ headless: true })
    } catch (error) {
      recorded.failure =
        `${BROWSER_INSTALL_INSTRUCTION} underlying error: `
        + `${error instanceof Error ? error.message : String(error)}`
      return
    }

    targetServer = await startTargetPageServer()
    stubServer = await startStubModelServer()
    recorded.stub = stubServer

    const project = populatedRunFixtureProject('run-detail-dom', {
      modelBaseUrl: stubServer.baseUrl,
      targetUrl: targetServer.url,
    })

    // THE SAME PORT ACROSS THE RESTART, so the second dashboard is the same door at the same
    // address and the only thing that changed is the PROCESS — which is precisely the fact the
    // re-derivation claim (D-08) rests on.
    const port = await reserveEphemeralPort()
    dashboard = await spawnDashboard(
      project.root,
      project.configPath,
      port,
      60_000,
      populatedRunSpawnEnv(),
    )
    if (!dashboard.ready) {
      recorded.dashboardStderr = dashboard.stderr()
      recorded.failure = 'the spawned `agent-qa dashboard` never said it was listening'
      return
    }

    try {
      recorded.drive = await drivePopulatedRun(dashboard, project, RUN_BUDGET_MS)
      recorded.envelopeTypes = recorded.drive.envelopes.map((envelope) => envelope.type)
      recorded.sseFrames = JSON.stringify(recorded.drive.envelopes)

      const firstContext = await browser.newContext()
      contexts.push(firstContext)
      recorded.first = await observeRunDetail(firstContext, dashboard.origin, recorded.drive.runId)

      // ── THE RESTART LEG. The process that masked these strings, held the run's in-memory masking
      // map and wrote the sidecar is KILLED. The replacement has never seen this run execute; every
      // value it puts back it re-derived from the host's CURRENT sources and matched against the
      // run's recorded digests. That is the whole of D-08, and it is the only way to tell a real
      // re-derivation from a process that simply still remembered.
      recorded.dashboardStderr = dashboard.stderr()
      await dashboard.stop()
      respawned = await spawnDashboard(
        project.root,
        project.configPath,
        port,
        RESPAWN_BUDGET_MS,
        populatedRunSpawnEnv(),
      )
      recorded.respawned = respawned.ready
      recorded.respawnStderr = respawned.stderr()
      if (respawned.ready) {
        // A FRESH BROWSER CONTEXT, so nothing the first visit cached can carry an answer across.
        const secondContext = await browser.newContext()
        contexts.push(secondContext)
        recorded.afterRestart = await observeRunDetail(
          secondContext,
          respawned.origin,
          recorded.drive.runId,
        )
      }
    } catch (error) {
      recorded.failure = error instanceof Error ? error.message : String(error)
    }

    // The detached tail is given a moment before its writer is taken away.
    await new Promise<void>((tick) => { setTimeout(tick, TAIL_GRACE_MS) })
    await respawned?.stop()
    await dashboard.stop()

    const runId = recorded.drive?.runId
    if (runId !== undefined) {
      const runDir = join(project.agentQaRoot, 'runs', slugBranch(runId))
      recorded.runDir = runDir
      const eventsPath = join(runDir, 'events.jsonl')
      if (existsSync(eventsPath)) recorded.eventsLog = readFileSync(eventsPath, 'utf8')
    }

    // EVERY database this host wrote AND their write-ahead sidecars, scanned after the processes
    // that own them exited — `populated-run.test.ts`'s reasoning, unchanged: a `-wal` a scan never
    // opened can hold the bytes the scan concluded were absent.
    const chunks: Buffer[] = []
    for (const entry of existsSync(project.agentQaRoot) ? readdirSync(project.agentQaRoot) : []) {
      if (!/\.db(?:-[a-z]+)?$/u.test(entry)) continue
      recorded.scannedDbFiles.push(entry)
      chunks.push(readFileSync(join(project.agentQaRoot, entry)))
    }
    recorded.dbBytes = Buffer.concat(chunks)
  }, RUN_BUDGET_MS + 240_000)

  afterAll(async () => {
    for (const held of contexts) await held.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    await respawned?.stop()
    await dashboard?.stop()
    await stubServer?.close()
    await targetServer?.close()
    cleanupTempRoots()
  })

  it('(1a) reasoning: the planner\'s own sentence is painted, non-empty', () => {
    const observed = firstVisit()
    expect(
      observed.planText,
      'the overview painted no `[data-sub-action-plan]` text for the selected sub-action. The '
      + 'reasoning is the `plan` string the projection carries; an empty node means the row, the '
      + `op, the route or the render lost it.${context()}`,
    ).not.toBe('')
  })

  it('(1b) sub-action timeline: the durable tree draws at least one recorded sub-action', () => {
    const observed = firstVisit()
    expect(
      observed.subActionCount,
      'the durable tree drew no `[data-sub-action]` row. The run recorded one, so either the '
      + 'subscriber wrote no `run_sub_actions` row, the projection dropped it, or the tree stopped '
      + `rendering it.${context()}`,
    ).toBeGreaterThanOrEqual(1)
  })

  it('(1c) decision screenshot: an <img> on the artifact route whose response was 200 image/png', () => {
    const observed = firstVisit()
    expect(
      observed.artifactState,
      'the overview rendered no screenshot pane at all for the selected sub-action. A ref-bearing '
      + `sub-action must reach either the available or the unavailable state.${context()}`,
    ).toBe('available')

    const src = observed.screenshotSrc ?? ''
    expect(
      src,
      'the decision screenshot is not addressed through the run-scoped content-addressed artifact '
      + `route.${context()}`,
    ).toMatch(ARTIFACT_ROUTE_RE)

    const served = observed.responses.filter((response) => response.url.endsWith(src))
    expect(
      served.map((response) => `${String(response.status)} ${response.contentType}`),
      'the browser issued no response for the screenshot `src` this page painted — the image is a '
      + `URL nobody fetched, which is not the same claim as a picture a person saw.${context()}`,
    ).not.toEqual([])
    expect(
      served.map((response) => response.status),
      `the artifact route did not answer 200 for the src the page painted.${context()}`,
    ).toContain(200)
    expect(
      served.some((response) => response.contentType.includes('image/png')),
      'the artifact route answered the screenshot request with something that is not a PNG: '
      + `${served.map((response) => response.contentType).join(', ')}${context()}`,
    ).toBe(true)
  })

  it('(1d) token usage: the step reports a measured spend, never the not-measured sentence', () => {
    const observed = firstVisit()
    expect(
      observed.tokenSummary,
      `the overview painted no \`[data-token-summary]\` at all.${context()}`,
    ).toBeDefined()
    expect(
      observed.tokenSummary,
      'the page reports this step as unmeasured. The stub answers non-zero `usage` on every arm, '
      + 'so an unmeasured reading means the runner summed no model call, the emit dropped the '
      + `triple, or the projection lost it.${context()}`,
    ).not.toBe(TOKENS_NOT_MEASURED_LABEL)
  })

  it('(1e) screen context: the recorded state hash is painted on the overview', () => {
    const observed = firstVisit()
    expect(
      observed.screenStateHash,
      'the overview painted no `[data-screen-state]` chip. The bus collapses a `ScreenState` to a '
      + 'sha256 before the wire, so the hash pair IS the screen context this page can honestly '
      + `show, and its absence means the sub-action row carried none.${context()}`,
    ).toBeDefined()
    expect(
      observed.screenStateHash ?? '',
      `the screen-state chip carries something that is not a recorded hash.${context()}`,
    ).not.toBe('')
  })

  it('(2a) the masking-seeded secret is VISIBLE on the page, and no placeholder reaches a text node', () => {
    const observed = firstVisit()
    expect(
      observed.bodyText.includes(POPULATED_SECRET_VALUE),
      'the real value the run masked into a `<SECRET_n>` placeholder is NOT visible on run detail. '
      + 'The display-unmask seam re-derives candidates from this host\'s current sources and '
      + 'restores by keyed digest identity; an absent value means the seam did not run, the sidecar '
      + `is missing, or the host key no longer matches.${context()}`,
    ).toBe(true)

    const raw = observed.textNodes.filter((text) => placeholderRe().test(text))
    expect(
      raw,
      `a raw masking placeholder reached a text node a person reads.${context()}`,
    ).toEqual([])

    const delimited = observed.textNodes.filter((text) => text.includes(MASKED_MARKER_DELIMITER))
    expect(
      delimited,
      'a masked-marker delimiter reached a text node instead of being split into a chip — the '
      + `parser and the seam have drifted apart.${context()}`,
    ).toEqual([])

    // THE TWO LANES SHARE ONE SENTENCE, and this is where that is held. Cell (2e) is about lane
    // (B) alone and must stay green under a mutation that only breaks restoration; the claim that
    // the two are being compared on the SAME producer string belongs to the restore cell, because
    // restoration is what makes them differ. Without it, (2a) and (2e) could drift onto two
    // unrelated strings and both go on passing about nothing in particular.
    expect(
      observed.planText,
      'the restored value and the declared lane\'s generic marker are not in the same recorded '
      + 'sentence, so cells (2a) and (2e) are no longer contrasting two lanes of one string. The '
      + `fixture plants both in the planner's reasoning.${context()}`,
    ).toContain(POPULATED_SECRET_VALUE)
    expect(
      observed.planText,
      'the same sentence no longer carries the declared lane\'s generic marker — see the message '
      + `on cell (2e), which owns that fact.${context()}`,
    ).toContain(publishedRedactionMarker())
  })

  it('(2b) the masked side holds: neither planted value is in the SSE frames, the log or the database', () => {
    driveOk()
    expect(
      recorded.sseFrames,
      `the drive collected no run-stream frames to scan.${context()}`,
    ).toBeDefined()
    expect(
      recorded.eventsLog,
      `the run wrote no \`events.jsonl\` to scan at ${recorded.runDir ?? '(no run dir)'}${context()}`,
    ).toBeDefined()
    expect(
      recorded.scannedDbFiles.length,
      `no runtime database file was found to scan — a clean scan of nothing is not a claim.${context()}`,
    ).toBeGreaterThan(0)

    for (const [what, value] of [
      ['the masking-seeded credential', POPULATED_SECRET_VALUE],
      ['the declared step secret', POPULATED_DECLARED_SECRET_VALUE],
      ['the planted email address', POPULATED_EMAIL],
    ] as const) {
      expect(
        (recorded.sseFrames ?? '').includes(value),
        `${what} appears IN CLEAR in the run-stream frames the local door served.${context()}`,
      ).toBe(false)
      expect(
        (recorded.eventsLog ?? '').includes(value),
        `${what} appears IN CLEAR in this run's events.jsonl.${context()}`,
      ).toBe(false)
      expect(
        (recorded.dbBytes ?? Buffer.alloc(0)).includes(Buffer.from(value, 'utf8')),
        `${what} appears IN CLEAR in the dashboard's own SQLite bytes `
        + `(${recorded.scannedDbFiles.join(', ')}).${context()}`,
      ).toBe(false)
    }
  })

  it('(2c) the email renders as a typed masked chip, never as an address', () => {
    const observed = firstVisit()
    expect(
      observed.maskedCategories,
      'the page painted no `[data-masked="email"]` chip. The address is minted lazily into an '
      + '`<EMAIL_n>` placeholder by the detector inside `mask()`, and the seam has no source to '
      + `restore it from — so a chip is the only honest rendering.${context()}`,
    ).toContain('email')
    expect(
      observed.maskedChipText.join(' | '),
      `the email chip does not carry the published label.${context()}`,
    ).toContain(MASKED_EMAIL_LABEL)
    expect(
      observed.bodyText.includes(POPULATED_EMAIL),
      `the planted address is VISIBLE on the page — the email lane is not masked.${context()}`,
    ).toBe(false)
  })

  it('(2d) after the dashboard is killed and respawned, the value is still restored (D-08)', () => {
    driveOk()
    expect(
      recorded.respawned,
      `the replacement \`agent-qa dashboard\` never said it was listening.${context()}`,
    ).toBe(true)
    const observed = recorded.afterRestart
    expect(
      observed,
      `the run-detail page was never re-observed after the restart.${context()}`,
    ).toBeDefined()
    expect(
      (observed as PageObservation).bodyText.includes(POPULATED_SECRET_VALUE),
      'a process that never saw this run execute could not put the value back. The run\'s masking '
      + 'map died with the first process, so this reading is the whole of D-08: what the page shows '
      + 'is RE-DERIVED from the host\'s current sources and matched against the run\'s recorded '
      + `digests, not remembered.${context()}`,
    ).toBe(true)
    const raw = (observed as PageObservation).textNodes.filter((text) => placeholderRe().test(text))
    expect(
      raw,
      `a raw masking placeholder reached a text node on the restarted host.${context()}`,
    ).toEqual([])
  })

  it('(2e) the DECLARED-secret lane is irreversible: the value is absent and a generic marker is what a person sees (WINDOWS #286)', () => {
    const observed = firstVisit()
    const marker = publishedRedactionMarker()

    // The at-rest half of criterion 2 HOLDS for this lane, and this is where that is stated on the
    // page rather than only in the log: the declared value is nowhere a person can read it.
    expect(
      observed.bodyText.includes(POPULATED_DECLARED_SECRET_VALUE),
      'a value declared in the project\'s secret store is VISIBLE on run detail. The runner\'s '
      + `redactor is supposed to have consumed it before anything was recorded.${context()}`,
    ).toBe(false)

    // And the half that does NOT hold, measured rather than argued. The redactor rewrote the value
    // to a generic marker inside the loop, before any evidence existed, so no placeholder was ever
    // minted and the display seam has no digest to match. What a person sees where a value belongs
    // is this marker, and no restart, config or key can turn it back. Recorded as WINDOWS #286 for
    // the verifier to rule on: criterion 2's "never renders a masked placeholder where a value
    // belongs" is satisfiable for the name-seeded lane and unsatisfiable for this one.
    expect(
      observed.planText,
      'the declared step credential no longer resolves to the redactor\'s generic marker in the '
      + 'planner\'s recorded reasoning. Either the redaction lane changed — in which case WINDOWS '
      + '#286 must be re-measured, because the two-lane finding it records is what this cell holds '
      + `— or the reasoning stopped carrying the credential at all.${context()}`,
    ).toContain(marker)
  })
})
