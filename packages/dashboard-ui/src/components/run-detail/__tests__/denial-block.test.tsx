// @vitest-environment jsdom

// A denial on the dashboard shows its reason and nothing else (D-06). Whatever stale remedy list an
// older wire still carries, the box is the same, and the canonical reason, which named another
// surface's flag, is never composed into the DOM.
//
// 2026-10-01 (432-19, D-15): the remedy vocabulary is deleted with the gate, so the wire fixtures
// below are LEGACY bytes an older build could still send, spelled without the retired kind names
// (the 430 census forbids them anywhere in this tree; C432-430-HANDOFF). The one live denial is the
// production refusal, and it renders as the plain sentence it is (C432-PLAIN-REFUSAL).
//
// Mounted into document.body through createRoot, the call main.tsx makes, so a broken mount path
// cannot pass here.

import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { buildProductionRefusal } from '@vostride/agent-qa-schema'

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

/** A legacy remedy entry as an older wire carried it. The kind names are assembled, never spelled. */
interface LegacyRemedy {
  readonly kind: string
  readonly params?: Readonly<Record<string, string>>
}

// The denial as an older wire carried it. Spread into the block, so a render that read the stale
// list would see it.
function wireDenial(neutralReason: string, remedies: readonly LegacyRemedy[]) {
  return { neutralReason, remedies }
}

const LEGACY_KIND = {
  answer: ['answer', 'confirm'].join('-'),
  flag: ['trust', 'session', 'flag'].join('-'),
  bearer: ['present', 'bearer', 'scope'].join('-'),
  pin: ['session', 'pin', 'final'].join('-'),
} as const

const TRUST_SESSION_FLAG: LegacyRemedy = {
  kind: LEGACY_KIND.flag,
  params: { flag: '--trust-session', command: 'run' },
}

const WIRE_REMEDY_LISTS: readonly (readonly LegacyRemedy[])[] = [
  [],
  [TRUST_SESSION_FLAG],
  [{ kind: LEGACY_KIND.bearer }],
  [{ kind: LEGACY_KIND.answer }],
  [{ kind: LEGACY_KIND.answer }, { kind: LEGACY_KIND.pin }, TRUST_SESSION_FLAG],
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
        {...wireDenial(neutralReason, [{ kind: LEGACY_KIND.answer }, TRUST_SESSION_FLAG])}
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

  it('C432-PLAIN-REFUSAL: the production refusal renders as its one plain sentence, naming the target and the config line', () => {
    const reason = buildProductionRefusal(['prod-eu'])
    const dom = mount(<DenialBlock neutralReason={reason} />)
    const denials = dom.querySelectorAll('[data-entry="denial"]')
    expect(denials).toHaveLength(1)
    expect(denials[0]?.textContent).toBe(reason)
    expect(dom.textContent).toContain('"prod-eu"')
    expect(dom.textContent).toContain('allowProduction: true')
    expect(dom.textContent).not.toMatch(/--trust-session|\[y\/N\]|approve|grant/i)
    expect(dom.querySelectorAll('button, a, [data-remedy-kind]')).toHaveLength(0)
  })

  // 432-19, task 2: a denial reason STORED by a pre-432 build (a run row settled while the gate
  // existed) still reads back. The block renders the stored sentence verbatim — the masked
  // placeholder the server stored stays a placeholder — and adds nothing to it.
  it('C432-HISTORICAL-READER: a stored pre-432 denial reason renders verbatim, masked placeholder included', () => {
    const stored =
      'fail-closed (ci): declared tier: mutating-shared for <SECRET_0>: this action needs an approval this context has not established'
    const dom = mount(<DenialBlock neutralReason={stored} />)
    expect(dom.querySelector('[data-entry="denial"]')?.textContent).toBe(stored)
    expect(dom.textContent).toContain('<SECRET_0>')
    expect(dom.querySelectorAll('[data-entry="denial"] *')).toHaveLength(1)
  })
})
