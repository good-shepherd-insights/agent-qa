// 427 · D-02, D-04..D-07, D-10 — the Knowledge used section: one content-led row per record, no ids.

import { Fragment, useId } from "react"
import { ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { NESTED_TRIGGER_CLASS } from "./knowledge-brief-line"
import { KnowledgeStepRefs } from "./knowledge-step-ref"
import { MaskedText } from "./masked-text"
import {
  CONTENT_ABSENCE_REASON_TEXT,
  RECORD_KIND_LABELS,
  USED_HEADING,
  USED_PAGE_SIZE,
  USE_VERB_PHRASES,
  formatStepRefs,
  showAllRecordsLabel,
  type StepRefContext,
  type UsedRecordView,
  type UsedSectionView,
} from "@/lib/knowledge-view"

const HEADING_CLASS = "text-base font-medium leading-snug"

export function KnowledgeUsed({ view, stepRefs }: { view: UsedSectionView; stepRefs?: StepRefContext }) {
  const headingId = useId()
  return (
    <section data-knowledge-section="used" aria-labelledby={headingId} className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 id={headingId} className={HEADING_CLASS}>{USED_HEADING}</h4>
        {view.countLine === undefined ? null : (
          <span data-used-count-line className="text-xs text-muted-foreground tabular-nums">
            {view.countLine}
          </span>
        )}
      </div>
      {view.records.length === 0 ? (
        <p data-section-absence className="text-sm text-muted-foreground">{view.absence}</p>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {view.records.slice(0, USED_PAGE_SIZE).map(record => (
              <UsedRecordRow key={record.key} record={record} stepRefs={stepRefs} />
            ))}
          </ul>
          {view.records.length <= USED_PAGE_SIZE ? null : (
            <Collapsible>
              <CollapsibleTrigger data-used-show-all={String(view.records.length)} className={NESTED_TRIGGER_CLASS}>
                <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
                {showAllRecordsLabel(view.records.length)}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2">
                <ul className="divide-y divide-border">
                  {view.records.slice(USED_PAGE_SIZE).map(record => (
                    <UsedRecordRow key={record.key} record={record} stepRefs={stepRefs} />
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </section>
  )
}

function UsedRecordRow({ record, stepRefs }: { record: UsedRecordView; stepRefs?: StepRefContext }) {
  return (
    <li
      data-used-record
      data-use-verbs={record.uses.map(use => use.verb).join(" ")}
      {...(record.kind === undefined ? {} : { "data-record-kind": record.kind })}
      {...(record.contentAbsence === undefined ? {} : { "data-content-absence": record.contentAbsence.reason })}
      className="py-2 space-y-1"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {record.kind === undefined ? null : (
          <Badge variant="outline" className="text-muted-foreground">{RECORD_KIND_LABELS[record.kind]}</Badge>
        )}
        <span data-row-primary className="text-sm wrap-anywhere">
          <MaskedText text={record.primary} />
        </span>
      </div>
      {record.contentAbsence === undefined ? null : (
        <p data-row-absence-reason className="text-xs text-muted-foreground wrap-anywhere">
          {CONTENT_ABSENCE_REASON_TEXT[record.contentAbsence.reason]}
        </p>
      )}
      <p data-row-uses className="text-xs text-muted-foreground tabular-nums">
        {record.uses.map((use, index) => (
          <Fragment key={use.verb}>
            {index > 0 ? " · " : null}
            {index === 0 ? USE_VERB_PHRASES[use.verb].lead : USE_VERB_PHRASES[use.verb].follow}{" "}
            <KnowledgeStepRefs
              segments={formatStepRefs(use.addresses, stepRefs?.testNames)}
              stepRefs={stepRefs}
            />
          </Fragment>
        ))}
      </p>
    </li>
  )
}
