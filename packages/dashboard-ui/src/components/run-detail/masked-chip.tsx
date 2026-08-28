// THE MASKED CHIP (405-11 · DETL-02, D-10).
//
// PRESENTATIONAL, AND DELIBERATELY SO. It takes a category and paints it. It reads nothing, fetches
// nothing and knows no run — the value behind the marker does not exist on this page and must not
// be reachable from it.
//
// TWO CATEGORIES, TWO SENTENCES. A masked SECRET is a value this host's current config could have
// restored had it been declared, so its copy says so; a masked EMAIL was minted by detection during
// masking and has no source to restore from at all, so it is a permanent state rather than a
// misconfiguration. Collapsing them into one sentence would tell a reader to go fix something that
// is not broken.
//
// THE `data-masked` ATTRIBUTE CARRIES THE RAW CATEGORY, never the label — 405-12's DOM cells assert
// on it, and a cell reading visible text would be asserting on presentation.

import { Lock } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { MASKED_EMAIL_LABEL, MASKED_SECRET_LABEL } from "@/lib/run-detail-view"
import type { MaskedCategory } from "@vostride/agent-qa-schema"

/**
 * The published sentence per category — a closed switch, so a new category cannot render unnamed.
 *
 * EXPORTED SINCE 405-14 because the chip is no longer the only medium a person reads a redaction
 * in: the failure banner's copy button writes the same sentence to the clipboard, and a second
 * switch over the same closed set would be a second place a third category could go unnamed.
 */
export function maskedLabel(category: MaskedCategory): string {
  switch (category) {
    case "secret":
      return MASKED_SECRET_LABEL
    case "email":
      return MASKED_EMAIL_LABEL
  }
}

export function MaskedChip({ category }: { category: MaskedCategory }) {
  return (
    <span data-masked={category} className="inline-flex align-baseline">
      <Badge variant="outline" className="gap-1 text-muted-foreground border-border font-normal">
        <Lock className="h-3 w-3" aria-hidden="true" />
        {maskedLabel(category)}
      </Badge>
    </span>
  )
}
