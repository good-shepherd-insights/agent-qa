// The `agent.ask` op's input and output contracts (Phase 392, D-24).
//
// D-24 is why these are here at all: the turn entry is a REGISTERED, gated function-layer op, and
// the REPL, the one-shot `ask` verb, 396's MCP projection and 397's parity suite are all clients of
// it. An op needs declared contracts, and a contract several surfaces render needs one spelling.
//
// `sessionId` IS OPAQUE TO THIS CONTRACT and validated where it becomes a path — the adapter checks
// it against the same safe-segment class the job checkpoint store uses, and an unknown id is a
// typed refusal rather than a silent create. A shape check here that looked like validation would
// be the more dangerous kind of guard: it would make a reader believe the string had been
// authorized when it had only been spelled acceptably.

import { z } from 'zod'

import { CLAUSE_RECEIPT_STATUSES } from './turn-receipts'
import { CHAT_TURN_STATUSES } from './session-events'

export const ClauseReceiptSchema = z.object({
  clause: z.string(),
  functionId: z.string(),
  origin: z.string(),
  status: z.enum(CLAUSE_RECEIPT_STATUSES),
  outcome: z.string(),
})

/**
 * What a caller asks with.
 *
 * `message` is non-empty because an empty utterance has no clause to route and the honest refusal
 * is at the contract, before a turn id is minted and a session file is touched.
 */
export const AgentAskInputSchema = z.object({
  message: z.string().min(1),
  sessionId: z.string().optional(),
})

export type AgentAskInput = z.infer<typeof AgentAskInputSchema>

/**
 * What a turn answers with.
 *
 * `receipts` is present on EVERY status including `fail_closed`, where it is empty — and the
 * emptiness is the assertion D-10 asks for. A fail-closed turn that omitted the field would leave
 * "nothing ran" and "the field is not reported here" as the same bytes, and `executed == 0` is the
 * exact claim the compound scenarios make.
 *
 * `unhandled` names the clause the turn could not route. It is the message D-08 requires: a turn
 * that fails closed must say WHICH part of what the person asked for it could not do.
 */
export const AgentAskResultSchema = z.object({
  sessionId: z.string(),
  turnId: z.string(),
  status: z.enum(CHAT_TURN_STATUSES),
  answer: z.string().optional(),
  receipts: z.array(ClauseReceiptSchema),
  unhandled: z.object({ clause: z.string(), reason: z.string() }).optional(),
})

export type AgentAskResult = z.infer<typeof AgentAskResultSchema>
