import { useId } from "react"
import type { StepAnnotation } from "@/lib/api"

export function MediaAnnotationOverlay({ annotation, refLabel, renderedW, renderedH, offsetX = 0, offsetY = 0 }: { annotation: StepAnnotation; refLabel?: string; renderedW: number; renderedH: number; offsetX?: number; offsetY?: number }) {
  const instanceId = useId()
  const scaleX = renderedW / (annotation.viewport?.width || 1)
  const scaleY = renderedH / (annotation.viewport?.height || 1)
  return (
    <>
      {annotation.failureHighlight && (
        <div
          data-annotation='failure'
          className="absolute border-2 border-red-500/70 rounded-sm bg-red-500/15 animate-pulse pointer-events-none"
          style={{
            left: offsetX + annotation.failureHighlight.x * scaleX,
            top: offsetY + annotation.failureHighlight.y * scaleY,
            width: annotation.failureHighlight.width * scaleX,
            height: annotation.failureHighlight.height * scaleY,
          }}
        />
      )}
      {annotation.boundingBox && (
        <>
          <div
            data-annotation='region'
            className="absolute border-2 border-emerald-500/70 rounded-sm bg-emerald-500/10 pointer-events-none"
            style={{
              left: offsetX + annotation.boundingBox.x * scaleX,
              top: offsetY + annotation.boundingBox.y * scaleY,
              width: annotation.boundingBox.width * scaleX,
              height: annotation.boundingBox.height * scaleY,
            }}
          />
          {refLabel && (
            <div
              className="absolute text-[10px] font-mono font-bold text-white bg-emerald-600/90 px-1 rounded-sm pointer-events-none leading-tight"
              style={{
                left: offsetX + annotation.boundingBox.x * scaleX,
                top: offsetY + annotation.boundingBox.y * scaleY - 14,
              }}
            >
              {refLabel}
            </div>
          )}
        </>
      )}
      {annotation.clickPoint && (
        <div
          data-annotation='point'
          className="absolute pointer-events-none"
          style={{
            left: offsetX + annotation.clickPoint.x * scaleX,
            top: offsetY + annotation.clickPoint.y * scaleY,
            transform: "translate(-50%, -50%)",
            zIndex: 1,
          }}
        >
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full bg-turquoise-500 border-[1.5px] border-black/60 shadow-[0_0_0_1px_rgba(255,255,255,0.4)]" />
            <div className="absolute rounded-full border-2 border-turquoise-500/50 animate-ping" style={{ width: 22, height: 22, left: -8.5, top: -8.5 }} />
          </div>
        </div>
      )}
      {/* Gesture annotations — animated indicators */}
      {/* Swipe/Drag: start dot + trailing dots along path + end dot with ping */}
      {annotation.startPoint && annotation.endPoint && (() => {
        const color = annotation.type === 'drag' ? 'oklch(0.65 0.19 150)' : 'oklch(0.65 0.19 210)'
        const colorFaded = annotation.type === 'drag' ? 'oklch(0.65 0.19 150 / 0.4)' : 'oklch(0.65 0.19 210 / 0.4)'
        const sx = offsetX + annotation.startPoint!.x * scaleX
        const sy = offsetY + annotation.startPoint!.y * scaleY
        const ex = offsetX + annotation.endPoint!.x * scaleX
        const ey = offsetY + annotation.endPoint!.y * scaleY
        const trailCount = 4
        return (
          <>
            {/* Trail dots — staggered fade animation along path */}
            {Array.from({ length: trailCount }, (_, i) => {
              const t = (i + 1) / (trailCount + 1)
              const x = sx + (ex - sx) * t
              const y = sy + (ey - sy) * t
              return (
                <div key={`trail-${i}`} className="absolute pointer-events-none animate-gesture-trail" style={{
                  left: x, top: y, transform: 'translate(-50%, -50%)', zIndex: 1,
                  animationDelay: `${i * 0.15}s`,
                }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: colorFaded }} />
                </div>
              )
            })}
            {/* Start dot */}
            <div className="absolute pointer-events-none" style={{ left: sx, top: sy, transform: 'translate(-50%, -50%)', zIndex: 1 }}>
              <div className="w-2.5 h-2.5 rounded-full border-[1.5px] border-black/50 shadow-[0_0_0_1px_rgba(255,255,255,0.3)]" style={{ backgroundColor: color }} />
            </div>
            {/* End dot with ping */}
            <div className="absolute pointer-events-none" style={{ left: ex, top: ey, transform: 'translate(-50%, -50%)', zIndex: 1 }}>
              <div className="relative">
                <div className="w-2 h-2 rounded-full border-[1.5px] border-black/50 shadow-[0_0_0_1px_rgba(255,255,255,0.3)]" style={{ backgroundColor: color }} />
                <div className="absolute rounded-full border-[1.5px] animate-ping" style={{ borderColor: colorFaded, width: 18, height: 18, left: -7, top: -7 }} />
              </div>
            </div>
          </>
        )
      })()}
      {/* Scroll: center dot with ripple + long thin arrow in scroll direction */}
      {annotation.direction && !annotation.startPoint && (() => {
        const cx = annotation.clickPoint
          ? offsetX + annotation.clickPoint.x * scaleX
          : offsetX + renderedW / 2
        const cy = annotation.clickPoint
          ? offsetY + annotation.clickPoint.y * scaleY
          : offsetY + renderedH / 2
        const arrowLen = Math.min(renderedH, renderedW) * 0.35
        const offsets: Record<string, [number, number]> = {
          up: [0, -arrowLen], down: [0, arrowLen], left: [-arrowLen, 0], right: [arrowLen, 0],
        }
        const [dx, dy] = offsets[annotation.direction!] || [0, 0]
        return (
          <>
            {/* Arrow line + small arrowhead via SVG */}
            <svg className="absolute pointer-events-none" style={{ left: offsetX, top: offsetY, zIndex: 1 }} width={renderedW} height={renderedH}>
              <defs>
                <marker id={`scroll-arrow-border-${instanceId}`} markerWidth="16" markerHeight="14" refX="14" refY="7" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M1 1 L14 7 L1 13" fill="none" stroke="oklch(0 0 0 / 0.5)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                </marker>
                <marker id={`scroll-arrow-${instanceId}`} markerWidth="16" markerHeight="14" refX="14" refY="7" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M1 1 L14 7 L1 13" fill="none" stroke="oklch(0.719 0.119 209.8)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </marker>
              </defs>
              {/* Black border stroke */}
              <line
                x1={cx - offsetX} y1={cy - offsetY}
                x2={cx - offsetX + dx} y2={cy - offsetY + dy}
                stroke="oklch(0 0 0 / 0.5)" strokeWidth={4} strokeLinecap="round"
                markerEnd={`url(#scroll-arrow-border-${instanceId})`}
              />
              {/* Colored body line — matches tap dot blue */}
              <line
                x1={cx - offsetX} y1={cy - offsetY}
                x2={cx - offsetX + dx} y2={cy - offsetY + dy}
                stroke="oklch(0.719 0.119 209.8 / 0.8)" strokeWidth={2.5} strokeLinecap="round"
                markerEnd={`url(#scroll-arrow-${instanceId})`}
              />
            </svg>
            {/* Center dot with ripple — identical to tap click dot */}
            <div className="absolute pointer-events-none" style={{ left: cx, top: cy, transform: 'translate(-50%, -50%)', zIndex: 2 }}>
              <div className="relative flex items-center justify-center" style={{ width: 22, height: 22 }}>
                <div className="w-2.5 h-2.5 rounded-full bg-turquoise-500 border-[1.5px] border-black/60 shadow-[0_0_0_1px_rgba(255,255,255,0.4)]" />
                <div className="absolute inset-0 rounded-full border-2 border-turquoise-500/50 animate-ping" />
              </div>
            </div>
          </>
        )
      })()}
      {/* Pinch: two dots that pulse outward/inward */}
      {annotation.pinchScale && (() => {
        const cx = annotation.startPoint ? offsetX + annotation.startPoint.x * scaleX : offsetX + renderedW / 2
        const cy = annotation.startPoint ? offsetY + annotation.startPoint.y * scaleY : offsetY + renderedH / 2
        const spread = 24
        const isOut = annotation.pinchScale === 'out'
        const animClass = isOut ? 'animate-gesture-pinch-out' : 'animate-gesture-pinch-in'
        return (
          <>
            <div className={`absolute pointer-events-none ${animClass}`} style={{ left: cx - spread, top: cy, transform: 'translate(-50%, -50%)', zIndex: 1 }}>
              <div className="relative">
                <div className="w-2.5 h-2.5 rounded-full bg-turquoise-500 border-[1.5px] border-black/50 shadow-[0_0_0_1px_rgba(255,255,255,0.3)]" />
                <div className="absolute rounded-full border-[1.5px] border-turquoise-500/40 animate-ping" style={{ width: 18, height: 18, left: -6.5, top: -6.5 }} />
              </div>
            </div>
            <div className={`absolute pointer-events-none ${animClass}`} style={{ left: cx + spread, top: cy, transform: 'translate(-50%, -50%)', zIndex: 1, animationDirection: 'reverse' }}>
              <div className="relative">
                <div className="w-2.5 h-2.5 rounded-full bg-turquoise-500 border-[1.5px] border-black/50 shadow-[0_0_0_1px_rgba(255,255,255,0.3)]" />
                <div className="absolute rounded-full border-[1.5px] border-turquoise-500/40 animate-ping" style={{ width: 18, height: 18, left: -6.5, top: -6.5 }} />
              </div>
            </div>
          </>
        )
      })()}
    </>
  )

}
