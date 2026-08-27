// One chat turn, from a POST to the last frame off its stream (Phase 400 plan 06, D-03).
//
// THE SHAPE IS THE DASHBOARD'S SSE-IN-REACT SHAPE, DELIBERATELY (its earlier statement was
// retired with the legacy execution-event feed in 405; the live shape now ships in
// `pages/live-run.tsx` and `components/run-results-panel.tsx`): one
// `EventSource` in a ref, one effect keyed on the
// id, a `cancelled` flag so a late frame cannot write into an unmounted tree, an idempotent
// `close()` in the teardown — and, the part that matters most, EVERY handler funnelling into ONE
// PURE REDUCER. A hook that folded state inline per event kind grows a second, undocumented
// grammar; a reducer can be driven by a cell with no DOM, no server and no timing, which is what
// makes the render contract's laws testable at all.
//
// THE TRANSPORT IS TWO CHANNELS AND THE REDUCER SEES BOTH AS ONE UNION. The POST answers with the
// typed `agent.ask` result (receipts, results, denials, the answer) and the SSE stream carries the
// same turn's session events as they append, plus the transient confirm frames. They are not
// redundant: the stream is what makes a turn watchable while it runs, and the POST is what carries
// the fields the log does not persist — the registry folds and the gate's remedies. So the reducer
// takes a `channel` discriminant and each arm states which facts that channel is allowed to
// contribute.
//
// NOTHING HERE PARSES A DIRECTIVE. `/fn <op> [json]`, `/help`, `/pin` and the five aliases are the
// resolver table's grammar, and the resolver table lives on the server. The utterance a person
// typed rides the wire verbatim (D-10).

import { useCallback, useEffect, useRef, useState } from "react"

import {
  answerChatConfirm,
  postChatTurn,
  subscribeToChatSessionEvents,
  type ChatConfirmAnswer,
  type ChatConfirmRequestFrame,
  type ChatConfirmResolvedFrame,
} from "@/lib/api"
import {
  CLAUSE_RECEIPT_STATUSES,
  type ChatSessionEvent,
  type ClauseDenial,
  type ClauseReceiptStatus,
} from "@vostride/agent-qa-schema"

/**
 * Narrow a session line's `status` to the vocabulary THIS build renders — or answer that it cannot.
 *
 * `ChatClauseReceiptEvent.status` is typed `string` on purpose: a session file is append-only and
 * durable, and a line written by a later build may carry a status word this one has never heard of.
 * Casting it would put an unrenderable value straight into a total map; dropping the row would hide
 * a clause that ran. So it is narrowed here and the unrecognised case is rendered as its own,
 * visible thing.
 *
 * THIS IS NOT A DEFAULT ARM OVER THE VOCABULARY, and the distinction is the whole point of the
 * totality guard next door. A fifth status added to THIS build is still a compile error at
 * `RECEIPT_STATUS_PRESENTATION`; what this handles is a word from ANOTHER build, which is a data
 * question rather than a vocabulary one.
 */
function asClauseReceiptStatus(value: string): ClauseReceiptStatus | undefined {
  return CLAUSE_RECEIPT_STATUSES.find((status) => status === value)
}

/**
 * One thing in the transcript.
 *
 * A FLAT, ORDERED LIST RATHER THAN A TREE OF TURNS. The order a person reads is the order the
 * events arrived, which is the order the engine ran the clauses in, which is the order they typed
 * them. Grouping into turn objects would put a second ordering in the middle — the one the grouper
 * chose — and every render bug in this class comes from the two disagreeing.
 */
export type ChatEntry =
  | { readonly kind: "utterance"; readonly id: string; readonly turnId: string; readonly text: string }
  | {
    readonly kind: "receipt"
    readonly id: string
    readonly turnId: string
    /** `undefined` when the line carries a status word this build does not know. */
    readonly status: ClauseReceiptStatus | undefined
    readonly rawStatus: string
    readonly functionId: string
    readonly clause: string
    readonly origin: string
    readonly outcome: string
  }
  | { readonly kind: "result"; readonly id: string; readonly turnId: string; readonly functionId: string; readonly payload: unknown; readonly foldLines: readonly string[] }
  | { readonly kind: "denial"; readonly id: string; readonly turnId: string; readonly denial: ClauseDenial }
  | { readonly kind: "answer"; readonly id: string; readonly turnId: string; readonly text: string }
  | { readonly kind: "present"; readonly id: string; readonly text: string }
  | { readonly kind: "confirm"; readonly id: string; readonly confirmId: string; readonly actionClass: string; readonly preview?: string; readonly resolution?: { readonly answer: ChatConfirmAnswer; readonly by: "answer" | "timeout" | "channel-closed" } }
  | { readonly kind: "unhandled"; readonly id: string; readonly turnId: string; readonly clause: string; readonly reason: string }
  | { readonly kind: "error"; readonly id: string; readonly text: string }

export interface ChatTranscriptState {
  readonly entries: readonly ChatEntry[]
  /**
   * How many receipts each turn has filed so far — the op-labeling law's ONLY input.
   *
   * `result-render.ts` states the rule and 399.1 gap 2 is what it costs to get wrong: a payload is
   * labelled with its op id when the turn filed more than one RECEIPT, never when it produced more
   * than one RESULT. The two counts diverge exactly when a turn has mixed outcomes — a failed
   * clause files a receipt and no result — and that is the case where an unlabelled payload sits
   * under a different op's failure line and reads as that op's answer.
   */
  readonly receiptCountByTurn: Readonly<Record<string, number>>
  /** The session this transcript belongs to, learned from the first turn that answered. */
  readonly sessionId?: string
}

/** One turn's POST answer, as the reducer consumes it. */
export interface ChatTurnFacts {
  readonly channel: "turn"
  readonly turnId: string
  readonly sessionId?: string
  /**
   * The registry folds, structurally — this reducer needs the op id and the lines and nothing else.
   * Typing the field as the door's full `ChatTurnFold` would make every cell that drives this
   * reducer restate a `verdict` the render never reads.
   */
  readonly folds?: readonly { readonly functionId: string; readonly foldLines: readonly string[] }[]
  readonly denials?: readonly ClauseDenial[]
  readonly answer?: string
  readonly unhandled?: { readonly clause: string; readonly reason: string }
}

export type ChatTranscriptEvent =
  | { readonly channel: "session"; readonly event: ChatSessionEvent }
  | ChatTurnFacts
  | { readonly channel: "confirm-request"; readonly frame: ChatConfirmRequestFrame }
  | { readonly channel: "confirm-resolved"; readonly frame: ChatConfirmResolvedFrame }
  | { readonly channel: "present"; readonly text: string }
  | { readonly channel: "local-error"; readonly text: string }

export function createChatTranscriptState(): ChatTranscriptState {
  return { entries: [], receiptCountByTurn: {} }
}

let entrySequence = 0
function nextEntryId(prefix: string): string {
  entrySequence += 1
  return `${prefix}-${String(entrySequence)}`
}

/**
 * Fold one event into the transcript. Pure, total, and the only place state is derived.
 *
 * THE STATUS ARMS ARE THE WHOLE POINT OF SEPARATING THE CHANNELS. A `clause_result` says an op
 * RETURNED something; it does not say the clause succeeded, and 399.1's whole thesis is that those
 * are different facts — a credential-blocked config mutation returns a payload and the classifier
 * calls it `refused`. So the result arm never writes a status and the receipt arm is the only
 * producer of one.
 */
export function reduceChatTranscript(
  prev: ChatTranscriptState,
  event: ChatTranscriptEvent,
): ChatTranscriptState {
  switch (event.channel) {
    case "session":
      return reduceSessionEvent(prev, event.event)
    case "turn": {
      const entries: ChatEntry[] = []
      for (const denial of event.denials ?? []) {
        entries.push({ kind: "denial", id: nextEntryId("denial"), turnId: event.turnId, denial })
      }
      if (event.unhandled !== undefined) {
        entries.push({
          kind: "unhandled",
          id: nextEntryId("unhandled"),
          turnId: event.turnId,
          clause: event.unhandled.clause,
          reason: event.unhandled.reason,
        })
      }
      if (event.answer !== undefined && event.answer !== "") {
        entries.push({ kind: "answer", id: nextEntryId("answer"), turnId: event.turnId, text: event.answer })
      }
      // THE FOLDS ARRIVE AFTER THE RESULTS THEY DESCRIBE, because they ride the POST and the
      // results ride the stream. They are attached to the entries already in hand rather than
      // appended as their own rows: 399.1 D-04 makes a fold something that renders ABOVE its
      // payload, and a fold with no payload beneath it would be the render replacing the value
      // with a summary, which is the one thing a fold may never do.
      const folds = event.folds ?? []
      const withFolds = folds.length === 0
        ? prev.entries
        : prev.entries.map((entry) =>
          entry.kind === "result" && entry.turnId === event.turnId && entry.foldLines.length === 0
            ? {
              ...entry,
              foldLines:
                folds.find((fold) => fold.functionId === entry.functionId)?.foldLines ?? [],
            }
            : entry)
      return {
        ...prev,
        entries: [...withFolds, ...entries],
        ...(event.sessionId === undefined ? {} : { sessionId: event.sessionId }),
      }
    }
    case "confirm-request":
      return {
        ...prev,
        entries: [...prev.entries, {
          kind: "confirm",
          id: nextEntryId("confirm"),
          confirmId: event.frame.confirmId,
          actionClass: event.frame.actionClass,
          ...(event.frame.preview === undefined ? {} : { preview: event.frame.preview }),
        }],
      }
    case "confirm-resolved":
      // THE BUBBLE CLOSES WHERE THE SERVER SAYS IT CLOSED, and it says WHY. A denial that arrived
      // because the channel dropped is not a pending question and must never render as one: the
      // server's deny-on-silence is deliberate fail-closed behaviour (D-06), and a UI that showed
      // it as "still waiting" would be papering over the product's own answer.
      return {
        ...prev,
        entries: prev.entries.map((entry) =>
          entry.kind === "confirm" && entry.confirmId === event.frame.confirmId
            ? { ...entry, resolution: { answer: event.frame.answer, by: event.frame.by } }
            : entry),
      }
    case "present":
      return {
        ...prev,
        entries: [...prev.entries, { kind: "present", id: nextEntryId("present"), text: event.text }],
      }
    case "local-error":
      return {
        ...prev,
        entries: [...prev.entries, { kind: "error", id: nextEntryId("error"), text: event.text }],
      }
  }
}

function reduceSessionEvent(
  prev: ChatTranscriptState,
  event: ChatSessionEvent,
): ChatTranscriptState {
  switch (event.kind) {
    case "user_message":
      return {
        ...prev,
        entries: [...prev.entries, {
          kind: "utterance",
          id: nextEntryId("utterance"),
          turnId: event.turnId,
          text: event.text,
        }],
      }
    case "clause_receipt": {
      return {
        entries: [...prev.entries, {
          kind: "receipt",
          id: nextEntryId("receipt"),
          turnId: event.turnId,
          status: asClauseReceiptStatus(event.status),
          rawStatus: event.status,
          functionId: event.functionId,
          clause: event.clause,
          origin: event.origin,
          outcome: event.outcome,
        }],
        receiptCountByTurn: {
          ...prev.receiptCountByTurn,
          [event.turnId]: (prev.receiptCountByTurn[event.turnId] ?? 0) + 1,
        },
        ...(prev.sessionId === undefined ? {} : { sessionId: prev.sessionId }),
      }
    }
    case "clause_result":
      return {
        ...prev,
        entries: [...prev.entries, {
          kind: "result",
          id: nextEntryId("result"),
          turnId: event.turnId,
          functionId: event.functionId,
          payload: event.payload,
          foldLines: [],
        }],
      }
    case "mark_unhandled":
      return {
        ...prev,
        entries: [...prev.entries, {
          kind: "unhandled",
          id: nextEntryId("unhandled"),
          turnId: event.turnId,
          clause: event.clause,
          reason: event.reason,
        }],
      }
    default:
      // EVERY OTHER KIND IS A FACT ABOUT THE CONVERSATION AND NOT ABOUT THIS TURN'S ANSWER —
      // `approval_decision`, `model_change`, `active_tools_change`, `compaction`, `aborted`,
      // `turn_complete`, `stage_outcome`. They are deliberately not rendered as transcript rows in
      // this phase, and they are deliberately not DROPPED silently either: the reducer is total
      // over the union and this arm is where a later phase adds the rows, in one place.
      return prev
  }
}

export type ChatTurnStatus = "idle" | "connecting" | "sending" | "ready" | "error"

export interface UseChatTurnResult {
  readonly state: ChatTranscriptState
  readonly status: ChatTurnStatus
  readonly sessionId?: string
  sendTurn(message: string): void
  answerConfirm(confirmId: string, answer: ChatConfirmAnswer): void
}

/**
 * The one channel a mount consumes: POST a turn, watch its session's stream, fold both.
 *
 * ONE INSTANCE PER APP, NOT PER MOUNT. The `/chat` page and the global panel are two mounts of one
 * conversation (D-13), so this hook is called once at the shell and its result is shared through
 * `ChatSessionProvider`. Two instances would be two `EventSource` connections, two session ids and
 * two transcripts of the same conversation — which is the "second entry" DASH-01 forbids, arrived
 * at through state rather than through a second renderer.
 */
export function useChatTurn(): UseChatTurnResult {
  const [state, setState] = useState<ChatTranscriptState>(createChatTranscriptState)
  const [status, setStatus] = useState<ChatTurnStatus>("idle")
  const [sessionId, setSessionId] = useState<string | undefined>(undefined)
  const sourceRef = useRef<EventSource | null>(null)
  const sessionRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (sessionId === undefined) return
    let cancelled = false
    setStatus("connecting")
    const source = subscribeToChatSessionEvents(sessionId, {
      onSessionEvent: (event) => {
        if (!cancelled) setState((prev) => reduceChatTranscript(prev, { channel: "session", event }))
      },
      onConfirmRequest: (frame) => {
        if (!cancelled) setState((prev) => reduceChatTranscript(prev, { channel: "confirm-request", frame }))
      },
      onConfirmResolved: (frame) => {
        if (!cancelled) setState((prev) => reduceChatTranscript(prev, { channel: "confirm-resolved", frame }))
      },
      onPresent: (text) => {
        if (!cancelled) setState((prev) => reduceChatTranscript(prev, { channel: "present", text }))
      },
      onOpen: () => {
        if (!cancelled) setStatus("ready")
      },
    })
    sourceRef.current = source
    return () => {
      cancelled = true
      // Safe to call twice — `EventSource.close()` is idempotent, the precedent every
      // stream consumer in this dashboard relies on for the same reason.
      source.close()
      sourceRef.current = null
    }
  }, [sessionId])

  const sendTurn = useCallback((message: string) => {
    const utterance = message.trim()
    if (utterance === "") return
    setStatus("sending")
    // THE UTTERANCE RIDES VERBATIM. No directive parsing, no alias expansion, no JSON validation of
    // a `/fn` argument: the resolver table on the server owns that grammar and a second parser here
    // would be free to disagree with the one that dispatches (D-10).
    void postChatTurn(
      sessionRef.current === undefined ? { message: utterance } : { message: utterance, sessionId: sessionRef.current },
    ).then((response) => {
      sessionRef.current = response.result.sessionId
      setSessionId(response.result.sessionId)
      setState((prev) => reduceChatTranscript(prev, {
        channel: "turn",
        turnId: response.result.turnId,
        sessionId: response.result.sessionId,
        folds: response.folds,
        denials: response.result.denials,
        ...(response.result.answer === undefined ? {} : { answer: response.result.answer }),
        ...(response.result.unhandled === undefined ? {} : { unhandled: response.result.unhandled }),
      }))
      setStatus("ready")
    }).catch((error: unknown) => {
      setState((prev) => reduceChatTranscript(prev, {
        channel: "local-error",
        text: error instanceof Error ? error.message : "the turn could not be sent",
      }))
      setStatus("error")
    })
  }, [])

  const answerConfirm = useCallback((confirmId: string, answer: ChatConfirmAnswer) => {
    const currentSession = sessionRef.current
    if (currentSession === undefined) return
    // NO CLIENT-SIDE TIMER AND NO CLIENT-SIDE GRANT. The window, the deny-on-silence and the
    // standing-approval mint all live in the registry the server composed (400-03); this posts one
    // answer and waits for the server's own `confirm_resolved` frame to close the bubble. A
    // browser that resolved its own bubble would be showing a decision nobody made.
    void answerChatConfirm({ sessionId: currentSession, confirmId, answer }).catch((error: unknown) => {
      setState((prev) => reduceChatTranscript(prev, {
        channel: "local-error",
        text: error instanceof Error ? error.message : "the confirm could not be answered",
      }))
    })
  }, [])

  return {
    state,
    status,
    ...(sessionId === undefined ? {} : { sessionId }),
    sendTurn,
    answerConfirm,
  }
}
