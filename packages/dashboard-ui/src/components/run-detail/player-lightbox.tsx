import { useRef } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { PLAYER_COPY } from '@/lib/player-view'
import { PlayerFrame } from './player'

export function PlayerLightbox({ runId, sha, open, onOpenChange, returnFocus }: {
  runId: string
  sha: string
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus?: HTMLElement | null
}) {
  const opener = useRef<HTMLElement | null>(null)
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent data-player-lightbox showCloseButton={false} className='sm:max-w-4xl'
      onOpenAutoFocus={() => { opener.current = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null) }}
      onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus() }}>
      <DialogTitle className='pr-8 text-sm font-medium'>{PLAYER_COPY.lightboxTitle}</DialogTitle>
      <PlayerFrame key={`${runId}:${sha}`} runId={runId} frame={{ id: `decision-screenshot:${sha}`, sha }} />
      <DialogDescription className='py-8 text-xs'>{PLAYER_COPY.lightboxNote}</DialogDescription>
      <DialogClose asChild>
        <Button size='icon-sm' variant='ghost' className='absolute right-4 top-4' aria-label={PLAYER_COPY.lightboxClose}><X className='h-4 w-4' /></Button>
      </DialogClose>
    </DialogContent>
  </Dialog>
}
