// Per-clause turn receipts (Phase 392, CHAT-01 / D-11).
//
// A turn reports what happened to EACH clause, not a single verdict, because D-11's execution rule
// is sequential-and-stop-on-failure: a compound turn can legitimately end with one clause executed,
// one failed and two never attempted, and a scalar answer cannot say that. The three statuses are
// exactly those three facts.
//
// `not-run` is the member that earns the vocabulary. Without it a clause the engine deliberately
// never attempted is indistinguishable from one that failed, and a person reading the receipt would
// go looking for a failure that never happened.

/**
 * What became of one clause. Closed, spelled once (388 C13).
 *
 * A DENIED confirm folds to `failed` rather than acquiring a fourth member (RESEARCH Pitfall 6):
 * the refusal name travels in `outcome`, so the fact is not lost, and a status a surface has to
 * special-case is a status every surface has to special-case.
 *
 * 2026-08-20 (Phase 399.1, D-02) — `refused` IS THAT FOURTH MEMBER, AND THE RULING ABOVE STANDS.
 * The 388 C13 ruling is about a PERSON declining a confirm, and a person who says no has not been
 * refused by anything: the turn asked, the answer was no, and folding that to `failed` costs a
 * reader nothing they cannot recover from `outcome`. This member is about the OTHER subject — a
 * GUARDRAIL declining an op. There the control WORKED and nothing failed, and both of the existing
 * members are actively wrong about it: `executed` asserts the change happened (measured G-399-2: a
 * credential-blocked config mutation rendered `executed` in green while the file was byte-unchanged,
 * and the reader's plausible next action was to paste the secret in by hand), while `failed` sends
 * them hunting a defect that does not exist. The specific reason — `guardrail-hit`, `schema-fail`,
 * `duplicate-of:…` — still travels in `outcome` and in the rendered payload; what this member adds
 * is the one bit a surface must not get wrong, which is whether the thing was carried out.
 *
 * THE COST IS PAID DELIBERATELY, not overlooked: a status every surface has to special-case is
 * exactly what this is, and 399.1 pays it at every consumer in-phase (the receipt colour map becomes
 * exhaustive with a never-check, so a FIFTH member is a compile error rather than a silent `pc.dim`).
 * Widening the set is read-compatible for existing session logs — a status only ever appears in
 * entries written after it existed.
 */
export const CLAUSE_RECEIPT_STATUSES = ['executed', 'failed', 'not-run', 'refused'] as const

export type ClauseReceiptStatus = (typeof CLAUSE_RECEIPT_STATUSES)[number]

/**
 * One clause's receipt.
 *
 * `outcome` is a ONE-LINE summary and never a payload body (D-18): for a failure it carries the
 * function layer's own refusal NAME (`UnknownFunctionError`, `FunctionDeniedError`, …), which is
 * the vocabulary `invokeFunction` already publishes, so a surface reporting a refused clause names
 * the same thing the audit row does.
 */
export interface ClauseReceipt {
  clause: string
  functionId: string
  origin: string
  status: ClauseReceiptStatus
  outcome: string
}
