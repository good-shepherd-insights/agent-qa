// 427 · D-06, D-09 — Show full record, shared by used rows and memory-change rows. The code-computed
// counts always render and always precede the curator's note (memory.md §7.5), so the note is never
// the only thing said. Numeric trust, tier and evidence tokens stay in Retrieval details.

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
} from "@/lib/knowledge-view"

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
