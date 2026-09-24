// 427 · D-06, D-08, D-09 — where a record applies and Show full record, shared by used rows and
// memory-change rows (one concept, one treatment). The code-computed counts always render and always
// precede the curator's note (memory.md §7.5), so the note is never the only thing said. Numeric
// trust, tier and evidence tokens stay in Retrieval details.

import { Fragment } from "react"
import { ChevronRight } from "lucide-react"
import type { RunKnowledgeRecordContent } from "@vostride/agent-qa-schema"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { NESTED_TRIGGER_CLASS } from "./knowledge-brief-line"
import { MaskedText } from "./masked-text"
import {
  EVIDENCE_NOTE_LABEL,
  SHOW_FULL_RECORD_LABEL,
  currentStatusLine,
  trustCountsLine,
  type AnchorPhraseView,
  type ApplicabilityView,
} from "@/lib/knowledge-view"

export function RecordApplicability({ view }: { view: ApplicabilityView }) {
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

export function KnowledgeRecordBody({ content }: { content: RunKnowledgeRecordContent }) {
  const { confirmations, contradictions, trustNarrative } = content.currentTrust
  return (
    <Collapsible>
      <CollapsibleTrigger className={NESTED_TRIGGER_CLASS}>
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
        {SHOW_FULL_RECORD_LABEL}
      </CollapsibleTrigger>
      <CollapsibleContent data-full-record className="mt-1 rounded-md bg-muted/40 px-3 py-2 space-y-2">
        <p data-record-current-status className="text-xs text-muted-foreground">
          {currentStatusLine(content.currentStatus)}
        </p>
        <p data-record-content className="text-sm whitespace-pre-wrap wrap-anywhere">
          <MaskedText text={content.content} />
        </p>
        <p data-trust-counts className="text-xs text-muted-foreground tabular-nums">
          {trustCountsLine(confirmations, contradictions)}
        </p>
        {trustNarrative === undefined ? null : (
          <div data-evidence-note className="border-l-2 border-border pl-2 space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{EVIDENCE_NOTE_LABEL}</p>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap wrap-anywhere">
              <MaskedText text={trustNarrative} />
            </p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}
