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

import { GATE_REMEDY_KINDS } from '../safety/remedies'
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
 * What ONE executed clause produced, on its way to a person (Phase 399.1, D-05).
 *
 * THE RECEIPT IS THE MAP AND THIS IS THE TERRITORY. `ClauseReceiptSchema` above is a five-string
 * one-line record by charter (D-18), and 392's `explainAnswerLines` comment defends that seat at
 * length — so the op's own result could not travel on it, and for forty ops it travelled nowhere at
 * all: chat executed them and printed `<op> completed` (G-399-2). This member is that missing
 * channel made structural rather than a second carrier bolted onto the receipt.
 *
 * `payload` IS `unknown` BY INTENTION. Forty-three ops declare forty-three output contracts, and a
 * turn result that tried to name them would either enumerate them here — a second registry, free to
 * drift from the one that dispatches — or normalise them, which is the render defect this member
 * exists to close. The op that produced it is named by `functionId`, and the contract for those
 * bytes is that op's own declared output schema, which the registry already publishes.
 *
 * THE PAYLOAD IS MASKED, AND THAT IS A CONTRACT RATHER THAN AN OBSERVATION (D-04/D-05, and the
 * 2026-08-20 D-10 adjudication's binding corollary). It carries the value the function layer
 * returned, placeholder-masked, and every path this contract travels — the prompt, the cache, the
 * session event log, any `agent.ask` client — keeps it that way. `unmaskForHumanOutput` runs at ONE
 * seam and it is each surface's own emit. An unmasked value here would put op-result credentials
 * into a persisted trail, minting a new instance of a cleartext-at-rest class that has already been
 * named.
 */
export const ClauseResultSchema = z.object({
  functionId: z.string().min(1),
  payload: z.unknown(),
})

export type ClauseResult = z.infer<typeof ClauseResultSchema>

/**
 * What the GATE decided about one clause it refused, in the vocabulary each door projects.
 *
 * THE THIRD CHANNEL, AND IT EXISTS FOR `results[]`'s REASON ONE LAYER OVER (400-06, window #188).
 * A gate denial arrives inside a turn as a thrown `FunctionDeniedError` carrying two things a
 * refused person needs: the canonical `reason` and the typed `remedies` phase 400 minted so a
 * surface can offer a way forward it can actually take. `turn-engine.ts`'s dispatch catch keeps
 * `refusalName(error)` — the NAME — because that is all a five-string receipt may carry, so both
 * were dropped on the floor and every interactive door rendered `failed FunctionDeniedError` with
 * nothing behind it. The CLI's single-op `fn` door renders them only because it catches the error
 * itself; a conversation never can.
 *
 * A SIBLING OF `receipts` RATHER THAN A MEMBER OF ONE, on the receipt charter's own argument
 * (398-13 D-21, defended at length at `explainAnswerLines`): the receipt is the MAP — five strings,
 * one line — and the territory travels beside it. Widening `ClauseReceipt` would also have widened
 * the append-only session-event grammar, whose `EVENT_KEYS` guard is an EXACT key comparison: every
 * session file written before the field existed would stop being readable. Nothing here reaches
 * that grammar. `clause_receipt` lines are byte-identical to the ones this build wrote yesterday.
 *
 * AND IT IS DELIBERATELY NOT PERSISTED. A remedy is advice about a decision being made NOW — "a
 * confirm could be answered", "this class is pinned for this session" — and its truth is a fact
 * about the live posture, not about the past. The durable record of the denial is the receipt and
 * the execution-audit row, both unchanged. A remedy replayed out of a log a week later would be a
 * suggestion nobody can check.
 *
 * `reason` IS THE GATE'S CANONICAL SENTENCE, VERBATIM. It is the same string the audit row carries
 * and `demo/acceptance/399/` publishes; nothing edits it on the way here. The per-surface half is
 * `remedies`, which is data, and each door renders only its own projection.
 */
export const ClauseDenialSchema = z.object({
  clause: z.string(),
  functionId: z.string(),
  reason: z.string(),
  remedies: z.array(z.object({
    kind: z.enum(GATE_REMEDY_KINDS),
    params: z.record(z.string(), z.string()).optional(),
  })),
})

export type ClauseDenial = z.infer<typeof ClauseDenialSchema>

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
  /**
   * What the clauses that RAN produced, in clause execution order (399.1, D-05).
   *
   * REQUIRED, AND A SIBLING OF `receipts` RATHER THAN A MEMBER OF ONE, on `receipts`' own argument:
   * a turn that omitted the field would leave "nothing produced a result" and "this build does not
   * report results" as the same bytes, and "the refused turn ran nothing" is precisely the claim a
   * fail-closed turn makes. So a fail-closed turn carries `[]` and says so.
   *
   * ONE ENTRY PER EXECUTED CLAUSE, so a compound turn's second op is not silently the first's. The
   * ORDER is the order the engine ran them in, which is the order the person typed them — the
   * property this whole engine preserves everywhere else.
   */
  results: z.array(ClauseResultSchema),
  /**
   * What the GATE refused, in clause order (400-06, window #188).
   *
   * REQUIRED, AND EMPTY IS THE CLAIM, on `results[]`'s own argument directly above: a turn that
   * omitted the field would leave "the gate refused nothing here" and "this build does not report
   * denials" as the same bytes — and "nothing was refused" is precisely what a reader of a green
   * transcript is entitled to believe. So a turn where the gate never spoke carries `[]` and says
   * so.
   *
   * ONE ENTRY PER DENIED CLAUSE, joined to its receipt by `clause` and `functionId` rather than by
   * position: a compound turn stops on failure, so the denial list and the receipt list have
   * different lengths, and a render that paired them by index would attribute one op's refusal to
   * another — the exact class of legibility defect 399.1 gap 2 measured on the payload side.
   */
  denials: z.array(ClauseDenialSchema),
  unhandled: z.object({ clause: z.string(), reason: z.string() }).optional(),
  /**
   * Lines of this session's log the open path could not read (392 plan 08, discharging 392-03).
   *
   * SURFACED RATHER THAN SWALLOWED. A resumed session with permanent mid-file damage comes back
   * with a non-empty list, and a surface that ignored it would re-create exactly the swallow plan
   * 03 removed — a person continuing a conversation that is quietly missing part of itself. One
   * line of output is enough, which is why this is a COUNT of what could not be read rather than
   * the damage report: the report is the file, and `chat --list` is what names the file.
   *
   * OPTIONAL, and absent means the log had nothing to refuse — which every healthy session is, so
   * a required field would put a zero on every turn of every conversation forever.
   */
  refusedLineCount: z.number().int().positive().optional(),
})

export type AgentAskResult = z.infer<typeof AgentAskResultSchema>
