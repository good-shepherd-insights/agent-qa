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
import { Circle, CircleCheck, CircleDashed, CircleX, type LucideIcon } from "lucide-react"
import type { ReactElement } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  CHIPS_UNAVAILABLE_TEXT,
  CURATION_CHIP_TITLE,
  STAGE_INDICATOR_WORDS,
  curationChipAccessibleName,
  stageIndicatorAccessibleName,
  type PostProcessingChipView,
  type PostProcessingStage,
  type PostProcessingView,
  type StageCardView,
} from "@/lib/post-processing-view"
import type { PostProcessingChipStatus } from "@vostride/agent-qa-schema"

/** The stage words, exported so cells name them rather than re-typing them. */
export const CHIP_LABELS: Record<PostProcessingStage, string> = {
  analysis: "analysis",
  curation: "curation",
}

type ChipLook = { Glyph: LucideIcon; glyphClass: string }

/**
 * The four-word vocabulary as a closed switch onto a glyph.
 *
 * SHAPE CARRIES THE STATE AND COLOUR ONLY REINFORCES IT (425 D-06, roadmap SC2): a check, a dashed
 * ring, an empty ring and a cross still separate four states with the colour stripped out, which a
 * tinted badge never did. The tint moves onto the glyph alone; the header's one filled element is
 * the verdict badge (UI-SPEC S2).
 */
function chipLook(status: PostProcessingChipStatus): ChipLook {
  switch (status) {
    case "done":
      return { Glyph: CircleCheck, glyphClass: "text-emerald-500" }
    case "failed":
      return { Glyph: CircleX, glyphClass: "text-destructive" }
    case "running":
      return { Glyph: CircleDashed, glyphClass: "text-amber-500 motion-safe:animate-pulse" }
    case "pending":
      return { Glyph: Circle, glyphClass: "text-muted-foreground" }
  }
}

/** The chip root's shipped layout, shared by both roots below so they cannot drift apart. */
const CHIP_ROOT_CLASS = "inline-flex items-center gap-1 min-h-6 rounded-sm text-xs"

/** The one accent use this phase adds (UI-SPEC Color 1) — the same ring the primitives draw. */
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

/**
 * The card, hung off the root as a Radix tooltip that opens on hover AND on keyboard focus (D-10).
 *
 * NO PROVIDER HERE. The page mounts the one tooltip provider (`run-detail.tsx`); a second one
 * inside the header would give this surface its own delay and its own open-state bookkeeping, which
 * is two answers to "is a card open right now" on one page.
 */
function WithCard({
  stage,
  card,
  children,
}: {
  stage: PostProcessingStage | "unavailable"
  card: StageCardView | undefined
  children: ReactElement
}) {
  if (card === undefined) return children
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="bottom"
        align="start"
        sideOffset={4}
        className="max-w-[320px] text-left break-words"
        data-stage-card={stage}
      >
        <div className="space-y-1">
          <p data-stage-card-line="outcome" className="font-medium">
            {card.outcome}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * One chip — a `<span>`, or a `<button>` when the page gave it somewhere to go (407-09 · D-01).
 *
 * THE CHIP STAYS PRESENTATIONAL. It is handed a callback and calls it; it knows no tab, no route
 * and no run id (400 D-13). A chip that navigated for itself would be a second answer to "what does
 * this header do", and would grow an affordance in every surface that renders the navbar without a
 * page behind it — which is exactly why the callback is optional and its absence is the shipped
 * `<span>` unchanged.
 *
 * THE ROOT SWAPS ELEMENT, NOT CONTRACT. `data-chip` and `data-chip-status` ride the root either
 * way and the body is one expression rendered into both, so the cells 404-08 addresses on the built
 * bundle read the same selectors whether or not the chip is a door. Only `curation` ever becomes
 * one: `analysis` has no half of the Knowledge tab to open.
 */
function Chip({
  stage,
  chip,
  onCurationClick,
}: {
  stage: PostProcessingStage
  chip: PostProcessingChipView
  onCurationClick?: (() => void) | undefined
}) {
  const { Glyph, glyphClass } = chipLook(chip.status)
  const name = stageIndicatorAccessibleName(stage, chip.state, chip.card?.outcome)
  const body = (
    <>
      <Glyph aria-hidden="true" className={`h-3.5 w-3.5 ${glyphClass}`} />
      <span className="text-muted-foreground">{chip.word}</span>
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
    </>
  )

  if (stage === "curation" && onCurationClick !== undefined) {
    return (
      <WithCard stage={stage} card={chip.card}>
        <button
          type="button"
          data-chip={stage}
          data-chip-status={chip.status}
          data-stage-state={chip.state}
          onClick={onCurationClick}
          title={CURATION_CHIP_TITLE}
          aria-label={curationChipAccessibleName(chip.status)}
          className={`${CHIP_ROOT_CLASS} ${FOCUS_RING} cursor-pointer transition-colors hover:text-foreground`}
        >
          {body}
        </button>
      </WithCard>
    )
  }

  return (
    <WithCard stage={stage} card={chip.card}>
      <span
        data-chip={stage}
        data-chip-status={chip.status}
        data-stage-state={chip.state}
        tabIndex={0}
        className={`${CHIP_ROOT_CLASS} ${FOCUS_RING} cursor-default`}
      >
        {body}
        <span className="sr-only">{name}</span>
      </span>
    </WithCard>
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
export function PostProcessingChips({
  view,
  onCurationClick,
}: {
  view: PostProcessingView | undefined
  /** What pressing the `curation` chip should do. Absent → the chip is not a control (D-01). */
  onCurationClick?: (() => void) | undefined
}) {
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
      <Chip stage="curation" chip={view.curation} onCurationClick={onCurationClick} />
    </span>
  )
}
