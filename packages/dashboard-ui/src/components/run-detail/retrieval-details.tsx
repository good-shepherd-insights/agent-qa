// 427 · D-19 — Retrieval details: the collapsed foot section holding the per-step ledger, moved
// verbatim from tab-knowledge.tsx. It is the only section where storage vocabulary may appear.

import { useId } from "react"
import { ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { NESTED_TRIGGER_CLASS } from "./knowledge-brief-line"
import { KnowledgeStepDetail } from "./knowledge-step-detail"
import {
  RETRIEVAL_DETAILS_LABEL,
  STEP_NO_BRIEF_TEXT,
  type LedgerView,
  type StepRowView,
} from "@/lib/knowledge-view"

export function RetrievalDetails({ ledger }: { ledger: LedgerView }) {
  const triggerId = useId()
  return (
    <section data-knowledge-section="retrieval-details" aria-labelledby={triggerId} className="border-t pt-4">
      <Collapsible>
        <CollapsibleTrigger id={triggerId} className={NESTED_TRIGGER_CLASS}>
          <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
          {RETRIEVAL_DETAILS_LABEL}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-4 space-y-4">
          <p data-used-summary className="text-xs text-muted-foreground tabular-nums">{ledger.summary}</p>
          {ledger.steps.length > 0 ? (
            <ul className="space-y-1">
              {ledger.steps.map(row => (
                <StepRow key={`${String(row.testIndex)}:${String(row.stepIndex)}`} row={row} />
              ))}
            </ul>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </section>
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
