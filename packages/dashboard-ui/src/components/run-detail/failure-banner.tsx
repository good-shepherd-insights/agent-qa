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
// TEXT NODES AND ELEMENTS, NEVER MARKUP (T-405-42): there is no `dangerouslySetInnerHTML` here or in
// `MaskedText` below it, and a jsdom cell feeds this component markup and asserts no element.

import { useState } from "react"
import { AlertCircle, Check, ChevronRight, Copy } from "lucide-react"

import { MaskedText } from "@/components/run-detail/masked-text"
import { truncateMaskedText } from "@/lib/masked-text"
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

export function FailureBanner({ summary }: { summary: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const preview = truncateMaskedText(summary, FAILURE_BANNER_PREVIEW_WORDS)

  const handleCopy = () => {
    navigator.clipboard.writeText(summary)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      data-failure-banner
      data-failure-banner-state={open ? 'full' : 'truncated'}
      className="mx-2 mt-2 rounded-[2px] border border-red-500/20 bg-red-500/5 px-3 py-2 shrink-0"
    >
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
        <span
          data-failure-banner-text
          className="flex-1 text-sm text-foreground/80 select-text"
        >
          <MaskedText text={open ? summary : preview.text} />
        </span>
        <button
          onClick={handleCopy}
          className="shrink-0 mt-0.5 p-0.5 rounded-sm hover:bg-red-500/10 transition-colors"
          title="Copy failure summary"
        >
          {copied
            ? <Check className="h-3.5 w-3.5 text-emerald-400" />
            : <Copy className="h-3.5 w-3.5 text-muted-foreground" />
          }
        </button>
        {preview.isTruncated && (
          <button
            data-failure-banner-toggle
            aria-label={open ? "Show less" : "Show full failure summary"}
            onClick={() => setOpen(o => !o)}
            className="shrink-0 mt-0.5 p-0.5 rounded-sm hover:bg-red-500/10 transition-colors"
          >
            <ChevronRight className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              open && "rotate-90"
            )} />
          </button>
        )}
      </div>
    </div>
  )
}
