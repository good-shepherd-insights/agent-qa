// THE shared transcript — the fourth door's one render channel (Phase 400 plan 06, DASH-01 / D-13).
//
// ONE COMPONENT, TWO MOUNTS. The `/chat` page and the global side panel both render
// `<ChatTranscript />` from this module and neither owns a line of transcript logic. That is not a
// tidiness preference: DASH-01's claim is that a person chats with the QA agent "through ONE
// registry-driven render channel, never a second hardcoded entry", and a per-placement renderer is
// exactly the second entry — two copies of the status vocabulary, the labeling law and the payload
// default, agreeing until one of them is edited. Plan 400-09's DOM cell proves the panel mounts
// this module.
//
// THE LAWS IT CARRIES, ALL FOUR, ALL FROM THE CLI'S SHIPPED RENDER:
//
//   1. The status vocabulary is closed at four and every member is VISUALLY DISTINCT with text a
//      person and a screen reader can both read. Total map, no default arm (`receipt-row.tsx`).
//   2. A payload is labelled with its op id when the turn filed more than ONE RECEIPT — receipt
//      count, not result count (`result-render.ts`; 399.1 gap 2).
//   3. The COMPLETE masked payload renders EXPANDED by default and registry folds render ABOVE it.
//      Folds add legibility and can never suppress (399.1 D-04, D-14). Collapse is a user toggle.
//   4. A denial renders the remedies THIS surface can take, through the one published projection
//      (`remediesRenderableBy`), and nothing it cannot (D-15).
//
// AND ONE THING IT DELIBERATELY DOES NOT DO: it does not unmask. The bytes reaching this component
// crossed `unmaskForHumanOutput` once already, at the door's own emit, because the masking context
// lives in the server process and a browser must never be handed one (see
// `dashboard-server/src/chat/host.ts`'s `unmaskForDisplay`).

import { useState, type FormEvent } from "react"

import {
  remediesRenderableBy,
  type GateRemedy,
  type RemedyKindFor,
} from "@vostride/agent-qa-schema"

import { useChatSession } from "@/chat/chat-session-context"
import { ChatMarkdown } from "@/chat/chat-markdown"
import { ConfirmBubble } from "@/chat/confirm-bubble"
import { EntityCard, entityCardsIn } from "@/chat/entity-card"
import { ReceiptRow } from "@/chat/receipt-row"
import type { ChatEntry, ChatTranscriptState, ChatTurnStatus } from "@/chat/use-chat-turn"
import type { ChatCapabilityRow, ChatConfirmAnswer } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * The identity of THIS MODULE INSTANCE, minted once when the module is evaluated (400-09, D-13).
 *
 * WHAT IT PROVES THAT A FIXED ATTRIBUTE CANNOT. `data-chat-transcript` says "something rendered a
 * transcript here"; a second, per-placement renderer could carry the same attribute and the mount
 * would look identical. D-13's claim is stronger and more specific — the `/chat` page and the
 * global panel resolve to ONE module — and the only observable that distinguishes one module from
 * two copies of it is a value the module minted for itself. Two mounts of one instance carry the
 * same value; a second copy of this file, or a bundle that duplicated it into two chunks, carries
 * two different ones.
 *
 * IT IS A PER-LOAD VALUE AND THAT IS DELIBERATE. Pinning a constant string would be an attribute
 * anybody could copy into a second renderer, which is the exact thing being ruled out. Nothing
 * reads it but a test and a person debugging; it is not an id, not a key, and nothing routes on it.
 */
export const CHAT_TRANSCRIPT_MODULE_ID = `ctm-${Math.random().toString(36).slice(2, 12)}`


export interface ChatTranscriptViewProps {
  state: ChatTranscriptState
  status: ChatTurnStatus | string
  starters: readonly string[]
  /**
   * The committed catalog's rows, for `/fn <op>` completion. Optional so a cell can drive the
   * render without one — and because a door composed with no catalog loader honestly has none.
   */
  capabilities?: readonly ChatCapabilityRow[]
  onSend: (utterance: string) => void
  onAnswerConfirm: (confirmId: string, answer: ChatConfirmAnswer) => void
}

/** The prefix a person types when they mean an op id — the resolver table's own passthrough. */
const FN_PREFIX = "/fn "

/**
 * The op ids a half-typed `/fn` could mean, READ OFF THE COMMITTED CATALOG.
 *
 * NOT ASSEMBLED HERE, and that is the whole design. The set of capabilities has exactly one
 * published answer — the artifact produced from a real composition's declarations — and a list this
 * component built from anything else would be a second one, free to advertise an op this door
 * cannot reach. Empty in, empty out: no catalog means no suggestions, never a guess.
 */
function completionsFor(
  draft: string,
  capabilities: readonly ChatCapabilityRow[],
): readonly string[] {
  if (!draft.startsWith(FN_PREFIX)) return []
  const typed = draft.slice(FN_PREFIX.length).trimStart().split(/\s/)[0] ?? ""
  const ids = new Set<string>()
  for (const row of capabilities) {
    const id = row.opId ?? row.targetOpId
    if (id !== undefined && id.includes(typed)) ids.add(id)
  }
  return [...ids].sort().slice(0, 8)
}

/**
 * How each dashboard-takeable remedy reads in a browser — TOTAL over THAT SET, derived.
 *
 * THE KEY SET IS COMPUTED FROM THE SHIPPED SURFACE TABLE, not listed here. `RemedyKindFor<'dashboard'>`
 * is derived from `GATE_REMEDY_SURFACES_BY_KIND`, so the day a remedy kind is added with
 * `dashboard` among its surfaces, THIS RECORD is missing a required arm and this line fails to
 * compile. A hand-written list of "the kinds the dashboard renders" would be a second copy of that
 * table, free to drift — and the drift presents as a remedy the gate mints for this door and this
 * door silently drops, which is the very defect D-15 closes.
 */
const DASHBOARD_REMEDY_TEXT = {
  "answer-confirm":
    "keep this chat open and re-run it — an ask-tier op raises a confirm here that you can answer",
  "session-pin-final":
    "this action class is pinned DENY for this conversation; a pin cannot be lifted, so start a new chat session to run it",
} as const satisfies Record<RemedyKindFor<"dashboard">, string>

/**
 * The transcript, given everything explicitly.
 *
 * SEPARATE FROM THE `ChatTranscript` BINDING ONLY BY WHERE ITS PROPS COME FROM. This view takes
 * data; `ChatTranscript` (plan 06 task 3) reads the shared session and renders this. Both produce
 * the SAME element tree from the same module, which is what keeps "one render channel" a
 * structural fact rather than a promise, while letting a cell drive the render with a state it
 * constructed.
 */
export function ChatTranscriptView({
  state,
  status,
  starters,
  capabilities = [],
  onSend,
  onAnswerConfirm,
}: ChatTranscriptViewProps) {
  const [draft, setDraft] = useState("")
  const completions = completionsFor(draft, capabilities)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    // VERBATIM. `/fn <op> {json}` and every directive go to the server exactly as typed — the
    // resolver table owns that grammar (D-10) and a browser-side parse would be a second one.
    onSend(draft)
    setDraft("")
  }

  return (
    <div
      data-chat-transcript
      data-chat-transcript-module={CHAT_TRANSCRIPT_MODULE_ID}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <div
        data-chat-entries
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1"
        role="log"
        aria-live="polite"
      >
        {state.entries.length === 0 ? (
          <StarterPrompts starters={starters} onSend={onSend} />
        ) : null}
        {state.entries.map((entry) => (
          <TranscriptEntry
            key={entry.id}
            entry={entry}
            receiptCount={
              "turnId" in entry ? (state.receiptCountByTurn[entry.turnId] ?? 0) : 0
            }
            onAnswerConfirm={onAnswerConfirm}
            onSend={onSend}
          />
        ))}
      </div>
      {completions.length === 0 ? null : (
        <div data-chat-completions className="flex flex-wrap gap-1">
          {completions.map((id) => (
            <button
              key={id}
              type="button"
              data-chat-completion={id}
              onClick={() => { setDraft(`${FN_PREFIX}${id} `) }}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-accent"
            >
              {id}
            </button>
          ))}
        </div>
      )}
      <form data-chat-form onSubmit={submit} className="flex items-end gap-2">
        <textarea
          data-chat-input
          value={draft}
          rows={2}
          onChange={(event) => { setDraft(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              submit(event)
            }
          }}
          placeholder="Ask the QA agent — or type /help, or /fn <op> {json}"
          className="min-h-[3rem] flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          data-chat-send
          type="submit"
          disabled={status === "sending"}
          className="rounded-md border border-border bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {status === "sending" ? "Sending…" : "Send"}
        </button>
      </form>
    </div>
  )
}

/**
 * THE shared transcript, bound to the app's ONE chat session.
 *
 * THIS is what both mounts render, and it takes NO PROPS on purpose. A mount that could configure
 * the transcript would be a mount that could configure it DIFFERENTLY, and the per-placement
 * divergence D-13 forbids would arrive one prop at a time rather than as a second file. `/chat` and
 * the panel each contain exactly `<ChatTranscript />`; plan 400-09's thin DOM cell proves they
 * resolve to this module.
 */
export function ChatTranscript() {
  const session = useChatSession()
  return (
    <ChatTranscriptView
      state={session.state}
      status={session.status}
      starters={session.starters}
      capabilities={session.capabilities}
      onSend={session.sendTurn}
      onAnswerConfirm={session.answerConfirm}
    />
  )
}

function StarterPrompts({
  starters,
  onSend,
}: {
  starters: readonly string[]
  onSend: (utterance: string) => void
}) {
  return (
    <div data-chat-starters className="flex flex-col gap-2 p-2 text-sm text-muted-foreground">
      <p>Ask about your tests, runs and configuration. Everything happens through the same gated capabilities the CLI uses.</p>
      <div className="flex flex-wrap gap-2">
        {starters.map((starter) => (
          <button
            key={starter}
            type="button"
            data-chat-starter
            onClick={() => { onSend(starter) }}
            className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
          >
            {starter}
          </button>
        ))}
      </div>
    </div>
  )
}

function TranscriptEntry({
  entry,
  receiptCount,
  onAnswerConfirm,
  onSend,
}: {
  entry: ChatEntry
  receiptCount: number
  onAnswerConfirm: (confirmId: string, answer: ChatConfirmAnswer) => void
  /** The chat door, threaded down so a card action leaves the same way a typed line does. */
  onSend: (utterance: string) => void
}) {
  switch (entry.kind) {
    case "utterance":
      return (
        <div data-entry="utterance" className="self-end rounded-lg bg-primary/10 px-3 py-2 text-sm">
          {entry.text}
        </div>
      )
    case "receipt":
      return (
        <ReceiptRow
          clause={entry.clause}
          functionId={entry.functionId}
          outcome={entry.outcome}
          status={entry.status}
          rawStatus={entry.rawStatus}
        />
      )
    case "result":
      return (
        <PayloadBlock
          functionId={entry.functionId}
          payload={entry.payload}
          foldLines={entry.foldLines}
          // LAW 2, and the only input it has. `receiptCount` is the number of receipt lines this
          // turn filed; keying on how many payloads came back is 399.1 gap 2.
          label={receiptCount > 1}
          onSend={onSend}
        />
      )
    case "denial":
      return <DenialBlock reason={entry.denial.reason} remedies={entry.denial.remedies} />
    case "answer":
      return (
        <div data-entry="answer" className="rounded-lg bg-muted/40 px-3 py-2">
          <ChatMarkdown content={entry.text} />
        </div>
      )
    case "present":
      return (
        <div data-entry="present" className="rounded-lg border border-dashed border-border px-3 py-2">
          <ChatMarkdown content={entry.text} />
        </div>
      )
    case "confirm":
      return (
        <ConfirmBubble
          confirmId={entry.confirmId}
          actionClass={entry.actionClass}
          {...(entry.preview === undefined ? {} : { preview: entry.preview })}
          {...(entry.resolution === undefined ? {} : { resolution: entry.resolution })}
          onAnswer={onAnswerConfirm}
        />
      )
    case "unhandled":
      return (
        <div data-entry="unhandled" className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
          <span className="font-mono text-xs text-muted-foreground">{entry.clause}</span>
          <p>{entry.reason}</p>
        </div>
      )
    case "error":
      return (
        <div data-entry="error" className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-sm">
          {entry.text}
        </div>
      )
  }
}

/**
 * One op's payload: fold lines above, the complete masked value below, expanded (LAW 3, D-14).
 *
 * `useState(true)` IS THE DECISION AND NOT A DEFAULT SOMEBODY PICKED. D-14 chose "always expand"
 * over a relevance heuristic explicitly, because a heuristic that decides which results are worth
 * showing is a drop path with a rule attached, and the rule rots. The toggle is a person's, taken
 * after they have seen the value.
 */
function PayloadBlock({
  functionId,
  payload,
  foldLines,
  label,
  onSend,
}: {
  functionId: string
  payload: unknown
  foldLines: readonly string[]
  label: boolean
  onSend: (utterance: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const rendered = JSON.stringify(payload, null, 2)
  // 400-08 (DASH-03): an entity reference renders as THE card, recognised by the schema that
  // defines one — never by a shape check written here. A card is a FOLD in 399.1 D-04's sense: it
  // renders ABOVE the complete payload and can never take its place, because a legibility layer
  // that could suppress a value is a drop path with a rule attached.
  const cards = entityCardsIn(payload)
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border/60 px-3 py-2">
      {/* The folds render ABOVE and never in place of the payload. */}
      {foldLines.map((line) => (
        <p data-fold-line key={line} className="text-sm text-foreground">
          {line}
        </p>
      ))}
      {cards.map((card) => (
        <EntityCard key={card.uri} card={card} onSend={onSend} />
      ))}
      <div className="flex items-center gap-2">
        {label ? (
          <span data-payload-op-label className="font-mono text-[11px] text-muted-foreground">
            {functionId}
          </span>
        ) : null}
        <button
          data-payload-toggle
          type="button"
          onClick={() => { setExpanded((open) => !open) }}
          className="ml-auto rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      <pre
        data-payload-block
        data-expanded={expanded ? "true" : "false"}
        className={cn(
          "overflow-x-auto rounded bg-muted/40 p-2 font-mono text-xs",
          !expanded && "hidden",
        )}
      >
        {/* `JSON.stringify` answers `undefined` for an undefined value; an op that returned
            nothing is an ordinary thing and a person needs to read that rather than a keyword. */}
        {rendered ?? "(no result)"}
      </pre>
    </div>
  )
}

/**
 * A refusal: the canonical reason, then the ways forward A BROWSER READER CAN ACTUALLY TAKE.
 *
 * AN EMPTY PROJECTION RENDERS NOTHING, and that had to be a decision rather than a fallthrough. A
 * render that reached for a line when it had nothing to offer would re-mint the todo — a reader
 * spending their attention on a way forward that is not there. The reason alone is a complete
 * answer.
 */
function DenialBlock({
  reason,
  remedies,
}: {
  reason: string
  remedies: readonly GateRemedy[]
}) {
  const renderable = remediesRenderableBy("dashboard", remedies)
  return (
    <div data-entry="denial" className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
      <p className="text-foreground">{reason}</p>
      {renderable.map((remedy) => (
        <p
          key={remedy.kind}
          data-remedy-kind={remedy.kind}
          className="text-xs text-muted-foreground"
        >
          {DASHBOARD_REMEDY_TEXT[remedy.kind as RemedyKindFor<"dashboard">]}
        </p>
      ))}
    </div>
  )
}
