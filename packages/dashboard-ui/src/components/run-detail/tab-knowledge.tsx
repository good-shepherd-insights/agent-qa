// THE KNOWLEDGE TAB SHELL (407-02 · LERN-01, D-01 / D-03 / D-06 / D-16, T-407-06).
//
// IT IS PRESENTATIONAL AND KNOWS NO RUN. It takes a view and paints it. It reads nothing, fetches
// nothing and mints no route — the page owns the one `runs.knowledge` client (D-05's "one read,
// one shape"), and a tab that could fetch for itself would open a client per mount of a component
// the tab strip remounts, and would be a second answer to "what does this page know about this
// run's brief".
//
// FIVE STATES, AND FOUR OF THEM ARE ABSENCES. `undefined` is the read that has not landed; the
// other four come from the projection. Every one renders a sentence or a skeleton, and none of
// them renders blank: a blank pane behind a tab someone pressed `7` to reach cannot be told apart
// from a broken op, which is the whole reason D-06 made the pruned-handoff case a RESULT.
//
// `data-knowledge-state` IS THE CELL CONTRACT, never the visible text. The jsdom cells here and
// the later plans' Playwright cells on the built bundle both address attributes, so a copy change
// moves `lib/knowledge-view.ts` and nothing else.
//
// EVERY STRING IS IMPORTED (403-05 D-5). Not one sentence is typed in this file. The `data-*` raw
// words (`none` / `procedure-replay` / `procedure-hint`) are not sentences — they are the
// projection's own vocabulary, forwarded unchanged so a cell can read the fact rather than a
// rendering of it.
//
// ALL TEXT GOES THROUGH REACT TEXT NODES. No raw-HTML injection escape hatch appears anywhere in
// this file — a grep for React's one is an acceptance criterion. Step text and masked errors are
// producer strings crossing the display seam, and the hostile-text cells assert that an
// `<img onerror=…>` in either one creates no element.

import { ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Skeleton } from "@/components/ui/skeleton"
import { EvidenceIncomplete } from "./evidence-incomplete"
import { KnowledgeLearned } from "./knowledge-learned"
import { KnowledgeStepDetail } from "./knowledge-step-detail"
import { STEP_NO_BRIEF_TEXT, USED_HEADING, type KnowledgeView, type StepRowView } from "@/lib/knowledge-view"

/** The tab body's own padding and rhythm (UI-SPEC: `TabsContent` → `ScrollArea` → this div). */
const CONTENT_CLASS = "px-3 py-4 space-y-4"

/** A half heading: 16px/500 — explicitly `font-medium`, because the global `h4` rule is 600. */
const HEADING_CLASS = "text-base font-medium leading-snug"

/** A page-level body sentence. `break-words` so a long masked error wraps inside the pane. */
const BODY_CLASS = "text-sm text-muted-foreground break-words"

export function TabKnowledge({ view }: { view: KnowledgeView | undefined }) {
  // THE READ HAS NOT LANDED. Three bars and no words — the chips' `…` posture, which says nobody
  // has answered yet rather than guessing at what the answer will be.
  if (view === undefined) {
    return (
      <div data-knowledge-state="loading" className={CONTENT_CLASS}>
        <div className="space-y-2">
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
        </div>
      </div>
    )
  }

  if (view.state === "error") {
    return (
      <div data-knowledge-state="error" className={CONTENT_CLASS}>
        <h4 className={HEADING_CLASS}>{view.heading}</h4>
        <p className={BODY_CLASS}>{view.body}</p>
      </div>
    )
  }

  // The shipped component owns the words for "the bytes are gone" (406 D-17), and it supplies its
  // own `py-12` — so this arm adds horizontal padding only (UI-SPEC Spacing: do not add more).
  if (view.state === "evidence-incomplete") {
    return (
      <div data-knowledge-state="evidence-incomplete" className="px-3">
        <EvidenceIncomplete variant="pane" />
      </div>
    )
  }

  if (view.state === "empty-no-store") {
    return (
      <div data-knowledge-state="empty-no-store" className={CONTENT_CLASS}>
        <h4 className={HEADING_CLASS}>{view.heading}</h4>
        <p className={BODY_CLASS}>{view.body}</p>
      </div>
    )
  }

  return (
    <div data-knowledge-state="ready" className={CONTENT_CLASS}>
      <div className="space-y-2">
        <h4 className={HEADING_CLASS}>{USED_HEADING}</h4>
        {/* The DERIVED line (D-03) — never a second read, and `tabular-nums` so it does not jitter. */}
        <p data-used-summary className="text-sm tabular-nums">{view.used.summary}</p>
        {view.used.steps.length > 0 ? (
          <ul className="space-y-1">
            {view.used.steps.map(row => (
              <StepRow key={`${String(row.testIndex)}:${String(row.stepIndex)}`} row={row} />
            ))}
          </ul>
        ) : null}
      </div>
      {/*
        THE SECOND HALF, AFTER THE FIRST (407-09). "What did this run read" then "what did it write
        back" — the order is the reading order, and the `space-y-4` on the wrapper is the one gap
        between them. The section renders only when the projection carried one: a tab that invented
        a Learned half for a view without one would be painting a state the op did not say.
      */}
      {view.learned === undefined ? null : (
        <KnowledgeLearned view={view.learned} proposals={view.proposals} />
      )}
    </div>
  )
}

/**
 * One collapsed step row.
 *
 * CLOSED BY DEFAULT, AND THAT IS THE OVERFLOW STRATEGY. A 200-step run is 200 one-line rows, so
 * the tab needs no virtualisation and the `ScrollArea` above stays the one scroll owner.
 *
 * THE ROW EXISTS EVEN WHEN IT SERVED NOTHING. `noBrief` renders a muted sentence instead of
 * badges rather than dropping the row: a run that looks shorter than it was is a worse answer
 * than a row that says nothing happened here.
 *
 * The expanded body holds ONE ANCHOR (407-02) that 407-06 filled with `KnowledgeStepDetail` — the
 * three channels, the per-line why-trace, the cut ledger and the procedure outcome. The anchor
 * stayed the same element and the row kept its shape, which is what made that plan an addition.
 */
function StepRow({ row }: { row: StepRowView }) {
  return (
    <Collapsible asChild>
      <li
        data-step-index={String(row.stepIndex)}
        data-test-index={String(row.testIndex)}
        data-plan-source={row.planSource}
        data-brief-lines={String(row.briefLines)}
        data-canary-lines={String(row.canaryLines)}
      >
        <CollapsibleTrigger className="group flex w-full items-center gap-2 py-1 text-left text-sm hover:text-foreground">
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
          <span className="truncate">{row.title}</span>
          {row.noBrief === true ? (
            <span className="text-xs text-muted-foreground">{STEP_NO_BRIEF_TEXT}</span>
          ) : (
            <span className="flex items-center gap-1">
              {row.facts.map(fact => (
                <Badge key={fact} variant="outline" className="text-xs font-medium">{fact}</Badge>
              ))}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="bg-muted/40 rounded-[var(--radius)] px-3 py-2 space-y-2">
          <div data-step-detail>
            <KnowledgeStepDetail detail={row.detail} />
          </div>
        </CollapsibleContent>
      </li>
    </Collapsible>
  )
}
