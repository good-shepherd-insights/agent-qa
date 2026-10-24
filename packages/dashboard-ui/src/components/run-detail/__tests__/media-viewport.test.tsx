// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { MediaViewport } from '../../media-viewport'

test('MEDIA-VIEWPORT-RESIZE: media and overlay share contain geometry, fullscreen and observer cleanup', () => {
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
  const render = (fullscreen: boolean) => act(() => root.render(
    <MediaViewport width={800} height={600} fullscreen={fullscreen}
      annotation={{ type: 'click', viewport: { width: 800, height: 600 }, clickPoint: { x: 200, y: 100 } }}>
      <video />
    </MediaViewport>,
  ))
  try {
    render(false)
    const video = host.querySelector('video')
    act(() => resize(1000, 300))
    const box = host.querySelector<HTMLElement>('[data-media-transform]')!
    expect([box.style.width, box.style.height, box.style.left, box.style.top]).toEqual(['400px', '300px', '300px', '0px'])
    expect(host.querySelector<HTMLElement>('[data-annotation="point"]')!.style.left).toBe('100px')
    render(true)
    act(() => resize(600, 800))
    expect([box.style.width, box.style.height, box.style.left, box.style.top]).toEqual(['600px', '450px', '0px', '175px'])
    expect(host.querySelector<HTMLElement>('[data-annotation="point"]')!.style.left).toBe('150px')
    expect(host.querySelector('video')).toBe(video)
  } finally {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  }
  expect(disconnect).toHaveBeenCalledOnce()
})

test('MEDIA-LENS-LIFECYCLE draws the same media and bounds redraw to active pixels', () => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const callbacks = new Map<number, FrameRequestCallback>()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => callbacks.delete(key))
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 1000, height: 300 } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    disconnect() {}
  })
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, clearRect: vi.fn() } as unknown as CanvasRenderingContext2D)
  const host = document.createElement('div')
  const root = createRoot(host)
  const render = (key: string, magnifier = true) => act(() => root.render(
    <MediaViewport width={800} height={600} mediaKey={key} magnifier={magnifier}
      annotation={{ type: 'click', viewport: { width: 800, height: 600 }, clickPoint: { x: 400, y: 300 } }}><video /></MediaViewport>,
  ))
  const move = (x: number) => act(() => host.querySelector('[data-media-viewport]')!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: 150 })))
  try {
    render('a')
    const video = host.querySelector('video')!
    let paused = true
    Object.defineProperty(video, 'paused', { get: () => paused })
    move(100) // letterbox
    expect(host.querySelector('[data-media-lens]')).toBeNull()
    move(500)
    expect(drawImage).toHaveBeenLastCalledWith(video, -425, -300, 1000, 750)
    expect(callbacks.size).toBe(0)
    expect(host.querySelector<HTMLElement>('[data-lens-annotation]')!.style.left).toBe('-425px')
    paused = false
    act(() => video.dispatchEvent(new Event('play')))
    expect(callbacks.size).toBe(1)
    move(510)
    expect(callbacks.size).toBe(1) // moving replaces, never adds another loop
    move(100)
    expect(callbacks.size).toBe(0)
    move(500)
    render('b')
    expect(callbacks.size).toBe(0)
    expect(host.querySelector('[data-media-lens]')).toBeNull()
    move(500)
    act(() => video.dispatchEvent(new Event('error')))
    expect(callbacks.size).toBe(0)
    expect(host.querySelector('[data-media-lens]')).toBeNull()
    move(500)
    expect(host.querySelector('[data-media-lens]')).toBeNull() // error stays hidden until a new source
    render('b', false)
    expect(callbacks.size).toBe(0)
    expect(host.querySelectorAll('video')).toHaveLength(1)
    expect(video.currentTime).toBe(0)
    expect(video.playbackRate).toBe(1)
  } finally {
    act(() => root.unmount())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
  expect(callbacks.size).toBe(0)
})
