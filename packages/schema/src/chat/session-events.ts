// The chat session log's event grammar (Phase 392, CHAT-05 / D-14 / D-18).
//
// MINTED IN SCHEMA, on the `run-notification.ts` precedent and for its stated reason rather than
// by analogy: several packages read these bytes and none may import another. `agent` emits them
// from the turn engine, `agent-local` writes and re-reads them as JSONL, `cli` renders them, and
// M5's dashboard will parse the same file. A grammar that lived beside any one consumer would be
// re-derived by the next, and the two spellings would drift on the first field either wanted.
//
// THE EVENT KIND UNION IS CLOSED AND COMPLETE FROM DAY ONE, including the kinds nothing emits
// yet. CHAT-05 names `model_change`, `active_tools_change`, `compaction` and `aborted` as members
// of the log grammar; declaring them late would make "this build does not know that kind" and
// "that kind did not occur" the same bytes for every reader written in between — which is exactly
// the ambiguity a versioned, append-only log exists to avoid.
//
// MAP, NOT TERRITORY (D-18). An event carries REFS and one-line summaries, never payload bodies.
// The one exception is chat's own content: a user message IS the thing chat is a record of, so its
// text is logged. A knowledge record, a config file's contents, a tool result — those live in
// their own stores and appear here as an id and a sentence. The rule is not about size. It is that
// this file is read by surfaces that render it directly, so a field that could carry a secret
// would need a masking boundary at every one of them.

/**
 * Stamped into the header line and checked before any shape question on reopen.
 *
 * A literal type rather than `number` (the `RunNotification` idiom): a header built with last
 * version's shape fails to typecheck at its construction site, which is where the mistake is,
 * rather than at a reader that could only report it as corrupt bytes.
 */
export const CURRENT_CHAT_SESSION_SCHEMA_VERSION = 1

/**
 * The first line of every session file, written and fsynced when the file is created.
 *
 * `model` and `toolsetHash` are the session's opening CONTEXT, not its running state: the log's
 * `model_change` and `active_tools_change` events carry drift from here onwards, so a reader
 * reconstructs "what was in force at turn N" by folding events over this header. Rewriting the
 * header on drift would make the file no longer append-only, which is the one property CHAT-05
 * asks for by name.
 */
export interface ChatSessionHeader {
  schemaVersion: typeof CURRENT_CHAT_SESSION_SCHEMA_VERSION
  sessionId: string
  createdAt: string
  model: string
  toolsetHash: string
}

/**
 * Every kind of thing that can happen to a session, spelled ONCE (388 C13).
 *
 * Ordered by the turn they belong to rather than alphabetically, because the order is the shape
 * of a turn and a reader of this list should be able to see one.
 */
export const CHAT_SESSION_EVENT_KINDS = [
  'user_message',
  'stage_outcome',
  'clause_receipt',
  'approval_decision',
  'mark_unhandled',
  'model_change',
  'active_tools_change',
  'compaction',
  'aborted',
  'turn_complete',
] as const

export type ChatSessionEventKind = (typeof CHAT_SESSION_EVENT_KINDS)[number]

/**
 * The four-stage routing contract's stages, named rather than numbered in the log.
 *
 * A number would be a position in a pipeline whose length is a design decision; a name survives
 * a stage being inserted, and a reader six months from now can tell which stage answered without
 * the contract in front of them.
 */
export const CHAT_TURN_STAGES = ['resolver', 'planner', 'reconcile', 'execute'] as const

export type ChatTurnStage = (typeof CHAT_TURN_STAGES)[number]

/**
 * What a stage did with the turn.
 *
 * `skipped` is a first-class outcome and not an absence: a turn every clause of which the
 * deterministic table resolved does not consult the planner at all, and that is the tracer's whole
 * point (D-01/D-06 — the LLM is never touched). Logging nothing would make a skipped planner and
 * an unbound one identical in the record.
 */
export const CHAT_STAGE_OUTCOMES = ['resolved', 'skipped', 'unresolved'] as const

export type ChatStageOutcome = (typeof CHAT_STAGE_OUTCOMES)[number]

/** How a turn ended (the value `turn_complete` carries, and the `agent.ask` result's status). */
export const CHAT_TURN_STATUSES = ['completed', 'failed', 'fail_closed'] as const

export type ChatTurnStatus = (typeof CHAT_TURN_STATUSES)[number]

/**
 * The fields EVERY event carries, whatever its kind.
 *
 * `turnId` is on the base rather than per-kind because the log's primary read is "show me that
 * turn", and a kind that could omit it would be a hole in exactly that read. Session-scoped facts
 * that arrive between turns (a config re-read on open) carry the id of the turn they precede.
 */
export interface ChatSessionEventBase<K extends ChatSessionEventKind> {
  kind: K
  turnId: string
  at: string
}

/**
 * What the person typed, verbatim.
 *
 * The ONE payload body in this vocabulary, and the exception is principled: the utterance is not
 * a reference to content held elsewhere, it IS the content, and a session log that recorded
 * "the user said something" would not be the triage report D-18 asks for.
 */
export interface ChatUserMessageEvent extends ChatSessionEventBase<'user_message'> {
  text: string
}

/** Which stage answered, and how. One event per stage the turn actually reached. */
export interface ChatStageOutcomeEvent extends ChatSessionEventBase<'stage_outcome'> {
  stage: ChatTurnStage
  outcome: ChatStageOutcome
}

/**
 * One clause's trip through the function layer, as a REF and a sentence.
 *
 * `functionId` addresses the op; `outcome` is a ONE-LINE human summary; the result itself stays
 * wherever the op put it. `origin` records which caller the composition MINTED for this clause
 * (391 D-06, RESEARCH Pitfall 1) — a deterministic table hit is a person typing, a planner-planned
 * call is not, and the difference is a permission fact worth having in the record.
 */
export interface ChatClauseReceiptEvent extends ChatSessionEventBase<'clause_receipt'> {
  clause: string
  functionId: string
  origin: string
  status: string
  outcome: string
}

/** The fsync boundary marker. Its presence is what makes the preceding turn non-dangling (D-19). */
export interface ChatTurnCompleteEvent extends ChatSessionEventBase<'turn_complete'> {
  status: ChatTurnStatus
}

/**
 * The events this build emits today.
 *
 * The KIND union above is complete; this payload union is not, and the gap is deliberate rather
 * than an oversight — plan 02 of this phase adds the payload DTOs for the six remaining kinds and
 * the reopen guard that ranges over all ten. Declaring the kinds first is what lets the sibling
 * plans compose against one closed vocabulary instead of widening it each time.
 */
export type ChatSessionEvent =
  | ChatUserMessageEvent
  | ChatStageOutcomeEvent
  | ChatClauseReceiptEvent
  | ChatTurnCompleteEvent
