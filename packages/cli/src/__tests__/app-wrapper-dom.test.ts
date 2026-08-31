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
// WHY A BROWSER IS NOT OPTIONAL FOR THESE THREE CLAIMS. Plan 01 asserted the wrapper's BYTES; the
// three questions left are about behaviour no string can answer — does a dead origin end as a
// NAMED state rather than a blank rectangle, does the picker swap without touching the network,
// and does a loaded frame actually reach `live`. Each is a property of the browser's event loop.
//
// A MEASURED FACT THAT SHAPED THE WRAPPER, recorded here because it is the reason cell (3) is not
// a one-liner: in Chromium an iframe pointing at a REFUSED connection still fires `load` (measured
// 2026-08-31 — a page whose only signal was `load` would have shown Chromium's own error page
// under a `live` label, which is exactly the blank inner frame D-11 forbids). So the wrapper
// proves reachability with an explicit no-cors probe of the frame's ORIGIN and treats `load` as
// necessary-but-not-sufficient. Both halves are cells below.
//
// THE MUTATION LEGS THIS FILE IS THE BAR FOR:
//   E1  `load` alone flipping the wrapper to `live`          -> cell (3)
//   E2  the picker re-fetching or re-minting on change       -> cell (4)'s request counter
//   E3  the live state losing its display rule               -> cell (5)

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
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
  + 'three are the only ones that assert behaviour.'

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
})
