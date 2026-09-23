// @vitest-environment jsdom
// THE COMPOSER SAYS WHAT IT IS ABOUT AND OFFERS THE THREE CHOICES, PICKING NONE (426-02 · D-11, D-12, D-14).
//
// The order under a step follows the STEP's own verdict, so a passing step inside a failed test opens
// with "This should have failed". All three rows render in every composer state, none disabled, each
// radio described by its meaning line, and nothing is checked until the person picks. The heading and
// scope line paint producer names as text nodes, never markup.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RunDetailMember, RunDetailProjection, RunDetailStep } from '@vostride/agent-qa-schema'

import { FeedbackComposer, type FeedbackComposerProps } from '../feedback-composer'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  CHOICE_LEGEND,
  CHOICE_MEANINGS,
  FEEDBACK_CHOICE_ORDER,
  FEEDBACK_COMPOSER_STATES,
  SUBMIT_REASON_NO_CHOICE,
  feedbackAddress,
  feedbackPartsText,
  feedbackTargetView,
  type FeedbackTarget,
} from '@/lib/feedback-view'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const HOSTILE = '<img src=x onerror="globalThis.__pwned = true">'

function stepRow(testIndex: number, stepIndex: number, pass: boolean, stepText?: string): RunDetailStep {
  return {
    testIndex,
    stepIndex,
    ...(stepText === undefined ? {} : { stepText }),
    cacheStatus: 'miss',
    verifierVerdict: { pass, reasoning: '' },
    selfHealOccurred: false,
    briefDigest: 'digest',
  }
}

function member(testIndex: number, name: string, outcome: RunDetailMember['outcome']): RunDetailMember {
  return { testIndex, name, attempts: 1, ...(outcome === undefined ? {} : { outcome }) }
}

type Detail = Pick<RunDetailProjection, 'members' | 'steps'>

const singleFailed: Detail = {
  members: [member(0, 'checkout', 'failed')],
  steps: [stepRow(0, 0, true, 'open cart'), stepRow(0, 1, true, 'apply coupon'), stepRow(0, 2, false, 'pay')],
}

const suite: Detail = {
  members: [member(0, 'login', 'passed'), member(1, HOSTILE, 'failed')],
  steps: [stepRow(0, 0, true, 'sign in'), stepRow(1, 0, true, HOSTILE), stepRow(1, 1, false, 'pay')],
}

function props(detail: Detail, target: FeedbackTarget, overrides: Partial<FeedbackComposerProps> = {}): FeedbackComposerProps {
  const view = feedbackTargetView({ detail, target, runStatus: 'failed' })
  return {
    composerId: 'composer',
    headingId: 'composer-heading',
    state: 'composing',
    scope: target.stepIndex === undefined ? 'test' : 'step',
    target: feedbackAddress(target),
    outcomeClass: view.outcomeClass,
    heading: view.heading,
    scopeLine: view.scopeLine,
    selected: undefined,
    onChoose: vi.fn(),
    previewState: 'idle',
    previewCurrent: false,
    submitReason: SUBMIT_REASON_NO_CHOICE,
    onSubmit: vi.fn(),
    status: '',
    onClose: vi.fn(),
    ...overrides,
  }
}

let root: Root | undefined
let container: HTMLDivElement

function render(next: FeedbackComposerProps) {
  if (root === undefined) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  act(() => root!.render(<TooltipProvider><FeedbackComposer {...next} /></TooltipProvider>))
}

afterEach(() => {
  if (root !== undefined) act(() => root!.unmount())
  root = undefined
  container.remove()
})

const rows = () => [...container.querySelectorAll<HTMLElement>('[data-feedback-choice]')]
const radios = () => [...container.querySelectorAll<HTMLElement>('[data-feedback-choice] [role="radio"]')]

describe('426-02 feedback composer', () => {
  it('CHOICE-ORDER-STEP-OWN-RESULT: a passing step in a failed test opens with should-have-failed; the failed test opens with should-have-passed', () => {
    render(props(singleFailed, { testIndex: 0, stepIndex: 1 }))
    expect(container.querySelector('[data-feedback-choices]')?.getAttribute('data-feedback-outcome-class')).toBe('passed')
    expect(rows().map((row) => row.getAttribute('data-feedback-choice'))).toEqual(['false-pass', 'confirmed-bug', 'false-fail'])
    expect(rows().map((row) => row.getAttribute('data-choice-position'))).toEqual(['1', '2', '3'])

    render(props(singleFailed, { testIndex: 0 }))
    expect(container.querySelector('[data-feedback-choices]')?.getAttribute('data-feedback-outcome-class')).toBe('failed')
    expect(rows().map((row) => row.getAttribute('data-feedback-choice'))).toEqual([...FEEDBACK_CHOICE_ORDER.failed])
    expect(rows()[0]?.getAttribute('data-feedback-choice')).toBe('false-fail')
  })

  it('ALL-THREE-ALWAYS-VISIBLE: three enabled rows in every state, each radio described by its meaning line', () => {
    for (const state of FEEDBACK_COMPOSER_STATES) {
      for (const target of [{ testIndex: 0 }, { testIndex: 0, stepIndex: 1 }]) {
        const next = props(singleFailed, target, { state })
        render(next)
        expect(rows()).toHaveLength(3)
        expect(container.querySelector('fieldset legend')?.textContent).toBe(CHOICE_LEGEND)
        for (const radio of radios()) {
          expect(radio.hasAttribute('disabled')).toBe(false)
          expect(radio.hasAttribute('data-disabled')).toBe(false)
          const kind = radio.closest('[data-feedback-choice]')!.getAttribute('data-feedback-choice') as keyof (typeof CHOICE_MEANINGS)['failed']
          const describedBy = radio.getAttribute('aria-describedby')
          expect(describedBy).toBeTruthy()
          expect(document.getElementById(describedBy!)?.textContent).toBe(CHOICE_MEANINGS[next.outcomeClass][kind])
        }
        expect(container.querySelectorAll('[data-feedback-choices] .truncate')).toHaveLength(0)
      }
    }
  })

  it('NO-CHOICE-PRESELECTED: nothing is checked on mount or after the target changes', () => {
    const onChoose = vi.fn()
    render(props(singleFailed, { testIndex: 0 }, { onChoose }))
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false'])

    act(() => radios()[1]!.click())
    expect(onChoose).toHaveBeenCalledExactlyOnceWith(FEEDBACK_CHOICE_ORDER.failed[1])

    render(props(singleFailed, { testIndex: 0 }, { onChoose, selected: 'confirmed-bug' }))
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])

    render(props(singleFailed, { testIndex: 0, stepIndex: 1 }, { onChoose }))
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false'])
  })

  it('HEADING-AND-SCOPE-RENDERED: the heading and scope line read the view parts, and producer markup stays text', () => {
    for (const target of [{ testIndex: 1, stepIndex: 0 }, { testIndex: 1 }, { testIndex: 0, stepIndex: 0 }]) {
      const next = props(suite, target)
      render(next)
      const heading = container.querySelector('h2')!
      expect(heading.id).toBe('composer-heading')
      expect(heading.textContent).toBe(feedbackPartsText(next.heading))
      expect(heading.className).toContain('break-words')
      expect(container.querySelector('[data-feedback-scope-line]')?.textContent).toBe(feedbackPartsText(next.scopeLine))
      expect(container.querySelector('img')).toBeNull()
      expect(container.querySelectorAll('.truncate')).toHaveLength(0)
    }
    expect(container.querySelector('h2')?.textContent).toContain('sign in')
    render(props(suite, { testIndex: 1, stepIndex: 0 }))
    expect(container.querySelector('h2')?.textContent).toContain(HOSTILE)
    expect(container.querySelector('[data-feedback-scope-line]')?.textContent).toContain(HOSTILE)
    expect((globalThis as { __pwned?: boolean }).__pwned).toBeUndefined()
  })
})
