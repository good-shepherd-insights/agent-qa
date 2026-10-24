import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { StepAnnotation } from '@/lib/api'
import { MediaAnnotationOverlay } from './media-annotation-overlay'

/** One contain rectangle for media, annotations and the current-pixel magnifier. */
export function MediaViewport({ children, width, height, annotation, annotationLabel, magnifier = false, fullscreen = false, mediaKey }: {
  children: ReactNode
  width: number
  height: number
  annotation?: StepAnnotation
  annotationLabel?: string
  magnifier?: boolean
  fullscreen?: boolean
  mediaKey?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const unavailable = useRef(false)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [painted, setPainted] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) setBounds({ width: rect.width, height: rect.height })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const scale = width > 0 && height > 0 ? Math.min(bounds.width / width, bounds.height / height) : 0
  const w = width * scale
  const h = height * scale
  const left = (bounds.width - w) / 2
  const top = (bounds.height - h) / 2
  const size = Math.min(150, bounds.width, bounds.height)
  const zoom = 2.5
  const lensX = pointer ? Math.max(0, Math.min(bounds.width - size, pointer.x + 20 + size > bounds.width ? pointer.x - size - 10 : pointer.x + 20)) : 0
  const lensY = pointer ? Math.max(0, Math.min(bounds.height - size, pointer.y + 20 + size > bounds.height ? pointer.y - size - 10 : pointer.y + 20)) : 0
  const imageX = pointer ? size / 2 - (pointer.x - left) * zoom : 0
  const imageY = pointer ? size / 2 - (pointer.y - top) * zoom : 0
  useEffect(() => { setPointer(null) }, [magnifier, fullscreen, mediaKey, width, height, bounds.width, bounds.height])
  useEffect(() => { unavailable.current = false }, [mediaKey])
  useEffect(() => {
    setPainted(false)
    if (!magnifier || !pointer || size <= 0) return
    const source = ref.current?.querySelector('video, img')
    const target = canvas.current
    if (!(source instanceof HTMLVideoElement || source instanceof HTMLImageElement) || !target) return
    const context = target.getContext('2d')
    if (!context) return
    let frame: number | undefined
    let cancelled = false
    const stop = () => { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined }
    const draw = () => {
      frame = undefined
      if (cancelled) return
      try {
        context.clearRect(0, 0, size, size)
        context.drawImage(source, imageX, imageY, w * zoom, h * zoom)
        setPainted(true)
      } catch {
        setPainted(false)
      }
      if (source instanceof HTMLVideoElement && !source.paused && !source.ended) frame = requestAnimationFrame(draw)
    }
    const refresh = () => { stop(); draw() }
    const failed = () => { unavailable.current = true; stop(); setPointer(null) }
    for (const event of ['loadeddata', 'seeked', 'play', 'pause']) source.addEventListener(event, refresh)
    source.addEventListener('error', failed)
    draw()
    return () => {
      cancelled = true
      stop()
      for (const event of ['loadeddata', 'seeked', 'play', 'pause']) source.removeEventListener(event, refresh)
      source.removeEventListener('error', failed)
    }
  }, [magnifier, pointer, size, imageX, imageY, w, h, mediaKey])
  return <div ref={ref} data-media-viewport className='relative w-full overflow-hidden rounded-lg border bg-muted/20'
    onPointerMove={event => {
      if (!magnifier || unavailable.current || event.pointerType === 'touch' || scale <= 0) return
      const rect = event.currentTarget.getBoundingClientRect()
      const x = event.clientX - rect.left - event.currentTarget.clientLeft
      const y = event.clientY - rect.top - event.currentTarget.clientTop
      setPointer(x >= left && x <= left + w && y >= top && y <= top + h ? { x, y } : null)
    }}
    onPointerLeave={() => setPointer(null)}
    style={{ height: fullscreen ? '72vh' : '50vh' }}>
    <div data-media-transform style={{ position: 'absolute', width: w, height: h, left, top }}>
      {children}
      {annotation && scale > 0 && <MediaAnnotationOverlay annotation={annotation} renderedW={w} renderedH={h} />}
    </div>
    {magnifier && pointer && <div data-media-lens aria-hidden='true'
      className='pointer-events-none absolute z-10 overflow-hidden rounded-full border-2 border-muted-foreground/50 bg-background shadow-lg'
      style={{ width: size, height: size, left: lensX, top: lensY, visibility: painted ? 'visible' : 'hidden' }}>
      <canvas ref={canvas} width={size} height={size} className='absolute inset-0' />
      {annotation && <div data-lens-annotation style={{ position: 'absolute', left: imageX, top: imageY, width: w, height: h, transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
        <MediaAnnotationOverlay annotation={annotation} renderedW={w} renderedH={h} />
      </div>}
    </div>}
    {annotationLabel && <span data-video-action-cue className='absolute bottom-1 left-1 rounded bg-background/90 px-2 py-1 text-xs'>{annotationLabel}</span>}
  </div>
}
