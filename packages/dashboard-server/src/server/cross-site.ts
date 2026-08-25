// The same-site guard, shared by every door that must not answer a page on another origin.
//
// WHY THIS FILE EXISTS. The predicate below was written for the chat door in 400-14 and lived
// private inside `chat/chat-routes.ts`. Phase 403's verification found the live-url MINT door
// standing open with the identical shape of hole, and a second door needs the identical answer:
// two spellings of "is this cross-site" is two policies, free to disagree the first time either is
// edited. The chat door now imports what it used to define, so its one call site reads the same
// bytes it always did.
//
// THE POLICY IS UNCHANGED BY THE MOVE. What follows is the chat door's recorded policy verbatim,
// rung for rung, comment for comment.

import type { IncomingMessage } from 'node:http'

/**
 * Refuse a request that a page on another origin drove (400-14, gap 6 — T-400-G6-01/02).
 *
 * THE RECORDED POLICY, and each rung is a decision rather than a default:
 *
 * - An ABSENT `Origin` is ALLOWED. This is a localhost door and its shipped norm is a person with a
 *   terminal: `curl`, a script, the CLI. No browser omits `Origin` on a cross-origin POST, so
 *   absence is evidence of a non-browser caller, and refusing it would brick every local drive to
 *   defend against nothing.
 * - An `Origin` whose HOST equals the request's own `Host` is allowed — that is the dashboard's own
 *   page driving its own door, which is exactly what must keep working.
 * - The literal `null` and every other value are REFUSED. `null` is what a sandboxed iframe, a
 *   `data:` document and a redirected cross-origin request send; it is not "no origin", it is an
 *   origin that declined to name itself.
 * - `Sec-Fetch-Site`, when the browser sends it, must say `same-origin` or `none`. It is checked
 *   BESIDE `Origin` and not instead of it: it is unforgeable by page script where `Origin` is only
 *   unforgeable by fetch, and it is absent on every non-browser client, so neither alone is total.
 *
 * WHY THE SCHEME IS NOT COMPARED. The bound door speaks `http` on loopback and the header carries
 * an absolute origin; comparing hosts keeps the check honest behind the `https` terminator an
 * operator may put in front of it, which is the deployment shape Phase 402 owns.
 *
 * WHY THIS LIVES HERE AND NOT IN `body-parser.ts`. That parser also serves the legacy read routes
 * whose wildcard-CORS posture is Phase 402's re-platform question. Widening it here would change
 * the posture of routes this phase does not own; `chat/chat-routes.ts` already keeps its own
 * responder and its own preflight for exactly that reason, and this was the third member of that
 * set before it moved here to be shared.
 */
export function refuseCrossSiteRequest(req: IncomingMessage): string | undefined {
  const refusal = 'Cross-site request refused: this door is driven from its own origin or from a '
    + 'local client that sends no Origin'
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    const host = typeof req.headers.host === 'string' ? req.headers.host.toLowerCase() : ''
    let originHost: string
    try {
      originHost = new URL(origin).host.toLowerCase()
    } catch {
      // Includes the literal `null`, which parses as no URL at all — a sandboxed frame, a
      // `data:` document, or a cross-origin redirect. Refused with everything else.
      return refusal
    }
    if (originHost === '' || host === '' || originHost !== host) return refusal
  }

  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return refusal

  return undefined
}
