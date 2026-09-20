// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useKeyboardShortcuts } from '../use-keyboard-shortcuts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('HOOK-DECLINED-KEY-NOT-PREVENTED preserves defaults for simple and compound refusals', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const declined = vi.fn(() => false)
  const accepted = vi.fn(() => {})
  function Shortcuts() {
    useKeyboardShortcuts({ a: declined, 'shift+a': declined, b: accepted, 'shift+b': accepted })
    return null
  }
  try {
    act(() => root.render(<Shortcuts />))
    for (const shiftKey of [false, true]) {
      for (const key of ['a', 'b']) {
        const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
        act(() => host.dispatchEvent(event))
        expect(event.defaultPrevented, `${shiftKey}:${key}`).toBe(key === 'b')
      }
    }
    expect(declined).toHaveBeenCalledTimes(2)
    expect(accepted).toHaveBeenCalledTimes(2)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
