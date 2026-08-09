// `agent.ask` — the chat turn entry, as a registered capability (Phase 392, D-24).
//
// THIS FILE IS THE L10 ANSWER. §3's "no private powers" law says a surface may not hold a
// capability the function layer does not, and a chat REPL that owned its turn engine directly would
// be the largest such power in the system — an orchestrator that can reach every op, reachable
// itself through nothing the catalogue declares. Registering the turn entry inverts that: the REPL
// and the `ask` verb are CLIENTS of `agent.ask` exactly as they are clients of `runs.list`, 396's
// MCP projection picks it up from the registry with no chat-specific code, and 397's parity suite
// asserts chat ≡ registry without a carve-out.
//
// OP CALLS OP, WHICH IS ORDINARY COMPOSITION. A turn invokes other capabilities, and each of those
// invocations crosses `invokeFunction` on its own with the caller the composition minted for its
// stage — so a clause the turn runs is gated by the same eight steps as the turn itself, and a
// `requiresHumanOrigin` op refuses a planner-planned call without this file knowing such ops exist.
//
// `requiredScopes: ['read']` IS ABOUT THE TURN, NOT ITS CONTENTS, and that is the deliberate part.
// Declaring the union of every scope a clause might need would hand a read-only surface's caller
// nothing and a full caller everything in one undifferentiated grant — the per-clause checks are
// where reach is actually decided, and they happen whatever this line says. What this scope governs
// is the ability to START a turn.
//
// `agent.chat` IS DELIBERATELY NOT HERE. The session-stateful sibling waits for a consumer
// (RESEARCH Open Q3): shipping it now would mint a second entry with no client, and 397's parity
// suite would then require a stub of it on every surface.

import { AgentAskInputSchema, AgentAskResultSchema } from '@vostride/agent-qa-schema'
import type { AgentAskInput, AgentAskResult } from '@vostride/agent-qa-schema'

import { FunctionNotBoundError } from '../spec.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'

/**
 * Lowercase dot taxonomy (384 D-15): the `agent.` domain's first verb.
 *
 * The literal appears exactly once, here. Every surface that names it — the `ask` command today,
 * the REPL and the MCP projection later — imports this constant, so the parity suite and the
 * catalogue read the same string as the dispatcher.
 */
export const AGENT_ASK_FUNCTION_ID = 'agent.ask'

export const agentAskSpec: FunctionSpec<AgentAskInput, AgentAskResult> = {
  id: AGENT_ASK_FUNCTION_ID,
  summary: 'Run one conversational turn: route the utterance, execute what it resolves to, and answer with per-clause receipts.',
  requiredScopes: ['read'],
  resultKind: 'unary',
  // Bound where a composition assembles a turn engine. A host with no engine lists this
  // `unbound` BY NAME rather than answering an empty turn — which would tell a person their
  // request was understood and produced nothing, the one wrong answer that stops them asking.
  boundThrough: 'chatTurn',
  input: AgentAskInputSchema,
  output: AgentAskResultSchema,
  // `readOnly: false`, and the honesty matters more here than on any other op in the catalogue: a
  // turn is a variable-reach capability, so describing it as a read would let a gate ladder treat
  // the door to every write verb as the cheapest thing in the registry.
  risk: { name: `fn:${AGENT_ASK_FUNCTION_ID}`, recognized: true, readOnly: false },
  async invoke(input, deps: FunctionDeps) {
    const turn = deps.chatTurn
    // An explicit presence check rather than a try/catch, on the `runs-digest.ts` reasoning:
    // swallowing would also swallow a real failure inside a bound engine.
    if (turn === undefined) {
      throw new FunctionNotBoundError(AGENT_ASK_FUNCTION_ID)
    }
    return turn.runTurn(input)
  },
}
