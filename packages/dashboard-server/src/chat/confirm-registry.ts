// The pending-confirm registry — the browser's half of an inline confirm (Phase 400 plan 03,
// D-05 / D-06 / D-07, RESEARCH Pattern 5; generalized to run triggers in 401-09, D-11).
//
// THE AXIS IS A CONFIRM SCOPE, AND A CHAT CONVERSATION IS ONE KIND OF SCOPE (401-09, D-11). Until
// this plan every question parked here belonged to a conversation, so the axis was spelled
// `sessionId` and the two words meant the same thing. They no longer do: an ask-tier run started
// from the dashboard's RUN BUTTON has to be able to ask the browser that clicked it, and a run
// trigger is not a turn and has no transcript. What generalizes is only the ADDRESS — the parking
// lot, the single-use ids, the session/scope comparison and the two DENY reapers are the same
// mechanism serving both, because "one confirm vocabulary across the dashboard" is what D-11 asks
// for and a second parking lot is what it forbids.
//
// THE ALTERNATIVE WAS TO FABRICATE A CHAT CONVERSATION for the run button and route its confirm
// through the chat door. That would write run confirms into chat transcripts — a second spelling of
// run history, which is the class this phase exists to remove (RESEARCH Open Q5, resolved in the
// 401-09 plan). Scope ids are PREFIX-NAMESPACED instead ({@link RUN_TRIGGER_CONFIRM_SCOPE_PREFIX}),
// so a trigger scope can never collide with a conversation id and neither can be answered as the
// other.
//
// WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT. A `ConfirmPort` is `(action) => boolean |
// Promise<boolean>`: the gate asks a question and waits for an answer. On a terminal the answer
// arrives on the same stream the question went out on, so `readline` is the whole mechanism. In a
// browser the question leaves on one connection (the session's SSE stream) and the answer arrives
// on a different one (a POST), possibly seconds later, possibly never. This module is the thing
// that holds the question open in between: a parked promise, addressable by a single-use id, with
// exactly two ways to be resolved other than an answer — the window closing, and the channel
// vanishing. Both resolve DENY.
//
// IT IS A TRANSPORT AND HOLDS NO POLICY. It does not know what an action class means, cannot mint a
// grant, cannot write a session event and does not decide which scope a confirm belongs to — the
// caller names the scope, because "which conversation is a person watching right now" is a fact
// about the composed host and the open sockets, not about a map of promises. What lives here is the
// parking lot and its two reapers, which is the part that must not be written twice.
//
// FAIL-CLOSED IN EVERY DIRECTION (D-06). A confirm for a scope with no live channel is denied
// without parking — there is nobody to ask, and a promise waiting for an answer that cannot arrive
// is a turn that hangs. A confirm whose channel closes is denied at once rather than at its
// timeout, because a closed tab is a person who has left, not a person who is thinking. And a
// confirm nobody answers is denied when its window closes. "Silence is consent" is the one reading
// this module makes impossible.
//
// WHY THE IDS ARE UUIDS AND WHY THEY ARE SPENT ON USE (T-400-09). The answer route is reachable by
// anything that can reach the server; an id a caller could GUESS would be a way to approve somebody
// else's capability call, and an id that could be answered TWICE would be a way to replay one
// person's yes onto a later question. So ids come from `randomUUID`, an answer consumes the entry,
// and the scope that parked the confirm is compared against the scope the answer names.

import { randomUUID } from 'node:crypto'

/**
 * A confirm scope id — the address a question is parked under and answered on.
 *
 * A TYPE ALIAS RATHER THAN A BRAND, deliberately: a chat conversation id minted by the engine is a
 * valid scope id exactly as it stands, which is what makes this widening rename-tolerant. What
 * distinguishes the two kinds is the PREFIX below, and only the two functions beside it are allowed
 * to know about it.
 */
export type ConfirmScopeId = string

/**
 * The namespace a run trigger's confirm scope lives in (401-09, D-11).
 *
 * SPELLED ONCE, HERE. The server's run-confirm routes need it to recognise a trigger scope, and the
 * CLI's run door needs it to mint one; a second copy in either place would be two answers to what a
 * trigger scope is called, and the two would be free to drift the first time somebody renamed one.
 * The colon is not decorative: chat session ids are `chat-<timestamp>-<nonce>` and carry no colon,
 * so no conversation can ever be addressed as a trigger or a trigger as a conversation.
 */
export const RUN_TRIGGER_CONFIRM_SCOPE_PREFIX = 'run-trigger:'

/**
 * Mint one run trigger's confirm scope (401-09, D-11).
 *
 * MINTED BY THE SERVER WHEN THE BROWSER OPENS ITS CHANNEL, and NOT derived from the run id — which
 * is the shape the first draft of this plan had, and it cannot work. The dashboard's queue
 * dispatches on the `enqueued` event, in the same tick the trigger route enqueues, so a browser
 * that only learns the run id from the trigger's RESPONSE cannot possibly have a channel open
 * before the run's gate evaluates. A posture that depended on winning that race would be
 * `local-interactive` or `local-headless` depending on how busy the machine was, which is not a
 * policy — so the order is inverted: the channel is opened first, the scope is what the server
 * hands back on it, and the trigger names the scope it wants asked.
 *
 * `randomUUID` FOR THE SAME REASON THE CONFIRM IDS USE IT (T-400-09). The scope is the address a
 * question is delivered to; a guessable one would let a caller name somebody else's browser as the
 * one to ask. It is only ever known to whoever is holding the stream it was minted on.
 */
export function mintRunTriggerConfirmScope(): ConfirmScopeId {
  return `${RUN_TRIGGER_CONFIRM_SCOPE_PREFIX}${randomUUID()}`
}

/**
 * Whether this is a run trigger's confirm scope at all.
 *
 * THE READ SIDE OF THE MINT, and it exists because a scope id travels on the wire: the trigger
 * route is handed one by a caller and must refuse anything that is not a trigger scope, or a caller
 * could name a live CONVERSATION as the browser to ask — which would put a run's question in
 * somebody's chat transcript and let a conversation's watcher approve a run they never triggered.
 */
export function isRunTriggerConfirmScope(scopeId: ConfirmScopeId): boolean {
  return scopeId.startsWith(RUN_TRIGGER_CONFIRM_SCOPE_PREFIX)
    && scopeId.length > RUN_TRIGGER_CONFIRM_SCOPE_PREFIX.length
}

/** The three answers a browser confirm offers — the TTY's `[y/a/N]`, in a medium with buttons. */
export const CHAT_CONFIRM_ANSWERS = ['accept', 'accept-always', 'deny'] as const

export type ChatConfirmAnswer = (typeof CHAT_CONFIRM_ANSWERS)[number]

/**
 * How long a confirm waits for a person, in milliseconds.
 *
 * A REAL POLICY DECISION AND NOT A TUNABLE DETAIL, so it is stated here once with its reasoning.
 * The CLI's prompt has NO timeout on purpose (386 D-15's spirit: "the person went to get coffee" is
 * not a policy question), and that is right for a terminal — the process is the person's session
 * and it lives as long as they do. A browser is different in the one way that matters: the server
 * cannot tell a person who is reading carefully from a laptop that slept, a proxy that stopped
 * forwarding, or a socket that is half-open. The channel-close reaper below catches every
 * disconnect the OS reports; this window is what catches the ones it does not. Two minutes is long
 * enough to read a cost preview and short enough that a turn does not hang for an afternoon.
 */
export const CHAT_CONFIRM_TIMEOUT_MS = 120_000

/**
 * What the browser is shown when a confirm is raised.
 *
 * `preview` is the action's own `disclosure` — what THIS invocation is about to cost, composed by
 * the op through `FunctionSpec.disclose` and carried here as inert data. It is a separate field
 * from `actionClass` for the reason the CLI keeps it on a separate line: the class name is the
 * string a later `grants.list` will show the same person, so it travels verbatim rather than as a
 * paraphrase with a number in it.
 */
export interface ChatConfirmRequest {
  readonly confirmId: string
  readonly actionClass: string
  readonly preview?: string
}

/**
 * Everything this registry pushes at a watching browser, as one closed union.
 *
 * NOT SESSION-LOG EVENTS, and the distinction is D-03's. A session event is a durable record that
 * was on the file before the server heard about it; these three are transient facts about a
 * question in flight. They ride the same SSE connection because that is where the person is, but
 * they carry NO stream id — the ids on that connection are the replay currency for the log's
 * projection, and interleaving un-replayable frames into that numbering would make a reconnect
 * ask for events that never existed.
 */
export type ChatConfirmChannelFrame =
  | { readonly kind: 'confirm_request'; readonly request: ChatConfirmRequest }
  | {
    readonly kind: 'confirm_resolved'
    readonly confirmId: string
    readonly answer: ChatConfirmAnswer
    /** WHY it resolved — a person, or one of the two silences. Rendered, never inferred. */
    readonly by: 'answer' | 'timeout' | 'channel-closed'
  }
  | { readonly kind: 'chat_present'; readonly text: string }

/**
 * What answering did.
 *
 * `unknown-confirm` covers three states ON PURPOSE — no such id, an id already spent, and an id
 * belonging to another scope. They are different facts internally and the route must not let a
 * caller tell them apart: a distinguishable "that id exists but is not yours" is an oracle for
 * probing which confirms are outstanding.
 */
export type ChatConfirmAnswerOutcome =
  | { readonly kind: 'resolved'; readonly answer: ChatConfirmAnswer }
  | { readonly kind: 'unknown-confirm' }

export interface ChatConfirmRequestInput {
  /**
   * The scope whose watcher is being asked. Named by the caller; see the module head.
   *
   * A conversation id, or a run trigger's own scope (401-09). The registry treats both the same
   * way and that is the point — one parking lot, one comparison, one pair of reapers.
   */
  readonly scopeId: ConfirmScopeId
  readonly actionClass: string
  readonly preview?: string
}

export interface ConfirmRegistry {
  /**
   * Register a live confirm channel for a session, and return its teardown.
   *
   * COUNTED RATHER THAN FLAGGED: two tabs on one conversation are two channels, and the pending
   * confirms of that session are only reaped when the LAST of them goes away. A boolean would make
   * one tab closing look like the person leaving.
   */
  openChannel(scopeId: ConfirmScopeId): () => void
  /**
   * Whether THIS scope has a live channel (400-13, gap 3; 401-09 for a run trigger).
   *
   * IT IS THE WHOLE OF THE RUN TRIGGER'S HONEST CLAIM (401-09, Pitfall 3). A conversation is
   * reachable when it is watched AND has a turn in flight; a run trigger has no turn, so the
   * question a trigger's posture rule asks is exactly this one — is the browser that clicked run
   * still holding the channel this run's question would go out on.
   *
   * THE ONLY LIVENESS QUESTION THIS REGISTRY ANSWERS. `liveSessionIds()` is deleted (401-01,
   * D-14 / WR-05): it sat right here enumerating every watched conversation in the process, still
   * documented as "the caller's input for choosing a target" — a second spelling of exactly the
   * process-global class the paragraph below exists to remove, orphaned of production consumers
   * when 400-17 took its last one and left available for the next caller to re-acquire. Removed
   * rather than re-documented, because nothing remains to re-pin it to.
   *
   * SESSION-SCOPED, AND THE ZERO-ARG FORM IS DELETED RATHER THAN KEPT BESIDE IT. `hasLiveChannel()`
   * answered `channels.size > 0` — a fact about the PROCESS, and the only fact this registry ever
   * answered that named no conversation. Its one consumer was the door's execution-context
   * resolver, so a stream opened on any id at all made every conversation in the process claim a
   * human was watching, and an UNWATCHED conversation's ask-tier denial went to the audit ledger as
   * `prompted-denied` — a prompt nobody was shown. "Any channel anywhere" is not a question about a
   * conversation, and the only questions this registry may answer are per-conversation; removing
   * the global form is what stops a later caller from re-acquiring the one that is not.
   */
  hasLiveChannel(scopeId: ConfirmScopeId): boolean
  /** Watch the frames above. Returns its own unsubscribe. */
  subscribe(listener: (scopeId: ConfirmScopeId, frame: ChatConfirmChannelFrame) => void): () => void
  /** Ask, and wait. Resolves `deny` for a scope no channel is watching (D-06). */
  request(input: ChatConfirmRequestInput): Promise<ChatConfirmAnswer>
  /** Push a mid-turn artifact into a conversation's transcript (`chatPresent`, Pattern 5). */
  present(scopeId: ConfirmScopeId, text: string): void
  /** Spend a confirm id. Single use, scope-bound. */
  answer(input: {
    readonly scopeId: ConfirmScopeId
    readonly confirmId: string
    readonly answer: ChatConfirmAnswer
  }): ChatConfirmAnswerOutcome
  /** How many questions are outstanding — the leak observable, on `openStreamCount`'s precedent. */
  pendingCount(): number
}

export interface CreateConfirmRegistryOptions {
  /** Override the window. Production takes {@link CHAT_CONFIRM_TIMEOUT_MS}. */
  readonly timeoutMs?: number
  /** The id source, injectable so a cell can pin one. Production takes `randomUUID`. */
  readonly mintConfirmId?: () => string
}

interface PendingConfirm {
  readonly scopeId: ConfirmScopeId
  readonly settle: (answer: ChatConfirmAnswer, by: 'answer' | 'timeout' | 'channel-closed') => void
  readonly timer: ReturnType<typeof setTimeout>
}

export function createConfirmRegistry(
  options: CreateConfirmRegistryOptions = {},
): ConfirmRegistry {
  const timeoutMs = options.timeoutMs ?? CHAT_CONFIRM_TIMEOUT_MS
  const mintConfirmId = options.mintConfirmId ?? ((): string => `confirm-${randomUUID()}`)

  /** Confirm scope id → the tokens of its live channels. One token per connection. */
  const channels = new Map<string, Set<symbol>>()
  const listeners = new Set<(scopeId: ConfirmScopeId, frame: ChatConfirmChannelFrame) => void>()
  const pending = new Map<string, PendingConfirm>()

  function emit(scopeId: ConfirmScopeId, frame: ChatConfirmChannelFrame): void {
    for (const listener of [...listeners]) {
      try {
        listener(scopeId, frame)
      } catch {
        // One broken watcher is not another's, and never the turn's — the fan-out's own law.
      }
    }
  }

  function resolve(
    confirmId: string,
    answer: ChatConfirmAnswer,
    by: 'answer' | 'timeout' | 'channel-closed',
  ): PendingConfirm | undefined {
    const entry = pending.get(confirmId)
    if (entry === undefined) return undefined
    // SPENT BEFORE SETTLED. The delete happens first so a resolution racing with a second answer,
    // a timeout and a channel close can only ever be won once — every other path then reads an
    // absent entry and does nothing.
    pending.delete(confirmId)
    clearTimeout(entry.timer)
    entry.settle(answer, by)
    return entry
  }

  return {
    openChannel(scopeId) {
      const token = Symbol('confirm-channel')
      const live = channels.get(scopeId) ?? new Set<symbol>()
      live.add(token)
      channels.set(scopeId, live)
      let released = false
      return () => {
        // IDEMPOTENT, so a caller's `finally` and its socket's `close` may both fire.
        if (released) return
        released = true
        live.delete(token)
        if (live.size > 0) return
        channels.delete(scopeId)
        // THE LAST WATCHER LEFT. Every question this scope had outstanding is denied NOW
        // rather than at its window — the answer cannot arrive on a connection that no longer
        // exists, and a turn waiting out a two-minute timer for an answer that is already
        // impossible is the hang this reaper exists to prevent (D-06).
        for (const [confirmId, entry] of [...pending]) {
          if (entry.scopeId !== scopeId) continue
          resolve(confirmId, 'deny', 'channel-closed')
        }
      }
    },

    hasLiveChannel(scopeId) {
      return channels.has(scopeId)
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    request(input) {
      // NOBODY IS WATCHING, SO NOBODY IS ASKED. Denied without parking: a promise waiting on a
      // channel that does not exist is a turn that never returns, and the honest answer for a
      // question that cannot be delivered is the fail-closed one.
      if (!channels.has(input.scopeId)) return Promise.resolve<ChatConfirmAnswer>('deny')

      const confirmId = mintConfirmId()
      return new Promise<ChatConfirmAnswer>((settled) => {
        const settle = (
          answer: ChatConfirmAnswer,
          by: 'answer' | 'timeout' | 'channel-closed',
        ): void => {
          emit(input.scopeId, { kind: 'confirm_resolved', confirmId, answer, by })
          settled(answer)
        }
        const timer = setTimeout(() => {
          resolve(confirmId, 'deny', 'timeout')
        }, timeoutMs)
        // `unref` so an outstanding question cannot hold a process alive past its work — the same
        // reasoning the stream heartbeat states.
        timer.unref?.()
        pending.set(confirmId, { scopeId: input.scopeId, settle, timer })
        emit(input.scopeId, {
          kind: 'confirm_request',
          request: {
            confirmId,
            actionClass: input.actionClass,
            ...(input.preview === undefined ? {} : { preview: input.preview }),
          },
        })
      })
    },

    present(scopeId, text) {
      // Dropped for a session nobody is watching, deliberately: a mid-turn artifact is something a
      // person reads BEFORE deciding, and there is no queue to hold it in that would not be a
      // second transcript.
      if (!channels.has(scopeId)) return
      emit(scopeId, { kind: 'chat_present', text })
    },

    answer(input) {
      const entry = pending.get(input.confirmId)
      // THE SCOPE BINDING (ASVS V3 / T-400-09). An id is not a bearer token for any caller that
      // holds it: the answer must name the scope the question was parked for, or it answers
      // nothing. Reported as `unknown-confirm` so this arm and a genuinely absent id are
      // indistinguishable from outside.
      if (entry === undefined || entry.scopeId !== input.scopeId) {
        return { kind: 'unknown-confirm' }
      }
      resolve(input.confirmId, input.answer, 'answer')
      return { kind: 'resolved', answer: input.answer }
    },

    pendingCount() {
      return pending.size
    },
  }
}
