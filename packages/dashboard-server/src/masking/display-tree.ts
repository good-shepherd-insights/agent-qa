// THE DISPLAY-UNMASK TREE WALK (Phase 405 plan 10, D-09 · RESEARCH Pitfall 3).
//
// ONE SEAM, APPLIED PER STRING ON THE RESPONSE TREE — never on a serialized body. A restored secret
// can contain a quote, a backslash or a newline, so unmasking a JSON string would produce bytes
// that no longer parse; the door would then answer a person with a 500 about a run that is
// perfectly fine, or worse, hand a client a body it silently mis-reads. Walking the tree BEFORE
// serialization means the restored value is escaped by `JSON.stringify` exactly as any other
// string is, and the seam has no opinion about transport at all.
//
// BUFFERS ARE HANDED STRAIGHT BACK, BY REFERENCE. Artifact bytes are never unmasked (D-09) — there
// is no text in a PNG to restore, and decoding one to look would be both wrong and expensive. Any
// value that is not a string, a plain object or an array passes through untouched for the same
// reason: this walk restores TEXT, and anything else is somebody else's data.
//
// THE INPUT IS NEVER MUTATED. The op's result may be shared (a cached projection, a row a second
// arm also reads), and a walk that rewrote it in place would put a restored secret into whatever
// else holds that object — including, in the wrong composition, a durable one.

import type { AgentHost } from '../chat/host.js'

/** Only the seam this walk needs — so a cell can drive it with a two-line host. */
export type DisplayUnmaskHost = Pick<AgentHost, 'unmaskForDisplay'>

/** A plain data object: an array's sibling, not a class instance, a Date or a Buffer. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (Array.isArray(value) || Buffer.isBuffer(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/**
 * Restore every string in `value` through the host's display seam, scoped to one run.
 *
 * The scope is REQUIRED here even though `unmaskForDisplay`'s own is optional: a tree walk is only
 * ever performed on a run-scoped read, and the scope-less call is chat's identity path (405-10's
 * D-09 note), which has no tree to walk.
 */
export function unmaskTreeForDisplay(
  host: DisplayUnmaskHost,
  value: unknown,
  scope: { runId: string },
): unknown {
  if (typeof value === 'string') return host.unmaskForDisplay(value, scope)
  if (Array.isArray(value)) return value.map((entry) => unmaskTreeForDisplay(host, entry, scope))
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      out[key] = unmaskTreeForDisplay(host, entry, scope)
    }
    return out
  }
  return value
}
