// THE EXPANDED STEP ROW (407-06 · LERN-01, D-03 / D-04 / D-07 / D-08, T-407-14).
//
// IT FILLS THE SLOT 407-02 LEFT. `tab-knowledge.tsx` shipped `<div data-step-detail />` as a
// structural anchor precisely so this plan would be an addition rather than a re-shaping of the
// row; this component is what goes in it.
//
// IT IS PRESENTATIONAL AND KNOWS NO RUN. It takes a `StepDetailView` and paints it. Every sentence
// it renders — the channel eyebrows, the cut-candidates label, the replay/hint sentence — is an
// exported constant or a function of `lib/knowledge-view.ts`. Nothing here decides a word.
//
// AN EMPTY CHANNEL STILL GETS ITS EYEBROW. Three named sections, always, because "channel 2 served
// nothing" and "this surface does not show channel 2" are different facts and a reader can only
// tell them apart if the heading is there either way.
//
// THE PAGE IS THE OVERFLOW STRATEGY, not virtualisation (UI-SPEC). Step rows render collapsed, so
// the tab's DOM is bounded by step count; the one unbounded case — a single step served hundreds
// of lines — is bounded by `channelPage` and a `Show all {n} lines` disclosure. The remainder is a
// SECOND `<ul>` inside the disclosure rather than more `<li>`s inside the first, because an `<li>`
// nested under a `<div>` under a `<ul>` is not a list.
//
// ALL TEXT GOES THROUGH REACT TEXT NODES. No raw-HTML injection escape hatch appears anywhere in
// this file — a grep for React's one is an acceptance criterion. Producer strings (caution
// summaries here, brief summaries in `KnowledgeBriefLine`) go through `MaskedText`.

import { ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { KnowledgeBriefLine, NESTED_TRIGGER_CLASS } from "./knowledge-brief-line"
import { MaskedText } from "./masked-text"
import {
  CHANNEL_EYEBROWS,
  CHANNEL_PAGE_SIZE,
  channelPage,
  type BriefLineView,
  type PlanSourceView,
  type StepDetailView,
} from "@/lib/knowledge-view"

/** The eyebrow role, from the UI-SPEC Typography table (the shortcut legend's own style). */
const EYEBROW_CLASS = "text-[10px] uppercase tracking-wider font-medium text-muted-foreground"

/** Children of a section indent by the chevron width — `artifact-config-tab.tsx`'s own offset. */
const CHANNEL_LIST_CLASS = "pl-5 space-y-2"

/** A record id or a cut-candidate line: mono, `tabular-nums` so a column of scores lines up. */
const MONO_CLASS = "font-mono text-xs text-muted-foreground tabular-nums"

/** The cut ledger's own eyebrow — the fourth sub-section caption of the UI-SPEC's list. */
const CUT_EYEBROW = "CUT CANDIDATES"

export function KnowledgeStepDetail({ detail }: { detail: StepDetailView }) {
  return (
    <div className="space-y-4">
      <Channel1 lines={detail.channel1} />

      <section className="space-y-2">
        <p className={EYEBROW_CLASS}>{CHANNEL_EYEBROWS[2]}</p>
        <ul className={CHANNEL_LIST_CLASS}>
          {detail.channel2.map(trace => (
            <li key={trace.id} data-served-channel="2" className="flex flex-wrap items-center gap-2">
              {/* This id had NO break at all, and it is a flex item of a `flex flex-wrap` row —
                  sized from its own content, so its min-content contribution was the whole
                  unbroken record id and the row could only grow past its column.
                  `overflow-wrap: anywhere` is the value that reduces that contribution;
                  `overflow-wrap: break-word` would not, which is why the other spelling is
                  nowhere in this file. Applied here rather than in the shared mono constant. */}
              <span className={`${MONO_CLASS} wrap-anywhere`}>{trace.id}</span>
              <span className="text-xs text-muted-foreground">{trace.detailLevel}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <p className={EYEBROW_CLASS}>{CHANNEL_EYEBROWS[3]}</p>
        <ul className={CHANNEL_LIST_CLASS}>
          {detail.channel3.map(caution => (
            <li key={caution.id} data-served-channel="3" className="space-y-1">
              {/* `overflow-wrap: anywhere`, NOT `overflow-wrap: break-word`. Same node shape, same
                  reason as channel 1 (`knowledge-brief-line.tsx`): a caution summary is regularly
                  one unbroken token, and `break-word` leaves min-content width at the whole token —
                  it offers a break only once the box HAS a width, so a content-sized box never
                  shrinks far enough to reach it. Only `anywhere` participates in intrinsic sizing.
                  This span was byte-identical to the channel-1 span before that fix. */}
              <span className="text-sm wrap-anywhere"><MaskedText text={caution.summary} /></span>
              {/* Applied at the USE SITE, not inside the shared mono constant above. */}
              <p className={`${MONO_CLASS} wrap-anywhere`}>{caution.id}</p>
            </li>
          ))}
        </ul>
      </section>

      {detail.cut === undefined ? null : (
        <div data-cut-candidates={String(detail.cut.lines.length)}>
          <Collapsible>
            <CollapsibleTrigger className={NESTED_TRIGGER_CLASS}>
              <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
              {detail.cut.label}
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-1">
              <p className={EYEBROW_CLASS}>{CUT_EYEBROW}</p>
              <ul className={CHANNEL_LIST_CLASS}>
                {/* Only the LEADING token of this sentence is unbroken — the record id — but that
                    is enough to set the line's min-content width, so it gets the same treatment at
                    the same use site. The spaced leg/rank/score remainder is unaffected. */}
                {detail.cut.lines.map(candidate => (
                  <li key={candidate.recordId} className={`${MONO_CLASS} wrap-anywhere`}>
                    {candidate.recordId} · leg {candidate.leg} · rank {String(candidate.rank)} · score{" "}
                    {candidate.score.toFixed(3)}
                  </li>
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {detail.planSource === undefined ? null : <PlanSourceRow planSource={detail.planSource} />}
    </div>
  )
}

/**
 * Channel 1 — the brief itself, paged.
 *
 * The first {@link CHANNEL_PAGE_SIZE} lines render in the list a reader sees on open; the rest sit
 * in a second list behind the disclosure, so opening it grows the page rather than replacing it.
 */
function Channel1({ lines }: { lines: readonly BriefLineView[] }) {
  const page = channelPage(lines)

  return (
    <section className="space-y-2">
      <p className={EYEBROW_CLASS}>{CHANNEL_EYEBROWS[1]}</p>
      <ul className={CHANNEL_LIST_CLASS}>
        {page.lines.map(line => (
          <KnowledgeBriefLine key={line.id} line={line} />
        ))}
      </ul>
      {page.showAllLabel === undefined ? null : (
        <Collapsible>
          <CollapsibleTrigger data-channel-show-all={String(lines.length)} className={NESTED_TRIGGER_CLASS}>
            <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
            {page.showAllLabel}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <ul className={CHANNEL_LIST_CLASS}>
              {lines.slice(CHANNEL_PAGE_SIZE).map(line => (
                <KnowledgeBriefLine key={line.id} line={line} />
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </section>
  )
}

/**
 * The procedure row: what the step's plan came from, and how that went (D-07).
 *
 * The tone drives the tint only. The SENTENCE is the view's, and a replay that broke reads as a
 * break even at a full check count — that judgement is made once, in `planSourceView`.
 */
function PlanSourceRow({ planSource }: { planSource: PlanSourceView }) {
  const look =
    planSource.tone === "ok"
      ? { variant: "outline" as const, className: "bg-emerald-500/15 text-emerald-500 border-emerald-500/20" }
      : planSource.tone === "broke"
        ? { variant: "destructive" as const, className: "" }
        : { variant: "outline" as const, className: "" }

  return (
    <div data-plan-source-outcome={planSource.tone} className="flex items-center gap-2">
      <Badge variant={look.variant} className={`text-xs ${look.className}`}>{planSource.sentence}</Badge>
    </div>
  )
}
