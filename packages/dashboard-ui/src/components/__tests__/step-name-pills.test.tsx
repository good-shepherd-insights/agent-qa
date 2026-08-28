// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MASKED_MARKER_DELIMITER, maskedMarker, type RunDetailStep } from '@vostride/agent-qa-schema'

import { StepNameWithPills } from '@/components/run-detail/step-name-pills'
import { fromRunDetailStep, type DisplayStep } from '@/lib/display-step'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

// REPOINTED TO THE DURABLE STEP (405-08). The pill parser reads `name`, `originalStepName` and
// `variableSnapshot`; the first is now the projection's `stepText` and the other two have no
// producer on this page until 405-11 rebuilds the overview, so they are ABSENT rather than
// null-filled. An absent optional a consumer already guards is an honest absence; a null-filled
// v1 field would be a claim that the v1 read still happened.
function makeStep(overrides: Partial<RunDetailStep> = {}): DisplayStep {
  return fromRunDetailStep(
    {
      testIndex: 0,
      stepIndex: 0,
      stepText: 'Enter password [secret:loginPassword]',
      cacheStatus: 'miss',
      verifierVerdict: { pass: true, reasoning: 'the password field is filled' },
      selfHealOccurred: false,
      briefDigest: 'd00',
      status: 'passed',
      durationMs: 10,
      ...overrides,
    },
    [],
  )
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('StepNameWithPills', () => {
  it('highlights redacted secret markers when only artifact text is available', () => {
    if (!root || !container) throw new Error('Test root not initialized')

    act(() => {
      root!.render(<StepNameWithPills step={makeStep()} />)
    })

    const secretMarker = container.querySelector('[aria-label="variable: loginPassword"]') as HTMLSpanElement | null
    expect(container.textContent).toContain('Enter password ')
    expect(secretMarker?.textContent).toBe('[secret:loginPassword]')
    expect(secretMarker?.className).toContain('bg-rose-500/15')
  })
})

describe('StepNameWithPills — the marker never reaches a text node (D-10, 405 CR-02)', () => {
  // THE LOAD-BEARING ASSERTION IN EVERY CELL BELOW is the delimiter one, and it is asserted BY
  // CONSTANT rather than by a literal so a respelling of the marker cannot pass by drift.
  //
  // WHY THESE CELLS DID NOT EXIST. Every other cell in this file supplies UNMASKED fixture text,
  // which is precisely why the leak survived review: the parser this label goes through knows the
  // `[secret:NAME]` idiom and nothing else, so a masked marker was passed straight through as
  // literal characters and no fixture ever carried one.

  it('paints a chip for a marker in a DURABLE step text and leaks no delimiter', () => {
    if (!root || !container) throw new Error('Test root not initialized')
    const step = makeStep({ stepText: `Enter password ${maskedMarker('secret')} into the field` })
    // The branch under test is the durable one, and it is the branch taken only because a durable
    // step has no `originalStepName`. Asserting that here keeps the cell honest about which parser
    // it exercised.
    expect(step.originalStepName).toBeUndefined()

    act(() => {
      root!.render(<StepNameWithPills step={step} />)
    })

    expect(container.textContent).toContain('Enter password ')
    expect(container.textContent).toContain(' into the field')
    expect(container.textContent).not.toContain(MASKED_MARKER_DELIMITER)
  })

  it('leaks no delimiter out of a pill resolved from masked step text', () => {
    if (!root || !container) throw new Error('Test root not initialized')
    // The LIVE-EDITOR branch: `originalStepName` is present, so the pill parser slices the
    // resolved value out of the same masked `name` and hands it to the tooltip and the trigger.
    const step: DisplayStep = {
      ...makeStep({ stepText: `Enter ${maskedMarker('secret')} now` }),
      originalStepName: 'Enter {{secret:loginPassword}} now',
      variableSnapshot: { loginPassword: { value: 'hunter2', source: 'secret' } },
    }

    act(() => {
      root!.render(<StepNameWithPills step={step} />)
    })

    expect(container.textContent).toContain('Enter ')
    expect(container.textContent).not.toContain(MASKED_MARKER_DELIMITER)
  })

  it('still shows the declared-secret marker as a pill — the two lanes are not the same lane', () => {
    if (!root || !container) throw new Error('Test root not initialized')
    // A CONTROL. `[secret:NAME]` is the declared-secret idiom and is deliberately rendered as a
    // labelled pill; the chip seam must not swallow it. Without this cell the assertions above
    // could be satisfied by a component that rendered nothing at all.
    act(() => {
      root!.render(<StepNameWithPills step={makeStep()} />)
    })

    const pill = container.querySelector('[aria-label="variable: loginPassword"]')
    expect(pill?.textContent).toBe('[secret:loginPassword]')
  })
})
