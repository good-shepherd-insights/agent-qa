// The SERVED EMBED PAGE (403 D-06/D-08, ratified 2026-08-25).
//
// THIS DOCUMENT IS THE PRODUCT'S PUBLISHED SURFACE for a live view. A `liveUrl` resolves to it, an
// iframe in the dashboard shows it, and 408's MCP App embed will show the same bytes — so what it
// renders in every state is a contract, not a detail.
//
// SELF-CONTAINED, NONCE'D, AND `default-src 'none'`. One inline script, no imports, no fetches
// except the socket. The run id is inserted through `textContent` in that script rather than
// interpolated into markup, so a run id can never become markup (T-403-09).
//
// EVERY ABSENCE IS NAMED. There is no state in which this page shows a blank rectangle: an expired
// link says `link expired`, a target that cannot stream says so, an unknown stream kind says so.
// A live preview that fails silently is indistinguishable from a run that is not running, which is
// the one thing a person watching must be able to tell.

import { LIVE_VIEW_WS_PATH } from './protocol.js'

/** Every value `[data-embed-state]` can take. The 403-02 DOM cells range this list. */
export const LIVE_EMBED_STATES = [
  'connecting',
  'live',
  'no-stream',
  'expired',
  'refused',
  // THIS MEMBER'S STREAM ENDED WHILE THE RUN CONTINUES (403 CR-03). Separate the whole run's end,
  // because a person watching one member of a suite needs to know which of the two happened — and
  // neither may be shown as `live` over whichever frame happened to be last.
  'stream-ended',
  'ended',
  'lost',
] as const

export type LiveEmbedState = (typeof LIVE_EMBED_STATES)[number]

/**
 * What an EXPIRED link says, exactly (D-02).
 *
 * Exported so the tracer cell and 403-02's DOM cells assert the SAME string the page renders — a
 * literal spelled twice is a literal that can drift, and this one is the difference between a
 * person seeing "your link timed out" and a person seeing nothing at all.
 */
export const LIVE_EMBED_EXPIRED_MESSAGE = 'link expired'

const STYLE = `
  :root { color-scheme: dark light }
  html, body { margin: 0; height: 100%; background: #0b0d10; }
  main { display: grid; place-items: center; height: 100%; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: #c9d1d9; }
  canvas { max-width: 100%; max-height: 100%; display: none; pointer-events: none; }
  main[data-embed-state="live"] canvas { display: block; }
  main[data-embed-state="live"] p { display: none; }
`

/**
 * Render the page for one run.
 *
 * `nonce` is minted per response by the caller and appears in both the CSP header and the two
 * inline elements; a page served twice never reuses one.
 */
export function renderLiveEmbedPage(input: { runId: string; nonce: string }): string {
  // JSON.stringify is the escape: the value lands inside a script as a STRING LITERAL, and the
  // `<` guard below closes the one hole that leaves (a `</script` sequence inside it).
  const runIdLiteral = JSON.stringify(input.runId).replaceAll('<', '\\u003c')
  const wsPathLiteral = JSON.stringify(LIVE_VIEW_WS_PATH)
  const expiredLiteral = JSON.stringify(LIVE_EMBED_EXPIRED_MESSAGE)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-qa live view</title>
<style nonce="${input.nonce}">${STYLE}</style>
</head>
<body>
<main data-embed-state="connecting" data-embed-frames="0">
<canvas data-embed-canvas width="0" height="0"></canvas>
<p data-embed-message>connecting…</p>
</main>
<script nonce="${input.nonce}">
(function () {
  var runId = ${runIdLiteral};
  var root = document.querySelector('[data-embed-state]');
  var canvas = document.querySelector('[data-embed-canvas]');
  var message = document.querySelector('[data-embed-message]');
  var ctx = canvas.getContext('2d');
  var frames = 0;

  function setState(state, text) {
    root.setAttribute('data-embed-state', state);
    message.textContent = text;
  }

  // THE TOKEN IS READ FROM THE FRAGMENT AND NEVER PUT BACK ANYWHERE. It is not written to the
  // document, not added to the socket URL, and not stored — it goes into one message and stays
  // in this closure.
  var token = location.hash.slice(1);
  if (token === '') {
    setState('refused', 'missing token');
    return;
  }

  var scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
  var socket = new WebSocket(scheme + location.host + ${wsPathLiteral} + '?runId=' + encodeURIComponent(runId));
  socket.binaryType = 'arraybuffer';

  var pending = null;
  var ended = false;

  socket.addEventListener('open', function () {
    socket.send(JSON.stringify({ type: 'hello', token: token }));
  });

  socket.addEventListener('message', function (event) {
    if (typeof event.data !== 'string') {
      // The binary half of a frame pair. Paint it, count it, then ack — the ack is what asks the
      // producer for the next one, so it goes AFTER the paint is scheduled.
      if (pending === null) return;
      var header = pending;
      pending = null;
      var blob = new Blob([event.data], { type: 'image/jpeg' });
      createImageBitmap(blob).then(function (bitmap) {
        if (canvas.width !== header.width || canvas.height !== header.height) {
          canvas.width = header.width;
          canvas.height = header.height;
        }
        ctx.drawImage(bitmap, 0, 0, header.width, header.height);
        bitmap.close();
        frames += 1;
        root.setAttribute('data-embed-frames', String(frames));
        if (!ended) setState('live', 'live');
        socket.send(JSON.stringify({ type: 'ack', id: header.id }));
      }).catch(function () {
        socket.send(JSON.stringify({ type: 'ack', id: header.id }));
      });
      return;
    }

    var msg;
    try { msg = JSON.parse(event.data); } catch (e) { return; }

    if (msg.type === 'ready') {
      // THE PAINTER IS CHOSEN BY THE DECLARED KIND — never by a browser name, an adapter class or
      // a transport guess (LIVE-04's prohibition).
      if (msg.stream && msg.stream.kind === 'cdp-screencast') {
        setState('connecting', 'waiting for the first frame…');
      } else if (msg.stream && msg.stream.kind === 'none') {
        setState('no-stream', 'no live preview for this target — steps still advance below');
      } else {
        setState('no-stream', 'unsupported stream kind');
      }
      return;
    }
    if (msg.type === 'frame') {
      pending = { id: msg.id, width: msg.width, height: msg.height };
      return;
    }
    if (msg.type === 'refused') {
      ended = true;
      if (msg.reason === 'expired') setState('expired', ${expiredLiteral});
      else setState('refused', String(msg.reason));
      return;
    }
    if (msg.type === 'ended') {
      // EVERY ABSENCE IS NAMED, AND THESE ARE TWO DIFFERENT ABSENCES. Painting stops either way --
      // the canvas is hidden outside the live state -- so neither end can leave a frozen frame on
      // screen labelled as though it were still arriving.
      ended = true;
      if (msg.reason === 'handleFinished') setState('stream-ended', 'this target finished — the run is still going');
      else setState('ended', 'run ended');
      return;
    }
  });

  socket.addEventListener('close', function () {
    if (ended) return;
    if (root.getAttribute('data-embed-state') === 'expired') return;
    if (root.getAttribute('data-embed-state') === 'refused') return;
    setState('lost', 'connection lost');
  });

  // A HOST THAT RE-MINTS replaces the fragment; the socket renews in place rather than reloading,
  // so a renewal never costs the viewer the stream it is watching (D-02).
  window.addEventListener('hashchange', function () {
    var next = location.hash.slice(1);
    if (next === '' || socket.readyState !== 1) return;
    token = next;
    socket.send(JSON.stringify({ type: 'renew', token: next }));
  });
}());
</script>
</body>
</html>
`
}
