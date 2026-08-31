// The App wrapper's RENDERED BYTES — the D-11 state machine as a pure function
// (Phase 408 plan 02 · MCPA-01 · D-06/D-07/D-10/D-11).
//
// WHAT IS PRODUCTION HERE AND WHAT IS SCRIPTED. Production: `renderAppWrapperPage` and every
// sentence constant it renders. Scripted: nothing at all — the renderer takes a record and returns
// a string, so these cells hand it records. That is the whole reason the wrapper was written as a
// pure function: the states a person can end up in are decidable without a browser, and the ones
// that are NOT (does the frame actually load? does the picker swap without a network call?) are in
// `packages/cli/src/__tests__/app-wrapper-dom.test.ts`, driven through a real Chromium.
//
// THE DIVISION OF LABOUR IS DELIBERATE. This file asks "what did the server serve"; the DOM file
// asks "what does a browser do with it". A claim about the second answered from the first is the
// class of assertion 403 retired — so nothing here claims a state was REACHED, only that the
// document can express it and that the initial one is right.
//
// THE MUTATION LEGS THIS FILE IS THE BAR FOR:
//   C1  the expiry clock read at SCRIPT time instead of render time   -> the expired cell
//   C2  a not-live document that still carries a minted url           -> the run-ended cell
//   C3  a value reaching the script without the escape helper         -> the hostile-runId cell
//   C4  the wrapper growing a step list / status line (D-11)          -> the prohibition cell

import { describe, expect, it } from 'vitest'

import {
  APP_WRAPPER_CONNECTING_MESSAGE,
  APP_WRAPPER_EXPIRED_HINT,
  APP_WRAPPER_EXPIRED_MESSAGE,
  APP_WRAPPER_LIVE_MESSAGE,
  APP_WRAPPER_LOAD_TIMEOUT_MS,
  APP_WRAPPER_PERMANENT_LINK_LABEL,
  APP_WRAPPER_RUN_ENDED_MESSAGE,
  APP_WRAPPER_STATES,
  APP_WRAPPER_UNREACHABLE_MESSAGE,
  renderAppWrapperPage,
} from '../app-wrapper.js'
import type { AppWrapperInput, AppWrapperMint } from '../app-wrapper.js'

const RUN_ID = 'run-408-02-wrapper'
const ORIGIN = 'http://127.0.0.1:7799'
const PERMANENT_LINK = `http://127.0.0.1:7799/runs/${RUN_ID}/live`
const NOW = 1_800_000_000_000

const mint = (handle: number, expiresAt: number): AppWrapperMint => ({
  handle,
  liveUrl: `${ORIGIN}/live/${RUN_ID}#v1.body${handle}.sig${handle}`,
  expiresAt,
  streamKind: 'cdp-screencast',
})

const render = (overrides: Partial<AppWrapperInput> = {}): string =>
  renderAppWrapperPage({
    runId: RUN_ID,
    mints: [mint(0, NOW + 300_000)],
    permanentLink: PERMANENT_LINK,
    runLive: true,
    now: NOW,
    ...overrides,
  })

const stateOf = (html: string): string | undefined =>
  /<main data-app-state="([^"]+)"/.exec(html)?.[1]

describe('the closed state vocabulary (D-11)', () => {
  it('is exactly the five states this wrapper owns', () => {
    expect([...APP_WRAPPER_STATES]).toEqual([
      'connecting',
      'live',
      'expired',
      'unreachable-origin',
      'run-ended',
    ])
  })

  it('renders every sentence it can ever show, so no state can reach a person as empty text', () => {
    const html = render()
    for (const sentence of [
      APP_WRAPPER_CONNECTING_MESSAGE,
      APP_WRAPPER_LIVE_MESSAGE,
      APP_WRAPPER_EXPIRED_MESSAGE,
      APP_WRAPPER_EXPIRED_HINT,
      APP_WRAPPER_UNREACHABLE_MESSAGE,
    ]) {
      expect(html.includes(sentence), `the document carries "${sentence}"`).toBe(true)
    }
  })

  it('says exactly the CONTEXT sentence for a host that cannot reach the origin (D-11)', () => {
    expect(APP_WRAPPER_UNREACHABLE_MESSAGE).toBe(
      "this host can't reach the live view — open it in your browser",
    )
  })
})

describe('expiry is an honest STATE, decided at render time (D-10)', () => {
  it('renders `expired` when every mint has already aged out, with the sentence, the hint and the link', () => {
    const html = render({
      mints: [mint(0, NOW - 1), mint(1, NOW - 60_000)],
    })

    expect(stateOf(html)).toBe('expired')
    expect(html).toContain(APP_WRAPPER_EXPIRED_MESSAGE)
    expect(html).toContain(APP_WRAPPER_EXPIRED_HINT)
    // D-10's refresh story is a SENTENCE, not a mechanism: the permanent link is the way out and a
    // fresh watch call is the way back, and neither of them is a re-mint inside this sandbox.
    expect(html).toContain('<a data-app-permanent-link')
    expect(html).toContain(PERMANENT_LINK)
    expect(html).toContain(APP_WRAPPER_PERMANENT_LINK_LABEL)
  })

  it('renders `connecting` while ANY mint is still good, and arms the timer from the LOWEST expiry', () => {
    const html = render({
      mints: [mint(0, NOW + 120_000), mint(1, NOW + 30_000)],
    })

    expect(stateOf(html)).toBe('connecting')
    // The clock is read ONCE, at render, and enters the script as a DELTA — a script that read
    // `Date.now()` for itself would be comparing a host's clock to this process's, which is the
    // drift C1 exists to catch.
    expect(html).toContain('30000')
    expect(html).not.toContain(String(NOW))
  })

  it('never re-mints from inside the sandbox — the document contains no mint vocabulary at all', () => {
    const html = render()
    for (const forbidden of ['runs.liveurl', 'fetch(', 'XMLHttpRequest', 'ui/mint', 'remint']) {
      expect(html.includes(forbidden), `the wrapper must not contain ${forbidden}`).toBe(false)
    }
  })
})

describe('a run this host holds no live session for (D-07)', () => {
  it('renders `run-ended` with its sentence and assigns NO iframe src anywhere', () => {
    const html = renderAppWrapperPage({
      runId: RUN_ID,
      mints: [],
      permanentLink: PERMANENT_LINK,
      runLive: false,
      now: NOW,
    })

    expect(stateOf(html)).toBe('run-ended')
    expect(html).toContain(APP_WRAPPER_RUN_ENDED_MESSAGE)
    expect(html.includes('src='), 'nothing in a not-live document has a src').toBe(false)
  })

  it('carries NO minted byte when the run is not live, even if a mint is handed in', () => {
    // The renderer is AUTHORITATIVE about this rather than trusting its caller: `runLive: false`
    // means the document must not be able to show a pane, so the urls never reach the script.
    const html = renderAppWrapperPage({
      runId: RUN_ID,
      mints: [mint(0, NOW + 300_000)],
      permanentLink: PERMANENT_LINK,
      runLive: false,
      now: NOW,
    })

    expect(stateOf(html)).toBe('run-ended')
    expect(html.includes('#v1.body0.sig0'), 'no token bytes in a not-live document').toBe(false)
  })
})

describe('the frame, the picker and the link (D-06/D-08)', () => {
  it('renders exactly one iframe, sandboxed and referrer-free', () => {
    const html = render({ mints: [mint(0, NOW + 300_000), mint(1, NOW + 300_000)] })
    expect(html.match(/<iframe\b/g) ?? []).toHaveLength(1)
    expect(html).toContain('sandbox="allow-scripts"')
    expect(html).toContain('referrerpolicy="no-referrer"')
  })

  it('carries one pre-minted url per handle and the picker that swaps among them', () => {
    const html = render({ mints: [mint(0, NOW + 300_000), mint(1, NOW + 300_000)] })
    expect(html).toContain('#v1.body0.sig0')
    expect(html).toContain('#v1.body1.sig1')
    expect(html).toContain('data-app-handle-picker')
  })

  it('renders no anchor at all when no permanent link is composed — never a link to nothing', () => {
    const html = render({ permanentLink: undefined })
    // The ANCHOR, not the selector the script uses to look for one — the slot is absent from the
    // markup, so there is no element for a person to click and none for a host to serialise.
    expect(html.includes('<a data-app-permanent-link')).toBe(false)
  })

  it('exports the load timeout and puts THAT number in the script', () => {
    expect(APP_WRAPPER_LOAD_TIMEOUT_MS).toBeGreaterThan(0)
    expect(render()).toContain(String(APP_WRAPPER_LOAD_TIMEOUT_MS))
  })
})

describe('every value entering the script crosses the escape helper (T-403-09)', () => {
  it('escapes a hostile run id that tries to close the script element', () => {
    const hostile = `run-</script><img src=x onerror=alert(1)>`
    const html = renderAppWrapperPage({
      runId: hostile,
      mints: [],
      permanentLink: undefined,
      runLive: false,
      now: NOW,
    })

    // The literal `</script` never appears: the escape turns the `<` into `\u003c`, so the parser
    // never sees a closing tag and the payload can never become markup.
    expect(html.includes('</script><img'), 'the script element cannot be closed early').toBe(false)
    expect(html).toContain('\\u003c/script')
  })

  it('escapes a hostile permanent link the same way', () => {
    const html = render({ permanentLink: 'http://x/</script><b>' })
    expect(html.includes('</script><b>')).toBe(false)
    expect(html).toContain('\\u003c/script')
  })
})

describe('the wrapper renders NO run state of its own (D-11 prohibition)', () => {
  it('has no step, status or verdict surface — structurally, not by wording', () => {
    const html = render({ mints: [mint(0, NOW + 300_000), mint(1, NOW + 300_000)] })
    for (const forbidden of [
      'data-app-step',
      'data-app-steps',
      'data-app-status',
      'data-app-verdict',
      'data-app-progress',
    ]) {
      expect(html.includes(forbidden), `the wrapper must own no ${forbidden}`).toBe(false)
    }
    // And no element renders per-step data: the only repeated structure in the document is the
    // picker's options, one per HANDLE, which is identity rather than run state.
    expect(html.match(/<option\b/g) ?? []).toHaveLength(0)
    expect(html).toContain('createElement(\'option\')')
  })
})
