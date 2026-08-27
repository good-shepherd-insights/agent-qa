// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RunDetailStep } from '@vostride/agent-qa-schema'

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
