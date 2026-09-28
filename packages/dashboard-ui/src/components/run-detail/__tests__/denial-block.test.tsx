// @vitest-environment jsdom

// A denial shows the gate's neutral reason and only the remedies this surface can take. The
// canonical reason names another surface's flag and is never composed into the DOM.
//
// Mounted into document.body through createRoot, the call main.tsx makes, so a broken mount path
// cannot pass here.

import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { DenialBlock } from '@/components/run-detail/denial-block'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  if (root !== undefined)
    act(() => {
      root?.unmount()
    })
  container?.remove()
  root = undefined
  container = undefined
})

function mount(element: ReactElement): HTMLElement {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root?.render(element)
  })
  return container
}

function remedyKinds(dom: ParentNode): (string | null)[] {
  return [...dom.querySelectorAll('[data-remedy-kind]')].map((node) =>
    node.getAttribute('data-remedy-kind'),
  )
}

const TRUST_SESSION_FLAG = {
  kind: 'trust-session-flag',
  params: { flag: '--trust-session', command: 'run' },
} as const

describe('DenialBlock renders the remedies this surface can take (D-15)', () => {
  it("DENIAL-DASHBOARD-PROJECTION: renders the dashboard projection and never another surface's flag instructions", () => {
    const dom = mount(
      <DenialBlock
        neutralReason="fail-closed (ci): tier: this action needs an approval this context has not established"
        remedies={[{ kind: 'answer-confirm' }, TRUST_SESSION_FLAG]}
      />,
    )
    // trust-session-flag lists only `cli` in the shipped surface table; a browser has no such flag.
    expect(remedyKinds(dom)).toEqual(['answer-confirm'])
    const remedyText = [...dom.querySelectorAll('[data-remedy-kind]')]
      .map((node) => node.textContent ?? '')
      .join('\n')
    expect(remedyText).not.toContain('--trust-session')
    expect(remedyText).toContain('confirm')
    expect(dom.textContent).toContain(
      'fail-closed (ci): tier: this action needs an approval this context has not established',
    )
    expect(dom.textContent).not.toContain('fail-closed: ask in ci without trust')
    expect(dom.textContent).not.toContain('--trust-session')
  })

  it('DENIAL-CANONICAL-PROSE-NEVER-IN-DOM: never lets the canonical prose reach the DOM, whatever it carries', () => {
    // Disjoint on purpose: agreeing strings would render the same bytes under either reason and
    // could not tell the neutral render from the canonical one.
    const canonicalReason =
      'prompted-denied: fn:knowledge.proposal.apply (mutating-shared): the interactive prompt was declined; re-run and approve, or opt in with --trust-session'
    const neutralReason =
      'prompted-denied: fn:knowledge.proposal.apply (mutating-shared): the interactive prompt was declined'
    const canonicalTail = canonicalReason.slice(neutralReason.length)
    expect(canonicalTail).toBe('; re-run and approve, or opt in with --trust-session')

    const dom = mount(
      <DenialBlock
        neutralReason={neutralReason}
        remedies={[{ kind: 'answer-confirm' }, TRUST_SESSION_FLAG]}
      />,
    )
    const denial = dom.querySelector<HTMLElement>('[data-entry="denial"]')
    expect(denial).not.toBeNull()
    expect(denial?.textContent).toContain(neutralReason)
    expect(remedyKinds(denial as HTMLElement)).toEqual(['answer-confirm'])
    expect(denial?.textContent).not.toContain(canonicalTail)
    expect(denial?.textContent).not.toContain('--trust-session')
    expect(denial?.textContent).not.toContain('re-run and approve')
  })

  it('DENIAL-EMPTY-PROJECTION-INVENTS-NOTHING: renders nothing where the dashboard projection is empty', () => {
    const dom = mount(
      <DenialBlock neutralReason="blocked: restricted tier" remedies={[TRUST_SESSION_FLAG]} />,
    )
    expect(dom.querySelectorAll('[data-remedy-kind]')).toHaveLength(0)
    const denial = dom.querySelector<HTMLElement>('[data-entry="denial"]')
    expect(denial?.textContent).toBe('blocked: restricted tier')
  })
})
