import { Fragment, type ReactNode } from 'react'
import type { RunDetailSubAction } from '@vostride/agent-qa-schema'
import { ACTION_FAMILY_ICONS, UNKNOWN_ACTION_ICON, buildActionSentence } from '@/lib/action-vocabulary'
import { cn } from '@/lib/utils'
import { MaskedText } from './masked-text'

interface ActionSentenceProps {
  sub: RunDetailSubAction
  wrap?: 'truncate' | 'line-clamp-2' | 'free'
  ordinal?: number
  wrapIcon?: (icon: ReactNode) => ReactNode
}

export function ActionSentence({ sub, wrap = 'free', ordinal, wrapIcon }: ActionSentenceProps) {
  const model = buildActionSentence(sub)
  const Icon = model.family ? ACTION_FAMILY_ICONS[model.family] : UNKNOWN_ACTION_ICON
  const icon = <Icon aria-hidden='true' className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground', model.outcome === 'failed' && 'text-red-500')} />
  return (
    <span data-action-family={model.family ?? 'unknown'} data-action-outcome={model.outcome}
      className='flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground'>
      {wrapIcon ? wrapIcon(icon) : icon}
      {ordinal !== undefined && <span className='shrink-0'>#{ordinal}</span>}
      <span className={cn('min-w-0', wrap === 'free' ? 'break-words' : wrap)}>
        {model.parts.map((part, index) => (
          <Fragment key={index}>{part.kind === 'text' ? part.text : <MaskedText text={part.text} />}</Fragment>
        ))}
      </span>
    </span>
  )
}
