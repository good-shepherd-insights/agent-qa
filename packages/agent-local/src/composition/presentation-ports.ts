// The presentation ports the run composition is HANDED rather than constructs (Phase 385, D-13).
//
// The dissection line this phase drew, stated once so 386 and every later host can apply the same
// one: a symbol is host-neutral when a process with no controlling terminal and nobody reading its
// output can run it to completion — its inputs and outputs are data and ports. A symbol is
// presentation when its only consumer is a human at this process's terminal. The operational test
// is a question about the daemon, not about the code: would a headless drainer call this symbol as
// written, or would it have to substitute something else (a log sink for a reporter, a policy for a
// prompt)? If it would substitute, the thing it substitutes is a port, and the port's TYPE is what
// lives here while the construction stays in the host.
//
// Consequence worth naming: types cross into this package, constructions that only a terminal host
// needs do not. `createLivePauseController` and the human-output unmasking confirm decorator stay in
// the CLI for exactly that reason — a daemon binds no live line and must never unmask for a human.

import type { ConfirmPort } from '@vostride/agent-qa-safety'
import type { RunEventEnvelope } from '@vostride/agent-qa-schema'

/**
 * The console pause/resume seam shared between a host's live reporter and the confirm decorator
 * that has to flush the live line before a question is asked. The composition only ever holds it
 * and passes it down; the implementation, and the decision to have one at all, is the host's.
 * Guards swallow their own errors so a reporter fault never blocks a prompt.
 */
export interface LivePauseController {
  pauseLive(): void
  resumeLive(): void
  bind(handle: { pauseLive(): void; resumeLive(): void } | undefined): void
}

/** A bus subscriber a host attaches: an envelope `handler` plus an optional post-run `flush`. */
export interface RunSubscriberHandle {
  handler: (envelope: RunEventEnvelope) => void
  flush?: () => Promise<void>
}

/** The minimal RunSession surface a subscriber attachment needs (subscribe replay-then-live). */
export interface AttachableRunSession {
  subscribe(fromSeq: number | undefined, handler: (envelope: RunEventEnvelope) => void): () => void
}

/**
 * The presentation capabilities the host-neutral run composition consumes directly. Deliberately
 * small: it carries what the composition actually calls, not everything a host owns. Reporter
 * attachment and the live seam are NOT fields here because the composition never touches them —
 * the host does, over the vocabulary declared above, which is why that vocabulary lives in this
 * file even though nothing in the composition reads it.
 */
export interface RunPresentationPorts {
  /**
   * The human confirm channel. Required, with no default: the default that used to live at this
   * seam was a readline prompt, and a headless host silently inheriting a terminal prompt is a
   * hang, not a fallback. A host with no human supplies a policy port instead.
   */
  confirm: ConfirmPort
  /**
   * A host wrapper applied OUTSIDE the composition's pause-timing decorator, for hosts that render
   * the prompt to a person. The nesting is the point and is why this is a hook rather than a second
   * confirm field: timing has to sit closest to the awaited answer so it measures the human's
   * deliberation and not the host's rendering. A host with no human omits it.
   */
  decorateConfirmForHuman?: (timedConfirm: ConfirmPort) => ConfirmPort
}
