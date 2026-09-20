import { ChevronRight, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { RunArtifactRow } from '@/lib/api'
import { copyTextOf } from '@/lib/display-text'
import { captureStateOf, DRAWER_COPY, RUN_ARTIFACT_KIND_LABELS } from '@/lib/drawer-view'
import { MaskedText } from './masked-text'

export function ArtifactTechnicalDetails({ runId, artifact }: {
  runId: string
  artifact: RunArtifactRow
}) {
  return (
    <Collapsible data-technical-details className="shrink-0 border-t bg-muted/40 p-4">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
        {DRAWER_COPY.technicalDetails}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-2 text-xs">
          <dt className="text-muted-foreground">{DRAWER_COPY.runId}</dt>
          <dd className="flex min-w-0 items-start gap-2 break-all font-mono">
            <span className="min-w-0 flex-1"><MaskedText text={runId} /></span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={DRAWER_COPY.copyRunId}
              onClick={() => { void navigator.clipboard?.writeText(copyTextOf(runId)) }}>
              <Copy className="size-3.5" />
            </Button>
          </dd>
          <dt className="text-muted-foreground">{DRAWER_COPY.artifactKind}</dt>
          <dd className="break-all">{RUN_ARTIFACT_KIND_LABELS[artifact.kind]}</dd>
          <dt className="text-muted-foreground">{DRAWER_COPY.schemaVersion}</dt>
          <dd className="break-all font-mono">{artifact.schemaVersion}</dd>
          {captureStateOf(artifact) === 'sealed' ? (
            <>
              <dt className="text-muted-foreground">{DRAWER_COPY.captureSealedAt}</dt>
              <dd className="break-all"><MaskedText text={artifact.finalizedAt!} /></dd>
            </>
          ) : null}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  )
}
