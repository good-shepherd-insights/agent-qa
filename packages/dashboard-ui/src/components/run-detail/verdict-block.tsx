// ONE MEMBER'S VERDICT, AS A PERSON READS IT (406-01 · DETL-04, D-05 / D-10 / D-12).
//
// PRESENTATIONAL, AND DELIBERATELY SO. This component takes a view the page already projected out
// of `analysis.get` and paints it. It fetches nothing, holds no run id, derives no fact and
// composes no prose: the sentence is the op's own bytes, copied through, and the provenance chip
// comes from `provenanceLabel` in `lib/analysis-view.ts`, which is pure and separately pinned.
//
// THE SENTENCE IS A PRODUCER STRING AND GOES THROUGH THE SEAM (D-12, 405 D-10). It quotes the
// failing step's recorded error verbatim — Playwright's own text — inside
// `observed (step N): "…"`, so it carries `<SECRET_n>` at rest and a typed marker after the
// display seam, exactly as `failureSummary` does one component away. Rendered raw, the marker's
// delimiter reaches a text node a person reads. `MaskedText` is the same seam the overview, the
// sub-action row and the failure banner have painted every producer string through since 405-11.
//
// THE PROVENANCE IS NOT WRAPPED, and its absence from the seam is a decision. "LLM verdict · 0.86"
// and "deterministic fallback" are this PRODUCT's words about the verdict's `producer` and
// `confidence` fields; wrapping them would claim a redaction nobody ever made.
//
// NO COPY AFFORDANCE AND NO TITLE WRITE (T-406-05). WINDOWS #302/#303 name the clipboard and the
// document title as unenumerated egress sinks for RESTORED cleartext: the local door restores
// declared secrets into this sentence for the person reading the page, and a copy button would
// move that value into a bug report, while a title write would move it into a bfcache entry and
// every window-title log. Neither is here; the sentence stays where the reader can see it.
//
// TEXT NODES AND ELEMENTS, NEVER MARKUP (T-406-02). Nothing in this file or in `MaskedText` below
// it hands React raw HTML — the acceptance gate greps this file for the escape hatch's name and
// requires zero occurrences, which is why the name is not written anywhere in it. A jsdom cell
// feeds this component markup and asserts no element was constructed.
//
// `data-*` DESCRIBES WHAT IS RENDERED, not what was passed (the banner's `showingFull` lesson).

import { MaskedText } from "@/components/run-detail/masked-text"
import type { MemberVerdictView } from "@/lib/analysis-view"

export function VerdictBlock({ view }: { view: MemberVerdictView }) {
  return (
    <div
      data-verdict-block
      data-verdict-producer={view.producer}
      data-verdict-confidence={String(view.confidence)}
      className="mx-2 mt-1 mb-1.5 rounded-[2px] border border-border/60 bg-muted/10 px-3 py-2 text-xs"
    >
      <span data-verdict-sentence className="select-text text-foreground/80">
        <MaskedText text={view.sentence} />
      </span>
      <span data-verdict-provenance className="ml-2 whitespace-nowrap text-[10px] text-muted-foreground">
        {view.provenance}
      </span>
    </div>
  )
}
