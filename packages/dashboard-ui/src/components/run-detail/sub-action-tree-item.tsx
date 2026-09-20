import type { RunDetailSubAction } from '@vostride/agent-qa-schema'

import { ActionSentence } from './action-sentence'
import { CacheStatusIconWrapper } from './cache-status-marker'
import { cn } from '@/lib/utils'

interface SubActionTreeItemProps {
  sub: RunDetailSubAction
  /** The owning step's key — see `runDetailStepKey`. */
  stepId: string
  /** Whether the owning step was served from cache (D-16). */
  cached: boolean
  isSelected: boolean
  isPlayheadRow?: boolean
  onSelect: () => void
}

/** The two words a recorded result can be. Raw, closed, and never a sentence. */
function resultWord(sub: RunDetailSubAction): 'success' | 'failure' {
  return sub.result.success ? 'success' : 'failure'
}

export function SubActionTreeItem({ sub, stepId, cached, isSelected, isPlayheadRow = false, onSelect }: SubActionTreeItemProps) {
  const result = resultWord(sub)
  return (
    <li
      role="treeitem"
      aria-level={2}
      aria-selected={isSelected}
      aria-current={isPlayheadRow ? true : undefined}
      data-playhead-row={isPlayheadRow ? '' : undefined}
      data-sub-action={String(sub.subActionIndex)}
      data-sub-action-result={result}
      data-sub-action-id={`${stepId}-${String(sub.subActionIndex)}`}
    >
      <button
        className={cn(
          "relative flex w-full items-center gap-2 py-1.5 px-3 text-left rounded-[2px] text-sm",
          "hover:bg-muted/50 transition-colors",
          isSelected && "bg-primary/10 ring-1 ring-primary/30"
        )}
        onClick={onSelect}
      >
        {isPlayheadRow && <span aria-hidden='true' className='absolute inset-y-1 left-0 w-0.5 bg-primary' />}
        <ActionSentence
          sub={sub}
          wrap='truncate'
          ordinal={sub.subActionIndex + 1}
          wrapIcon={cached ? (icon) => (
            <CacheStatusIconWrapper
              marker='sub-action-status'
              state='cached'
              tone='primary'
              label='Cached action'
            >
              {icon}
            </CacheStatusIconWrapper>
          ) : undefined}
        />
      </button>
    </li>
  )
}
