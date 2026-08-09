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
 */
export const CLAUSE_RECEIPT_STATUSES = ['executed', 'failed', 'not-run'] as const

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
