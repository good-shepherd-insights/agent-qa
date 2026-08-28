// THE RUN'S FAILURE SUMMARY, AS A PERSON READS IT (405-14 · DETL-02, D-10, T-405-40/41/42/43).
//
// `failureSummary` IS A PRODUCER STRING, and this component is the last render site on the rebuilt
// page that painted one raw. The provenance is `member-group.tsx`'s, restated because it is the
// whole reason this file exists:
//
//   `generateFailureSummary` (runner) → `projectTestFinished`, which routes the string through
//   `maskPayloadStrings` BY NAME, so it carries `<SECRET_n>` / `<EMAIL_n>` at rest → the dashboard
//   subscriber writes it to `runs.failure_summary` → `GET /api/runs/:id` crosses
//   `unmaskTreeForDisplay`, which restores what this host can and rewrites what it cannot into a
//   typed marker → here.
//
// Rendered raw, the marker's delimiter reaches a text node a person reads — precisely the state
// 405-11's third truth and its prohibition forbid. 405-12 fixed the identical defect one row away
// in `sub-action-tree-item.tsx`; this one could not be MEASURED until 405-14 built a failing-run
// producer, because 405-09's populated run passes and the banner never rendered. WINDOWS #287.
//
// THE PARSE PRECEDES THE BUDGET. `truncateMaskedText` splits first and spends the word budget over
// SEGMENTS, so a marker is one word and is either kept whole or dropped whole. The page-local
// helper this replaces truncated the raw string on whitespace and handed the renderer a suffix of a
// producer sentence; `lib/masked-text.ts` records why that ordering was wrong even though today's
// marker spelling made it harmless.
//
// THE CLIPBOARD IS A SECOND MEDIUM A PERSON READS, SO IT GETS THE SAME RULE (T-405-43). What
// `copyTextOf` writes is the sentence the reader just looked at — the PREVIEW while the banner is
// collapsed, the whole summary once it has been expanded — with each marker replaced by the
// PUBLISHED label its chip shows, never the marker-bearing string the seam produced.
//
// BOTH HALVES OF THAT RULE ARE LOAD-BEARING, AND THE SECOND ONE WAS MEASURED MISSING. A copy button
// that pasted `␟masked:…␟` into a bug report would move the leak off the page rather than close
// it, and the pasted text is read by exactly the people a redaction is kept from. A copy button
// that pasted the FULL summary out of a COLLAPSED banner does the same thing with a RESTORED
// credential: the display seam restores `<SECRET_n>` for the human reading the page, and on the
// failing-run fixture the restored value sits at word 23 — three words past the preview budget — so
// one click on a banner that never showed it put it on the clipboard. Measured on real Chromium
// against the shipped bundle before this was fixed: 21 words / 170 chars on the page, 47 words /
// 351 chars on the clipboard, the fixture's credential at word 24 of a string the reader never saw,
// and byte-identical output from the expanded state because the argument ignored the banner's state
// entirely. THE CLIPBOARD CARRIES WHAT WAS RENDERED AND NOTHING ELSE.
//
// TEXT NODES AND ELEMENTS, NEVER MARKUP (T-405-42): there is no `dangerouslySetInnerHTML` here or in
// `MaskedText` below it, and a jsdom cell feeds this component markup and asserts no element.

import { useState } from "react"
import { AlertCircle, Check, ChevronRight, Copy } from "lucide-react"

import { MaskedText } from "@/components/run-detail/masked-text"
import { maskedLabel } from "@/components/run-detail/masked-chip"
import { splitMaskedText, truncateMaskedText } from "@/lib/masked-text"
import { cn } from "@/lib/utils"

/**
 * How much of the summary the collapsed banner shows.
 *
 * TWENTY, WHICH IS THE SHIPPED NUMBER — the page-local helper's own budget, moved rather than
 * re-chosen. It is exported because the failing-run fixture's word arithmetic is written against it:
 * the producer plants the email marker inside this budget deliberately, so the truncated state has a
 * chip to assert on. A drift that pushes the marker past the budget is fixed in the FIXTURE, never
 * by widening this number to make a cell go green.
 */
export const FAILURE_BANNER_PREVIEW_WORDS = 20

/**
 * One RENDERED run of summary text as a clipboard string: every marker replaced by the sentence its
 * chip shows.
 *
 * WHAT WAS RENDERED, NEVER MORE THAN IT. This takes the string the caller handed `MaskedText`
 * rather than reading the summary itself, because the collapsed banner shows a PREVIEW: a clipboard
 * built from the whole summary hands a reader restored cleartext the page never showed them, which
 * is the half of the medium the marker->label substitution alone does not close.
 *
 * JOINED WITH NO SEPARATOR, because the segments already carry the producer's own spacing — a join
 * on anything else would insert whitespace the sentence never had around every redaction.
 */
function copyTextOf(rendered: string): string {
  return splitMaskedText(rendered)
    .map((segment) => (
      segment.kind === "text" ? segment.text : `[${maskedLabel(segment.category)}]`
    ))
    .join("")
}

/** What the last copy attempt did — `idle` until one is made, and back to `idle` after a moment. */
type CopyStatus = "idle" | "copied" | "failed"

/**
 * What the live region says, per outcome.
 *
 * A CHECK MARK IS NOT AN ANNOUNCEMENT. The tick is the only confirmation this button has ever
 * given, and it is invisible to a screen reader: the button carried a `title` and no accessible
 * name, and the outcome was a swapped icon inside a `polite`-less subtree. Sighted feedback and
 * announced feedback are the same fact in two media, so they are derived from the same state.
 */
const COPY_ANNOUNCEMENT: Record<CopyStatus, string> = {
  idle: "",
  copied: "Failure summary copied to the clipboard",
  failed: "Could not copy the failure summary to the clipboard",
}

export function FailureBanner({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle")
  const preview = truncateMaskedText(summary, FAILURE_BANNER_PREVIEW_WORDS)

  // WHAT IS RENDERED, NOT WHAT WAS PRESSED. `data-failure-banner-state` is the attribute every DOM
  // cell reads to say which of the two claims it is making, so it has to describe the TEXT on the
  // page. Derived from `open` alone it was a constant on mount — `truncated` for every input,
  // including a summary that was never over the budget and a summary whose truncation had stopped
  // running entirely — and a cell that asserted `truncated` there was asserting `useState(false)`.
  // A banner showing all of its summary is `full` whether the reader got there by pressing the
  // chevron or by the sentence being short enough not to need one.
  const showingFull = open || !preview.isTruncated

  const announce = (outcome: Exclude<CopyStatus, "idle">) => {
    setCopyStatus(outcome)
    setTimeout(() => setCopyStatus("idle"), 2000)
  }

  // THE SAME EXPRESSION AS THE RENDER, SPELLED OUT RATHER THAN HOISTED. `copyTextOf` is handed the
  // exact string `MaskedText` below is handed, so the clipboard cannot carry a word the page did
  // not. It is written out at both sites on purpose: `scripts/405-failure-banner-mutation.sh` M4
  // matches the render call literally and M7 matches this one, and a hoisted `const rendered` would
  // leave M4's pattern matching nothing — a leg that reds nothing is a FATAL by that script's law.
  //
  // THE CHECK MARK MEANS THE WRITE RESOLVED, AND NOTHING ELSE. `writeText` returns a promise that
  // rejects with `NotAllowedError` whenever the document is not focused or the permission was
  // denied — a routine condition, not an exotic one — and the previous spelling neither awaited nor
  // caught it: an unhandled rejection, plus a green tick telling a reader the failure summary was
  // on their clipboard when it was not. `navigator.clipboard` is also `undefined` outside a secure
  // context, which the repo's Docker release reaches over any non-loopback hostname, and the bare
  // property access threw a `TypeError` inside the click handler. Optional-chained, awaited and
  // caught — `artifact-drawer.tsx`'s `copyText` idiom, with the outcome kept rather than dropped.
  const handleCopy = () => {
    const written = navigator.clipboard?.writeText(copyTextOf(open ? summary : preview.text))
    if (written === undefined) {
      announce("failed")
      return
    }
    void written.then(() => { announce("copied") }, () => { announce("failed") })
  }

  return (
    <div
      data-failure-banner
      data-failure-banner-state={showingFull ? 'full' : 'truncated'}
      className="mx-2 mt-2 rounded-[2px] border border-red-500/20 bg-red-500/5 px-3 py-2 shrink-0"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
        <span
          data-failure-banner-text
          className="flex-1 text-sm text-foreground/80 select-text"
        >
          <MaskedText text={open ? summary : preview.text} />
        </span>
        <button
          data-failure-banner-copy
          data-copy-status={copyStatus}
          onClick={handleCopy}
          className="shrink-0 mt-0.5 p-0.5 rounded-sm hover:bg-red-500/10 transition-colors"
          aria-label="Copy failure summary"
          title="Copy failure summary"
        >
          {copyStatus === "copied"
            ? <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            : <Copy
                className={cn(
                  "h-3.5 w-3.5",
                  copyStatus === "failed" ? "text-red-400" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
          }
        </button>
        {/*
          THE OUTCOME, SAID OUT LOUD. `role="status"` is an implicit `aria-live="polite"`; both are
          written because the pair is what assistive technology has historically needed, and an
          empty node that is present from first paint is what makes the announcement fire — a region
          inserted at the same moment its text appears is frequently not announced at all.

          OUTSIDE `[data-failure-banner-text]` DELIBERATELY. That element's `textContent` is the
          sentence the clipboard is measured against by the conformance cell (3g); a confirmation
          message inside it would make the page's own text disagree with the copy of it.
        */}
        <span
          data-failure-banner-copy-status
          role="status"
          aria-live="polite"
          className="sr-only"
        >
          {COPY_ANNOUNCEMENT[copyStatus]}
        </span>
        {preview.isTruncated && (
          <button
            data-failure-banner-toggle
            aria-label={open ? "Show less" : "Show full failure summary"}
            onClick={() => setOpen(o => !o)}
            className="shrink-0 mt-0.5 p-0.5 rounded-sm hover:bg-red-500/10 transition-colors"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "h-3.5 w-3.5 text-muted-foreground transition-transform",
                open && "rotate-90"
              )}
            />
          </button>
        )}
      </div>
    </div>
  )
}
