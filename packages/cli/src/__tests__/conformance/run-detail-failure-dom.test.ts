/// <reference lib="dom" />
// The DOM lib is referenced HERE because this file's `page.evaluate` callbacks are compiled as
// TypeScript and EXECUTED in a browser — `run-detail-dom.test.ts`'s reasoning, unchanged.

// A FAILED RUN'S SUMMARY, IN THE MEDIUM A PERSON LOOKS AT (Phase 405 plan 14 · DETL-02, WINDOWS #287).
//
// WHAT THIS FILE MEASURES THAT ITS SIBLING CANNOT. `run-detail-dom.test.ts` drives 405-09's
// populated run, and that run PASSES — so `run.status === 'failed' && run.failureSummary` is false
// and the failure banner never mounts. The banner was therefore the one render site on the rebuilt
// page still painting a producer string RAW, invisible to every cell in the repository: 405-11 put
// the overview's strings through the chip seam, 405-12 read a marker delimiter out of a sub-action
// row and fixed it one row away, and neither could see this one. The verifier found it by reading
// (VERIFICATION.md criterion 2, missing item 3) and WINDOWS #287 recorded the three things a fix
// needs — a failing-run producer, parse-before-truncate, and a cell that measures it on the shipped
// artifact. This file is the third.
//
// THE PRODUCER IS THE SAME ONE, WITH ONE BOOLEAN MOVED. Same stub model server, same target page,
// same project recipe, same credential-free posture — `startStubModelServer({ plannerOutcome:
// 'stepFailed' })` sets the shipped `stepFailed` plan field on the planner's tool call, which is
// the product's own path to a step the planner declares impossible. Nothing in the runner changes
// to make this run fail, which is what keeps the run a RUN rather than an arrangement.
//
// A BROWSER THAT CANNOT LAUNCH IS A RED, NEVER A SKIP — 404-08's law, restated by
// `run-detail-dom.test.ts`'s own header and carried here without softening. There is no conditional
// skip in this file. A suite that exits 0 having measured nothing is indistinguishable from one
// that measured everything, and what this file measures is a leak.
//
// THE DRIVING HAPPENS ONCE, IN `beforeAll`, AND THE CELLS ASSERT ON WHAT IT RECORDED. The drive
// records and never asserts, so each named claim can be the only red under its own mutation.
//
// NO RESTART LEG. D-08 — that a process which never saw a run execute still restores its values —
// is `run-detail-dom.test.ts`'s claim and is measured there on the passing run. Re-driving it here
// would double this file's wall time to re-prove somebody else's property. Cell (3e) reads the
// restored value on the FIRST process, which is the fact this file needs: the banner sits on the
// restore lane like every other producer string on the page.
//
// WHAT A RED ON (3f) MEANS, STATED BEFORE ANYONE IS TEMPTED. `runs.failure_summary` is an at-rest
// sink no PASSING run ever writes, so this file's scan covers ground 405-12's cannot. If a planted
// value turns up there, in `events.jsonl` or in an SSE frame, that is a NEW DETL-02 at-rest
// finding: stop and report the sink and the value. It is not an occasion to narrow the scan.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { MASKED_MARKER_DELIMITER, PLACEHOLDER_PATTERN, slugBranch } from '@vostride/agent-qa-schema'
import { chromium } from 'playwright-core'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  POPULATED_DECLARED_SECRET_VALUE,
  POPULATED_EMAIL,
  POPULATED_FAILURE_STEP_TEXT,
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

// NO PLATFORM SKIP — `run-detail-dom.test.ts`'s refusal, applied to the same class of drive.
const WINDOWS_REFUSAL =
  'the spawned-binary cells in this directory are POSIX-only: the dashboard child is stopped with '
  + 'SIGTERM and the run writes a POSIX runtime root. This file reds rather than skipping on '
  + 'Windows, because a suite that exits 0 having measured nothing is indistinguishable from one '
  + 'that measured everything.'

const REBUILD_INSTRUCTION =
  'these cells drive the BUILT dashboard UI served by the BUILT `agent-qa dashboard` and the built '
  + 'packages it resolves as external workspace dependencies: run `pnpm turbo run build --force` '
  + 'from the agent-qa root first. `--force` is required — a mutation script restores its subjects '
  + 'byte-identically, which turbo treats as a cache hit, so a plain build reports FULL TURBO and '
  + 'refreshes no dist mtime.'

const BROWSER_INSTALL_INSTRUCTION =
  'these cells drive the BUILT dashboard UI in a real Chromium, against a run the shipped binary '
  + 'really executed and really FAILED: run `pnpm exec playwright install chromium` and re-run. '
  + 'THEY MUST NOT BE SKIPPED WHEN THE BROWSER IS ABSENT — they are the only cells in this '
  + 'repository that measure the failure banner at all, and the banner is the render site '
  + 'WINDOWS #287 was opened about.'

/** How long the page has to mount and paint the banner. */
const PAGE_BUDGET_MS = 60_000

/** How long the detached post-run tail is given before the dashboard is stopped for the scan. */
const TAIL_GRACE_MS = 2_000

/**
 * A published constant, read out of the module that publishes it.
 *
 * `run-detail-dom.test.ts`'s helper, unchanged and for its reason: importing a `dashboard-ui`
 * module into a Node test would drag a renderer in, and a hardcoded copy would go on passing
 * against a page that says something else.
 */
function publishedConstant(relativePath: string, name: string): string {
  const source = readFileSync(join(PACKAGES_ROOT, 'dashboard-ui', 'src', relativePath), 'utf8')
  const entry = new RegExp(`export const ${name}(?::\\s*string)?\\s*=\\s*'([^']*)'`, 'u').exec(source)
  if (entry === null) {
    throw new Error(`${name} is no longer a single-quoted top-level constant in ${relativePath}`)
  }
  return entry[1] as string
}

const MASKED_EMAIL_LABEL = publishedConstant('lib/run-detail-view.ts', 'MASKED_EMAIL_LABEL')

/** A fresh, non-global copy of the placeholder pattern — `PLACEHOLDER_PATTERN` carries `lastIndex`. */
const placeholderRe = (): RegExp => new RegExp(PLACEHOLDER_PATTERN.source, 'u')

/** One response the browser actually received, as the cells that read it consume it. */
interface RecordedResponse {
  readonly url: string
  readonly status: number
  readonly contentType: string
  /** The body of an API REFUSAL, bounded — only for `status >= 400` under `/api/`. */
  readonly refusalBody?: string
}

/** One state of the banner — the truncated preview, or the expanded full text. */
interface BannerState {
  /** `data-failure-banner-state`, or nothing when the banner never rendered. */
  readonly state?: string
  /** The banner's own `textContent` — what cell (3e) reads the restored value out of. */
  readonly bannerText: string
  /** Every `data-masked` category INSIDE the banner, in document order. */
  readonly maskedCategories: readonly string[]
  /** Every `[data-masked]` chip's visible text, inside the banner. */
  readonly maskedChipText: readonly string[]
  /** Every non-blank text node under `<body>` — the medium a person reads. */
  readonly textNodes: readonly string[]
  /** `document.body.innerText`, for the whole-page containment questions. */
  readonly bodyText: string
}

/** Everything one page visit recorded. */
interface PageObservation {
  /** Where the browser ended up — a bounce to `/live` would show here rather than as a hang. */
  readonly finalUrl: string
  /** Why the banner never attached, when it never did. Recorded, so the cells red on the FACT. */
  readonly waitFailure?: string
  /** Whether a `[data-failure-banner-toggle]` was present and clicked. */
  readonly toggled: boolean
  readonly truncated: BannerState
  readonly full: BannerState
  /** Every response this page received. */
  readonly responses: readonly RecordedResponse[]
}

/** Everything `beforeAll` measured, or the reason it could not. */
interface Recorded {
  drive?: PopulatedRunDrive
  /** Envelope types in arrival order — what every failure message quotes. */
  envelopeTypes: string[]
  /** The `testFinished` payload the door served, as data. */
  testFinished?: { outcome?: unknown; failureSummary?: unknown }
  /** The run row `GET /api/runs/:id` answered with, for the context block only. */
  runRow?: { status?: unknown; failureSummary?: unknown }
  observed?: PageObservation
  /** Every run-stream frame the drive collected, serialised — the masked-side wire scan. */
  sseFrames?: string
  /** `runs/<slug>/events.jsonl` as text, read after the dashboard exited. */
  eventsLog?: string
  /** Every byte of the runtime databases and their write-ahead sidecars. */
  dbBytes?: Buffer
  /** The database files scanned, named so a clean scan is not a scan of nothing. */
  scannedDbFiles: string[]
  /** Whether `playwright-core` can name an installed Chromium at all. */
  browserPresent: boolean
  stub?: StubModelServer
  runDir?: string
  dashboardStderr?: string
  failure?: string
}

const recorded: Recorded = {
  envelopeTypes: [],
  scannedDbFiles: [],
  browserPresent: false,
}

let targetServer: FixtureServer | undefined
let stubServer: StubModelServer | undefined
let dashboard: (SpawnedDashboard & { readonly ready: boolean }) | undefined
let browser: Browser | undefined
const contexts: BrowserContext[] = []

/** The context every failure message carries: what the run and the page did, in one block. */
function context(): string {
  const drive = recorded.drive
  const observed = recorded.observed
  return [
    '',
    `envelope types: ${recorded.envelopeTypes.join(', ') || '(none)'}`,
    `finished: ${String(drive?.finished ?? false)}; last type: ${drive?.lastType ?? '(none)'}; `
    + `elapsed: ${String(drive?.elapsedMs ?? 0)}ms`,
    `testFinished: ${JSON.stringify(recorded.testFinished ?? null).slice(0, 900)}`,
    `run row: ${JSON.stringify(recorded.runRow ?? null).slice(0, 900)}`,
    `chromium present: ${String(recorded.browserPresent)}`,
    `visit url: ${observed?.finalUrl ?? '(never opened)'}`,
    `banner wait failure: ${observed?.waitFailure?.split('\n')[0] ?? '(none)'}`,
    `truncated state: ${observed?.truncated.state ?? '(no banner)'}; `
    + `toggled: ${String(observed?.toggled ?? false)}; `
    + `full state: ${observed?.full.state ?? '(no banner)'}`,
    `banner text (truncated): ${JSON.stringify((observed?.truncated.bannerText ?? '').slice(0, 400))}`,
    `banner text (full): ${JSON.stringify((observed?.full.bannerText ?? '').slice(0, 800))}`,
    `banner chips (truncated): ${(observed?.truncated.maskedCategories ?? []).join(', ') || '(none)'}; `
    + `(full): ${(observed?.full.maskedCategories ?? []).join(', ') || '(none)'}`,
    `page api traffic: ${
      (observed?.responses ?? [])
        .filter((response) => response.url.includes('/api/'))
        .map((response) =>
          `${String(response.status)} ${response.url.replace(/^https?:\/\/[^/]+/u, '')}`
          + (response.refusalBody === undefined ? '' : ` -> ${response.refusalBody}`))
        .join(' | ') || '(none)'
    }`,
    `page text: ${JSON.stringify((observed?.truncated.bodyText ?? '').slice(0, 600))}`,
    recorded.failure === undefined ? '' : `drive failure: ${recorded.failure}`,
    `dashboard stderr: ${(recorded.dashboardStderr ?? '').slice(-1_200)}`,
  ].join('\n')
}

/** The recorded drive, or a failure the cells report with their own message. */
function driveOk(): void {
  expect(
    recorded.failure,
    `the measurement drive stopped early. ${BROWSER_INSTALL_INSTRUCTION}${context()}`,
  ).toBeUndefined()
}

/** The visit's observation, asserted present so every cell below reads a real page. */
function visit(): PageObservation {
  driveOk()
  const observed = recorded.observed
  expect(
    observed,
    `the run-detail page was never observed. ${BROWSER_INSTALL_INSTRUCTION}${context()}`,
  ).toBeDefined()
  return observed as PageObservation
}

/**
 * Harvest one banner state: the attribute, the chips inside it, and every text node on the page.
 *
 * THE CHIPS ARE SCOPED TO THE BANNER and the text-node scan is not, deliberately. "Is there an
 * email chip in the banner" is a claim about this component; "does a delimiter reach a text node"
 * is a claim about the page a person is looking at, and a leak two elements away is still a leak.
 */
async function harvestBanner(page: Page): Promise<BannerState> {
  return page.evaluate(() => {
    const nodes: string[] = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const value = node.nodeValue ?? ''
      if (value.trim() !== '') nodes.push(value)
    }
    const banner = document.querySelector('[data-failure-banner]')
    const masked = banner === null
      ? []
      : Array.from(banner.querySelectorAll('[data-masked]'))
    return {
      state: banner?.getAttribute('data-failure-banner-state') ?? undefined,
      bannerText: (banner?.textContent ?? ''),
      maskedCategories: masked.map((element) => element.getAttribute('data-masked') ?? '?'),
      maskedChipText: masked.map((element) => (element.textContent ?? '').trim()),
      textNodes: nodes,
      bodyText: document.body.innerText,
    }
  })
}

/**
 * Open one failed run's detail page and harvest the banner in BOTH of its states.
 *
 * THE TOGGLE IS CLICKED, NOT SIMULATED. The expanded state is what a person gets by pressing the
 * chevron, and the claim these cells make is about what the shipped bundle renders when they do.
 */
async function observeFailureBanner(
  context_: BrowserContext,
  origin: string,
  runId: string,
): Promise<PageObservation> {
  const page: Page = await context_.newPage()
  let waitFailure: string | undefined
  let toggled = false
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
    // EVERY WAIT RECORDS RATHER THAN THROWS — `run-detail-dom.test.ts`'s law. A timeout is a fact
    // about the page, and the cells red on the missing FACT with the whole observation quoted.
    await page.locator('[data-failure-banner]')
      .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
      .catch((error: unknown) => {
        waitFailure = error instanceof Error ? error.message : String(error)
      })

    const truncated = await harvestBanner(page)

    const toggle = page.locator('[data-failure-banner-toggle]')
    if ((await toggle.count()) > 0) {
      await toggle.first().click().catch(() => undefined)
      toggled = true
      await page.locator('[data-failure-banner-state="full"]')
        .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
        .catch(() => undefined)
    }
    const full = await harvestBanner(page)

    // Every refusal body read before the observation is handed back, so the record is complete.
    await Promise.all(pendingBodies)

    return {
      finalUrl: page.url(),
      ...(waitFailure === undefined ? {} : { waitFailure }),
      toggled,
      truncated,
      full,
      responses,
    }
  } finally {
    await page.close()
  }
}

describe('the shipped dashboard paints a FAILED run\'s summary through the masking seam (405-14, WINDOWS #287)', () => {
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
    stubServer = await startStubModelServer({ plannerOutcome: 'stepFailed' })
    recorded.stub = stubServer

    const project = populatedRunFixtureProject(
      'run-detail-failure-dom',
      { modelBaseUrl: stubServer.baseUrl, targetUrl: targetServer.url },
      { stepText: POPULATED_FAILURE_STEP_TEXT },
    )

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

      const finished = recorded.drive.envelopes.find((envelope) => envelope.type === 'testFinished')
      if (finished !== undefined) {
        recorded.testFinished = (finished as unknown as {
          payload: { outcome?: unknown; failureSummary?: unknown }
        }).payload
      }

      // THE RUN ROW AS THE DISPLAY DOOR SERVES IT, for the context block. The cells below assert on
      // the DOM; this is here so a red names the string the page was handed rather than only the
      // string it painted.
      const row = await fetch(
        `${dashboard.origin}/api/runs/${encodeURIComponent(recorded.drive.runId)}`,
      ).then(
        async (response) => await response.json() as { run?: { status?: unknown; failureSummary?: unknown } },
        () => undefined,
      )
      if (row?.run !== undefined) {
        recorded.runRow = { status: row.run.status, failureSummary: row.run.failureSummary }
      }

      const visitContext = await browser.newContext()
      contexts.push(visitContext)
      recorded.observed = await observeFailureBanner(
        visitContext,
        dashboard.origin,
        recorded.drive.runId,
      )
    } catch (error) {
      recorded.failure = error instanceof Error ? error.message : String(error)
    }

    // The detached tail is given a moment before its writer is taken away.
    await new Promise<void>((tick) => { setTimeout(tick, TAIL_GRACE_MS) })
    recorded.dashboardStderr = dashboard.stderr()
    await dashboard.stop()

    const runId = recorded.drive?.runId
    if (runId !== undefined) {
      const runDir = join(project.agentQaRoot, 'runs', slugBranch(runId))
      recorded.runDir = runDir
      const eventsPath = join(runDir, 'events.jsonl')
      if (existsSync(eventsPath)) recorded.eventsLog = readFileSync(eventsPath, 'utf8')
    }

    // EVERY database this host wrote AND their write-ahead sidecars, scanned after the process that
    // owns them exited: a `-wal` a scan never opened can hold the bytes the scan concluded were
    // absent.
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
    await dashboard?.stop()
    await stubServer?.close()
    await targetServer?.close()
    cleanupTempRoots()
  })

  it('(3a) the producer: the shipped binary really failed this run, with a masked summary on the wire', () => {
    driveOk()
    expect(
      recorded.drive?.finished,
      'the failing run never reached `runFinished` inside the budget. The `stepFailed` knob sets a '
      + 'plan field on the planner\'s tool call and nothing else; a run that never finishes means '
      + `the loop took a different path, not that the fixture asked for one.${context()}`,
    ).toBe(true)
    expect(
      recorded.testFinished,
      `the run served no \`testFinished\` envelope to read an outcome off.${context()}`,
    ).toBeDefined()
    expect(
      recorded.testFinished?.outcome,
      'the member did not fail. Without a failed member the run row is not `failed`, the banner '
      + `never mounts, and every cell below would be measuring a page that renders nothing.${context()}`,
    ).toBe('failed')
    const summary = recorded.testFinished?.failureSummary
    expect(
      typeof summary,
      `the \`testFinished\` payload carried no \`failureSummary\` string.${context()}`,
    ).toBe('string')
    expect(
      placeholderRe().test(summary as string),
      'the failure summary on the wire carries NO masking placeholder, so this file would be '
      + 'measuring a banner with nothing to mask. `projectTestFinished` routes the summary through '
      + '`maskPayloadStrings` by name; an unmasked summary means the projection stopped masking it '
      + `or the planted values stopped reaching it.${context()}`,
    ).toBe(true)
  })

  it('(3b) the banner rendered on the shipped bundle, in its truncated state', () => {
    const observed = visit()
    expect(
      observed.waitFailure,
      'the failure banner never attached to the run-detail page. The run failed with a summary, so '
      + 'either the row was not written `failed`, the single-run arm dropped `failureSummary`, or '
      + `the page stopped rendering the banner.${context()}`,
    ).toBeUndefined()
    expect(
      observed.truncated.state,
      'the banner did not open in its truncated state. The fixture\'s summary is over the preview '
      + 'budget by construction, so a banner that starts full means the truncation stopped running '
      + `— and the truncated-state claims below would be measuring the full text.${context()}`,
    ).toBe('truncated')
  })

  it('(3c) truncated state: the email is a typed chip, and no marker or placeholder reaches a text node', () => {
    const observed = visit()
    expect(
      observed.truncated.maskedCategories,
      'the truncated banner painted no `[data-masked="email"]` chip. The fixture plants the email '
      + 'inside the preview budget deliberately; an absent chip means the banner is rendering the '
      + 'summary raw, the truncation dropped the marker, or the fixture\'s sentence drifted past '
      + `the budget — and the drift is fixed in the FIXTURE, never by widening the budget.${context()}`,
    ).toContain('email')
    expect(
      observed.truncated.maskedChipText.join(' | '),
      `the email chip in the banner does not carry the published label.${context()}`,
    ).toContain(MASKED_EMAIL_LABEL)

    const delimited = observed.truncated.textNodes.filter(
      (text) => text.includes(MASKED_MARKER_DELIMITER),
    )
    expect(
      delimited,
      'a masked-marker delimiter reached a text node a person reads, in the TRUNCATED state. This '
      + 'is the exact leak WINDOWS #287 was opened about: the banner painting a producer string '
      + `without the chip seam, or the truncation cutting a marker apart.${context()}`,
    ).toEqual([])

    const raw = observed.truncated.textNodes.filter((text) => placeholderRe().test(text))
    expect(
      raw,
      `a raw masking placeholder reached a text node in the TRUNCATED state.${context()}`,
    ).toEqual([])

    expect(
      observed.truncated.bodyText.includes(POPULATED_EMAIL),
      `the planted address is VISIBLE on the page — the email lane is not masked.${context()}`,
    ).toBe(false)
  })

  it('(3d) full state: the same four facts hold after the banner is expanded', () => {
    const observed = visit()
    expect(
      observed.toggled,
      'the banner rendered no `[data-failure-banner-toggle]`, so the expanded state was never '
      + 'reachable. A summary over the preview budget must offer the toggle; without it the full '
      + `text is unreadable and this claim is unmeasurable.${context()}`,
    ).toBe(true)
    expect(
      observed.full.state,
      `the banner did not reach its full state after the toggle was clicked.${context()}`,
    ).toBe('full')

    expect(
      observed.full.maskedCategories,
      'the expanded banner painted no `[data-masked="email"]` chip. The full text is a superset of '
      + `the preview, so a chip present truncated and absent expanded is a render fork.${context()}`,
    ).toContain('email')

    const delimited = observed.full.textNodes.filter(
      (text) => text.includes(MASKED_MARKER_DELIMITER),
    )
    expect(
      delimited,
      'a masked-marker delimiter reached a text node in the FULL state. The expanded banner renders '
      + 'the WHOLE summary; a leak here and not in the preview means only the truncated branch goes '
      + `through the seam.${context()}`,
    ).toEqual([])

    const raw = observed.full.textNodes.filter((text) => placeholderRe().test(text))
    expect(
      raw,
      `a raw masking placeholder reached a text node in the FULL state.${context()}`,
    ).toEqual([])

    expect(
      observed.full.bodyText.includes(POPULATED_EMAIL),
      `the planted address is VISIBLE once the banner is expanded.${context()}`,
    ).toBe(false)
  })

  it('(3e) full state: the masking-seeded credential is restored INSIDE the banner (D-08/D-09)', () => {
    const observed = visit()
    expect(
      observed.full.bannerText.includes(POPULATED_SECRET_VALUE),
      'the real value the run masked into a `<SECRET_n>` placeholder is NOT in the expanded '
      + 'banner. `run.failureSummary` arrives through the `GET /api/runs/:id` arm that crosses '
      + '`unmaskTreeForDisplay`, so the banner sits on the restore lane like every other producer '
      + 'string on this page; an absent value means the summary is being served off a path that '
      + `does not cross the seam, or the seam stopped restoring.${context()}`,
    ).toBe(true)
    // AND IT IS OUTSIDE THE PREVIEW, which is what makes (3c) and (3e) two claims. The fixture puts
    // the credential past the word budget on purpose; if it drifted into the preview, the truncated
    // cell would be asserting about a string that already carries everything.
    expect(
      observed.truncated.bannerText.includes(POPULATED_SECRET_VALUE),
      'the masking-seeded credential is already visible in the TRUNCATED banner, so the preview is '
      + 'not shorter than the full text in the way the fixture\'s word arithmetic says it is. Fix '
      + `the fixture's sentence, not this cell.${context()}`,
    ).toBe(false)
  })

  it('(3f) at rest on a FAILING run: no planted value in the SSE frames, the events log or the database', () => {
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

    // `runs.failure_summary` IS A SINK NO PASSING RUN EVER WROTE, so this scan covers ground the
    // passing-run differential cannot. A red here is a NEW DETL-02 at-rest finding: report the sink
    // and the value. It is not an occasion to narrow the scan.
    for (const [what, value] of [
      ['the masking-seeded credential', POPULATED_SECRET_VALUE],
      ['the declared step secret', POPULATED_DECLARED_SECRET_VALUE],
      ['the planted email address', POPULATED_EMAIL],
    ] as const) {
      expect(
        (recorded.sseFrames ?? '').includes(value),
        `${what} appears IN CLEAR in the run-stream frames of a FAILING run.${context()}`,
      ).toBe(false)
      expect(
        (recorded.eventsLog ?? '').includes(value),
        `${what} appears IN CLEAR in this failing run's events.jsonl.${context()}`,
      ).toBe(false)
      expect(
        (recorded.dbBytes ?? Buffer.alloc(0)).includes(Buffer.from(value, 'utf8')),
        `${what} appears IN CLEAR in the dashboard's own SQLite bytes `
        + `(${recorded.scannedDbFiles.join(', ')}) — `
        + `\`runs.failure_summary\` is the sink a passing run never writes.${context()}`,
      ).toBe(false)
    }
  })
})
