// @vitest-environment jsdom

// THE CHIP RENDER'S CELLS (405-11 Task 1 · DETL-02, D-10, T-405-40).
//
// The load-bearing assertion is the LAST one in each cell: the rendered container's `textContent`
// carries no delimiter. That is the whole point of the chip — a person must be able to tell
// deliberate redaction apart from a broken page, and a marker leaking into a text node would be
// neither. Copy is asserted BY CONSTANT, never by string.

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MASKED_MARKER_DELIMITER, maskedMarker } from '@vostride/agent-qa-schema'

import { MaskedChip } from '@/components/run-detail/masked-chip'
import { MaskedText } from '@/components/run-detail/masked-text'
import { MASKED_EMAIL_LABEL, MASKED_SECRET_LABEL } from '@/lib/run-detail-view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, className }: { children: ReactNode; className?: string }) => (
    <span data-testid="badge" className={className}>{children}</span>
  ),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(node: ReactNode): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(node)
  })
  return container
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
})

describe('MaskedText', () => {
  it('paints each marker as a typed chip and keeps the surrounding text intact', () => {
    const view = mount(<MaskedText text={`a ${maskedMarker('secret')} b`} />)

    const chip = view.querySelector('[data-masked="secret"]')
    expect(chip).not.toBeNull()
    expect(chip?.textContent).toContain(MASKED_SECRET_LABEL)
    expect(view.textContent).toContain('a ')
    expect(view.textContent).toContain(' b')
    expect(view.textContent).not.toContain(MASKED_MARKER_DELIMITER)
  })

  it('gives the two categories two different chips and two different sentences', () => {
    const view = mount(
      <MaskedText text={`${maskedMarker('secret')} and ${maskedMarker('email')}`} />,
    )

    expect(view.querySelector('[data-masked="secret"]')?.textContent).toContain(MASKED_SECRET_LABEL)
    expect(view.querySelector('[data-masked="email"]')?.textContent).toContain(MASKED_EMAIL_LABEL)
    expect(view.textContent).not.toContain(MASKED_MARKER_DELIMITER)
  })

  it('renders an unmasked run as plain text with no chip at all', () => {
    const view = mount(<MaskedText text="the checkout button was not visible" />)

    expect(view.querySelector('[data-masked]')).toBeNull()
    expect(view.textContent).toBe('the checkout button was not visible')
  })

  // The producer's text is a text node and nothing else. A cell that fed markup and found no
  // element is the only assertion that keeps it that way.
  it('renders producer text as a text node, never as markup', () => {
    const view = mount(<MaskedText text={'<img src=x onerror="alert(1)">'} />)

    expect(view.querySelector('img')).toBeNull()
    expect(view.textContent).toBe('<img src=x onerror="alert(1)">')
  })
})

describe('MaskedChip', () => {
  it('carries the category on the element and the sentence in the text', () => {
    const view = mount(<MaskedChip category="email" />)
    const chip = view.querySelector('[data-masked="email"]')

    expect(chip).not.toBeNull()
    expect(chip?.textContent).toContain(MASKED_EMAIL_LABEL)
  })
})
