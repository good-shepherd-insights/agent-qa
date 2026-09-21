import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { StepAnnotation } from '@/lib/api'
import { MediaAnnotationOverlay } from './media-annotation-overlay'

/** One measured contain rectangle for both media and overlays, including zoom and fullscreen. */
export function MediaViewport({ children, width, height, annotation, zoom = 1, fullscreen = false }: {
  children: ReactNode
  width: number
  height: number
  annotation?: StepAnnotation
  zoom?: number
  fullscreen?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState({ width: 0, height: 0 })
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
  return <div ref={ref} data-media-viewport className='relative w-full overflow-auto rounded-lg border bg-muted/20'
    style={{ height: fullscreen ? '72vh' : '50vh' }}>
    <div style={{ width: Math.max(bounds.width, w * zoom), height: Math.max(bounds.height, h * zoom), position: 'relative' }}>
      <div data-media-transform style={{ position: 'absolute', width: w, height: h,
        left: Math.max(0, (bounds.width - w * zoom) / 2), top: Math.max(0, (bounds.height - h * zoom) / 2),
        transform: `scale(${zoom})`, transformOrigin: 'top left' }}>
        {children}
        {annotation && scale > 0 && <MediaAnnotationOverlay annotation={annotation} renderedW={w} renderedH={h} />}
      </div>
    </div>
  </div>
}
