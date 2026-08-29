// ONE SERVED BRIEF LINE, WITH THE REASON IT WAS SERVED (407-06 · LERN-01, D-04 / D-08, T-407-14).
//
// IT IS PRESENTATIONAL AND KNOWS NO RUN. It takes a line view and paints it. It computes no rank,
// no score and no outcome word — every one of those is decided in `lib/knowledge-view.ts` from the
// serve-time trace and the projection's own attribution join, and a component that could compute a
// rank would be a component that could answer "why this line?" about the index as it stands NOW
// rather than about the moment the brief was assembled. That is the exact dishonesty KREV-02
// exists to prevent, and the reason `why` arrives as data rather than as a query.
//
// EVERY ABSENCE IS A VISIBLE STATE (D-04). `data-trace-state` is one of four words and never
// missing: `answered` prints what the trace recorded; `artifact-missing` renders the SHIPPED
// evidence-incomplete component rather than a fifth wording for "the bytes are gone";
// `pre-trace-run` and `step-not-found` each print their own sentence. Nothing silently drops, and
// nothing renders an expander that would open onto nothing.
//
// THE CANARY MARKER IS UNCONDITIONAL (D-08). A line served as a canary says so whatever curation
// did or did not decide, and the outcome badge beside it is one of seven words — never blank. A
// blank slot beside a canary marker reads as "this did not matter", which is a claim nobody made.
// The seventh word, `unknown`, is the one a partial store read earns: `not attributed` asserts the
// store was consulted and said no, and a scan that could not finish never made that claim (WR-02).
//
// ALL TEXT GOES THROUGH REACT TEXT NODES. No raw-HTML injection escape hatch appears anywhere in
// this file — a grep for React's one is an acceptance criterion. The summary is a producer string
// crossing the display seam, so it goes through `MaskedText`, which paints restored-marker
// segments as chips and everything else as text.

import { ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { EvidenceIncomplete } from "./evidence-incomplete"
import { MaskedText } from "./masked-text"
import {
  ATTRIBUTION_PENDING_TEXT,
  ATTRIBUTION_UNKNOWN_TEXT,
  CANARY_BADGE_TEXT,
  NOT_ATTRIBUTED_TEXT,
  PRE_TRACE_TEXT,
  STEP_NOT_FOUND_TEXT,
  WHY_TRIGGER_TEXT,
  traceLineText,
  type BriefLineView,
  type CanaryOutcomeWord,
} from "@/lib/knowledge-view"

/** The nested-disclosure trigger idiom `artifact-config-tab.tsx` established. */
export const NESTED_TRIGGER_CLASS =
  "group flex items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"

/** A record id, a leg, a rank, a score: mono, and `tabular-nums` so a column does not jitter. */
const MONO_CLASS = "font-mono text-xs text-muted-foreground tabular-nums"

/**
 * The seven outcome words, as the badge that carries each.
 *
 * ONE CLOSED MAPPING, matching the UI-SPEC Color table: emerald for the two words that say the
 * canary held up, destructive for the two that say it did not, amber outline while nobody has
 * decided, muted outline when the fold decided nothing. The words themselves come from
 * `lib/knowledge-view.ts`; only the LOOK is decided here.
 *
 * `unknown` WEARS THE SAME MUTED OUTLINE AS `not-attributed`, deliberately (407-18 · WR-02). The
 * two say different things — one is an answer, the other is the absence of one — and the
 * `data-canary-outcome` word is what tells them apart. A warning tint here would put the story of
 * the degradation on a line that did nothing wrong; the Learned half's read note is where a
 * partial read is explained.
 *
 * NO `default` ARM. The switch is exhaustive over `CanaryOutcomeWord` and its return type is not
 * optional, so an eighth word is a COMPILE ERROR here rather than a badge that silently renders
 * `undefined` — which is exactly how the missing `unknown` arm surfaced.
 */
function outcomeBadge(word: CanaryOutcomeWord): { text: string; className: string; variant: "outline" | "destructive" } {
  switch (word) {
    case "confirmed":
    case "helpful":
      return { text: word, className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20", variant: "outline" }
    case "contradicted":
    case "harmful":
      return { text: word, className: "", variant: "destructive" }
    case "pending":
      return {
        text: ATTRIBUTION_PENDING_TEXT,
        className: "bg-amber-500/15 text-amber-500 border-amber-500/20",
        variant: "outline",
      }
    case "not-attributed":
      return { text: NOT_ATTRIBUTED_TEXT, className: "text-muted-foreground", variant: "outline" }
    case "unknown":
      return { text: ATTRIBUTION_UNKNOWN_TEXT, className: "text-muted-foreground", variant: "outline" }
  }
}

export function KnowledgeBriefLine({ line }: { line: BriefLineView }) {
  const outcome = line.canaryOutcome === undefined ? undefined : outcomeBadge(line.canaryOutcome)

  return (
    <li
      data-served-channel="1"
      data-served-as-canary={line.servedAsCanary ? "true" : "false"}
      // ABSENT, not empty, on a line that was not served as a canary: an empty attribute is
      // indistinguishable from an outcome the component forgot to stamp.
      {...(line.canaryOutcome === undefined ? {} : { "data-canary-outcome": line.canaryOutcome })}
      data-trace-state={line.why.kind === "answered" ? "answered" : line.why.reason}
      className="space-y-1"
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* `break-words`: a 120-char brief line wraps inside the row rather than widening it. */}
        <span className="text-sm break-words"><MaskedText text={line.summary} /></span>
        {line.servedAsCanary ? (
          <Badge variant="outline" className="text-xs">{CANARY_BADGE_TEXT}</Badge>
        ) : null}
        {outcome === undefined ? null : (
          <Badge variant={outcome.variant} className={`text-xs ${outcome.className}`}>{outcome.text}</Badge>
        )}
      </div>
      <p className={MONO_CLASS}>{line.id}</p>
      <LineWhyRow line={line} />
    </li>
  )
}

/**
 * The why answer, or the named absence of one.
 *
 * The answered arm is a `Collapsible` rather than a permanently-visible row because a step can
 * serve dozens of lines and three numbers apiece would drown the sentences they explain. The
 * absence arms are NOT collapsibles: an expander that opens onto one sentence is an affordance
 * that promises more than it has.
 */
function LineWhyRow({ line }: { line: BriefLineView }) {
  if (line.why.kind === "answered") {
    const answer = traceLineText(line.why.leg, line.why.rank, line.why.score)
    return (
      <Collapsible>
        <CollapsibleTrigger className={NESTED_TRIGGER_CLASS}>
          <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
          {WHY_TRIGGER_TEXT}
        </CollapsibleTrigger>
        <CollapsibleContent className="pl-5">
          <p className={MONO_CLASS}>{answer}</p>
        </CollapsibleContent>
      </Collapsible>
    )
  }

  if (line.why.reason === "artifact-missing") {
    // The one component and the one word for "the bytes are gone" (406 D-17) — not a fifth
    // wording invented here for a row.
    return <EvidenceIncomplete variant="inline" />
  }

  return (
    <p className="text-xs text-muted-foreground">
      {line.why.reason === "pre-trace-run" ? PRE_TRACE_TEXT : STEP_NOT_FOUND_TEXT}
    </p>
  )
}
