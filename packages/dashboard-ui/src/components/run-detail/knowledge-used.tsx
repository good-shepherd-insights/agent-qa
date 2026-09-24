// 427 · D-02, D-04, D-05, D-07 — the Knowledge used section: one content-led row per record, no ids.

import { Fragment, useId } from "react"

import { KnowledgeStepRefs } from "./knowledge-step-ref"
import { MaskedText } from "./masked-text"
import {
  USED_HEADING,
  USE_VERB_PHRASES,
  formatStepRefs,
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
        <ul className="divide-y divide-border">
          {view.records.map(record => (
            <UsedRecordRow key={record.key} record={record} stepRefs={stepRefs} />
          ))}
        </ul>
      )}
    </section>
  )
}

function UsedRecordRow({ record, stepRefs }: { record: UsedRecordView; stepRefs?: StepRefContext }) {
  return (
    <li
      data-used-record
      data-use-verbs={record.uses.map(use => use.verb).join(" ")}
      className="py-2 space-y-1"
    >
      <span data-row-primary className="text-sm wrap-anywhere">
        <MaskedText text={record.primary} />
      </span>
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
