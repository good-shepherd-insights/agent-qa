// The run button's `[y/a/N]` (Phase 401 plan 09, D-11).
//
// THIS IS A RENDER AND NOT APPROVAL MACHINERY, which is `confirm-bubble.tsx`'s first sentence and
// is just as true here. The question was raised by the policy gate, parked in the server's confirm
// registry under a single-use scope-bound id, and pushed down this browser's own trigger channel.
// What this component does is show it and send one of three words back. It holds no timer, mints no
// grant and decides nothing — each of those exists exactly once, on the server, where 391's grant
// machinery and 392's confirm classification live.
//
// THE SAME THREE ANSWERS, DELIBERATELY, AND NO FOURTH. `accept` / `accept-always` / `deny` are the
// registry's own enum and the route validates against it with a closed `z.enum`. "One confirm
// vocabulary across the dashboard" (D-11) is a claim about what a person is offered, so a fourth
// button here — "ask me later", "always for this file" — would be new approval semantics no gate
// can express, invented at the surface furthest from the decision.
//
// WHY THERE IS NO TIMER HERE, stated because adding one looks helpful. The confirm has a window and
// the server owns it: it denies on timeout, on the channel closing, and where no channel was open
// at all. A countdown in the browser would be a SECOND clock on one question, and two clocks
// disagree. The server's `confirm_resolved` frame is what closes this, and it says WHY.
//
// AND A DENIED-ON-SILENCE MUST LOOK DENIED. Fail-closed is the product's deliberate answer to a
// channel that can vanish mid-question, not a failure to respond in time. Rendering it as "still
// waiting" would paper over a decision the system has already made and recorded.
//
// A DIALOG HERE, WHERE CHAT USES AN INLINE BUBBLE, AND THE DIFFERENCE IS THE MEDIUM'S. The chat
// bubble is inline because the cost preview arrived a moment earlier as a `chat_present` frame and
// is sitting in the transcript directly above it — a modal would cover the disclosure the answer
// depends on. A run trigger has no transcript to sit in: the person clicked a button on a table and
// the preview travels WITH the question, on this component. So the disclosure and the answer are in
// the same frame, which is the same rule reaching the opposite layout.

import { useCallback, useEffect, useRef, useState } from "react"

import {
  answerRunConfirm,
  openRunConfirmChannel,
  setRunConfirmScope,
  type ChatConfirmAnswer,
  type ChatConfirmRequestFrame,
} from "@/lib/api"

export interface RunConfirmDialogProps {
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
 * THE LITERALS ARE THE CONTRACT and the labels are what a person reads; they are written out rather
 * than derived from one another because those two must be free to differ.
 */
const RUN_CONFIRM_ANSWERS: readonly { answer: ChatConfirmAnswer; label: string; hint: string }[] = [
  { answer: "accept", label: "Yes", hint: "allow this one run" },
  { answer: "accept-always", label: "Always", hint: "record a standing approval for this action class" },
  { answer: "deny", label: "No", hint: "refuse — the run does not start" },
]

// A LITERAL LIST, CHECKED BY A CELL RATHER THAN BY MODULE-LEVEL CODE. Deriving this array from
// `CONFIRM_ANSWER_VOCABULARY` at import time was the first shape, and it is the wrong one HERE:
// this component is reachable from the app shell, and several suites render that shell over a
// partial `@/lib/api` mock — so a module-level read of an api export makes an unrelated cell's
// mock, rather than this file, decide whether the dashboard renders at all (measured: 24 red cells
// across `update-banner` and `product-tour`). The membership claim lives where it costs nothing:
// `run-confirm-dialog.test.ts` reads the rendered buttons back and compares them to the wire's own
// enum, so a fourth answer added here still reds, and it reds in the file that added it.

const RESOLUTION_TEXT: Record<"answer" | "timeout" | "channel-closed", string> = {
  answer: "answered",
  timeout: "denied — nobody answered before the window closed",
  "channel-closed": "denied — this page stopped watching",
}

export function RunConfirmDialog({
  confirmId,
  actionClass,
  preview,
  resolution,
  onAnswer,
}: RunConfirmDialogProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Approval needed to start this run"
      data-run-confirm-dialog
      data-confirm-id={confirmId}
      {...(resolution === undefined
        ? {}
        : { "data-confirm-resolution": resolution.answer, "data-confirm-resolved-by": resolution.by })}
      className="fixed bottom-4 right-4 z-50 flex w-[22rem] flex-col gap-2 rounded-lg border border-sky-500/50 bg-background px-4 py-3 text-sm shadow-lg"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-foreground">Approval needed to start this run</span>
        <span className="font-mono text-xs text-muted-foreground">{actionClass}</span>
      </div>
      {/* The action's OWN disclosure, verbatim — the same string a later `grants.list` will show. */}
      {preview === undefined ? null : (
        <p data-confirm-preview className="text-xs text-muted-foreground">{preview}</p>
      )}
      {resolution === undefined ? (
        <div className="flex flex-wrap gap-2">
          {RUN_CONFIRM_ANSWERS.map(({ answer, label, hint }) => (
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

/**
 * The one trigger confirm channel this page holds, and the dialog it raises.
 *
 * MOUNTED ONCE IN THE APP SHELL, beside the other global overlays, for the reason the scope box in
 * `api.ts` gives: "which browser is asking" is a property of this page and not of any one trigger,
 * and there are nine places that start a run. One channel here covers all of them, and a tenth
 * trigger added tomorrow inherits it without anybody remembering to.
 *
 * IT OPENS THE CHANNEL ON MOUNT, NOT ON A CLICK. The queue dispatches in the same tick the trigger
 * route enqueues, so a channel opened when a run is requested is already too late — the run's gate
 * may have decided. Being on the page IS being askable.
 *
 * THE RESOLVED DIALOG LINGERS BRIEFLY. A question that resolved because nobody answered it has to
 * be SEEN to have been denied; closing it the instant the frame arrives would make a fail-closed
 * denial indistinguishable from a dialog that never appeared.
 */
export const RESOLVED_DIALOG_LINGER_MS = 6_000

/**
 * How many arriving questions may WAIT behind the one on screen.
 *
 * EXPORTED SO THE CELLS READ THIS VALUE rather than spell a second one: a bound written twice is a
 * bound that agrees with the test file right up until somebody changes it here.
 */
export const MAX_QUEUED_CONFIRMS = 4

export function RunConfirmHost() {
  const [pending, setPending] = useState<ChatConfirmRequestFrame | undefined>(undefined)
  const [resolution, setResolution] = useState<RunConfirmDialogProps["resolution"]>(undefined)
  const scopeRef = useRef<string | undefined>(undefined)
  // THE QUESTION THIS HOST IS CURRENTLY ASKING (401-14, CR-05).
  //
  // A REF FOR THE SAME REASON `scopeRef` IS ONE: the channel's callbacks are captured ONCE at
  // mount, so React state read inside them is the state as of that render and stays there forever.
  // A guard written against `pending` would compare every later frame against `undefined` and
  // therefore ignore every resolution, including the right one.
  const pendingConfirmIdRef = useRef<string | undefined>(undefined)
  // THE QUESTIONS WAITING THEIR TURN (401-16, G-401-15 / WR-05).
  //
  // A REF FOR THE SAME REASON THE TWO ABOVE ARE REFS — the channel's callbacks are captured once at
  // mount, so a queue in `useState` would be read as `[]` by every arrival after the first and the
  // third question would vanish while the second still worked.
  const queuedConfirmsRef = useRef<ChatConfirmRequestFrame[]>([])

  /**
   * Raise the next question that is still worth asking.
   *
   * REACHABLE FROM WHEREVER THE PENDING ID IS CLEARED, not only from the linger timer: a question
   * can resolve with no dialog left to render it onto, and a drain wired to one clearing site
   * would leave the queue standing while nothing was on screen.
   *
   * Stable (`[]` deps, refs and setters only) so the mount-captured channel callbacks may hold it.
   */
  const raiseNextQueued = useCallback(() => {
    const next = queuedConfirmsRef.current.shift()
    if (next === undefined) return
    pendingConfirmIdRef.current = next.confirmId
    setResolution(undefined)
    setPending(next)
  }, [])

  useEffect(() => {
    // NO SSE, NO CHANNEL, NO CLAIM — and the page still renders. A document that cannot hold a
    // server-sent-events connection cannot be asked a question, which is a real posture and the
    // fail-closed one: every trigger from here carries no scope and its ask-tier runs deny by name.
    // It is guarded rather than assumed because the shell mounts this unconditionally, and a throw
    // in an effect at the top of the tree takes the whole dashboard down to protect nothing.
    if (typeof EventSource === "undefined") return
    let source: EventSource
    try {
      source = openRunConfirmChannel({
        onScope: (frame) => {
          scopeRef.current = frame.scopeId
          setRunConfirmScope(frame.scopeId)
        },
        onConfirmRequest: (frame) => {
          // AN ARRIVING QUESTION WAITS FOR THE ONE ON SCREEN (401-16, G-401-15; ruled at UAT
          // test 1). This assignment used to be unconditional, so a second Run click replaced the
          // first question inside a second — not disabled, not marked superseded, not stacked;
          // gone from the document. Its denial then arrived thirty seconds later and was correctly
          // dropped by the keyed guard below, which is what made the loss silent rather than
          // misattributed. A person asked two questions gets to answer the first one.
          if (pendingConfirmIdRef.current !== undefined) {
            // BOUNDED, AND THE NEWEST ARRIVAL IS WHAT GETS DROPPED. Evicting an older waiting
            // question in favour of a newer one is the clobber this fix removes, one position
            // further down; and the older ones are nearer their own windows, so they are the ones
            // a person can still usefully be asked. Past the bound the arrival is dropped here and
            // its run denies fail-closed at its window, exactly as an unanswered question does.
            if (queuedConfirmsRef.current.length < MAX_QUEUED_CONFIRMS) {
              queuedConfirmsRef.current.push(frame)
            }
            return
          }
          pendingConfirmIdRef.current = frame.confirmId
          setResolution(undefined)
          setPending(frame)
        },
        onConfirmResolved: (frame) => {
          // ONLY THIS QUESTION'S OWN RESOLUTION (401-14, CR-05) — the keyed semantic the chat
          // sibling has always applied at its reducer (`use-chat-turn.ts` matches on `confirmId`
          // before it writes a resolution onto an entry). Without it a stale or overlapping frame
          // rendered the pending question as resolved with ANOTHER question's answer, and the
          // linger timer below then cleared it — costing the person the chance to answer.
          //
          // NOT A SECURITY GUARD, and it must not be mistaken for one: `answerRunConfirm` posts
          // the real confirmId and the SERVER decides, so a spurious "approved" render approved
          // nothing. What was lost was the answer, not the decision.
          if (frame.confirmId !== pendingConfirmIdRef.current) {
            // A QUEUED QUESTION'S WINDOW KEEPS RUNNING WHILE IT WAITS (401-16). If this frame
            // belongs to one of them, its window has already closed and it must never be raised
            // afterwards — handing somebody a dialog whose three buttons do nothing would trade a
            // silent denial for a click that lies, which is worse than what this plan repaired.
            // Dropping it here is a SEPARATE concern from the guard above and does not touch it:
            // no resolution is written for anything but the question on screen.
            queuedConfirmsRef.current = queuedConfirmsRef.current
              .filter((queued) => queued.confirmId !== frame.confirmId)
            return
          }
          setResolution({ answer: frame.answer, by: frame.by })
        },
      })
    } catch {
      return
    }
    return () => {
      source.close()
      pendingConfirmIdRef.current = undefined
      // EMPTIED WITH THE CHANNEL THAT RAISED IT. A queue outliving its socket would raise a
      // question addressed to a scope that no longer exists — answerable-looking, unanswerable.
      queuedConfirmsRef.current = []
      // CLEARED ON THE WAY OUT. A stale scope on a closed channel would make every later trigger
      // name a browser that is no longer there — the run would still deny fail-closed, but it would
      // deny after claiming somebody was reachable, which is the dishonest half.
      scopeRef.current = undefined
      setRunConfirmScope(undefined)
    }
  }, [])

  useEffect(() => {
    if (resolution === undefined) return
    const timer = setTimeout(() => {
      // The pending id is cleared WITH the question it belongs to — one place clears both, so a
      // frame arriving after the linger cannot match an id no dialog is showing.
      pendingConfirmIdRef.current = undefined
      setPending(undefined)
      setResolution(undefined)
      // AND THE NEXT QUESTION IS RAISED HERE, where the pending id is cleared — not a moment
      // earlier. The person reading why their run was refused is not handed the next question
      // underneath the answer they are still reading.
      raiseNextQueued()
    }, RESOLVED_DIALOG_LINGER_MS)
    return () => { clearTimeout(timer) }
  }, [resolution, raiseNextQueued])

  if (pending === undefined) return null

  return (
    <RunConfirmDialog
      confirmId={pending.confirmId}
      actionClass={pending.actionClass}
      {...(pending.preview === undefined ? {} : { preview: pending.preview })}
      {...(resolution === undefined ? {} : { resolution })}
      onAnswer={(confirmId, answer) => {
        const scopeId = scopeRef.current
        if (scopeId === undefined) return
        // FIRE AND FORGET, and the resolution is read off the SERVER's frame rather than from this
        // promise: the server is what decides, and a click that raced the window's own reaper would
        // otherwise render an approval the gate never granted.
        void answerRunConfirm({ scopeId, confirmId, answer }).catch(() => undefined)
      }}
    />
  )
}
