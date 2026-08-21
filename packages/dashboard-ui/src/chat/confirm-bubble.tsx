// The browser's `[y/a/N]` (Phase 400 plan 06, D-06 / D-07).
//
// THIS IS A RENDER AND NOT APPROVAL MACHINERY, and every line below is written to keep it that way.
// The question was raised by the gate, parked in the server's confirm registry under a single-use
// session-bound id, and pushed down this conversation's SSE stream. What this component does is
// show it and send one of three words back. It holds no timer, mints no grant, and decides nothing
// — because each of those already exists exactly once, on the server, where 391's grant machinery
// and 392's confirm classification live (400-03).
//
// WHY THERE IS NO TIMER HERE, stated because adding one looks helpful. The confirm has a window and
// the server owns it: it denies on timeout, on the channel closing, and where no channel was open
// at all. A countdown in the browser would be a SECOND clock on one question, and two clocks
// disagree — a bubble that expired locally while the server still held the question open would
// leave a person unable to answer something that was still answerable, and one that expired later
// would show buttons for a decision already made. The server's `confirm_resolved` frame is what
// closes this bubble, and it says WHY.
//
// AND WHY A DENIED-ON-SILENCE MUST LOOK DENIED. Fail-closed is the product's deliberate answer to a
// channel that can vanish mid-question, not a failure to respond in time. Rendering it as "still
// waiting" — a spinner, a greyed bubble, a retry — would paper over a decision the system has
// already made and recorded, which is the one thing a transcript may not do.
//
// A MODAL WOULD BE THE OTHER WAY TO GET THIS WRONG (D-06). The cost preview a person needs in order
// to answer — "up to 9 runs" — arrived a moment earlier as a `chat_present` frame and is sitting in
// the transcript directly above. A dialog covers it, and the answer is then given without the
// disclosure. So the bubble is inline, in the flow, under its own context.

import type { ChatConfirmAnswer } from "@/lib/api"

export interface ConfirmBubbleProps {
  confirmId: string
  actionClass: string
  preview?: string
  resolution?: {
    answer: ChatConfirmAnswer
    /** WHY it resolved — a person, or one of the two silences. Rendered, never inferred. */
    by: "answer" | "timeout" | "channel-closed"
  }
  onAnswer: (confirmId: string, answer: ChatConfirmAnswer) => void
}

/**
 * The three answers, in the TTY's own order, spelled as the wire spells them.
 *
 * THE LITERALS ARE THE CONTRACT. `accept` / `accept-always` / `deny` are the registry's own enum
 * and the route validates against it with a closed `z.enum`, so a fourth or a renamed answer is a
 * 400 rather than a silent `undefined`. They are written out here rather than derived from a
 * prettier label, because the label is what a person reads and the literal is what the server acts
 * on, and those must be free to differ.
 */
const CONFIRM_ANSWERS: readonly { answer: ChatConfirmAnswer; label: string; hint: string }[] = [
  { answer: "accept", label: "Yes", hint: "allow this one invocation" },
  { answer: "accept-always", label: "Always", hint: "record a standing approval for this action class" },
  { answer: "deny", label: "No", hint: "refuse — nothing is carried out" },
]

const RESOLUTION_TEXT: Record<"answer" | "timeout" | "channel-closed", string> = {
  answer: "answered",
  timeout: "denied — nobody answered before the window closed",
  "channel-closed": "denied — this conversation stopped being watched",
}

export function ConfirmBubble({
  confirmId,
  actionClass,
  preview,
  resolution,
  onAnswer,
}: ConfirmBubbleProps) {
  return (
    <div
      data-confirm-bubble
      data-confirm-id={confirmId}
      {...(resolution === undefined
        ? {}
        : { "data-confirm-resolution": resolution.answer, "data-confirm-resolved-by": resolution.by })}
      className="flex flex-col gap-2 rounded-lg border border-sky-500/50 bg-sky-500/5 px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-foreground">Approval needed</span>
        <span className="font-mono text-xs text-muted-foreground">{actionClass}</span>
      </div>
      {/* The op's OWN disclosure, verbatim — the same string a later `grants.list` will show. */}
      {preview === undefined ? null : (
        <p data-confirm-preview className="text-xs text-muted-foreground">{preview}</p>
      )}
      {resolution === undefined ? (
        <div className="flex flex-wrap gap-2">
          {CONFIRM_ANSWERS.map(({ answer, label, hint }) => (
            <button
              key={answer}
              type="button"
              data-confirm-answer={answer}
              title={hint}
              onClick={() => { onAnswer(confirmId, answer) }}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent"
            >
              {label}
            </button>
          ))}
        </div>
      ) : (
        <p data-confirm-outcome className="text-xs text-muted-foreground">
          {resolution.answer === "deny" && resolution.by !== "answer"
            ? RESOLUTION_TEXT[resolution.by]
            : `${resolution.answer === "deny" ? "denied" : "approved"} — ${RESOLUTION_TEXT.answer}`}
        </p>
      )}
    </div>
  )
}
