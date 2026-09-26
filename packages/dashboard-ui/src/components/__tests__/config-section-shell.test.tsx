// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import * as shellModule from '@/components/config-manager/config-section-shell'
import { ConfigLineNotice } from '@/components/config-manager/config-section-shell'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

function renderNotice() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root!.render(
      <ConfigLineNotice className="mt-2" role="status">
        Changes are written as you make them.
      </ConfigLineNotice>,
    )
  })

  return container
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount())
  }
  root = null
  if (container) {
    container.remove()
  }
  container = null
})

describe('Config section shell helpers', () => {
  it('renders ConfigLineNotice as one flat, unboxed line with its own props', () => {
    const view = renderNotice()
    const notice = view.querySelector('[data-config-line-notice]')
    expect(notice).not.toBeNull()
    expect(notice?.tagName).toBe('DIV')
    expect(notice?.getAttribute('role')).toBe('status')
    expect(notice?.textContent).toBe('Changes are written as you make them.')
    expect(notice?.className).toContain('border border-border')
    expect(notice?.className).toContain('bg-transparent')
    expect(notice?.className).toContain('rounded-none')
    expect(notice?.className).toContain('px-4 py-3 text-sm text-muted-foreground')
    expect(notice?.className).toContain('mt-2')
    expect(notice?.children).toHaveLength(0)

    expect(view.querySelector('[data-slot="card"]')).toBeNull()
    expect(view.querySelector('[data-config-section-shell]')).toBeNull()
    expect(view.querySelector('button')).toBeNull()
  })

  it('SECTION-SHELL-BOXES-GONE: the module exports ConfigLineNotice and none of the boxed section parts', () => {
    const exported = Object.keys(shellModule)
    expect(exported).toEqual(['ConfigLineNotice'])
    for (const retired of [
      'ConfigSectionShell',
      'ConfigSectionHeader',
      'ConfigSectionBody',
      'ConfigSectionFooter',
    ]) {
      expect(exported, retired).not.toContain(retired)
    }
  })
})
