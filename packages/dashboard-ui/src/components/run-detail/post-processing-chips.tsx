// THE TWO CHIPS IN THE RUN HEADER (404-07 · LIFE-03, D-20..D-23, T-404-01).
//
// PRESENTATIONAL, AND DELIBERATELY SO (400 D-13). This component takes a view and paints it. It
// opens no socket, holds no timer and does not know a run id — run detail owns the client and hands
// the projection down. A header that fetched for itself would open one client per mount of a
// component that remounts on every tab change, and would be a second answer to "what does this page
// know about this chain".
//
// EVERY VISIBLE SENTENCE COMES FROM `post-processing-view.ts`. The posture parenthetical, the
// absent-reason line and the unavailable heading are all exported constants, so the words a person
// reads live beside the reasoning for them and cannot drift from the cells that pin them.
//
// THE FAILURE TEXT IS A TEXT NODE AND NOTHING ELSE (T-404-01). It is the producer's masked, bounded
// string, forwarded by the route and forwarded again by the projection; React escapes it on the way
// into the DOM and there is no `dangerouslySetInnerHTML` anywhere in this file. A cell feeds it an
// `<img onerror=...>` and asserts no element was created.
//
// THE `data-*` ATTRIBUTES ARE THE CONTRACT 404-08's Playwright cells address on the built bundle.
// They carry the RAW words — `data-chip-status="failed"`, not the label — because a cell reading
// visible text would be asserting on presentation, and a page that painted the right word into the
// wrong element would still pass.

import { Badge } from "@/components/ui/badge"
import type * as React from "react"
import {
  CHIPS_UNAVAILABLE_TEXT,
  type PostProcessingChipView,
  type PostProcessingStage,
  type PostProcessingView,
} from "@/lib/post-processing-view"
import type { PostProcessingChipStatus } from "@vostride/agent-qa-schema"

/** The stage words, exported so cells name them rather than re-typing them. */
export const CHIP_LABELS: Record<PostProcessingStage, string> = {
  analysis: "analysis",
  curation: "curation",
}

type ChipLook = Pick<React.ComponentProps<typeof Badge>, "variant" | "className">

/**
 * The four-word vocabulary as a closed switch onto badge looks.
 *
 * `done` borrows the verdict badge's emerald so a settled chain reads as settled at a glance;
 * `failed` is the same destructive as a failed run; `running` is amber with a slow pulse, which is
 * the one piece of motion in this header and exists to say "this is still moving" without a spinner
 * that competes with the step tree. `pending` is a bare outline: present, unstarted, not alarming.
 */
function chipLook(status: PostProcessingChipStatus): ChipLook {
  switch (status) {
    case "done":
      return { className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20" }
    case "failed":
      return { variant: "destructive" }
    case "running":
      return { className: "bg-amber-500/15 text-amber-500 border-amber-500/20 animate-pulse" }
    case "pending":
      return { variant: "outline" }
  }
}

function Chip({ stage, chip }: { stage: PostProcessingStage; chip: PostProcessingChipView }) {
  return (
    <span
      data-chip={stage}
      data-chip-status={chip.status}
      className="inline-flex items-center gap-1 min-w-0"
    >
      <Badge {...chipLook(chip.status)}>
        {CHIP_LABELS[stage]} {chip.status}
      </Badge>
      {chip.posture === undefined ? null : (
        <span data-chip-posture className="text-xs text-muted-foreground truncate">
          ({chip.posture})
        </span>
      )}
      {chip.facts === undefined ? null : (
        <span data-chip-facts className="text-xs text-muted-foreground truncate">
          {chip.facts}
        </span>
      )}
      {chip.error === undefined ? null : (
        <span
          data-chip-error
          {...(chip.willRetry === undefined ? {} : { "data-chip-will-retry": String(chip.willRetry) })}
          title={chip.error}
          className="text-xs text-destructive truncate max-w-[24rem]"
        >
          {chip.error}
        </span>
      )}
      {chip.reasonAbsent === undefined ? null : (
        <span data-chip-reason-absent className="text-xs text-muted-foreground truncate">
          {chip.reasonAbsent}
        </span>
      )}
    </span>
  )
}

/**
 * The chip area: two chips, a named refusal, or the honest gap before the first read.
 *
 * THREE STATES AND NOT TWO. `undefined` is "the first read has not landed", which is NOT the same
 * claim as `pending` ("the store says this chain has not started") and not the same as
 * `unavailable` ("the store could not be read"). D-23 forbids collapsing the third into the first;
 * collapsing the second into the first would be the same lie one step earlier.
 */
export function PostProcessingChips({ view }: { view: PostProcessingView | undefined }) {
  if (view === undefined) {
    return (
      <span data-chips-state="loading" className="text-xs text-muted-foreground shrink-0">
        …
      </span>
    )
  }

  if (view.kind === "unavailable") {
    const detail = view.reason === undefined ? view.error : `${view.error}: ${view.reason}`
    return (
      <span
        data-chips-state="unavailable"
        title={detail}
        className="inline-flex items-center gap-1 min-w-0"
      >
        <Badge variant="outline" className="text-muted-foreground border-border">
          {CHIPS_UNAVAILABLE_TEXT}
        </Badge>
        <span className="text-xs text-muted-foreground truncate">{detail}</span>
      </span>
    )
  }

  return (
    <span data-chips-state="chips" className="inline-flex items-center gap-2 min-w-0">
      <Chip stage="analysis" chip={view.analysis} />
      <Chip stage="curation" chip={view.curation} />
    </span>
  )
}
