// The MCP App WRAPPER page (408 D-04/D-06/D-07/D-10/D-11, ratified 2026-08-31).
//
// WHAT THIS DOCUMENT IS. A thin host-rendered page that IFRAMES the `liveUrl` Phase 403 already
// mints and serves. It is not a second embed document: the 403 embed page
// (`dashboard-server/src/live-view/embed-page.ts`) stays byte-identical and this file re-implements
// none of it — no socket, no canvas, no frame protocol, no token parse. One embed contract, two
// consumers (D-04). Copying that file's IDIOMS is deliberate; copying its BYTES would be the
// second implementation this milestone exists to retire.
//
// IT RENDERS NO RUN STATE OF ITS OWN (D-11). No step list, no status line, no verdict. Those need
// an event-stream credential story inside a sandboxed iframe that this phase refuses to invent; the
// full two-pane surface stays the dashboard's, one click away through the permanent link. What this
// page owns is the closed state set below, the handle picker, and the link slot.
//
// EVERY ABSENCE IS NAMED, inherited verbatim from the embed page's own header. There is no state in
// which this page shows a blank rectangle: a run with no live session says so by name
// (`run-ended`), a host that cannot reach the dashboard origin says so (`unreachable-origin`), and
// an elapsed token says so (`expired`) rather than leaving a dead frame under a spinner.
//
// SELF-CONTAINED AND PURE. No imports, no fetches, no external stylesheet, no build step: the whole
// document is the string this function returns, because a host renders it inside a sandbox with no
// network identity of its own. `renderAppWrapperPage` is a pure function of its input, so a cell
// drives it directly rather than only through a server.
//
// VALUES ENTER THE SCRIPT AS STRING LITERALS AND LAND AS `textContent` (T-403-09). The escape
// helper is `embed-page.ts`'s, copied because the guard must not be re-derived: `JSON.stringify`
// plus a `<` escape closes the `</script` hole. Nothing caller-supplied is interpolated into
// markup, which is why the picker's options and the link's href are BUILT in the script rather
// than templated above it.
//
// Protocol grounding. This module speaks no protocol at all — it returns a string — and the two
// SEPs that nonetheless shape it are the reason it can. SEP-1730 places extensions outside every
// conformance tier, so this page is rendered only by a host that OPTED IN to the Apps extension and
// a host that did not owes it nothing: there is no degraded rendering to design for, only the
// link-out that rides every carrier result. SEP-2575's stateless protocol is why the page holds no
// session and mints nothing: it is handed everything it will ever have at render time, which is
// what makes D-10's answer to an aged token another READ rather than a credential machine inside
// somebody else's sandbox.

/**
 * Every value `[data-app-state]` can take (D-11's closed set).
 *
 * Exported for the reason `LIVE_EMBED_STATES` is: the DOM cells range over this list, so a state
 * added to the page without a cell is a visible diff rather than an unobserved arm. Plan 02
 * finalises the copy each state shows; the vocabulary is fixed here.
 */
export const APP_WRAPPER_STATES = [
  'connecting',
  'live',
  'expired',
  'unreachable-origin',
  'run-ended',
] as const

export type AppWrapperState = (typeof APP_WRAPPER_STATES)[number]

/** What the page says while the inner frame has not painted yet. */
export const APP_WRAPPER_CONNECTING_MESSAGE = 'connecting to the live view…'

/** What the page says once the inner frame has loaded. */
export const APP_WRAPPER_LIVE_MESSAGE = 'live'

/**
 * What an elapsed live link says (D-10). It is the wrapper's own sentence rather than the embed
 * page's `link expired`, because the two are about different things: the embed says its socket was
 * refused, and this says the link this App was rendered with has aged out — for which the useful
 * next move is another watch call, named here rather than left to the reader.
 */
export const APP_WRAPPER_EXPIRED_MESSAGE = 'live link expired — ask to watch again'

/**
 * The REQUIRED unreachable-origin sentence (D-11). A host running somewhere that cannot reach a
 * loopback dashboard origin must say so and offer the browser, never show a blank inner frame.
 */
export const APP_WRAPPER_UNREACHABLE_ORIGIN_MESSAGE =
  "this host can't reach the live view — open it in your browser"

/** What a run with no live session on this host says (D-07). Not an error, and not a blank frame. */
export const APP_WRAPPER_RUN_ENDED_MESSAGE = 'this run is not live'

/** The label on the permanent link-out slot, when one is composed (D-08). */
export const APP_WRAPPER_PERMANENT_LINK_LABEL = 'open in your browser'

/**
 * ONE minted view onto ONE member handle of the run.
 *
 * `liveUrl` carries its token in the FRAGMENT (403 D-04), so this value is the only place a live
 * credential exists on this page — it is written into the frame's `src` and nowhere else: not into
 * the document text, not into the picker's labels, not into any attribute a host serialises back.
 */
export interface AppWrapperMint {
  readonly handle: number
  readonly liveUrl: string
  readonly expiresAt: number
  readonly streamKind: string
}

export interface AppWrapperInput {
  readonly runId: string
  /** One mint per handle on the run's announced roster. Empty is the D-07 not-live case. */
  readonly mints: readonly AppWrapperMint[]
  /** The tokenless dashboard page (D-08). `undefined` when no dashboard origin is composable. */
  readonly permanentLink: string | undefined
  /** Whether this host holds a live session for the run at all. `false` renders `run-ended`. */
  readonly runLive: boolean
}

const STYLE = `
  :root { color-scheme: dark light }
  html, body { margin: 0; height: 100%; background: #0b0d10; }
  main { display: grid; grid-template-rows: auto 1fr auto; height: 100%; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: #c9d1d9; }
  header { display: flex; gap: .75rem; align-items: center; padding: .5rem .75rem; }
  iframe { border: 0; width: 100%; height: 100%; display: none; background: #0b0d10; }
  main[data-app-state="live"] iframe { display: block; }
  main[data-app-state="live"] p[data-app-message] { display: none; }
  p[data-app-message] { margin: 0; padding: .5rem .75rem; }
  footer { padding: .5rem .75rem; }
  select[hidden], a[hidden] { display: none; }
`

/**
 * Render the App wrapper for one run.
 *
 * The whole document, every time — there is no partial render and no update path, because D-10's
 * answer to a stale App is a FRESH read that mints again rather than a credential machine inside
 * the sandbox.
 */
export function renderAppWrapperPage(input: AppWrapperInput): string {
  // The embed page's escape, copied verbatim (embed-page.ts:72) rather than re-derived: the value
  // lands inside a script as a STRING LITERAL and the `<` guard closes the one hole that leaves.
  // ONE helper for every value that enters the script, so the guard cannot be forgotten for a new
  // one — including the handle numbers, which enter as literals like everything else so that
  // "every value crosses the helper" is a property a reader can check by grepping for the calls.
  const scriptLiteral = (value: string) => JSON.stringify(value).replaceAll('<', '\\u003c')

  const live = input.runLive && input.mints.length > 0
  const mintsLiteral = input.mints
    .map(
      (mint) =>
        `{handle:${scriptLiteral(String(mint.handle))},`
        + `url:${scriptLiteral(mint.liveUrl)},`
        + `expiresAt:${scriptLiteral(String(mint.expiresAt))},`
        + `kind:${scriptLiteral(mint.streamKind)}}`,
    )
    .join(',')

  const initialState: AppWrapperState = live ? 'connecting' : 'run-ended'
  const permanentLinkSlot =
    typeof input.permanentLink === 'string'
      ? '<a data-app-permanent-link rel="noreferrer" target="_blank"></a>'
      : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-qa live run</title>
<style>${STYLE}</style>
</head>
<body>
<main data-app-state="${initialState}">
<header><select data-app-handle-picker hidden></select></header>
<iframe data-app-live-frame sandbox="allow-scripts" referrerpolicy="no-referrer" title="agent-qa live view"></iframe>
<p data-app-message></p>
<footer>${permanentLinkSlot}</footer>
</main>
<script>
(function () {
  var mints = [${mintsLiteral}];
  var permanentLink = ${scriptLiteral(input.permanentLink ?? '')};
  var messages = {
    connecting: ${scriptLiteral(APP_WRAPPER_CONNECTING_MESSAGE)},
    live: ${scriptLiteral(APP_WRAPPER_LIVE_MESSAGE)},
    expired: ${scriptLiteral(APP_WRAPPER_EXPIRED_MESSAGE)},
    'unreachable-origin': ${scriptLiteral(APP_WRAPPER_UNREACHABLE_ORIGIN_MESSAGE)},
    'run-ended': ${scriptLiteral(APP_WRAPPER_RUN_ENDED_MESSAGE)}
  };

  var root = document.querySelector('[data-app-state]');
  var frame = document.querySelector('[data-app-live-frame]');
  var picker = document.querySelector('[data-app-handle-picker]');
  var message = document.querySelector('[data-app-message]');
  var link = document.querySelector('[data-app-permanent-link]');
  var settled = false;
  var timer = null;

  // The state machine is an ATTRIBUTE plus a textContent write, exactly as the embed page's is: a
  // state a person can read off the DOM is a state a cell can assert without screenshotting, and
  // text that arrives through textContent can never become markup.
  function setState(state) {
    root.setAttribute('data-app-state', state);
    message.textContent = messages[state] || '';
  }

  if (link !== null && permanentLink !== '') {
    link.href = permanentLink;
    link.textContent = ${scriptLiteral(APP_WRAPPER_PERMANENT_LINK_LABEL)};
  }

  if (mints.length === 0) {
    // D-07: the honest terminal/unknown state. No src is assigned, so there is no blank frame to
    // mistake for a stalled one.
    setState('run-ended');
    return;
  }

  function attach(mint) {
    settled = false;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    setState('connecting');
    // THE ONLY PLACE A TOKEN IS WRITTEN. It goes into the frame's src and nowhere else.
    frame.src = mint.url;
    var remaining = Number(mint.expiresAt) - Date.now();
    if (remaining > 0) {
      timer = setTimeout(function () { setState('expired'); }, remaining);
    }
  }

  frame.addEventListener('load', function () {
    // A cross-origin load event fires for a REACHED origin whether or not the inner document is the
    // embed page; what it rules out is the unreachable case, which is the only thing this wrapper
    // can honestly tell from out here (the inner page owns its own states).
    settled = true;
    if (root.getAttribute('data-app-state') === 'connecting') setState('live');
  });
  frame.addEventListener('error', function () {
    settled = true;
    setState('unreachable-origin');
  });

  // D-11's REQUIRED unreachable-origin arm. A host that cannot route to the dashboard origin never
  // fires an error event on some engines — it simply never loads — so silence past this bound is
  // itself the signal, named rather than left as a spinner.
  setTimeout(function () {
    if (!settled && root.getAttribute('data-app-state') === 'connecting') {
      setState('unreachable-origin');
    }
  }, 15000);

  // D-06/D-10: the picker swaps among tokens ALREADY minted for this render. It never mints, and
  // there is no bridge here that could ask anyone to — a fresh watch call is what re-mints.
  for (var i = 0; i < mints.length; i += 1) {
    var option = document.createElement('option');
    option.value = String(i);
    option.textContent = 'handle ' + mints[i].handle;
    picker.appendChild(option);
  }
  if (mints.length > 1) picker.removeAttribute('hidden');
  picker.addEventListener('change', function () {
    var chosen = mints[Number(picker.value)];
    if (chosen !== undefined) attach(chosen);
  });

  attach(mints[0]);
}());
</script>
</body>
</html>
`
}
