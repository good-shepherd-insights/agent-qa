// One clause receipt, in the browser's medium (Phase 400 plan 06, DASH-01).
//
// THE LAW THIS FILE CARRIES IS `receipt-line.ts`'s, NOT ITS CODE. The CLI renders the same four
// statuses with picocolors — `executed` green, `failed` red, `refused` yellow, `not-run` dim — as a
// record with NO default arm, so a fifth member of `ClauseReceiptStatus` is a compile error at that
// line rather than a new status silently wearing the "never attempted" affordance. That module
// cannot be imported here (it prints ANSI at a terminal) and must not be copied; what crosses is
// the law, expressed with the same guard shape in a different medium.
//
// THE FOUR PRESENTATIONS ARE FOUR DIFFERENT FACTS, restated here because the words matter more
// than the colours: `executed` means the thing was carried out. `failed` means something went
// wrong and a person should look. `refused` means a guardrail declined — the control WORKED,
// nothing is broken, and nothing happened; it is neither of the other two and 399.1 D-02 paid for
// that distinction at every consumer. `not-run` means the clause was never attempted at all.
//
// AND EVERY ONE OF THEM CARRIES TEXT. Colour alone is not a distinction for a person who cannot
// see the difference between the reds and the greens, and it is not one for an automated cell
// either — the DOM differential in plan 400-09 reads the accessible label, which is why it exists
// as data here rather than as a class name somebody would have to decode.

import { type ClauseReceiptStatus } from "@vostride/agent-qa-schema"

import { cn } from "@/lib/utils"

export interface ReceiptStatusPresentation {
  /** The visual channel — one distinct treatment per status, never a shared palette. */
  readonly className: string
  /** The words a person (or a screen reader, or a DOM cell) reads instead of a colour. */
  readonly accessibleLabel: string
}

/**
 * How each status reads in a browser — TOTAL over the vocabulary, and the totality is the guard.
 *
 * `as const satisfies Record<ClauseReceiptStatus, …>` is the same construction `receipt-line.ts`
 * uses and for the same measured reason: the version of this map with a default arm styles an
 * unrecognised status as whatever the fallback happens to be, and the fallback is always the one
 * that reads as "nothing happened". A fifth member added to `CLAUSE_RECEIPT_STATUSES` fails to
 * compile HERE, which is the only version of this guard that does not depend on somebody
 * remembering to come back to this file.
 */
export const RECEIPT_STATUS_PRESENTATION = {
  executed: {
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    accessibleLabel: "executed",
  },
  failed: {
    className: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
    accessibleLabel: "failed",
  },
  refused: {
    className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
    accessibleLabel: "refused by a guardrail",
  },
  "not-run": {
    className: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
    accessibleLabel: "not run",
  },
} as const satisfies Record<ClauseReceiptStatus, ReceiptStatusPresentation>

export interface ReceiptRowProps {
  clause: string
  functionId: string
  outcome: string
  /** `undefined` when the session line carries a status word this build does not know. */
  status: ClauseReceiptStatus | undefined
  rawStatus: string
}

/**
 * What a line from a LATER BUILD reads as. Not part of the total map, and deliberately outside it:
 * the map is total over the vocabulary this build ships, and a word from another build is a data
 * fact rather than a fifth member. It is shown rather than dropped, because a clause that ran and
 * cannot be classified here is still a clause that ran.
 */
const UNRECOGNISED_STATUS: ReceiptStatusPresentation = {
  className: "border-dashed border-muted-foreground/40 bg-muted/20 text-muted-foreground",
  accessibleLabel: "status not recognised by this build",
}

/**
 * The receipt line: what ran, how it went, the op's own name — and what it cost.
 *
 * `outcome` IS RENDERED UNCONDITIONALLY, on WINDOWS 124's owner-ratified ruling that the RENDERED
 * LINE governs: `Runs consumed: N (previewed up to M)` reaches the persisted receipt and no surface
 * ever printed it, so a person who approved "up to 7 runs" was never told it cost 1. A conditional
 * render is a drop path with a condition on it.
 */
export function ReceiptRow({ clause, functionId, outcome, status, rawStatus }: ReceiptRowProps) {
  const presentation = status === undefined
    ? UNRECOGNISED_STATUS
    : RECEIPT_STATUS_PRESENTATION[status]
  return (
    <div
      data-receipt-status={status ?? "unrecognised"}
      data-receipt-raw-status={rawStatus}
      className="flex flex-col gap-1 rounded-md border border-border/60 bg-card/40 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[11px] leading-none",
            presentation.className,
          )}
        >
          {presentation.accessibleLabel}
        </span>
        <span className="font-mono text-xs font-semibold text-foreground">{functionId}</span>
        <span className="text-xs text-muted-foreground">{clause}</span>
      </div>
      <span className="pl-1 text-xs text-muted-foreground">{outcome}</span>
    </div>
  )
}
