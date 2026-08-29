/// <reference lib="dom" />
// The DOM lib is referenced HERE because this file's `page.evaluate` callbacks are compiled as
// TypeScript and EXECUTED in a browser — `run-detail-dom.test.ts`'s reasoning, unchanged.

// THE KNOWLEDGE TAB AND THE RUNG BANNER, IN THE MEDIUM A PERSON LOOKS AT (Phase 407 plan 11 ·
// LERN-01 / LERN-02 / TRST-01, D-01 / D-02 / D-03 / D-04 / D-13 / D-14 / D-15).
//
// WHAT THIS FILE IS FOR. 407-02 through 407-10 each proved one leg with jsdom and unit cells: the
// op projects, the route serves, the view module folds the copy, the component paints the
// attribute. This file is the phase's acceptance on the artifact a person installs — it drives the
// BUILT dashboard bundle served by the SHIPPED `agent-qa dashboard`, over a real socket, in a real
// headless Chromium, against runs the binary really executed, and asserts on what the browser drew
// and on what the browser's own `/api/runs/:id/knowledge` response said.
//
// PAGE ↔ OP PARITY RATHER THAN A HOST ASSUMPTION. Every claim about the rung banner is stated
// against the projection THIS PAGE FETCHED, not against a rung this file believes a CI host would
// reach. A machine's embedder ladder is not a fixed point: the same commit answers `memidex` on a
// laptop with a downloaded model and `lexical-only` on a runner without one, and a cell pinning
// either word would be measuring the machine. The ONE deterministic rung here is fixture (A)'s,
// and it is deterministic for a structural reason rather than a hopeful one — the populated
// fixture ships an EMPTY `agent-qa-knowledge` directory with no index, the fold reads the index
// axis FIRST, and `scan` folds to `bundle-scan` / `index-unavailable` whatever the embedder did.
// If a future fixture change adds an index, (a1)/(a2) must switch to the parity form (b3) uses.
//
// A BROWSER THAT CANNOT LAUNCH IS A RED, NEVER A SKIP — `run-detail-dom.test.ts`'s law. The one
// conditional in this file is `describePosix`, and it exists because the dashboard child is
// stopped with SIGTERM and the runs write POSIX runtime roots.
//
// THE DRIVING HAPPENS ONCE PER FIXTURE, IN `beforeAll`, AND THE CELLS ASSERT ON WHAT IT RECORDED.
// Two fixtures, because the two halves of LERN-01 need two different worlds:
//
//   (A) `knowledge-tab-dom-scan` — the populated fixture UNCHANGED. Empty knowledge root, no
//       index, so retrieval serves nothing and the rung is the deterministic `bundle-scan`. This
//       is where the banner's sentence of record, the empty Used half, the `m` shortcut, the
//       deleted memory tab and the `curation` chip click-through are measured.
//
//   (B) `knowledge-tab-dom-served` — the same fixture with ONE published bundle at the run's own
//       product scope and a rebuilt index, seeded BEFORE the binary is spawned. This is the only
//       world in which a served channel-1 line and its serve-time why-trace exist to be looked at,
//       and a served line is the LERN-01 claim.
//
// EVERY SENTENCE IS READ OUT OF THE MODULE THAT PUBLISHES IT. `packages/cli` cannot import a React
// package's lib (dashboard-ui ships built app assets, not a library entry), so the copy tables are
// EXTRACTED from `dashboard-ui/src/lib/knowledge-view.ts` as source text — `run-detail-dom.test.ts`
// and `post-processing-dom.test.ts`'s `publishedConstant` idiom, widened to a `Record` literal.
// A hardcoded copy would go on passing against a page that says something else.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  publishBundleForTest,
  rebuildIndex,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '@vostride/agent-qa-knowledge-local'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import {
  BundleOutcomeEventSchema,
  RunKnowledgeProjectionSchema,
  asEvidenceToken,
  type BundleDiscriminant,
  type BundleDraft,
  type DistilledObservation,
  type RunKnowledgeProjection,
} from '@vostride/agent-qa-schema'
import { chromium } from 'playwright-core'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  POPULATED_RUN_ANCHORED_BUILDS,
  POPULATED_TARGET_NAME,
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

const describePosix = process.platform === 'win32' ? describe.skip : describe

const REBUILD_INSTRUCTION =
  'these cells drive the BUILT dashboard UI served by the BUILT `agent-qa dashboard` and the built '
  + 'packages it resolves as external workspace dependencies: run `pnpm turbo run build --force` '
  + 'from the agent-qa root first. `--force` is required — a mutation script that restores its '
  + 'subject byte-identically is a turbo cache hit, so a plain build reports FULL TURBO and '
  + 'refreshes no dist mtime.'

const BROWSER_INSTALL_INSTRUCTION =
  'these cells drive the BUILT dashboard UI in a real Chromium, against runs the shipped binary '
  + 'really executed: run `pnpm exec playwright install chromium` and re-run. THEY MUST NOT BE '
  + 'SKIPPED WHEN THE BROWSER IS ABSENT — they are the only cells in this repository that measure '
  + "the Knowledge tab and the retrieval-rung banner on the artifact a person installs."

/** How long the page has to mount, paint the tree and settle the tab. */
const PAGE_BUDGET_MS = 60_000

// ── The published copy, read out of the module that publishes it ─────────────────────────────────

const KNOWLEDGE_VIEW_REL = join('lib', 'knowledge-view.ts')

function knowledgeViewSource(): string {
  return readFileSync(join(PACKAGES_ROOT, 'dashboard-ui', 'src', KNOWLEDGE_VIEW_REL), 'utf8')
}

/** A top-level single-quoted `export const` — `run-detail-dom.test.ts`'s `publishedConstant`. */
function publishedConstant(name: string): string {
  const entry = new RegExp(`export const ${name}(?::\\s*string)?\\s*=\\s*'([^']*)'`, 'u')
    .exec(knowledgeViewSource())
  if (entry === null) {
    throw new Error(`${name} is no longer a single-quoted top-level constant in ${KNOWLEDGE_VIEW_REL}`)
  }
  return entry[1] as string
}

/**
 * An exported `Record` literal of single-quoted key/value pairs, as a map.
 *
 * The same extraction `post-processing-dom.test.ts` uses for one member, taken whole: these two
 * tables are the banner's entire vocabulary and the cells below compose the sentence from them
 * rather than retyping it.
 */
function publishedLabelTable(name: string): Record<string, string> {
  const block = new RegExp(`export const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\}`, 'u')
    .exec(knowledgeViewSource())
  if (block === null) {
    throw new Error(`${name} is no longer an exported object literal in ${KNOWLEDGE_VIEW_REL}`)
  }
  const table: Record<string, string> = {}
  for (const line of (block[1] as string).split('\n')) {
    const entry = /^\s*'([^']+)':\s*'([^']*)',?\s*$/u.exec(line)
    if (entry !== null) table[entry[1] as string] = entry[2] as string
  }
  if (Object.keys(table).length === 0) {
    throw new Error(`${name} carries no single-quoted members in ${KNOWLEDGE_VIEW_REL}`)
  }
  return table
}

const RUNG_LABELS = publishedLabelTable('RUNG_LABELS')
const RUNG_CAUSE_LABELS = publishedLabelTable('RUNG_CAUSE_LABELS')
const DOCTOR_HINT_TEXT = publishedConstant('DOCTOR_HINT_TEXT')
const NO_BRIEF_LINES_TEXT = publishedConstant('NO_BRIEF_LINES_TEXT')
const NO_BRIEF_SERVED_TEXT = publishedConstant('NO_BRIEF_SERVED_TEXT')
const STEP_NO_BRIEF_TEXT = publishedConstant('STEP_NO_BRIEF_TEXT')
const WHY_TRIGGER_TEXT = publishedConstant('WHY_TRIGGER_TEXT')

/**
 * The banner sentence, composed from the two published tables and the published hint.
 *
 * ONLY THE CONNECTIVE PUNCTUATION IS SPELLED HERE. The three drifty parts — the rung word, the
 * cause word and the door — are read out of `knowledge-view.ts`; the shape is `rungBannerText`'s,
 * at `packages/dashboard-ui/src/lib/knowledge-view.ts:1005`. A label edited on either side reds
 * this cell instead of leaving it asserting a string nothing renders.
 */
function bannerSentence(rung: string, reason: string | undefined): string {
  const label = RUNG_LABELS[rung]
  if (label === undefined) throw new Error(`RUNG_LABELS names no ${rung}`)
  const causeLabel = reason === undefined ? undefined : RUNG_CAUSE_LABELS[reason]
  if (reason !== undefined && causeLabel === undefined) {
    throw new Error(`RUNG_CAUSE_LABELS names no ${reason}`)
  }
  const cause = causeLabel === undefined ? '' : ` — ${causeLabel}`
  return `Retrieval degraded: ${label}${cause}. ${DOCTOR_HINT_TEXT}`
}

/**
 * The why-trace line, composed from the projection's own trace entry.
 *
 * `traceLineText`'s shape (`knowledge-view.ts:193`) with the three numbers taken from the trace
 * the RUN recorded — never typed, which is the whole of D-04's honesty claim: the page must say
 * what the serve-time trace said, not what an index would say if asked again today.
 */
function traceLineText(leg: string, rank: number, score: number): string {
  return `leg ${leg} · rank ${String(rank)} · score ${score.toFixed(3)}`
}

// ── The seeded bundle for fixture (B) ────────────────────────────────────────────────────────────

/**
 * The build ordinal the seeded record is created under.
 *
 * ONE, because a fresh project's first run is ordinal one: `nextBuildOrdinal` reads a missing
 * counter as zero and advances it, and `populatedRunFixtureProject` mints a brand-new temp root
 * per call. The reader admits a record whose `createdAtOrdinal` is not GREATER than the run's
 * `asOfBuild`, so equal is visible — and the lineage window opens at `max(1, asOf - w + 1)`, which
 * is one here, so the confirming event at ordinal one is inside it.
 */
const SEED_ORDINAL = 1

/** The summary the seeded record carries — long enough to be unmistakable in a page's text. */
const SEED_SUMMARY = 'The Acknowledge button dismisses the notice banner on the fixture page.'

/**
 * The bundle seeded at the run's own product scope.
 *
 * COPIED FROM `knowledge-composition.acceptance.test.ts`'s `committedFixtureInput` and adjusted on
 * exactly two axes: the SCOPE key is this fixture's product (`resolveTarget` answers
 * `target.product ?? targetName`, and the populated fixture declares no `product`, so the run's
 * scope key is the target NAME) and the ordinals are the first-run ordinals above. Everything else
 * is the recipe that is already known to publish and to be served.
 */
function seededBundleInput(): PublishBundleInput {
  const draft: BundleDraft = {
    kind: 'fact',
    subtype: 'selector',
    anchors: [
      { t: 'el', role: 'button', name: 'Acknowledge', ordinal: 0 },
      { t: 'page', route: '/' },
      { t: 'selector', literal: '[data-testid="acknowledge"]' },
    ],
    scope: { tier: 'product', key: POPULATED_TARGET_NAME },
    summary: SEED_SUMMARY,
    body: 'The Acknowledge button was resolved and verified on the notice page.',
    distilledEvidenceRef: {
      id: 'knowledge-tab-dom-evidence',
      sha: 'b'.repeat(64),
    },
    originStage: 'run-curation',
  }
  const discriminant: BundleDiscriminant = {
    kind: 'fact',
    subtype: 'selector',
    elementRef: { role: 'button', name: 'Acknowledge' },
  }
  const observation: DistilledObservation = {
    schemaVersion: 1,
    step: { naturalKey: 'acknowledge-click', ordinal: 0 },
    platform: 'web',
    element: { naturalKey: 'button:acknowledge:0' },
    locator: { selector: '[data-testid="acknowledge"]' },
    observedAtOrdinal: SEED_ORDINAL,
  }
  return {
    draft,
    discriminant,
    originClass: 'agent-verified',
    createdAtOrdinal: SEED_ORDINAL,
    screenStates: [],
    initialEvents: [BundleOutcomeEventSchema.parse({
      type: 'confirmed',
      evidenceToken: asEvidenceToken('knowledge-tab-dom-confirmation'),
      curationJobId: 'knowledge-tab-dom-confirmation',
      buildOrdinal: SEED_ORDINAL,
      origin: 'agent-verified',
    })],
    relations: [],
    provenance: {
      mode: 'run-linked',
      runId: 'run-knowledge-tab-dom-seed',
      testId: 'test-knowledge-tab-dom-seed',
      stepIndex: 0,
      curationJobId: 'knowledge-tab-dom-seed',
      sourceBuildOrdinal: SEED_ORDINAL,
    },
    artifacts: [],
    evidenceMarkdown: 'Deterministically observed while acknowledging the notice.\n',
    distilledObservations: [observation],
  }
}

/** Seed one published record into a fixture's knowledge root and rebuild its index. */
async function seedServedRecord(project: {
  readonly root: string
  readonly agentQaRoot: string
}): Promise<{ readonly id: string; readonly outcome: string }> {
  const knowledgeRoot = join(project.root, 'agent-qa-knowledge')
  const storeConfig: BundleStoreConfig = {
    knowledgeRoot,
    productKey: POPULATED_TARGET_NAME,
    auditBaseDir: project.agentQaRoot,
    commitArtifacts: 'none',
    writerLeaseId: 'knowledge-tab-dom-seed',
    policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
  }
  const published = publishBundleForTest(storeConfig, seededBundleInput())
  if (published.kind !== 'published') return { id: '', outcome: published.kind }
  await rebuildIndex({ knowledgeRoot })
  return { id: String(published.id), outcome: 'published' }
}

// ── What one page visit records ──────────────────────────────────────────────────────────────────

/** One served channel-1 line, as the expanded row painted it. */
interface ServedLineObservation {
  readonly recordId: string
  readonly traceState: string
  readonly servedAsCanary: string
  /** The `Why this line?` disclosure's text, after it was opened. Absent when there was none. */
  readonly whyText?: string
}

/** Everything one run-detail visit recorded. */
interface PageObservation {
  readonly finalUrl: string
  readonly waitFailure?: string
  /** How many `[data-step-id]` rows the durable tree drew. */
  readonly treeStepCount: number
  /** `data-rung` on the header banner, or nothing when the header painted no banner. */
  readonly bannerRung?: string
  readonly bannerReason?: string
  readonly bannerText?: string
  /** `data-knowledge-state` after `7`. */
  readonly stateAfter7?: string
  /** The `[data-used-summary]` sentence, as painted. */
  readonly usedSummary?: string
  /** How many `[data-step-index]` rows the Used half drew. */
  readonly knowledgeStepCount: number
  /** Every `data-brief-lines` the Used half stamped, in document order. */
  readonly briefLineCounts: readonly string[]
  /** The muted no-brief sentence, when the first row painted one. */
  readonly firstRowNoBriefText?: string
  /** `data-learned-state` on the Learned half's root, when the half rendered. */
  readonly learnedState?: string
  /** The channel-1 lines of the first row the drive expanded. */
  readonly servedLines: readonly ServedLineObservation[]
  /** `data-knowledge-state` after `1` — absent is the tab having been left. */
  readonly stateAfterOverview?: string
  /** `data-knowledge-state` after `m` (D-02's re-pointed shortcut). */
  readonly stateAfterM?: string
  /** Every tab trigger label inside the artifact drawer, in document order (D-02's deletion). */
  readonly drawerTabLabels: readonly string[]
  /** The `curation` chip's own tag name, lower-cased. `button` is the D-01 click-through. */
  readonly curationChipTag?: string
  /** `data-knowledge-state` after the `curation` chip was pressed. */
  readonly stateAfterChip?: string
  readonly bodyText: string
}

/** Everything one fixture's drive measured, or the reason it could not. */
interface Recorded {
  drive?: PopulatedRunDrive
  projection?: RunKnowledgeProjection
  projectionStatus?: number
  projectionBody?: string
  visit?: PageObservation
  seed?: { readonly id: string; readonly outcome: string }
  dashboardStderr?: string
  failure?: string
}

const scan: Recorded = {}
const served: Recorded = {}

let browser: Browser | undefined
let browserPresent = false
const contexts: BrowserContext[] = []
const servers: FixtureServer[] = []
const dashboards: SpawnedDashboard[] = []
let stubServer: StubModelServer | undefined

/** The context every failure message carries, for one fixture. */
function context(label: string, recorded: Recorded): string {
  const projection = recorded.projection
  return [
    '',
    `fixture: ${label}`,
    `chromium present: ${String(browserPresent)}`,
    `seed: ${recorded.seed === undefined ? '(not seeded)' : `${recorded.seed.outcome} ${recorded.seed.id}`}`,
    `run finished: ${String(recorded.drive?.finished ?? false)}; last type: ${recorded.drive?.lastType ?? '(none)'}`,
    `projection status: ${String(recorded.projectionStatus ?? 0)}; kind: ${projection?.kind ?? '(none)'}`,
    `projection: ${(recorded.projectionBody ?? '').slice(0, 1_400)}`,
    `visit url: ${recorded.visit?.finalUrl ?? '(never opened)'}`,
    `visit wait failure: ${recorded.visit?.waitFailure?.split('\n')[0] ?? '(none)'}`,
    `banner: rung=${recorded.visit?.bannerRung ?? '(absent)'} `
    + `reason=${recorded.visit?.bannerReason ?? '(absent)'} `
    + `text=${JSON.stringify(recorded.visit?.bannerText ?? null)}`,
    `knowledge state: 7=${recorded.visit?.stateAfter7 ?? '(none)'} `
    + `overview=${recorded.visit?.stateAfterOverview ?? '(unmounted)'} `
    + `m=${recorded.visit?.stateAfterM ?? '(none)'} `
    + `chip=${recorded.visit?.stateAfterChip ?? '(none)'}`,
    `used summary: ${JSON.stringify(recorded.visit?.usedSummary ?? null)}`,
    `knowledge step rows: ${String(recorded.visit?.knowledgeStepCount ?? 0)}; `
    + `brief-line counts: ${(recorded.visit?.briefLineCounts ?? []).join(', ') || '(none)'}`,
    `learned state: ${recorded.visit?.learnedState ?? '(absent)'}`,
    `served lines: ${JSON.stringify(recorded.visit?.servedLines ?? [])}`,
    `drawer tabs: ${(recorded.visit?.drawerTabLabels ?? []).join(', ') || '(none)'}`,
    `curation chip tag: ${recorded.visit?.curationChipTag ?? '(absent)'}`,
    `page text: ${JSON.stringify((recorded.visit?.bodyText ?? '').slice(0, 700))}`,
    recorded.failure === undefined ? '' : `drive failure: ${recorded.failure}`,
    `dashboard stderr: ${(recorded.dashboardStderr ?? '').slice(-1_200)}`,
  ].join('\n')
}

/** The recorded visit, asserted present so every cell below reads a real page. */
function visitOf(label: string, recorded: Recorded): PageObservation {
  expect(
    recorded.failure,
    `the ${label} measurement drive stopped early. ${BROWSER_INSTALL_INSTRUCTION}`
    + context(label, recorded),
  ).toBeUndefined()
  const observed = recorded.visit
  expect(
    observed,
    `the ${label} run-detail page was never observed. ${BROWSER_INSTALL_INSTRUCTION}`
    + context(label, recorded),
  ).toBeDefined()
  return observed as PageObservation
}

/** The recorded projection, narrowed to the `ready` arm every cell here asks about. */
function readyProjection(
  label: string,
  recorded: Recorded,
): Extract<RunKnowledgeProjection, { kind: 'ready' }> {
  const projection = recorded.projection
  expect(
    projection?.kind,
    `the ${label} \`/api/runs/:id/knowledge\` read did not answer \`ready\`.${context(label, recorded)}`,
  ).toBe('ready')
  return projection as Extract<RunKnowledgeProjection, { kind: 'ready' }>
}

async function textOf(page: Page, selector: string): Promise<string | undefined> {
  const node = page.locator(selector).first()
  if ((await node.count()) === 0) return undefined
  return ((await node.textContent()) ?? '').trim()
}

async function attributeOf(page: Page, selector: string, name: string): Promise<string | undefined> {
  const node = page.locator(selector).first()
  if ((await node.count()) === 0) return undefined
  return (await node.getAttribute(name)) ?? undefined
}

/**
 * Open one run's detail page and harvest the whole Knowledge story a person can reach.
 *
 * THE TAB IS REACHED BY THE KEY A PERSON PRESSES rather than by a `?tab=` deep link: `7` is the
 * shortcut D-01 put on the seventh tab and a deep link would reach the same panel while skipping
 * the binding this file exists to measure.
 *
 * EVERY WAIT RECORDS RATHER THAN THROWS, and the harvest runs whatever happened — a drive that
 * threw would leave every cell reporting "the drive stopped early" and nothing about the page a
 * person would have been looking at.
 */
async function observeKnowledge(
  browserContext: BrowserContext,
  origin: string,
  runId: string,
): Promise<PageObservation> {
  const page: Page = await browserContext.newPage()
  let waitFailure: string | undefined
  try {
    await page.goto(`${origin}/runs/${encodeURIComponent(runId)}`)
    await page.locator('[data-step-id]').first()
      .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
      .catch((error: unknown) => {
        waitFailure = error instanceof Error ? error.message : String(error)
      })

    const treeStepCount = await page.locator('[data-step-id]').count()

    // The durable header banner, read BEFORE any tab is touched: it is a run-detail header fact,
    // not a Knowledge-tab one, and a reader sees it without pressing anything.
    const bannerRung = await attributeOf(page, '[data-rung-banner]', 'data-rung')
    const bannerReason = await attributeOf(page, '[data-rung-banner]', 'data-rung-reason')
    const bannerText = await textOf(page, '[data-rung-banner]')

    // ── The tab, reached by its own key.
    await page.keyboard.press('7')
    await page.locator('[data-knowledge-state]').first()
      .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
      .catch(() => undefined)
    const stateAfter7 = await attributeOf(page, '[data-knowledge-state]', 'data-knowledge-state')
    const usedSummary = await textOf(page, '[data-used-summary]')
    const knowledgeStepCount = await page.locator('[data-step-index]').count()
    const briefLineCounts = await page.locator('[data-step-index]').evaluateAll(
      (rows) => rows.map((row) => row.getAttribute('data-brief-lines') ?? '?'),
    )
    const firstRowNoBriefText = await textOf(
      page,
      `[data-step-index] >> text=${STEP_NO_BRIEF_TEXT}`,
    ).catch(() => undefined)
    const learnedState = await attributeOf(page, '[data-learned-state]', 'data-learned-state')

    // ── One expanded row, and the why-trace inside it. The row that served something is chosen by
    // the attribute the panel stamped, so a fixture that served nothing expands its first row and
    // records an empty channel rather than hunting for one that does not exist.
    const servedLines: ServedLineObservation[] = []
    const rows = page.locator('[data-step-index]')
    const rowCount = await rows.count()
    let target = -1
    for (let index = 0; index < rowCount; index += 1) {
      const count = await rows.nth(index).getAttribute('data-brief-lines')
      if (count !== null && Number(count) > 0) { target = index; break }
    }
    if (target === -1 && rowCount > 0) target = 0
    if (target >= 0) {
      const row = rows.nth(target)
      await row.locator('button').first().click().catch(() => undefined)
      await row.locator('[data-step-detail]').first()
        .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
        .catch(() => undefined)
      const lines = row.locator('li[data-served-channel="1"]')
      const lineCount = await lines.count()
      for (let index = 0; index < lineCount; index += 1) {
        const line = lines.nth(index)
        const why = line.getByText(WHY_TRIGGER_TEXT, { exact: false }).first()
        if ((await why.count()) > 0) await why.click().catch(() => undefined)
        const harvested = await line.evaluate((element) => ({
          traceState: element.getAttribute('data-trace-state') ?? '?',
          servedAsCanary: element.getAttribute('data-served-as-canary') ?? '?',
          // The mono paragraphs inside the line: the first is the record id, and the trace answer
          // is the one that follows an opened disclosure.
          monoText: Array.from(element.querySelectorAll('p'))
            .map((node) => (node.textContent ?? '').trim())
            .filter((text) => text !== ''),
        }))
        const whyText = harvested.monoText.find((text) => text.startsWith('leg '))
        servedLines.push({
          recordId: harvested.monoText[0] ?? '',
          traceState: harvested.traceState,
          servedAsCanary: harvested.servedAsCanary,
          ...(whyText === undefined ? {} : { whyText }),
        })
      }
      // The row is collapsed again so the later shortcut legs read a page in its resting shape.
      await row.locator('button').first().click().catch(() => undefined)
    }

    // ── D-02's re-pointed `m`. The tab is left first, so "still on knowledge" cannot pass for
    // "the key brought us back".
    await page.keyboard.press('1')
    await page.waitForTimeout(200)
    const stateAfterOverview = await attributeOf(
      page,
      '[data-knowledge-state]',
      'data-knowledge-state',
    )
    await page.keyboard.press('m')
    await page.locator('[data-knowledge-state]').first()
      .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
      .catch(() => undefined)
    const stateAfterM = await attributeOf(page, '[data-knowledge-state]', 'data-knowledge-state')

    // ── D-01's click-through: the chip is a control, and pressing it lands on the tab.
    //
    // MEASURED BEFORE THE DRAWER LEG, and the order is load-bearing rather than tidy. Closing the
    // drawer with `Escape` runs the page's own escape shortcut, whose second arm CLEARS THE STEP
    // SELECTION — and with no step selected the detail pane renders its "select a step" placeholder
    // instead of any tab, so a chip click measured after the drawer would land on a page with no
    // tab panel at all and report an absence that has nothing to do with the chip.
    await page.keyboard.press('1')
    await page.waitForTimeout(200)
    const chip = page.locator('[data-chip="curation"]').first()
    const curationChipTag = (await chip.count()) === 0
      ? undefined
      : await chip.evaluate((element) => element.tagName.toLowerCase())
    if ((await chip.count()) > 0) await chip.click().catch(() => undefined)
    await page.locator('[data-knowledge-state]').first()
      .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
      .catch(() => undefined)
    const stateAfterChip = await attributeOf(page, '[data-knowledge-state]', 'data-knowledge-state')

    // ── The artifact drawer, and what it no longer offers. Last, for the reason above.
    await page.keyboard.press('i')
    await page.locator('[data-slot="sheet-content"]').first()
      .waitFor({ state: 'attached', timeout: PAGE_BUDGET_MS })
      .catch(() => undefined)
    const drawerTabLabels = await page
      .locator('[data-slot="sheet-content"] [data-slot="tabs-trigger"]')
      .evaluateAll((triggers) => triggers.map((trigger) => (trigger.textContent ?? '').trim()))
    await page.keyboard.press('Escape')
    await page.locator('[data-slot="sheet-content"]').first()
      .waitFor({ state: 'detached', timeout: PAGE_BUDGET_MS })
      .catch(() => undefined)

    const bodyText = await page.evaluate(() => document.body.innerText)

    return {
      finalUrl: page.url(),
      ...(waitFailure === undefined ? {} : { waitFailure }),
      treeStepCount,
      ...(bannerRung === undefined ? {} : { bannerRung }),
      ...(bannerReason === undefined ? {} : { bannerReason }),
      ...(bannerText === undefined ? {} : { bannerText }),
      ...(stateAfter7 === undefined ? {} : { stateAfter7 }),
      ...(usedSummary === undefined ? {} : { usedSummary }),
      knowledgeStepCount,
      briefLineCounts,
      ...(firstRowNoBriefText === undefined ? {} : { firstRowNoBriefText }),
      ...(learnedState === undefined ? {} : { learnedState }),
      servedLines,
      ...(stateAfterOverview === undefined ? {} : { stateAfterOverview }),
      ...(stateAfterM === undefined ? {} : { stateAfterM }),
      drawerTabLabels,
      ...(curationChipTag === undefined ? {} : { curationChipTag }),
      ...(stateAfterChip === undefined ? {} : { stateAfterChip }),
      bodyText,
    }
  } finally {
    await page.close()
  }
}

/** How long the post-run chain has to reach a terminal curation word before the page is read. */
const CHAIN_BUDGET_MS = 90_000

/**
 * Read the projection the page itself reads, through the SAME spawned door, ONCE THE CHAIN HAS
 * SETTLED.
 *
 * WHY IT WAITS RATHER THAN SNAPSHOTTING. `runFinished` arrives before the post-run chain drains,
 * so a projection read at that instant says `curation: pending` while the page — rendered seconds
 * later, after the client's own poll — paints `done`. Comparing the two would be measuring the gap
 * between two clocks, not an agreement between a page and its op. Both readings are therefore
 * taken after the chain is TERMINAL, which is the only state in which "the half and the chip give
 * one account" is a claim about the product.
 *
 * A BUDGET THAT RUNS OUT IS NOT A THROW. The last reading is kept whatever it says, and the cells
 * red on the fact with the whole projection quoted.
 */
async function readSettledProjection(
  origin: string,
  runId: string,
  recorded: Recorded,
): Promise<void> {
  const deadline = Date.now() + CHAIN_BUDGET_MS
  for (;;) {
    const response = await fetch(`${origin}/api/runs/${encodeURIComponent(runId)}/knowledge`)
    const body = await response.text()
    recorded.projectionStatus = response.status
    recorded.projectionBody = body
    if (response.status === 200) {
      const parsed = RunKnowledgeProjectionSchema.safeParse(JSON.parse(body))
      if (parsed.success) {
        recorded.projection = parsed.data
        const status = parsed.data.kind === 'ready' ? parsed.data.curation.status : 'done'
        if (status === 'done' || status === 'failed') return
      }
    }
    if (Date.now() >= deadline) return
    await new Promise<void>((tick) => { setTimeout(tick, 500) })
  }
}

/** Drive ONE fixture end to end and record everything it produced. */
async function driveFixture(
  label: string,
  recorded: Recorded,
  seed: boolean,
  addresses: { readonly modelBaseUrl: string; readonly targetUrl: string },
): Promise<void> {
  const project = populatedRunFixtureProject(label, addresses)
  if (seed) {
    recorded.seed = await seedServedRecord(project)
  }

  const port = await reserveEphemeralPort()
  const dashboard = await spawnDashboard(
    project.root,
    project.configPath,
    port,
    60_000,
    populatedRunSpawnEnv(),
  )
  dashboards.push(dashboard)
  if (!dashboard.ready) {
    recorded.dashboardStderr = dashboard.stderr()
    recorded.failure = 'the spawned `agent-qa dashboard` never said it was listening'
    return
  }

  try {
    recorded.drive = await drivePopulatedRun(dashboard, project, RUN_BUDGET_MS)
    await readSettledProjection(dashboard.origin, recorded.drive.runId, recorded)
    const browserContext = await (browser as Browser).newContext()
    contexts.push(browserContext)
    recorded.visit = await observeKnowledge(
      browserContext,
      dashboard.origin,
      recorded.drive.runId,
    )
  } catch (error) {
    recorded.failure = error instanceof Error ? error.message : String(error)
  }
  recorded.dashboardStderr = dashboard.stderr()
  await dashboard.stop()
}

describePosix('the shipped dashboard renders the Knowledge tab and the rung banner (407-11)', () => {
  beforeAll(async () => {
    try {
      browserPresent = existsSync(chromium.executablePath())
    } catch {
      browserPresent = false
    }

    // FIRST, AND BEFORE ANYTHING IS SPAWNED: a stale build measures the previous commit, and the
    // bundle these cells read is `dashboard-ui/dist`.
    const freshness = buildFreshness(POPULATED_RUN_ANCHORED_BUILDS)
    if (freshness.missing.length > 0 || freshness.stale.length > 0) {
      const why = `${REBUILD_INSTRUCTION} missing: ${freshness.missing.join(', ') || '(none)'}; `
        + `stale: ${freshness.stale.join(', ') || '(none)'}`
      scan.failure = why
      served.failure = why
      return
    }

    try {
      browser = await chromium.launch({ headless: true })
    } catch (error) {
      const why = `${BROWSER_INSTALL_INSTRUCTION} underlying error: `
        + `${error instanceof Error ? error.message : String(error)}`
      scan.failure = why
      served.failure = why
      return
    }

    const targetServer = await startTargetPageServer()
    servers.push(targetServer)
    stubServer = await startStubModelServer()
    const addresses = { modelBaseUrl: stubServer.baseUrl, targetUrl: targetServer.url }

    // SEQUENTIAL, NOT CONCURRENT. Each fixture drives a real Chromium inside a real run through a
    // real dashboard; two at once on one machine is the resource contention WINDOWS #309 recorded.
    await driveFixture('knowledge-tab-dom-scan', scan, false, addresses)
    await driveFixture('knowledge-tab-dom-served', served, true, addresses)
  }, RUN_BUDGET_MS * 2 + 360_000)

  afterAll(async () => {
    for (const held of contexts) await held.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    for (const dashboard of dashboards) await dashboard.stop().catch(() => undefined)
    await stubServer?.close()
    for (const server of servers) await server.close()
    cleanupTempRoots()
  })

  // ── (A) The empty knowledge root: the deterministic rung, and the Used half with nothing in it.

  it('(a1) the run\'s own `/api/runs/:id/knowledge` answers ready, bound, on the bundle-scan rung', () => {
    visitOf('scan', scan)
    const projection = readyProjection('scan', scan)
    expect(
      projection.knowledgeStore,
      'a project whose config names a knowledge dir that exists has a reader BOUND; `unbound` '
      + 'means the run served every step with no reader and recorded no rung, which would make '
      + `every claim below vacuous.${context('scan', scan)}`,
    ).toBe('bound')
    expect(
      projection.retrievalRung?.rung,
      'the populated fixture ships an EMPTY knowledge root with no index, and the fold reads the '
      + 'index axis first — so this run was served on `bundle-scan` whatever the host embedder '
      + `did. A different word here means the fixture gained an index or the fold moved.${context('scan', scan)}`,
    ).toBe('bundle-scan')
    expect(
      projection.retrievalRung?.reason,
      `the recorded cause for a scanned index is \`index-unavailable\`.${context('scan', scan)}`,
    ).toBe('index-unavailable')
  })

  it('(a2) the run header paints the rung banner with the sentence of record', () => {
    const observed = visitOf('scan', scan)
    const projection = readyProjection('scan', scan)
    expect(
      observed.bannerRung,
      'the run-detail header painted no `[data-rung-banner]` for a run the projection says was '
      + `served on a DEGRADED rung.${context('scan', scan)}`,
    ).toBe(projection.retrievalRung?.rung)
    expect(
      observed.bannerReason,
      `the banner's \`data-rung-reason\` disagrees with the recorded cause.${context('scan', scan)}`,
    ).toBe(projection.retrievalRung?.reason)
    expect(
      observed.bannerText,
      'the banner text is not the sentence the two published label tables compose for this '
      + `recorded rung and cause.${context('scan', scan)}`,
    ).toBe(bannerSentence('bundle-scan', 'index-unavailable'))
  })

  it('(a3) pressing `7` opens a ready Knowledge tab with one row per recorded step', () => {
    const observed = visitOf('scan', scan)
    const projection = readyProjection('scan', scan)
    expect(
      observed.stateAfter7,
      'pressing `7` did not land on a READY Knowledge tab. The tab is the seventh trigger and its '
      + `state attribute is the cell contract, never the visible text.${context('scan', scan)}`,
    ).toBe('ready')
    expect(
      observed.knowledgeStepCount,
      'the Used half drew a different number of `[data-step-index]` rows than the projection '
      + `carries steps — the row exists even when the step served nothing.${context('scan', scan)}`,
    ).toBe(projection.steps.length)
    expect(
      observed.briefLineCounts,
      'a run served out of an empty knowledge root served no brief line on any step, so every '
      + `row's \`data-brief-lines\` must read zero.${context('scan', scan)}`,
    ).toEqual(projection.steps.map(() => '0'))
  })

  it('(a4) the Used summary is the published absence sentence for a run that served nothing', () => {
    const observed = visitOf('scan', scan)
    const projection = readyProjection('scan', scan)
    const servedTotal = projection.steps.reduce(
      (total, step) => total + step.served.channel1.length,
      0,
    )
    expect(
      servedTotal,
      `the empty-root fixture served a brief line, which makes this cell's subject wrong rather `
      + `than the page.${context('scan', scan)}`,
    ).toBe(0)
    // TWO DIFFERENT ABSENCES, AND THE PAGE MUST PICK THE RIGHT ONE. `NO_BRIEF_SERVED_TEXT` is for
    // a run with NO steps at all; a run whose steps all served nothing says the other sentence.
    // Both are read out of the module, so a rename reds here rather than silently passing.
    const expected = projection.steps.length === 0 ? NO_BRIEF_SERVED_TEXT : NO_BRIEF_LINES_TEXT
    expect(
      observed.usedSummary,
      `the derived Used summary is not the published sentence for this run.${context('scan', scan)}`,
    ).toBe(expected)
  })

  it('(a5) pressing `1` then `m` brings the Knowledge tab back (D-02 re-pointed the key)', () => {
    const observed = visitOf('scan', scan)
    expect(
      observed.stateAfterOverview,
      'pressing `1` left the Knowledge content mounted, so "still on knowledge" cannot be told '
      + `apart from "the key brought us back".${context('scan', scan)}`,
    ).toBeUndefined()
    expect(
      observed.stateAfterM,
      'pressing `m` did not activate the Knowledge tab. The key is re-pointed, not retired: the '
      + `v1 memory drawer tab it used to open is deleted.${context('scan', scan)}`,
    ).toBe('ready')
  })

  it('(a6) the artifact drawer offers no memory tab', () => {
    const observed = visitOf('scan', scan)
    expect(
      observed.drawerTabLabels.length,
      `pressing \`i\` opened no artifact drawer with tabs in it.${context('scan', scan)}`,
    ).toBeGreaterThan(0)
    expect(
      observed.drawerTabLabels.map((label) => label.toLowerCase()),
      'the artifact drawer still offers a memory tab. 407-05 deleted the v1 drawer tab; a run\'s '
      + `memory story lives in the Knowledge tab now.${context('scan', scan)}`,
    ).not.toContain('memory')
  })

  it('(a7) the `curation` chip is a button and pressing it activates the Knowledge tab', () => {
    const observed = visitOf('scan', scan)
    expect(
      observed.curationChipTag,
      'the `curation` chip is not a `button`. D-01 makes it the one click-through into the '
      + `Knowledge tab, and a span is not a control.${context('scan', scan)}`,
    ).toBe('button')
    expect(
      observed.stateAfterChip,
      'pressing the `curation` chip did not activate the Knowledge tab. The click-through does '
      + `not depend on the chip's status.${context('scan', scan)}`,
    ).toBe('ready')
  })

  // ── (B) The seeded knowledge root: a served line, and the why-trace behind it.

  it('(b1) the seeded record is published and the run really served it on channel 1', () => {
    visitOf('served', served)
    expect(
      served.seed?.outcome,
      'the fixture bundle did not publish, so there was nothing for the run to be served. This is '
      + `a fixture fault, not a page fault.${context('served', served)}`,
    ).toBe('published')
    const projection = readyProjection('served', served)
    const servedSteps = projection.steps.filter((step) => step.served.channel1.length > 0)
    expect(
      servedSteps.length,
      'the run served NO channel-1 line out of a knowledge root holding one published record at '
      + 'the run\'s own product scope with a rebuilt index. Either the scope ladder did not reach '
      + 'the record (a fixture-scope fault) or the reader gate refused it (a product fault) — '
      + `read the projection below to tell which.${context('served', served)}`,
    ).toBeGreaterThan(0)
    expect(
      servedSteps.every((step) => step.trace.kind === 'answered'),
      'a step that served a channel-1 line recorded no serve-time trace, so the page has nothing '
      + `honest to answer "why this line?" with.${context('served', served)}`,
    ).toBe(true)
  })

  it('(b2) the expanded row paints the served line as answered, with the trace\'s own numbers', () => {
    const observed = visitOf('served', served)
    const projection = readyProjection('served', served)
    expect(
      observed.servedLines.length,
      'the expanded step row painted no `li[data-served-channel="1"]` for a step whose projection '
      + `carries served lines.${context('served', served)}`,
    ).toBeGreaterThan(0)

    const painted = observed.servedLines[0] as ServedLineObservation
    expect(
      painted.traceState,
      'the served line\'s `data-trace-state` is not `answered`, so the page is reporting an '
      + `absence for a line the run recorded a trace for.${context('served', served)}`,
    ).toBe('answered')

    // The expectation is COMPUTED from the trace the run recorded, never typed: the page must say
    // what serve time said, not what an index would say if asked again today (D-04).
    const step = projection.steps.find((candidate) =>
      candidate.served.channel1.some((line) => line.id === painted.recordId))
    expect(
      step,
      'the record id the page painted is in no step of the projection it read — the page and the '
      + `op disagree about what this run served.${context('served', served)}`,
    ).toBeDefined()
    const trace = (step as NonNullable<typeof step>).trace
    expect(
      trace.kind,
      `the step carrying the painted line recorded no trace.${context('served', served)}`,
    ).toBe('answered')
    const entry = trace.kind === 'answered'
      ? trace.trace.servedLines.find((line) => line.recordId === painted.recordId)
      : undefined
    expect(
      entry,
      'the recorded trace has no `servedLines` entry for the line the page painted as answered.'
      + context('served', served),
    ).toBeDefined()
    const answer = entry as NonNullable<typeof entry>
    expect(
      painted.whyText,
      'the `Why this line?` disclosure did not print the leg, rank and score the serve-time trace '
      + `recorded for this record.${context('served', served)}`,
    ).toBe(traceLineText(answer.leg, answer.rank, answer.score))
  })

  it('(b3) the header banner is present exactly when the projection says the rung degraded', () => {
    const observed = visitOf('served', served)
    const projection = readyProjection('served', served)
    const rung = projection.retrievalRung?.rung
    expect(
      rung,
      'the seeded run recorded no rung at all, so there is nothing for the header to agree or '
      + `disagree with.${context('served', served)}`,
    ).toBeDefined()
    if (rung === 'memidex') {
      // NO HOST ASSUMPTION IN EITHER DIRECTION. A machine with a native embedder and a rebuilt
      // index reaches the top rung, and the top rung is not a degradation — so the honest claim
      // is silence, and painting an amber strip here would be the defect.
      expect(
        observed.bannerRung,
        'the run reached the top rung and the header still painted a degradation banner.'
        + context('served', served),
      ).toBeUndefined()
      return
    }
    expect(
      observed.bannerRung,
      'the projection records a degraded rung and the header painted no banner for it.'
      + context('served', served),
    ).toBe(rung)
    expect(
      observed.bannerText,
      'the banner text is not the sentence the published label tables compose for the rung and '
      + `cause this run recorded.${context('served', served)}`,
    ).toBe(bannerSentence(rung as string, projection.retrievalRung?.reason))
  })

  it('(b4) the Learned half\'s root carries the curation word the projection served', () => {
    const observed = visitOf('served', served)
    const projection = readyProjection('served', served)
    expect(
      observed.learnedState,
      'the Knowledge tab painted no `[data-learned-state]` root. The Learned half renders '
      + `whenever the projection carried one, which a ready projection always does.${context('served', served)}`,
    ).toBeDefined()
    // `counts-absent` is the fifth word the chip cannot say: a settled chain whose frozen row
    // recorded neither count. Every other word mirrors the chip exactly.
    const expected = projection.curation.status === 'done' && projection.curation.counts === undefined
      ? 'counts-absent'
      : projection.curation.status
    expect(
      observed.learnedState,
      'the Learned half and the curation chip give two different accounts of one chain.'
      + context('served', served),
    ).toBe(expected)
  })

  it('(b5) the Used summary counts the steps that really were briefed', () => {
    const observed = visitOf('served', served)
    const projection = readyProjection('served', served)
    const briefed = projection.steps.filter((step) =>
      step.served.channel1.length + step.served.channel2.length + step.served.channel3.length > 0)
    expect(
      observed.usedSummary,
      `the Used half painted no summary line at all.${context('served', served)}`,
    ).toBeDefined()
    expect(
      (observed.usedSummary ?? '').startsWith(
        `${String(briefed.length)} ${briefed.length === 1 ? 'step' : 'steps'} briefed`,
      ),
      'the derived Used summary does not open with the number of steps the projection says were '
      + `briefed.${context('served', served)}`,
    ).toBe(true)
  })

  it('(b6) the Knowledge tab is reachable by `7` on the seeded run too', () => {
    const observed = visitOf('served', served)
    expect(
      observed.stateAfter7,
      `pressing \`7\` did not land on a READY Knowledge tab.${context('served', served)}`,
    ).toBe('ready')
    expect(
      observed.knowledgeStepCount,
      `the Used half drew no step rows for a run the tree drew ${String(observed.treeStepCount)} `
      + `steps for.${context('served', served)}`,
    ).toBeGreaterThan(0)
  })
})
