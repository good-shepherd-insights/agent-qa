// The session log PORT (Phase 392, CHAT-05 / D-17 / D-19).
//
// Port in schema, factory in the adapter, binding at the composition root — the 390/391 triple, and
// for the same structural reason: `agent`'s turn engine appends through this type and
// `agent-local`'s JSONL adapter implements it, and neither package may import the other.
//
// IT IS ITS OWN PORT, NOT A WIDENING OF `PersistencePort`. The conversation methods were
// deliberately DELETED from that port in 385 (`packages/agent/src/ports/persistence.ts:5-11`), and
// re-adding them here under a new name would restore the thing that deletion removed: a general
// persistence surface whose consumers cannot tell which of its verbs a given host can actually
// answer. A session log has a lifecycle — open, append, boundary, close — that no other stored
// artifact in this system has, and a port shaped like that lifecycle is what makes the fsync
// discipline expressible at all.

import type { ChatSessionEvent, ChatSessionHeader } from './session-events'

/**
 * One line an open could not read, surfaced as data rather than thrown over.
 *
 * MINTED HERE rather than beside the repair logic, for this vocabulary's usual reason: the shape
 * crosses the port, so `agent`'s repair produces it and `agent-local`'s adapters hand it back, and
 * neither package may import the other. `lineNumber` is 1-based and counts the header line, so it
 * names what an editor shows the person who has to go and look.
 */
export interface RefusedChatSessionLine {
  lineNumber: number
  reason: string
}

/**
 * What `open` answers: the header in force, every event already on file, and what it could not read.
 *
 * `refusedLines` IS PART OF THE ANSWER, not an aside. A session file can carry damage that the
 * append-only law forbids ever removing — a line another build wrote, or one edited in place — and
 * the open path is the single moment in the system where that is known. Dropping it here would
 * leave every later surface to re-derive it with a second parser, which is how two readers end up
 * disagreeing about whether a conversation is intact. A clean session answers with an empty list.
 */
export interface OpenedChatSession {
  header: ChatSessionHeader
  events: readonly ChatSessionEvent[]
  refusedLines: readonly RefusedChatSessionLine[]
}

export interface SessionLogPort {
  /**
   * Open a session, creating one when no id is given.
   *
   * A SUPPLIED id is a claim that the session exists. An unknown one is a typed refusal and never
   * a create: a surface that mistyped an id and got a fresh empty session would be told its history
   * was lost when in fact it was never looked at (D-17, RESEARCH Open Q4).
   */
  open(sessionId?: string): Promise<OpenedChatSession>
  /** Append one event. Durability is NOT claimed until {@link turnBoundary} returns. */
  append(event: ChatSessionEvent): Promise<void>
  /**
   * The fsync point (D-19).
   *
   * Per TURN rather than per event, which is what makes the loss bound exactly the in-flight turn —
   * the thing the next-turn repair already knows how to handle. Syncing per event would pay for a
   * durability guarantee finer than any reader can use.
   */
  turnBoundary(): Promise<void>
  close(): Promise<void>
}
