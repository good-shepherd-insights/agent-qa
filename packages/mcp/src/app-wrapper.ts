// The MCP App WRAPPER page (408 D-04/D-06/D-07/D-10/D-11, ratified 2026-08-31; finished in plan 02).
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
// A MEASURED FACT THAT SHAPES THE `live` ARM, and the reason this page probes rather than trusting
// an event (measured 2026-08-31, Chromium; the cell is `cli/src/__tests__/app-wrapper-dom.test.ts`):
// AN IFRAME POINTED AT A REFUSED CONNECTION STILL FIRES `load`. The browser navigates the frame to
// its own error page and that navigation completes, so `load` says "a document settled in there",
// never "the origin answered". A wrapper whose only signal was `load` would therefore label
// Chromium's error page `live` — the blank inner frame D-11 forbids, wearing the one label that
// stops a person from looking further. Cross-origin, this page cannot look inside the frame to
// tell the difference, and it must not ask the INNER page to tell it (criterion 3 freezes that
// document). So reachability is established by an explicit `fetch(origin, { mode: 'no-cors' })`
// probe — the one question a sandboxed page can honestly ask about somebody else's origin — and
// `live` requires BOTH the probe answering and the frame loading. The probe is memoised per
// ORIGIN, so the handle picker (D-06) swaps among panes on one origin with no network call at all.
//
// THE TIMEOUT ARM IS STILL REQUIRED, because the other unreachable shape does not fail fast: an
// origin that black-holes packets (the cloud-host-versus-loopback case D-11 was written for) leaves
// both the probe and the frame pending forever. `APP_WRAPPER_LOAD_TIMEOUT_MS` is the bound past
// which silence is itself the answer, named rather than left as a spinner.
//
// EXPIRY IS DECIDED AT RENDER TIME (D-10). The clock is read ONCE, by the renderer, and what enters
// the script is a DELTA in milliseconds — never an absolute epoch the script would compare against
// the HOST's clock. A wrapper rendered on a machine whose clock differs from the host's by a minute
// would otherwise expire a minute early or a minute late for no reason a person could see. If every
// mint has already aged out by the time the document is built, the document is BORN `expired`: it
// never assigns a src, so there is no dead frame to flash before the sentence appears.
//
// SELF-CONTAINED AND PURE. No imports, no external stylesheet, no build step: the whole document is
// the string this function returns, because a host renders it inside a sandbox with no network
// identity of its own. `renderAppWrapperPage` is a pure function of its input (the clock included,
// which is why `now` is a parameter and not a call), so a cell drives it directly.
//
// VALUES ENTER THE SCRIPT AS STRING LITERALS AND LAND AS `textContent` (T-403-09). The escape
// helper is `embed-page.ts`'s, copied because the guard must not be re-derived: `JSON.stringify`
// plus a `<` escape closes the `</script` hole. Nothing caller-supplied is interpolated into
// markup, which is why the picker's options, the link's href and the run id are BUILT in the script
// rather than templated above it. The only prose in the markup is this file's OWN constants.
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
 * added to the page without a cell is a visible diff rather than an unobserved arm.
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

/** What the page says once the inner frame has loaded on an origin this host can reach. */
export const APP_WRAPPER_LIVE_MESSAGE = 'live'

/**
 * What an elapsed live link says (D-10).
 *
 * The wrapper's own sentence rather than the embed page's `link expired`, because the two are about
 * different things: the embed says its socket was refused, and this says the link this App was
 * rendered with has aged out.
 */
export const APP_WRAPPER_EXPIRED_MESSAGE = 'live link expired'

/**
 * The second half of the expired state, and the WHOLE of D-10's refresh story (D-10).
 *
 * There is no re-mint inside this sandbox and there is never going to be one — a UI-initiated mint
 * door was rejected precisely because its model-context hygiene is per-host behaviour nobody here
 * controls. What replaces it is this sentence: the way to a fresh token is another watch call, one
 * the person can simply ask for, and saying so is the difference between a dead end and a next
 * move. Separate from the message above so the DOM can show both and a cell can assert each.
 */
export const APP_WRAPPER_EXPIRED_HINT = 'ask to watch again — a fresh watch mints a new link'

/**
 * The REQUIRED unreachable-origin sentence (D-11), spelled EXACTLY as CONTEXT ratified it.
 *
 * A host running somewhere that cannot route to a loopback dashboard origin must say so and offer
 * the browser, never show a blank inner frame. This string is a contract: the DOM cells assert
 * against this constant, so the sentence and the assertion can never drift apart.
 */
export const APP_WRAPPER_UNREACHABLE_MESSAGE =
  "this host can't reach the live view — open it in your browser"

/**
 * What a run with no live session on this host says (D-07).
 *
 * Not an error and not a blank frame — and it points at the way to see the run anyway, which is
 * the permanent link rendered directly beneath it. A run that has finished still HAPPENED, and the
 * dashboard's own page is where its history lives.
 */
export const APP_WRAPPER_RUN_ENDED_MESSAGE = 'this run is not live — open it in your browser'

/** The label on the permanent link-out slot, when one is composed (D-08). */
export const APP_WRAPPER_PERMANENT_LINK_LABEL = 'open in your browser'

/**
 * How long silence from the inner frame is allowed to last before it is named (D-11, T-408-08).
 *
 * Exported because the DOM cell must wait on the page's OWN bound rather than on a number a test
 * file guessed. Ten seconds is chosen against the two shapes this arm exists for: a black-holed
 * origin never answers at all, and a slow-but-reachable dashboard on loopback answers in
 * milliseconds — there is no realistic case in between, so a longer bound would only make a person
 * stare at a spinner for longer before reading the same sentence.
 */
export const APP_WRAPPER_LOAD_TIMEOUT_MS = 10_000

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
  /**
   * The instant this document is being built, in ms-epoch (D-10).
   *
   * A PARAMETER rather than a `Date.now()` call, for the reason every clock in this repository is a
   * port: the expiry arm is the one thing this renderer decides about time, and a cell that cannot
   * choose "now" could only ever assert the arm it happened to land in. Defaults to the wall clock,
   * so the read handler passes nothing and gets the honest answer.
   */
  readonly now?: number
}

const STYLE = `
  :root { color-scheme: dark light }
  html, body { margin: 0; height: 100%; background: #0b0d10; }
  main { display: grid; grid-template-rows: auto 1fr auto auto; height: 100%; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: #c9d1d9; }
  header { display: flex; gap: .75rem; align-items: center; padding: .5rem .75rem; }
  header:empty { display: none; }
  iframe { border: 0; width: 100%; height: 100%; display: none; background: #0b0d10; }
  main[data-app-state="live"] iframe { display: block; }
  main[data-app-state="live"] p[data-app-message] { display: none; }
  main[data-app-state="live"] p[data-app-hint] { display: none; }
  p[data-app-message] { margin: 0; padding: .5rem .75rem; }
  p[data-app-hint] { margin: 0; padding: 0 .75rem .5rem; opacity: .75; }
  p[data-app-hint]:empty { display: none; }
  footer { padding: .5rem .75rem; }
  select[hidden], a[hidden] { display: none; }
`

/** The sentence each state shows, and the second line it shows underneath. */
const MESSAGES: Readonly<Record<AppWrapperState, string>> = {
  connecting: APP_WRAPPER_CONNECTING_MESSAGE,
  live: APP_WRAPPER_LIVE_MESSAGE,
  expired: APP_WRAPPER_EXPIRED_MESSAGE,
  'unreachable-origin': APP_WRAPPER_UNREACHABLE_MESSAGE,
  'run-ended': APP_WRAPPER_RUN_ENDED_MESSAGE,
}

const HINTS: Readonly<Record<AppWrapperState, string>> = {
  connecting: '',
  live: '',
  expired: APP_WRAPPER_EXPIRED_HINT,
  'unreachable-origin': '',
  'run-ended': '',
}

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

  const now = input.now ?? Date.now()

  // THE RENDERER IS AUTHORITATIVE ABOUT WHETHER A PANE EXISTS, rather than trusting the record it
  // was handed. `runLive: false` means the document must not be ABLE to show a pane, so the urls
  // never reach the script at all — a not-live document that still carried a minted token would be
  // a credential shipped for no reason, which is the one thing D-01's channel argument cannot
  // tolerate. The same line makes "zero surviving mints ⇒ not live" (408-01 D-C) structural here.
  const live = input.runLive && input.mints.length > 0
  const mints = live ? input.mints : []

  // The LOWEST expiry among the panes, because the document expires when the first of its links
  // does: showing a person a picker whose other option is already dead would be a worse lie than
  // saying the whole thing aged out.
  const lowestExpiry = mints.reduce(
    (lowest, mint) => (mint.expiresAt < lowest ? mint.expiresAt : lowest),
    Number.POSITIVE_INFINITY,
  )
  const expired = live && lowestExpiry <= now
  // The DELTA, not the deadline — see the header. Clamped at zero because a negative timeout is a
  // fact about this render, and this render already turned it into the `expired` initial state.
  const expiresInMs = expired || !live ? 0 : Math.max(0, lowestExpiry - now)

  const initialState: AppWrapperState = !live ? 'run-ended' : expired ? 'expired' : 'connecting'

  const mintsLiteral = (expired ? [] : mints)
    .map(
      (mint) =>
        `{handle:${scriptLiteral(String(mint.handle))},`
        + `url:${scriptLiteral(mint.liveUrl)},`
        + `kind:${scriptLiteral(mint.streamKind)}}`,
    )
    .join(',')

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
${live && !expired ? '<iframe data-app-live-frame sandbox="allow-scripts" referrerpolicy="no-referrer" title="agent-qa live view"></iframe>' : ''}
<p data-app-message>${MESSAGES[initialState]}</p>
<p data-app-hint>${HINTS[initialState]}</p>
<footer>${permanentLinkSlot}</footer>
</main>
<script>
(function () {
  var mints = [${mintsLiteral}];
  var runId = ${scriptLiteral(input.runId)};
  var permanentLink = ${scriptLiteral(input.permanentLink ?? '')};
  var expiresInMs = ${String(expiresInMs)};
  var loadTimeoutMs = ${String(APP_WRAPPER_LOAD_TIMEOUT_MS)};
  var messages = {
    connecting: ${scriptLiteral(APP_WRAPPER_CONNECTING_MESSAGE)},
    live: ${scriptLiteral(APP_WRAPPER_LIVE_MESSAGE)},
    expired: ${scriptLiteral(APP_WRAPPER_EXPIRED_MESSAGE)},
    'unreachable-origin': ${scriptLiteral(APP_WRAPPER_UNREACHABLE_MESSAGE)},
    'run-ended': ${scriptLiteral(APP_WRAPPER_RUN_ENDED_MESSAGE)}
  };
  var hints = {
    connecting: '',
    live: '',
    expired: ${scriptLiteral(APP_WRAPPER_EXPIRED_HINT)},
    'unreachable-origin': '',
    'run-ended': ''
  };

  var root = document.querySelector('[data-app-state]');
  var frame = document.querySelector('[data-app-live-frame]');
  var picker = document.querySelector('[data-app-handle-picker]');
  var message = document.querySelector('[data-app-message]');
  var hint = document.querySelector('[data-app-hint]');
  var link = document.querySelector('[data-app-permanent-link]');

  // WHICH RUN, as an attribute rather than as prose. Identity is not run STATE (D-11 forbids the
  // second, not the first), and it enters through setAttribute from an escaped literal, so a run
  // id can never become markup no matter what it spells.
  root.setAttribute('data-app-run-id', runId);

  // The state machine is an ATTRIBUTE plus two textContent writes, exactly as the embed page's is:
  // a state a person can read off the DOM is a state a cell can assert without screenshotting, and
  // text that arrives through textContent can never become markup.
  function setState(state) {
    root.setAttribute('data-app-state', state);
    message.textContent = messages[state] || '';
    hint.textContent = hints[state] || '';
  }

  if (link !== null && permanentLink !== '') {
    link.href = permanentLink;
    link.textContent = ${scriptLiteral(APP_WRAPPER_PERMANENT_LINK_LABEL)};
  }

  // ---- The minimal ui/initialize handshake (ext-apps spec shape) -------------------------------
  //
  // HAND-ROLLED AND DELIBERATELY ISOLATED IN THIS ONE BLOCK. The ext-apps package
  // declares a peer on the v1 monolith SDK, so importing its app-bridge into production would drag
  // a second SDK generation in (Pitfall 3) — and this page has no bundler anyway. RESEARCH
  // assumption A5 rates the method-name and field spellings MEDIUM (single spec fetch), so plan 06's
  // harness measures this exchange against the OFFICIAL app-bridge and may correct the spelling
  // here. Keeping it in one block with no other behaviour hanging off it is what makes that
  // correction a small diff instead of an archaeology exercise.
  //
  // IT ASKS FOR NOTHING. No permissions, no tools, no re-mint (D-10) — it announces that this
  // document is ready, which is all a wrapper that renders no run state of its own has to say.
  try {
    if (window.parent !== window) {
      window.parent.postMessage({
        jsonrpc: '2.0',
        id: 'ui-init-1',
        method: 'ui/initialize',
        params: { protocolVersion: '2026-01-26' }
      }, '*');
    }
  } catch (e) { /* a host that refuses the message changes nothing about what this page shows */ }

  if (mints.length === 0) {
    // Either D-07's honest terminal/unknown state or D-10's expired one — both were decided by the
    // RENDERER and are already in the markup. No src was ever assigned, so there is no blank frame
    // to mistake for a stalled one, and nothing below this line can move the document off them.
    return;
  }

  // ---- Reachability, once per ORIGIN (see the header's measured note) ---------------------------
  //
  // Memoised deliberately: the picker swaps among panes that share one origin, so after the first
  // pane every swap is answered from this map and issues NO network request at all (D-06/D-10's
  // "zero re-mints, zero calls", which the DOM cell counts).
  var reach = {};
  function reachable(url) {
    var origin;
    try { origin = new URL(url).origin; } catch (e) { return Promise.resolve(false); }
    if (reach[origin] === undefined) {
      reach[origin] = fetch(origin + '/', { mode: 'no-cors', cache: 'no-store' })
        .then(function () { return true; })
        .catch(function () { return false; });
    }
    return reach[origin];
  }

  var attachId = 0;
  var expiryTimer = null;

  function attach(mint) {
    var mine = (attachId += 1);
    var loaded = false;
    var settled = false;

    function settle(state) {
      if (settled || mine !== attachId) return;
      if (root.getAttribute('data-app-state') === 'expired') return;
      settled = true;
      setState(state);
    }

    setState('connecting');
    // THE ONLY PLACE A TOKEN IS WRITTEN. It goes into the frame's src and nowhere else.
    frame.src = mint.url;

    frame.addEventListener('error', function () { settle('unreachable-origin'); }, { once: true });
    frame.addEventListener('load', function () {
      // NECESSARY, NOT SUFFICIENT: Chromium fires this for a refused connection too (header note),
      // so the probe is what decides — a frame that loaded on an origin nothing answered for is an
      // error page, and calling that 'live' is the failure this arm exists to prevent.
      loaded = true;
      reachable(mint.url).then(function (ok) { settle(ok ? 'live' : 'unreachable-origin'); });
    }, { once: true });

    reachable(mint.url).then(function (ok) {
      if (!ok) settle('unreachable-origin');
      else if (loaded) settle('live');
    });

    // D-11's REQUIRED arm for the origin that never answers at all: a black-holed host fires no
    // error and never loads, so silence past this bound is itself the signal, named rather than
    // left as a spinner.
    setTimeout(function () { settle('unreachable-origin'); }, loadTimeoutMs);
  }

  // D-10: the deadline was computed at RENDER time and arrives as a delta, so the host's own clock
  // never enters the comparison. When it fires the document says so and stops — nothing here mints.
  if (expiresInMs > 0) {
    expiryTimer = setTimeout(function () {
      attachId += 1;
      if (frame !== null) frame.removeAttribute('src');
      setState('expired');
    }, expiresInMs);
  }

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
