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
// THE CLIPBOARD IS MEASURED HERE TOO, AND ON THE SHIPPED BUNDLE (3g · T-405-43). The copy button
// is a SECOND medium a person reads a redaction in, and until this cell existed the only thing
// asserting it was a jsdom cell nothing had ever taken a fact away from. What it caught the first
// time it ran on real Chromium: with the banner COLLAPSED, the page carried 21 words and the
// clipboard carried 47, including the fixture's restored credential at word 24 — a value the reader
// was never shown, one click away from a bug report. The cell therefore reads the clipboard back
// through `navigator.clipboard.readText()` after clicking copy in the TRUNCATED state, which is why
// this file's browser context is granted `clipboard-read`/`clipboard-write`.
//
// WHAT A RED ON (3f) MEANS, STATED BEFORE ANYONE IS TEMPTED. `runs.failure_summary` is an at-rest
// sink no PASSING run ever writes, so this file's scan covers ground 405-12's cannot. If a planted
// value turns up there, in `events.jsonl` or in an SSE frame, that is a NEW DETL-02 at-rest
// finding: stop and report the sink and the value. It is not an occasion to narrow the scan.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { MASKED_MARKER_DELIMITER, PLACEHOLDER_PATTERN, maskedMarker, slugBranch } from '@vostride/agent-qa-schema'
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
 * One source-level string body as the runtime would see it.
 *
 * JAVASCRIPT'S OWN RULE, WHICH IS THE ONLY ONE THAT MAKES THE READ FAITHFUL: a backslash escapes
 * the character after it, `\n`/`\t`/`\r` and the two unicode forms name characters, and every
 * other escape is the character itself. Without this, a constant whose text merely contains its own
 * quote — the case that made the helper below quote-agnostic — would come back carrying the
 * backslash the source needed and nothing on the page would ever match it.
 */
function unescapeStringBody(body: string): string {
  const named: Record<string, string> = {
    n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0',
  }
  let out = ''
  let index = 0
  while (index < body.length) {
    const char = body[index] as string
    if (char !== '\\' || index + 1 >= body.length) {
      out += char
      index += 1
      continue
    }
    const next = body[index + 1] as string
    const braced = next === 'u' ? /^u\{([0-9a-fA-F]+)\}/u.exec(body.slice(index + 1)) : null
    const quad = next === 'u' ? /^u([0-9a-fA-F]{4})/u.exec(body.slice(index + 1)) : null
    const hex = next === 'x' ? /^x([0-9a-fA-F]{2})/u.exec(body.slice(index + 1)) : null
    const escape = braced ?? quad ?? hex
    if (escape !== null) {
      out += String.fromCodePoint(Number.parseInt(escape[1] as string, 16))
      index += 1 + escape[0].length
      continue
    }
    out += named[next] ?? next
    index += 2
  }
  return out
}

/**
 * A published constant, read out of the module that publishes it.
 *
 * `run-detail-dom.test.ts`'s helper, for its reason: importing a `dashboard-ui` module into a Node
 * test would drag a renderer in, and a hardcoded copy would go on passing against a page that says
 * something else.
 *
 * EITHER QUOTE STYLE, AND THE STYLE IS NOT THE CONSTANT'S BUSINESS (WINDOWS #297). This read used
 * to accept single quotes only, so `MASKED_SECRET_LABEL` — which is DOUBLE-quoted because its text
 * carries an apostrophe — could not be read at all, and the one cell that needed the secret chip's
 * published label had to hardcode it, which is the green-for-the-wrong-reason this whole file
 * exists to prevent. Worse in the other direction: a Prettier or ESLint quote-style change to
 * `run-detail-view.ts` turned the WORKING email read into a `beforeAll` throw that red all six
 * cells at once, for a formatting reason. The body is matched to the MATCHING quote across escaped
 * pairs, so a `\'` inside a single-quoted constant does not end it early.
 *
 * A TEMPLATE LITERAL IS STILL REFUSED, deliberately: its body can interpolate, and a helper that
 * returned the source text of `${...}` would be publishing a string nothing renders.
 */
function publishedConstant(relativePath: string, name: string): string {
  const source = readFileSync(join(PACKAGES_ROOT, 'dashboard-ui', 'src', relativePath), 'utf8')
  const entry = new RegExp(
    `export const ${name}(?::\\s*string)?\\s*=\\s*(['"])((?:\\\\.|[^\\\\])*?)\\1`,
    'u',
  ).exec(source)
  if (entry === null) {
    throw new Error(
      `${name} is no longer a single- or double-quoted top-level constant in ${relativePath}`,
    )
  }
  return unescapeStringBody(entry[2] as string)
}

const MASKED_EMAIL_LABEL = publishedConstant('lib/run-detail-view.ts', 'MASKED_EMAIL_LABEL')

/**
 * The chip a `SECRET` placeholder this host cannot restore paints, read by CONSTANT at last.
 *
 * This is the read WINDOWS #297 blocked. It is a redaction spelling like the email label, so it
 * joins the set `normaliseRedactions` collapses below — the fixture's own credential IS restored,
 * so no secret chip appears on this page today, and the point of reading it by constant rather than
 * typing it is that the day one does, both media are compared on the label the page actually shows.
 */
const MASKED_SECRET_LABEL = publishedConstant('lib/run-detail-view.ts', 'MASKED_SECRET_LABEL')

// ── THE HELPER'S OWN CELL (WINDOWS #297). It is outside the drive's `describe` deliberately: it
// reads one source file and nothing else, so it must not pull a spawned binary, a browser and a
// real run in behind it. A helper whose failure mode is "throws in `beforeAll` and reds every cell
// in the file at once" is worth three cells of its own.
describe('publishedConstant reads a constant whatever quotes it carries (WINDOWS #297)', () => {
  it('publishedConstant reads the DOUBLE-quoted secret label with its apostrophe intact', () => {
    expect(MASKED_SECRET_LABEL).toContain("host's")
    expect(MASKED_SECRET_LABEL.startsWith('masked secret')).toBe(true)
    // The body is the RUNTIME string, not the source text: no backslash survives the read.
    expect(MASKED_SECRET_LABEL).not.toContain('\\')
  })

  it('publishedConstant still reads the SINGLE-quoted email label, unchanged', () => {
    expect(MASKED_EMAIL_LABEL).toBe('masked email')
  })

  it('publishedConstant refuses a name it cannot find rather than answering an empty string', () => {
    expect(() => publishedConstant('lib/run-detail-view.ts', 'NOT_A_PUBLISHED_CONSTANT'))
      .toThrow(/single- or double-quoted/u)
  })
})

/** A fresh, non-global copy of the placeholder pattern — `PLACEHOLDER_PATTERN` carries `lastIndex`. */
const placeholderRe = (): RegExp => new RegExp(PLACEHOLDER_PATTERN.source, 'u')

/** What a redaction collapses to on both sides of (3g)'s comparison. Not a producible string. */
const REDACTION_SENTINEL = '<<REDACTION>>'

/**
 * One string with every SPELLING of a redaction collapsed to a single sentinel.
 *
 * (3g) COMPARES TWO MEDIA THAT SPELL THE SAME REDACTION DIFFERENTLY BY DESIGN: the page paints a
 * marker as a CHIP whose text is the published label, and the clipboard writes the same label in
 * BRACKETS, because a bracket-less label in a pasted sentence would read as the producer's own
 * words. Comparing the raw strings would therefore red on the difference the design asks for.
 *
 * IT IS ALSO WHAT KEEPS (3g) A SINGLE-FACT CELL. Mutation leg M4 replaces the banner's `MaskedText`
 * render with the raw string, so the page then carries the MARKER where it used to carry a chip —
 * and (3g) has no business moving under a mutation of the chip painting, which is (3c)/(3d)'s fact.
 * Collapsing the marker spelling too leaves exactly one thing for this cell to lose: whether the
 * clipboard carries the same WORDS the page did.
 *
 * The labels are read off the page's own chips rather than typed here, plus BOTH published labels,
 * each read by constant. `MASKED_SECRET_LABEL` is double-quoted at `lib/run-detail-view.ts` (it
 * contains an apostrophe) and `publishedConstant` could once read only single-quoted constants;
 * that was WR-11 / WINDOWS #297 and it is fixed above, so the chip texts are no longer the only
 * source available to this cell.
 */
function normaliseRedactions(text: string, labels: readonly string[]): string {
  const spellings = [
    ...new Set(
      [...labels, MASKED_EMAIL_LABEL, MASKED_SECRET_LABEL].filter((label) => label !== ''),
    ),
  ]
  let out = text
  // The BRACKETED form first, whole: a bare-label pass run first would leave the brackets behind.
  for (const label of spellings) out = out.split(`[${label}]`).join(REDACTION_SENTINEL)
  for (const label of spellings) out = out.split(label).join(REDACTION_SENTINEL)
  for (const category of ['secret', 'email'] as const) {
    out = out.split(maskedMarker(category)).join(REDACTION_SENTINEL)
  }
  return out
}

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
  /**
   * `[data-failure-banner-text]`'s `textContent` — the SENTENCE, without the buttons around it.
   *
   * (3g) compares the clipboard against THIS rather than against `bannerText`, because the live
   * region that announces a completed copy is inside the banner and would otherwise become part of
   * the string the copy of the page is measured against.
   */
  readonly renderedText: string
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
  /**
   * Whether a `[data-failure-banner-toggle]` was present AND its click RESOLVED.
   *
   * BOTH HALVES, BECAUSE THE FLAG IS A CELL'S DIAGNOSIS (WINDOWS #293). It was set unconditionally
   * on the line after a click whose rejection was swallowed, so an element that existed and could
   * not be clicked — detached, obscured, timed out — reported `true`, and cell (3d) then red one
   * assertion later with a message naming the wrong cause on the slowest suite in the repository.
   */
  readonly toggled: boolean
  /** Why the toggle click did not resolve, when it did not. Recorded, never thrown. */
  readonly toggleFailure?: string
  /** What `navigator.clipboard.readText()` answered after copy was clicked while COLLAPSED. */
  readonly clipboard?: string
  /** Why the clipboard could not be measured, when it could not. Recorded, never thrown. */
  readonly clipboardFailure?: string
  /** `data-failure-banner-state` as it read at the moment copy was clicked — (3g)'s precondition. */
  readonly clipboardCopiedState?: string
  /** `data-copy-status` after the wait, so a refused write names itself instead of timing out mutely. */
  readonly clipboardCopyStatus?: string
  readonly truncated: BannerState
  readonly full: BannerState
  /** Every response this page received. */
  readonly responses: readonly RecordedResponse[]
  /** What the failure view says about circularity on THIS run (422 D-17/D-19/D-20). */
  readonly circularity: CircularityObservation
}

/**
 * The circularity half of the same visit, harvested from the same page (422 D-17/D-19/D-20).
 *
 * IT IS RECORDED ON BOTH SIDES OF THE SEAM ON PURPOSE. `analysisBody` is what the shipped binary
 * put on the wire and `states` is what the shipped bundle painted from it, and (3h)'s whole claim
 * is that the two agree on an ABSENCE: this run's arbiter never ran, so `analysis.get` carries no
 * `misdirection` member and the page paints no circularity element. A DOM-only cell would pass
 * just as happily against a page that received the member and silently dropped it.
 */
interface CircularityObservation {
  /** How many verdict blocks painted. Zero would make the absence claim below vacuous. */
  readonly verdictBlocks: number
  /** Every `data-misdirection` word on the page, in document order. */
  readonly states: readonly string[]
  /** Every causal record chip the page named. */
  readonly causalRecords: readonly string[]
  /** Every exposed on-path record chip the page named. */
  readonly onPathRecords: readonly string[]
  /** `GET /api/runs/:id/analysis`'s body, bounded — the wire half of the claim. */
  readonly analysisBody?: string
  /** Why the verdict block never attached, when it never did. Recorded, never thrown. */
  readonly waitFailure?: string
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
    + `toggle failure: ${observed?.toggleFailure ?? '(none)'}; `
    + `full state: ${observed?.full.state ?? '(no banner)'}`,
    `banner text (truncated): ${JSON.stringify((observed?.truncated.bannerText ?? '').slice(0, 400))}`,
    `banner text (full): ${JSON.stringify((observed?.full.bannerText ?? '').slice(0, 800))}`,
    `banner chips (truncated): ${(observed?.truncated.maskedCategories ?? []).join(', ') || '(none)'}; `
    + `(full): ${(observed?.full.maskedCategories ?? []).join(', ') || '(none)'}`,
    `clipboard: state at copy: ${observed?.clipboardCopiedState ?? '(never clicked)'}; `
    + `copy status: ${observed?.clipboardCopyStatus ?? '(none)'}; `
    + `failure: ${observed?.clipboardFailure ?? '(none)'}`,
    `clipboard text: ${JSON.stringify((observed?.clipboard ?? '').slice(0, 800))}`,
    `rendered text (truncated): ${JSON.stringify((observed?.truncated.renderedText ?? '').slice(0, 800))}`,
    `page api traffic: ${
      (observed?.responses ?? [])
        .filter((response) => response.url.includes('/api/'))
        .map((response) =>
          `${String(response.status)} ${response.url.replace(/^https?:\/\/[^/]+/u, '')}`
          + (response.refusalBody === undefined ? '' : ` -> ${response.refusalBody}`))
        .join(' | ') || '(none)'
    }`,
    `circularity: verdict blocks: ${String(observed?.circularity.verdictBlocks ?? 0)}; `
    + `states: ${(observed?.circularity.states ?? []).join(', ') || '(none)'}; `
    + `causal: ${(observed?.circularity.causalRecords ?? []).join(', ') || '(none)'}; `
    + `on-path: ${(observed?.circularity.onPathRecords ?? []).join(', ') || '(none)'}; `
    + `wait failure: ${observed?.circularity.waitFailure?.split('\n')[0] ?? '(none)'}`,
    `analysis body: ${JSON.stringify((observed?.circularity.analysisBody ?? '').slice(0, 900))}`,
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
      renderedText: (banner?.querySelector('[data-failure-banner-text]')?.textContent ?? ''),
      maskedCategories: masked.map((element) => element.getAttribute('data-masked') ?? '?'),
      maskedChipText: masked.map((element) => (element.textContent ?? '').trim()),
      textNodes: nodes,
      bodyText: document.body.innerText,
    }
  })
}

/** How long the copy button has to reach `data-copy-status="copied"` before (3g) gives up. */
const CLIPBOARD_BUDGET_MS = 15_000

/**
 * Open one failed run's detail page, harvest the banner in BOTH of its states, and read the
 * clipboard the copy button writes while the banner is still COLLAPSED.
 *
 * THE TOGGLE IS CLICKED, NOT SIMULATED. The expanded state is what a person gets by pressing the
 * chevron, and the claim these cells make is about what the shipped bundle renders when they do.
 *
 * THE COPY IS CLICKED BEFORE THE TOGGLE AND THE ORDER IS THE MEASUREMENT. (3g)'s whole subject is
 * what leaves a COLLAPSED banner; a copy taken after the expand would be measuring the state the
 * defect was already correct in. The state attribute is re-read at the moment of the click and
 * recorded, so the cell asserts its own precondition rather than assuming it.
 */
async function observeFailureBanner(
  context_: BrowserContext,
  origin: string,
  runId: string,
): Promise<PageObservation> {
  const page: Page = await context_.newPage()
  let waitFailure: string | undefined
  let toggled = false
  let toggleFailure: string | undefined
  const responses: RecordedResponse[] = []
  const pendingBodies: Promise<void>[] = []
  let analysisBody: string | undefined
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
    // THE ANALYSIS BODY, ON A 200 — the wire half of (3h). It is read here rather than re-fetched
    // because a second request is a second answer, and the claim is about the bytes THIS page got.
    if (record.status === 200 && /\/api\/runs\/[^/]+\/analysis$/u.test(record.url)) {
      pendingBodies.push(
        response.text().then(
          (body) => { analysisBody = body.slice(0, 20_000) },
          () => { analysisBody = '(body unreadable)' },
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

    // THE CLIPBOARD, WHILE THE BANNER IS STILL COLLAPSED (3g).
    //
    // THE WRITE IS A PROMISE AND THE READ RACES IT, so the wait is on the button's own
    // `data-copy-status`, which the component sets to `copied` only after `writeText` RESOLVES —
    // not on a sleep, and not on the icon. When the write is refused (an unfocused document is the
    // usual reason) the attribute reads `failed` instead, and that word is what the recorded
    // failure carries, so a red names the cause rather than reporting a mute timeout.
    let clipboard: string | undefined
    let clipboardFailure: string | undefined
    let clipboardCopiedState: string | undefined
    let clipboardCopyStatus: string | undefined
    const copy = page.locator('[data-failure-banner-copy]')
    if ((await copy.count()) === 0) {
      clipboardFailure = 'the banner rendered no `[data-failure-banner-copy]` button to click'
    } else {
      clipboardFailure = await copy.first().click().then(
        () => undefined,
        (error: unknown) =>
          `the copy button could not be clicked: ${
            error instanceof Error ? error.message : String(error)}`,
      )
      clipboardCopiedState = (await page.locator('[data-failure-banner]')
        .getAttribute('data-failure-banner-state')) ?? undefined
      if (clipboardFailure === undefined) {
        const settled = await page
          .locator('[data-failure-banner-copy][data-copy-status="copied"]')
          .waitFor({ state: 'attached', timeout: CLIPBOARD_BUDGET_MS })
          .then(() => true, () => false)
        clipboardCopyStatus = (await copy.first().getAttribute('data-copy-status')) ?? undefined
        if (!settled) {
          clipboardFailure =
            'the copy button never reported a resolved write — `data-copy-status` last read '
            + `\`${clipboardCopyStatus ?? '(absent)'}\`. \`failed\` means the browser refused `
            + '`navigator.clipboard.writeText`, which is what an unfocused document or an ungranted '
            + '`clipboard-write` permission looks like.'
        } else {
          const read = await page.evaluate(async () => await navigator.clipboard.readText()).then(
            (text) => ({ text }),
            (error: unknown) => ({
              error: error instanceof Error ? error.message : String(error),
            }),
          )
          if ('error' in read) {
            clipboardFailure = `\`navigator.clipboard.readText()\` refused: ${read.error}`
          } else {
            clipboard = read.text
          }
        }
      }
    }

    // THE FLAG RECORDS THE CLICK'S OUTCOME, NOT ITS ATTEMPT (WINDOWS #293). `toggled = true` used
    // to sit unconditionally after a `.catch(() => undefined)`, so a click that threw still
    // reported success and (3d) blamed a missing element for a click that failed on a present one.
    const toggle = page.locator('[data-failure-banner-toggle]')
    if ((await toggle.count()) > 0) {
      toggleFailure = await toggle.first().click().then(
        () => undefined,
        (error: unknown) =>
          `the toggle was present but the click did not resolve: ${
            error instanceof Error ? error.message : String(error)}`,
      )
      toggled = toggleFailure === undefined
      await page.locator('[data-failure-banner-state="full"]')
        .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
        .catch(() => undefined)
    }
    const full = await harvestBanner(page)

    // THE FAILURE VIEW'S OWN BLOCK (422). The wait is on the verdict block rather than on a
    // circularity element, because the fact being measured is that NO circularity element exists:
    // waiting for one would time out on the healthy case and record nothing about the block.
    let circularityWaitFailure: string | undefined
    await page.locator('[data-verdict-block]')
      .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
      .catch((error: unknown) => {
        circularityWaitFailure = error instanceof Error ? error.message : String(error)
      })
    const painted = await page.evaluate(() => {
      const read = (selector: string, attribute: string) =>
        Array.from(document.querySelectorAll(selector))
          .map((element) => element.getAttribute(attribute) ?? '?')
      return {
        verdictBlocks: document.querySelectorAll('[data-verdict-block]').length,
        states: read('[data-misdirection]', 'data-misdirection'),
        causalRecords: read('[data-misdirection-causal-record]', 'data-misdirection-causal-record'),
        onPathRecords: read('[data-misdirection-on-path-record]', 'data-misdirection-on-path-record'),
      }
    })

    // Every refusal body read before the observation is handed back, so the record is complete.
    await Promise.all(pendingBodies)

    return {
      circularity: {
        ...painted,
        ...(analysisBody === undefined ? {} : { analysisBody }),
        ...(circularityWaitFailure === undefined ? {} : { waitFailure: circularityWaitFailure }),
      },
      finalUrl: page.url(),
      ...(waitFailure === undefined ? {} : { waitFailure }),
      toggled,
      ...(toggleFailure === undefined ? {} : { toggleFailure }),
      ...(clipboard === undefined ? {} : { clipboard }),
      ...(clipboardFailure === undefined ? {} : { clipboardFailure }),
      ...(clipboardCopiedState === undefined ? {} : { clipboardCopiedState }),
      ...(clipboardCopyStatus === undefined ? {} : { clipboardCopyStatus }),
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

      // `clipboard-read`/`clipboard-write` ARE GRANTED ON THE CONTEXT because (3g) reads back what
      // the copy button wrote. Without them Chromium refuses `writeText` in the page and the cell
      // would red on a permission rather than on the fact it is measuring.
      const visitContext = await browser.newContext({
        permissions: ['clipboard-read', 'clipboard-write'],
      })
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

    // AND THE ATTRIBUTE IS CHECKED AGAINST THE TEXT, because an attribute is only worth reading if
    // it can disagree with what is on the page. `data-failure-banner-state` was once derived from
    // the toggle's `useState(false)` alone, which made `truncated` a compile-time constant on
    // mount: this cell would have gone on passing with the truncation deleted outright. The two
    // assertions below are the fact the sentence above claims — the preview really is SHORTER than
    // the full text, and it really was cut — and mutation leg M6 (`truncateMaskedText` returns its
    // input unchanged) is the measurement that this cell can lose them.
    expect(
      observed.truncated.bannerText.length,
      'the truncated banner is not shorter than the expanded one, so no truncation happened. The '
      + 'fixture\'s summary is over the preview budget by construction; equal lengths mean the '
      + `preview is the whole sentence and the two banner states are one claim.${context()}`,
    ).toBeLessThan(observed.full.bannerText.length)
    expect(
      observed.truncated.bannerText,
      'the truncated banner carries no ellipsis, which `truncateMaskedText` appends if and only if '
      + `it cut something — so the preview was never over the budget.${context()}`,
    ).toContain('...')
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
      'the expanded state was never reached: either the banner rendered no '
      + '`[data-failure-banner-toggle]`, or one was present and the click on it did not resolve — '
      + '`toggle failure` in the block below names which. A summary over the preview budget must '
      + `offer the toggle; without it the full text is unreadable and this claim is unmeasurable.${
        context()}`,
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

  it('(3g) the clipboard carries ONLY what the collapsed banner rendered (T-405-43)', () => {
    const observed = visit()
    expect(
      observed.clipboardFailure,
      `the clipboard could not be measured at all, so this cell asserts nothing.${context()}`,
    ).toBeUndefined()

    // THE PRECONDITION IS ASSERTED, NOT ASSUMED. This cell's whole subject is what leaves a
    // COLLAPSED banner; measured from an expanded one it would be asserting a tautology.
    expect(
      observed.clipboardCopiedState,
      'the copy button was clicked while the banner was NOT collapsed, so what this cell read is '
      + `not the fact it names.${context()}`,
    ).toBe('truncated')

    const clipboard = observed.clipboard ?? ''
    expect(
      clipboard,
      `the copy button reported a resolved write and the clipboard is EMPTY.${context()}`,
    ).not.toBe('')

    // THE FACT. The display seam restores `<SECRET_n>` for the human reading the page, and the
    // fixture plants the restored value at word 23 — three words past the preview budget, so it is
    // NOT on a collapsed page. It was on the clipboard anyway: `copyTextOf` was handed the whole
    // summary regardless of state, and one click on a banner that never showed the credential put
    // 47 words on the clipboard against 21 on the page. A pasted bug report is read by exactly the
    // people a redaction is kept from, restored or not.
    expect(
      clipboard.includes(POPULATED_SECRET_VALUE),
      'the RESTORED credential is on the clipboard, copied from a COLLAPSED banner that never '
      + 'showed it. The clipboard is a second medium a person reads: it carries what was RENDERED '
      + `and nothing else.${context()}`,
    ).toBe(false)
    expect(
      clipboard.includes(POPULATED_EMAIL),
      `the planted address is on the clipboard in the clear.${context()}`,
    ).toBe(false)
    expect(
      clipboard.includes(MASKED_MARKER_DELIMITER),
      'a masked-marker delimiter is on the clipboard — the copy path is writing the seam\'s '
      + `marker-bearing string rather than the published label its chip shows.${context()}`,
    ).toBe(false)
    expect(
      placeholderRe().test(clipboard),
      `a raw masking placeholder is on the clipboard.${context()}`,
    ).toBe(false)

    // AND IT IS THE RENDERED SENTENCE, WORD FOR WORD — the containment above cannot see a copy that
    // carries three EXTRA words none of which happened to be planted. Both sides are normalised so
    // that the two media's different spellings of the same redaction (a chip's bare label on the
    // page, the same label in brackets on the clipboard, the marker itself under mutation M4) do
    // not read as a difference; what is left to compare is the WORDS.
    const labels = observed.truncated.maskedChipText
    expect(
      normaliseRedactions(clipboard, labels),
      'the clipboard is not the sentence the collapsed banner rendered. A copy that carries more '
      + 'than the page did is the defect this cell exists for; a copy that carries LESS would mean '
      + `the copy path is truncating a second time.${context()}`,
    ).toBe(normaliseRedactions(observed.truncated.renderedText, labels))
  })

  // ── 422 D-17/D-19/D-20: THE CIRCULARITY EVIDENCE, ON THE RUN THIS FILE ACTUALLY DRIVES.
  //
  // THIS RUN'S ARBITER NEVER RAN. The fixture spends no provider call on a cross-check, publishes
  // no `misdirection-*` sidecar and writes no verdict ledger, so `analysis.get` must carry NO
  // `misdirection` member and the failure view must paint no circularity element. That is the
  // ADDITIVE claim of the whole plan, and it is the one claim only this file can make: everything
  // else about the evidence is measured against fixtures, and a fixture cannot prove that the
  // shipped binary and the shipped bundle leave an untouched run untouched.
  //
  // BOTH SIDES OF THE SEAM ARE ASSERTED. A DOM-only cell would pass just as happily against a page
  // that received the member and dropped it on the floor, and a wire-only cell would pass against a
  // bundle that invented a "not recorded" badge under every historical failure. And the block count
  // is asserted first, because an absence measured on a page with no blocks is an absence of
  // nothing.
  it('(3h) a run whose arbiter never ran carries no circularity member and paints no badge', () => {
    const observed = visit()
    expect(
      observed.circularity.waitFailure,
      'no `[data-verdict-block]` ever attached, so the absence below is an absence of nothing. '
      + 'The failure view paints a block for every member `analysis.get` answers a verdict for, '
      + `and this run failed one.${context()}`,
    ).toBeUndefined()
    expect(
      observed.circularity.verdictBlocks,
      `the page painted no verdict block for a run with a failed member.${context()}`,
    ).toBeGreaterThan(0)

    const body = observed.circularity.analysisBody
    expect(
      body,
      `the page never received a 200 from \`/api/runs/:id/analysis\`.${context()}`,
    ).toBeDefined()
    const analysis = JSON.parse(body as string) as {
      verdicts?: { misdirection?: unknown }[]
    }
    expect(
      (analysis.verdicts ?? []).length,
      `the analysis answered no verdicts at all, so the wire claim below is vacuous.${context()}`,
    ).toBeGreaterThan(0)
    expect(
      (analysis.verdicts ?? []).filter((verdict) => 'misdirection' in verdict).length,
      'a verdict carries a `misdirection` member on a run whose arbiter never ran. ABSENT and '
      + 'EMPTY are two facts here: a `{ state: "not-recorded" }` on every historical verdict is a '
      + `claim the producer never made.${context()}`,
    ).toBe(0)

    expect(
      observed.circularity.states,
      'the shipped bundle painted a circularity badge over evidence that was never produced. '
      + 'This is the exact misstatement 422-17 refused on the CLI line and #427 makes live: a '
      + `reader would conclude something was ruled out.${context()}`,
    ).toEqual([])
    expect(
      observed.circularity.causalRecords,
      `a memory record is attributed as causal on a run that cross-checked nothing.${context()}`,
    ).toEqual([])
    expect(
      observed.circularity.onPathRecords,
      `an on-path record is named on a run whose verdict declared none.${context()}`,
    ).toEqual([])
  })
})

// ── THE TWO RECORD ROWS ARE TWO DIFFERENT NAMES (422 D-20). Source-level and outside the drive,
// for `publishedConstant`'s reason: it reads two files and nothing else, so it must not pull a
// spawned binary, a browser and a real run in behind it.
//
// WHY A CELL AT ALL. The causal row names the records whose cross-check FLIPPED and the exposure
// row names every low-trust record the run put on the member's path; a refactor that hoisted them
// onto one attribute would still render two lists, still pass every count assertion in the
// dashboard suites, and would attribute a member's failure to a record whose check HELD. The wall
// is the NAMES, because the names are what every cell that tells the rows apart addresses.
describe('the failure view keeps causal and exposed memory records apart (422 D-20)', () => {
  const VERDICT_BLOCK = readFileSync(
    join(PACKAGES_ROOT, 'dashboard-ui', 'src', 'components', 'run-detail', 'verdict-block.tsx'),
    'utf8',
  )

  it('renders the causal row and the exposure row under two distinct attribute names', () => {
    // Read out of the SOURCE rather than typed as a pair of literals: a literal comparison is a
    // tautology the compiler resolves, and what is being walled is the file's own text.
    const names = [...new Set(
      [...VERDICT_BLOCK.matchAll(/data-misdirection-[a-z-]+/gu)].map((match) => match[0]),
    )].sort()
    expect(
      names.includes('data-misdirection-causal-record'),
      'the causal row lost its own attribute name',
    ).toBe(true)
    expect(
      names.includes('data-misdirection-on-path-record'),
      'the exposure row lost its own attribute name',
    ).toBe(true)
    expect(
      names.filter((name) => name.endsWith('-record')).length,
      'the two record rows collapsed onto one name — a record whose check HELD would then be '
      + 'rendered as the cause of the failure',
    ).toBe(2)
  })

  it('publishes every circularity sentence as a constant, so no copy is typed at a render site', () => {
    // The block's own law, applied to the 422 copy: a sentence lives in `lib/analysis-view.ts` and
    // the component reads it. A literal here would drift from what the cells assert.
    for (const name of [
      'MISDIRECTION_NOT_RECORDED_TEXT',
      'MISDIRECTION_HELD_TEXT',
      'MISDIRECTION_UNRESOLVED_TEXT',
      'MISDIRECTION_DECLARED_ONLY_TEXT',
      'MEMORY_ON_PATH_NOT_RECORDED_TEXT',
      'MEMORY_ON_PATH_NONE_TEXT',
    ]) {
      expect(publishedConstant('lib/analysis-view.ts', name).length).toBeGreaterThan(0)
    }
    // AND THE ONE WORD THE CLI ALREADY OWNS IS SPELLED THE SAME WAY (422-17). `post-run-tail.ts`
    // renders `circularity guard: declared-only` for the backing an operator actually got; two
    // surfaces describing one run in two vocabularies is worse than either being absent.
    expect(publishedConstant('lib/analysis-view.ts', 'MISDIRECTION_DECLARED_ONLY_TEXT'))
      .toContain('declared-only')
    expect(publishedConstant('lib/analysis-view.ts', 'MISDIRECTION_NOT_RECORDED_TEXT'))
      .toContain('not recorded')
  })
})
