// Chat's tier blocks for the ONE prompt builder (Phase 392 plan 04 — 389 D-04, 392-EXTENDS).
//
// THIS MODULE AUTHORS CONTENT, NEVER ASSEMBLY. `tiered-prompt-builder.ts` owns the tier law and
// the render order; chat passes its own `agent_context` and its own blocks, exactly as
// analyze-run does, and touches nothing about how the three tiers are joined. That parameter is
// the whole mechanism by which six job types share one prompt idiom (spec §1.4: "parameterized,
// not separate personas"), and the way it usually gets lost is not a decision — it is a caller
// who needed one more section and wrote its own assembly instead of one more block.
//
// TIER PLACEMENT IS A CACHE DECISION AS WELL AS A STRUCTURAL ONE. The stable tier is chat's role
// and the invariant planning discipline: identical bytes on every turn of every session, so a
// provider prompt cache sees the same prefix each call. Session facts move per session and lead
// the prompt leg; the conversation and the current utterance move every turn and trail it. Put
// the utterance in the stable tier and the cached prefix is novel on every keystroke — a defect
// that never fails a test and only ever shows up as a bill.
//
// THE INSTRUCTIONS BELOW ARE WHAT CHAT-03's CEILING MEASURES. One action tool call per clause in
// utterance order is what makes the reconciler's order alignment meaningful; `mark_unhandled`
// naming the clause is what makes the fail-closed arm a NAMED refusal rather than an improvisation
// with an adjacent capability (D-08); `answer_only` is what keeps an informational turn from
// looking like a planning failure. Loosening any of the three moves the measured unhandled rate
// without moving any mechanism, which is the one way that number can lie.
//
// NO PAYLOAD BODIES. Session facts are one-liners and the replayed conversation is refs plus
// outcomes (D-18) — the same map-not-territory rule the session log follows, applied to the one
// place where the whole conversation is about to cross a network boundary (T-392-14).

import { buildTieredPrompt } from '../prompt/tiered-prompt-builder.js'
import type { PromptTierBlock } from '../prompt/tiered-prompt-builder.js'
import type { JobModelRequest } from '../jobs/record-llm-authorship.js'

import type { ChatClause } from './ports.js'
import type { ChatReplayMessage } from './session-repair.js'

/** Who is asking and why — chat's stable-tier provenance (§1.4's `agent_context` parameter). */
export const CHAT_AGENT_CONTEXT =
  'agent-qa chat orchestrator. A person is talking to the QA agent through a terminal session. '
  + 'Your job on this turn is to PROPOSE a plan, not to carry one out: nothing you name here runs '
  + 'until a deterministic reconciliation step has checked it.'

const ROLE_BLOCK: PromptTierBlock = {
  title: 'Role',
  body:
    'You route what a person asked for onto the capabilities this host actually has. Every '
    + 'capability available to you is offered as a tool; there are no others, and there is no way '
    + 'to ask for one. A capability that is missing is missing because it has not shipped yet.',
}

const PLANNING_BLOCK: PromptTierBlock = {
  title: 'How to answer',
  body:
    'Call one action tool per clause of the request, in utterance order. Order is meaning: later '
    + 'clauses routinely depend on earlier ones, so the sequence you emit is the sequence that '
    + 'will be considered.\n'
    + '\n'
    + 'Use `answer_only` when the turn asks for information rather than for something to happen. '
    + 'A turn answered this way performs zero actions and returns your text.\n'
    + '\n'
    + 'Use `mark_unhandled` when no available tool can carry out a clause, naming that clause and '
    + 'saying which capability would be needed. This refuses the whole turn without performing any '
    + 'of it, and that is the correct outcome. Never substitute a tool that looks close: a request '
    + 'nobody can satisfy and a request satisfied by the wrong action are not the same event, and '
    + 'the person can only recover from the first one.\n'
    + '\n'
    + 'Bind arguments only from what the person actually supplied. If a clause needs an identifier '
    + 'and none was given, that clause is unhandled — do not invent one.',
}

export interface ChatPromptInput {
  /** The current message, verbatim — the one payload body this vocabulary carries. */
  readonly utterance: string
  /** The clauses the planner is being asked about, as the splitter produced them. */
  readonly clauses: readonly ChatClause[]
  /** The model in force for this turn, as the session states it. */
  readonly activeModel: string
  /** Session facts as one-liners — refs and counts, never a serialized result (D-18). */
  readonly facts?: readonly string[]
  /** The conversation this turn continues, oldest first, already repaired and pruned. */
  readonly conversation?: readonly ChatReplayMessage[]
}

function renderClauses(clauses: readonly ChatClause[]): string {
  return clauses.map((clause) => `${clause.index + 1}. ${clause.text}`).join('\n')
}

function renderConversation(messages: readonly ChatReplayMessage[]): string {
  return messages.map((message) => `${message.role}: ${message.text}`).join('\n')
}

/**
 * Chat's three tiers, rendered by the one builder.
 *
 * A block is added only when it has content: an empty tier contributes zero bytes by the builder's
 * own contract, and a header over nothing would be a section a reader has to interpret as "there
 * were none" rather than "this host did not say".
 */
export function buildChatPrompt(input: ChatPromptInput): JobModelRequest {
  const context: PromptTierBlock[] = [
    { title: 'Session', body: `Model in force: ${input.activeModel}` },
  ]
  if (input.facts !== undefined && input.facts.length > 0) {
    context.push({ title: 'Session facts', body: input.facts.join('\n') })
  }

  const volatile: PromptTierBlock[] = []
  if (input.conversation !== undefined && input.conversation.length > 0) {
    volatile.push({ title: 'Conversation so far', body: renderConversation(input.conversation) })
  }
  volatile.push({ title: 'Request', body: input.utterance })
  if (input.clauses.length > 0) {
    volatile.push({ title: 'Clauses to answer', body: renderClauses(input.clauses) })
  }

  return buildTieredPrompt({
    agent_context: CHAT_AGENT_CONTEXT,
    stable: [ROLE_BLOCK, PLANNING_BLOCK],
    context,
    volatile,
  })
}
