import type { RunDetailSubAction } from '@vostride/agent-qa-schema'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useEvidenceRecords } from '@/hooks/use-evidence-records'
import type { DisplayStep } from '@/lib/display-step'
import { resolveEvidenceView } from '@/lib/evidence-state-view'
import { EvidenceLoading, EvidenceState } from './evidence-state'
import { MaskedText } from './masked-text'

interface TabAriaTreeProps {
  step: DisplayStep | null
  subAction?: RunDetailSubAction | null
  runId?: string | null
  selection?: Parameters<typeof resolveEvidenceView>[0]['selection']
}

export function TabAriaTree({ step, subAction, runId, selection = subAction ? 'sub-action' : step ? 'step' : 'none' }: TabAriaTreeProps) {
  const entry = subAction?.ariaEvidence
  const { read, retry } = useEvidenceRecords(subAction ? {
    runId: runId ?? '', testIndex: subAction.testIndex, stepIndex: subAction.stepIndex,
    subActionIndex: subAction.subActionIndex, kind: 'aria',
  } : null, selection === 'sub-action' && entry?.state === 'present' && !entry.ref.evidenceIncomplete)
  const view = resolveEvidenceView({ kind: 'aria', selection: subAction ? selection : 'none', entry, read })
  if (view.kind === 'loading') return <EvidenceLoading kind="aria" />
  if (view.kind === 'state') return <EvidenceState {...view} kind="aria"
    actionLabel={view.action?.label} onAction={view.action?.type === 'retry' ? retry : undefined} />
  return view.document.kind === 'aria' ? (
    <ScrollArea className="h-full min-h-0 w-full">
      <pre className="p-3 font-mono text-xs whitespace-pre-wrap break-words"><MaskedText text={view.document.tree} /></pre>
    </ScrollArea>
  ) : null
}
