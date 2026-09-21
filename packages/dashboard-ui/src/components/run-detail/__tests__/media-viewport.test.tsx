// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { MediaViewport } from '../../media-viewport'

test('MEDIA-VIEWPORT-RESIZE: media and overlay share contain geometry, zoom and observer cleanup', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  let resize!: (width: number, height: number) => void
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) {
      resize = (width, height) => callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    observe() {} disconnect = disconnect
  })
  const host = document.createElement('div')
  const root = createRoot(host)
  const render = (zoom: number, fullscreen: boolean) => act(() => root.render(
    <MediaViewport width={800} height={600} zoom={zoom} fullscreen={fullscreen}
      annotation={{ type: 'click', viewport: { width: 800, height: 600 }, clickPoint: { x: 200, y: 100 } }}>
      <video />
    </MediaViewport>,
  ))
  try {
    render(1, false)
    const video = host.querySelector('video')
    act(() => resize(1000, 300))
    const box = host.querySelector<HTMLElement>('[data-media-transform]')!
    expect([box.style.width, box.style.height, box.style.left, box.style.top]).toEqual(['400px', '300px', '300px', '0px'])
    expect(host.querySelector<HTMLElement>('[data-annotation="point"]')!.style.left).toBe('100px')
    render(2, true)
    act(() => resize(600, 800))
    expect([box.style.width, box.style.height, box.style.left, box.style.transform]).toEqual(['600px', '450px', '0px', 'scale(2)'])
    expect(host.querySelector<HTMLElement>('[data-annotation="point"]')!.style.left).toBe('150px')
    expect(host.querySelector('video')).toBe(video)
  } finally {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  }
  expect(disconnect).toHaveBeenCalledOnce()
})
