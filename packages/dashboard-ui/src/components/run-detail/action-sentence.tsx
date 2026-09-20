import { Fragment, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { RunDetailSubAction } from '@vostride/agent-qa-schema'
import {
  ACTION_FAMILY_ICONS, UNKNOWN_ACTION_ICON, buildActionSentence,
} from '@/lib/action-vocabulary'
import { cn } from '@/lib/utils'
import { MaskedText } from './masked-text'

interface ActionSentenceProps {
  sub: RunDetailSubAction
  wrap?: 'truncate' | 'line-clamp-2' | 'free'
  ordinal?: number
  wrapIcon?: (icon: ReactNode) => ReactNode
}

export function ActionSentence({ sub, wrap = 'free', ordinal, wrapIcon }: ActionSentenceProps) {
  const sentence = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const element = sentence.current
    if (!element || wrap !== 'truncate') return
    // Ellipsis may clip an inline badge halfway through its label. Keep the atomic chip
    // only when it fits; the full sentence remains available in the Overview caption.
    const measure = () => {
      const bounds = element.getBoundingClientRect()
      for (const chip of element.querySelectorAll<HTMLElement>('[data-masked]')) {
        const rect = chip.getBoundingClientRect()
        chip.style.visibility = rect.left >= bounds.left && rect.right <= bounds.right ? '' : 'hidden'
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => {
      observer.disconnect()
      for (const chip of element.querySelectorAll<HTMLElement>('[data-masked]')) chip.style.visibility = ''
    }
  }, [sub, wrap])
  const model = buildActionSentence(sub)
  const Icon = model.family ? ACTION_FAMILY_ICONS[model.family] : UNKNOWN_ACTION_ICON
  const icon = (
    <Icon aria-hidden='true' className={cn(
      'h-3.5 w-3.5 shrink-0 text-muted-foreground',
      model.outcome === 'failed' && 'text-red-500',
    )} />
  )
  return (
    <span data-action-family={model.family ?? 'unknown'} data-action-outcome={model.outcome}
      className='flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground'>
      {wrapIcon ? wrapIcon(icon) : icon}
      {ordinal !== undefined && <span className='shrink-0'>#{ordinal}</span>}
      <span ref={sentence} className={cn('min-w-0', wrap === 'free' ? 'break-words' : wrap)}>
        {model.parts.map((part, index) => (
          <Fragment key={index}>
            {part.kind === 'text' ? part.text : <MaskedText text={part.text} />}
          </Fragment>
        ))}
      </span>
    </span>
  )
}
