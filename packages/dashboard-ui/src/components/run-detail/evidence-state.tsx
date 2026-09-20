import { Ban, CircleCheck, CircleDashed, FileQuestionMark, MousePointerClick, TriangleAlert } from 'lucide-react'
import type { EvidenceKind } from '@vostride/agent-qa-schema'
import { Button } from '@/components/ui/button'
import { EVIDENCE_TONE_OF_STATE, type EvidenceFailure, type EvidenceState as State, type EvidenceTone } from '@/lib/evidence-state-view'
import { cn } from '@/lib/utils'

const ICONS = {
  empty: CircleCheck, 'not-captured': CircleDashed, unsupported: Ban,
  unavailable: FileQuestionMark, failed: TriangleAlert, 'no-selection': MousePointerClick,
} satisfies Record<State, typeof CircleCheck>
const TONE_CLASS = {
  positive: 'text-emerald-500', neutral: 'text-muted-foreground', alert: 'text-destructive',
} satisfies Record<EvidenceTone, string>

interface EvidenceStateProps {
  kind: EvidenceKind | 'video' | 'frame'
  state: State
  failure?: EvidenceFailure
  incomplete?: boolean
  title: string
  explanation: string
  actionLabel?: string
  onAction?: () => void
}

export function EvidenceState({ kind, state, failure, incomplete, title, explanation, actionLabel, onAction }: EvidenceStateProps) {
  const tone = EVIDENCE_TONE_OF_STATE[state]
  const Icon = ICONS[state]
  return (
    <div data-evidence-state={state} data-evidence-kind={kind} data-evidence-tone={tone}
      data-evidence-failure={state === 'failed' ? failure : undefined}
      data-evidence-incomplete={incomplete ? true : undefined}
      role={tone === 'alert' ? 'alert' : 'status'}
      className="flex min-h-[16rem] w-full flex-col items-center justify-center gap-2 py-12 text-center">
      <Icon className={cn('h-8 w-8', TONE_CLASS[tone])} aria-hidden="true" />
      <span className="text-sm font-medium text-foreground">{title}</span>
      <p className="max-w-sm text-xs text-muted-foreground">{explanation}</p>
      {actionLabel && onAction && <Button size="sm" variant={state === 'not-captured' ? 'link' : 'outline'} onClick={onAction}>{actionLabel}</Button>}
    </div>
  )
}
