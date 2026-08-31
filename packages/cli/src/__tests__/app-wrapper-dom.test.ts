// The App wrapper IN A REAL BROWSER — the D-11 states a person actually lands in
// (Phase 408 plan 02 · MCPA-01 · D-06/D-10/D-11 · T-408-08).
//
// WHAT IS PRODUCTION HERE AND WHAT IS SCRIPTED. Production: `renderAppWrapperPage` and every
// sentence constant, driven through a real headless Chromium. Scripted: the two throwaway
// `node:http` servers — one serving the wrapper document, one standing in for the dashboard origin
// the wrapper iframes — and the mint records, which are plain values a read handler would have
// composed. Nothing about the INNER embed page is re-tested here: its own states are 403's proven
// ground, and this file's subject is what the OUTER document does with a frame it cannot see into.
//
// WHY A BROWSER IS NOT OPTIONAL FOR THESE CLAIMS. Plan 01 asserted the wrapper's BYTES; the
// questions left are about behaviour no string can answer — does a dead origin end as a NAMED
// state rather than a blank rectangle, does the picker swap without touching the network, does a
// loaded frame actually reach `live`, and once the document has expired does it STAY expired no
// matter what a person does to it. Each is a property of the browser's event loop, and the last of
// them is the one `408-VERIFICATION.md` measured going the other way (plan 07, cell (6)).
//
// A MEASURED FACT THAT SHAPED THE WRAPPER, recorded here because it is the reason cell (3) is not
// a one-liner: in Chromium an iframe pointing at a REFUSED connection still fires `load` (measured
// 2026-08-31 — a page whose only signal was `load` would have shown Chromium's own error page
// under a `live` label, which is exactly the blank inner frame D-11 forbids). So the wrapper
// proves reachability with an explicit no-cors probe of the frame's ORIGIN and treats `load` as
// necessary-but-not-sufficient. Both halves are cells below.
//
// THE MUTATION LEGS THIS FILE IS THE BAR FOR:
//   E1  the origin probe removed, `load` treated as proof     -> cell (3), MEASURED: deleting the
//                                                                probe makes cell (3) time out at
//                                                                25 s on Chromium's error page,
//                                                                which the wrapper then calls live
//   E2  the picker re-fetching or re-minting on change       -> cell (4)'s request counter
//   E3  the live state losing its display rule               -> cell (5)
//   E4  the `attach()` expired early-return removed          -> cell (6), MEASURED: the document
//                                                               reads `live` again after the picker
//                                                               change and the frame carries an
//                                                               already-aged liveUrl

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  APP_WRAPPER_EXPIRED_HINT,
  APP_WRAPPER_EXPIRED_MESSAGE,
  APP_WRAPPER_LOAD_TIMEOUT_MS,
  APP_WRAPPER_PERMANENT_LINK_LABEL,
  APP_WRAPPER_UNREACHABLE_MESSAGE,
  renderAppWrapperPage,
} from '@vostride/agent-qa-mcp'
import type { AppWrapperMint } from '@vostride/agent-qa-mcp'
import { chromium } from 'playwright-core'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const BROWSER_INSTALL_INSTRUCTION =
  'these cells drive a REAL Chromium — the only place the wrapper\'s states can be observed as a '
  + 'person meets them: run `pnpm exec playwright install chromium` and re-run. THEY MUST NOT BE '
  + 'SKIPPED WHEN THE BROWSER IS ABSENT: every other cell in this phase asserts bytes, and these '
  + 'are the only ones that assert behaviour.'

const RUN_ID = 'run-408-02-dom'

let browser: Browser | undefined
const openServers: Server[] = []

/** Serve one fixed response body on loopback, and answer the origin it bound. */
async function serveStatic(body: string, contentType: string): Promise<string> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': contentType })
    res.end(body)
  })
  openServers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** A loopback port with NOTHING listening on it — the unreachable origin, honestly produced. */
async function deadOrigin(): Promise<string> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return `http://127.0.0.1:${port}`
}

const mint = (handle: number, origin: string, expiresAt: number): AppWrapperMint => ({
  handle,
  liveUrl: `${origin}/live/${RUN_ID}#v1.body${handle}.sig${handle}`,
  expiresAt,
  streamKind: 'cdp-screencast',
})

/** Serve the wrapper for these mints and answer the URL a browser can open it at. */
async function serveWrapper(mints: readonly AppWrapperMint[], permanentLink: string): Promise<string> {
  return serveStatic(
    renderAppWrapperPage({
      runId: RUN_ID,
      mints,
      permanentLink,
      runLive: mints.length > 0,
      now: Date.now(),
    }),
    'text/html; charset=utf-8',
  )
}

beforeAll(async () => {
  try {
    browser = await chromium.launch({ headless: true })
  } catch (error) {
    throw new Error(
      `${BROWSER_INSTALL_INSTRUCTION} underlying error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}, 120_000)

afterAll(async () => {
  await browser?.close()
  for (const server of openServers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

const held = (): Browser => {
  if (browser === undefined) throw new Error('the chromium fixture never came up')
  return browser
}

describe('the wrapper in a real browser (D-11)', () => {
  it('(3) a dead inner origin ends as `unreachable-origin`, with the sentence and a live link', async () => {
    const dead = await deadOrigin()
    const permanentLink = `${await serveStatic('<!doctype html>ok', 'text/html')}/runs/${RUN_ID}/live`
    const url = await serveWrapper([mint(0, dead, Date.now() + 300_000)], permanentLink)

    const page = await held().newPage()
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page
        .locator('[data-app-state="unreachable-origin"]')
        .waitFor({ state: 'attached', timeout: APP_WRAPPER_LOAD_TIMEOUT_MS + 15_000 })

      // The sentence a person reads, asserted against the SAME constant the page renders — never a
      // literal restated here, which is the drift T-403-09's discipline exists to stop.
      expect(await page.locator('[data-app-message]').textContent()).toBe(
        APP_WRAPPER_UNREACHABLE_MESSAGE,
      )
      // ...and the way out is still there. "Never a blank frame" is only half of D-11; the other
      // half is that the named state carries the browser path.
      const link = page.locator('[data-app-permanent-link]')
      expect(await link.getAttribute('href')).toBe(permanentLink)
      expect(await link.textContent()).toBe(APP_WRAPPER_PERMANENT_LINK_LABEL)
      await expect(link).toBeTruthy()
    } finally {
      await page.close()
    }
  }, 180_000)

  it('(4) the picker swaps the frame among PRE-MINTED urls, with zero wrapper-issued requests', async () => {
    const inner = await serveStatic('<!doctype html><title>inner</title>ok', 'text/html')
    const permanentLink = `${inner}/runs/${RUN_ID}/live`
    const mints = [mint(0, inner, Date.now() + 300_000), mint(1, inner, Date.now() + 300_000)]
    const url = await serveWrapper(mints, permanentLink)

    const page = await held().newPage()
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-app-state="live"]').waitFor({ state: 'attached', timeout: 30_000 })
      expect(await page.locator('[data-app-live-frame]').getAttribute('src')).toBe(mints[0]!.liveUrl)

      // Count only requests the WRAPPER DOCUMENT issues. The inner frame navigating is the swap
      // itself; a request from the main frame would be the re-mint D-10 forbids.
      const wrapperRequests: string[] = []
      page.on('request', (request) => {
        if (request.frame() === page.mainFrame()) wrapperRequests.push(request.url())
      })

      await page.locator('[data-app-handle-picker]').selectOption('1')
      await page.waitForFunction(
        (expected) =>
          document.querySelector('[data-app-live-frame]')?.getAttribute('src') === expected,
        mints[1]!.liveUrl,
        { timeout: 15_000 },
      )

      expect(await page.locator('[data-app-live-frame]').getAttribute('src')).toBe(mints[1]!.liveUrl)
      expect(wrapperRequests, 'the picker swaps LOCALLY — it never asks anybody for anything').toEqual(
        [],
      )
    } finally {
      await page.close()
    }
  }, 180_000)

  it('(5) a reachable, unexpired frame reaches `live` and hides the message paragraph', async () => {
    const inner = await serveStatic('<!doctype html><title>inner</title>ok', 'text/html')
    const permanentLink = `${inner}/runs/${RUN_ID}/live`
    const url = await serveWrapper([mint(0, inner, Date.now() + 300_000)], permanentLink)

    const page = await held().newPage()
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.locator('[data-app-state="live"]').waitFor({ state: 'attached', timeout: 30_000 })

      // The embed page's own display rule, mirrored: in `live` the frame is what a person sees and
      // the banner gets out of the way.
      await expect(page.locator('[data-app-message]')).toBeTruthy()
      expect(await page.locator('[data-app-message]').isVisible()).toBe(false)
      expect(await page.locator('[data-app-live-frame]').isVisible()).toBe(true)
      // A single mint needs no picker, so it is not shown — one pane and no chrome.
      expect(await page.locator('[data-app-handle-picker]').isVisible()).toBe(false)
    } finally {
      await page.close()
    }
  }, 180_000)

  // THE VERIFIER'S OWN PROBE, MADE PERMANENT (408-VERIFICATION.md gaps[0]/gaps[1], ROADMAP SC2
  // clause 2, D-10). Before plan 07 the expiry timer was one-shot and `attach()` was reachable from
  // the picker afterwards, so a person who left the App open past the TTL and then swapped handles
  // got the word `live` painted over a pane whose token had aged out — a state the wrapper's own
  // header calls worse than a blank frame, and one nothing later would correct.
  //
  // THE INNER ORIGIN IS REACHABLE HERE ON PURPOSE. A dead origin would reach `expired` for the
  // wrong reason; the claim is about a pane that was GENUINELY live and then aged out, which is the
  // only shape in which the defect was reachable.
  //
  // THE PICKER CHANGE IS FORCED past the actionability checks deliberately. The `disabled`
  // attribute is asserted below as its own claim, but if the change were only PREVENTED by that
  // attribute this cell would be measuring Playwright's refusal to drive a disabled control rather
  // than the wrapper's terminal guard — and removing the `attach()` early return would leave it
  // green. Forcing the change event fires the handler exactly as a host that ignores `disabled`
  // would, so leg E4 reds on the guard itself.
  it('(6) an expired document STAYS expired when the picker is changed, and keeps the link and hint', async () => {
    const inner = await serveStatic('<!doctype html><title>inner</title>ok', 'text/html')
    const permanentLink = `${inner}/runs/${RUN_ID}/live`
    const expiresAt = Date.now() + 2_000
    const mints = [mint(0, inner, expiresAt), mint(1, inner, expiresAt)]
    const url = await serveWrapper(mints, permanentLink)

    const page = await held().newPage()
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      // It was live FIRST — otherwise this cell would pass against a document born expired, which
      // is a state plan 02 already proved and not the transition under test.
      await page.locator('[data-app-state="live"]').waitFor({ state: 'attached', timeout: 30_000 })
      await page
        .locator('[data-app-state="expired"]')
        .waitFor({ state: 'attached', timeout: 30_000 })

      await page.locator('[data-app-handle-picker]').selectOption('1', { force: true })
      // Longer than the wrapper's OWN bound, so any competing transition the change could have
      // started — `connecting`, a probe resolving to `live`, the timeout arm naming
      // `unreachable-origin` — has had its full chance to land before the reads below.
      await page.waitForTimeout(APP_WRAPPER_LOAD_TIMEOUT_MS + 2_000)

      expect(
        await page.locator('[data-app-state]').getAttribute('data-app-state'),
        'expired is ABSORBING — no interaction the page offers can leave it',
      ).toBe('expired')
      expect(
        await page.locator('[data-app-live-frame]').getAttribute('src'),
        'no aged liveUrl is ever re-assigned to the frame',
      ).toBeNull()

      // D-10's other half, and the second gap the verification recorded: the expired state must go
      // on CARRYING the way out for the whole life of the document, not only on the first render.
      expect(await page.locator('[data-app-message]').textContent()).toBe(APP_WRAPPER_EXPIRED_MESSAGE)
      expect(await page.locator('[data-app-hint]').textContent()).toBe(APP_WRAPPER_EXPIRED_HINT)
      const link = page.locator('[data-app-permanent-link]')
      expect(await link.getAttribute('href')).toBe(permanentLink)

      // The affordance and the state cannot disagree.
      expect(
        await page.locator('[data-app-handle-picker]').getAttribute('disabled'),
        'the picker is an affordance of the embedded variant — it goes when the variant goes',
      ).not.toBeNull()
    } finally {
      await page.close()
    }
  }, 180_000)
})
