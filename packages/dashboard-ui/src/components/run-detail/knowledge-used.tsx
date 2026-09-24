// 427 · D-02, D-04..D-07, D-10 — the Knowledge used section: one content-led row per record, no ids.

import { Fragment, useId } from "react"
import { ChevronRight, FlaskConical, History } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { NESTED_TRIGGER_CLASS } from "./knowledge-brief-line"
import { KnowledgeRecordBody } from "./knowledge-record-body"
import { KnowledgeStepRefs } from "./knowledge-step-ref"
import { MaskedText } from "./masked-text"
import {
  CONTENT_ABSENCE_REASON_TEXT,
  ON_TRIAL_TAG,
  ON_TRIAL_TOOLTIP,
  RECORD_KIND_LABELS,
  SINCE_STATUS_TAGS,
  USED_HEADING,
  USED_PAGE_SIZE,
  USE_VERB_PHRASES,
  formatStepRefs,
  showAllRecordsLabel,
  type AnchorPhraseView,
  type ApplicabilityView,
  type StepRefContext,
  type UsedRecordView,
  type UsedSectionView,
} from "@/lib/knowledge-view"

const HEADING_CLASS = "text-base font-medium leading-snug"

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

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
      {...(record.onTrial === undefined ? {} : { "data-on-trial": "true" })}
      {...(record.sinceStatus === undefined ? {} : { "data-since-status": record.sinceStatus })}
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
        {record.onTrial === undefined ? null : <OnTrialTag />}
        {record.sinceStatus === undefined ? null : (
          <Badge variant="outline" className="text-muted-foreground">
            <History className="size-3" aria-hidden />
            {SINCE_STATUS_TAGS[record.sinceStatus]}
          </Badge>
        )}
      </div>
      {record.applicability === undefined ? null : <ApplicabilityLine view={record.applicability} />}
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
      {record.content === undefined ? null : <KnowledgeRecordBody content={record.content} />}
    </li>
  )
}

function OnTrialTag() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={`inline-flex rounded-md ${FOCUS_RING}`}>
          <Badge variant="outline" className="cursor-help text-muted-foreground">
            <FlaskConical className="size-3" aria-hidden />
            {ON_TRIAL_TAG}
          </Badge>
          <span className="sr-only">{ON_TRIAL_TOOLTIP}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" sideOffset={4} className="max-w-[320px] text-left">
        {ON_TRIAL_TOOLTIP}
      </TooltipContent>
    </Tooltip>
  )
}

function ApplicabilityLine({ view }: { view: ApplicabilityView }) {
  return (
    <p data-row-applicability className="text-xs text-muted-foreground wrap-anywhere">
      <MaskedText text={view.lead} />
      {view.phrases.map((phrase, index) => (
        <Fragment key={index}>
          {" · "}
          <AnchorPhrase phrase={phrase} />
        </Fragment>
      ))}
    </p>
  )
}

function AnchorPhrase({ phrase }: { phrase: AnchorPhraseView }) {
  if (phrase.literal !== undefined) {
    return (
      <span data-anchor-type={phrase.type}>
        {phrase.text}{" "}
        <code className="font-mono wrap-anywhere"><MaskedText text={phrase.literal} /></code>
      </span>
    )
  }
  return (
    <span data-anchor-type={phrase.type} className={phrase.type === "unparsed" ? "font-mono wrap-anywhere" : undefined}>
      <MaskedText text={phrase.text} />
    </span>
  )
}
