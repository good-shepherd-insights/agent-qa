// @vitest-environment jsdom

// A denial on the dashboard shows the gate's neutral reason and nothing else (D-06). Whatever
// remedy list the denial carries, the box is the same, and the canonical reason, which names
// another surface's flag, is never composed into the DOM.
//
// Mounted into document.body through createRoot, the call main.tsx makes, so a broken mount path
// cannot pass here.

import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { GateRemedy } from '@vostride/agent-qa-schema'

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

function unmount(): void {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = undefined
  container = undefined
}

// The denial as the wire carries it. Spread into the block, so a render that read the remedies
// would see them.
function wireDenial(neutralReason: string, remedies: readonly GateRemedy[]) {
  return { neutralReason, remedies }
}

const TRUST_SESSION_FLAG = {
  kind: 'trust-session-flag',
  params: { flag: '--trust-session', command: 'run' },
} as const

const WIRE_REMEDY_LISTS: readonly (readonly GateRemedy[])[] = [
  [],
  [TRUST_SESSION_FLAG],
  [{ kind: 'present-bearer-scope' }],
  [{ kind: 'answer-confirm' }],
  [{ kind: 'answer-confirm' }, { kind: 'session-pin-final' }, TRUST_SESSION_FLAG],
]

const REMOVED_REMEDY_SENTENCES = [
  'keep this ' + 'chat open and re-run it',
  'start a new chat ' + 'session to run it',
]

describe('DenialBlock renders its reason only (D-06)', () => {
  it('DENIAL-REASON-ONLY: renders the neutral reason alone, the same box whatever remedies the denial carries', () => {
    const reason =
      'fail-closed (ci): tier: this action needs an approval this context has not established'
    const bare = mount(<DenialBlock {...wireDenial(reason, [])} />)
    const denials = bare.querySelectorAll('[data-entry="denial"]')
    expect(denials).toHaveLength(1)
    expect(denials[0]?.textContent).toBe(reason)
    const expectedMarkup = bare.innerHTML
    unmount()

    for (const remedies of WIRE_REMEDY_LISTS) {
      const dom = mount(<DenialBlock {...wireDenial(reason, remedies)} />)
      const kinds = remedies.map((remedy) => remedy.kind).join(',') || 'none'
      expect(dom.querySelectorAll('[data-remedy-kind]'), kinds).toHaveLength(0)
      expect(dom.querySelector('[data-entry="denial"]')?.textContent, kinds).toBe(reason)
      for (const sentence of REMOVED_REMEDY_SENTENCES)
        expect(dom.textContent, kinds).not.toContain(sentence)
      expect(dom.textContent, kinds).not.toContain('--trust-session')
      expect(dom.innerHTML, kinds).toBe(expectedMarkup)
      unmount()
    }
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
        {...wireDenial(neutralReason, [{ kind: 'answer-confirm' }, TRUST_SESSION_FLAG])}
      />,
    )
    const denial = dom.querySelector<HTMLElement>('[data-entry="denial"]')
    expect(denial).not.toBeNull()
    expect(denial?.textContent).toContain(neutralReason)
    expect(denial?.textContent).not.toContain(canonicalTail)
    expect(denial?.textContent).not.toContain('--trust-session')
    expect(denial?.textContent).not.toContain('re-run and approve')
  })

  it('DENIAL-NOTHING-INVENTED: an empty reason renders the empty box, with no remedy and no fallback copy', () => {
    const dom = mount(<DenialBlock {...wireDenial('', [TRUST_SESSION_FLAG])} />)
    const denials = dom.querySelectorAll('[data-entry="denial"]')
    expect(denials).toHaveLength(1)
    expect(dom.querySelectorAll('[data-remedy-kind]')).toHaveLength(0)
    expect(denials[0]?.textContent).toBe('')
  })
})
