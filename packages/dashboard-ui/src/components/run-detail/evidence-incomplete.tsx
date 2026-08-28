// THE ONE COMPONENT FOR "THE BYTES ARE GONE" (406-05 · DETL-05, D-17 / D-18, T-406-15 / T-406-16).
//
// EVERY REF SITE RENDERS IT THROUGH HERE. The overview's decision-screenshot pane and the failure
// view's cited-artifact links describe the same fact about the same evidence store, and 405 had
// each of them one private component away from describing it in two words. One component, one
// exported label, one attribute: the two places cannot drift, because there is only one place.
//
// TWO VARIANTS, ONE STATE. `pane` fills a slot that was going to hold a picture; `inline` sits in a
// sentence where a link would have been. They differ in size and nothing else — the same word, the
// same attribute — because a reader who learns the state in one place must recognise it in the
// other. The inline form is deliberately NOT a button and NOT a link: there is nothing to open, and
// an affordance that opens nothing is a worse lie than the missing picture.
//
// IT IS PRESENTATIONAL AND KNOWS NO RUN. It takes a variant and paints it. It reads nothing,
// fetches nothing and mints no route — deciding that evidence is gone is the projection's job
// (D-17), and a component that could ask would be a component that could ask for bytes it was just
// told are not there.
//
// THIS IS THE THIRD ABSENCE VOCABULARY, and it must stay tellable apart from the other two at a
// glance and by attribute: redacted-on-purpose has the masked chip's attribute, a failed read has
// the page-level error attribute, and neither of those appears anywhere in this subtree.
//
// `data-evidence-state` IS THE CELL CONTRACT, never the visible text — a cell reading the sentence
// would be asserting on presentation, and the shipped-binary cells read attributes.

import { ImageOff } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { EVIDENCE_INCOMPLETE_LABEL } from "@/lib/run-detail-view"

export type EvidenceIncompleteVariant = "pane" | "inline"

export function EvidenceIncomplete({ variant }: { variant: EvidenceIncompleteVariant }) {
  if (variant === "inline") {
    return (
      <span data-evidence-state="incomplete" className="inline-flex align-baseline">
        <Badge variant="outline" className="gap-1 text-muted-foreground border-border font-normal">
          <ImageOff className="h-3 w-3" aria-hidden="true" />
          {EVIDENCE_INCOMPLETE_LABEL}
        </Badge>
      </span>
    )
  }

  return (
    <div data-evidence-state="incomplete" className="h-full w-full py-12">
      <div className="flex min-h-[16rem] w-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <ImageOff className="h-8 w-8" />
        <span className="text-sm font-medium text-foreground">{EVIDENCE_INCOMPLETE_LABEL}</span>
      </div>
    </div>
  )
}
