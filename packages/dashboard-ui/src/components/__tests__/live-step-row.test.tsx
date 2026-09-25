// @vitest-environment jsdom

// THE LIVE STEP ROW (428 D-19/D-20/D-22).
//
// A live step row is one status glyph and the step label, nothing else. The running glyph breathes,
// restarting each time the run records a sub-action, and every status has its own shape and name.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { LIVE_STEP_GLYPHS, LiveStepRowView } from '@/components/live-step-row'
import { LIVE_STEP_STATUS_NAMES } from '@/lib/live-step-row'
import { STEP_STATUSES, type LiveStepRow, type StepStatus } from '@/lib/run-stream-reducer'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// THE NEEDLE IS CONCATENATED so this file cannot satisfy the phase's deletion census by matching
// itself.
const TICKS_LABEL_ATTR = 'data-step-ticks' + '-label'
const CLOCK_PATTERN = /\d+:\d{2}/

let container: HTMLDivElement | null = null
let root: Root | null = null

function row(overrides: Partial<LiveStepRow> = {}): LiveStepRow {
  return {
    testIndex: 0,
    stepIndex: 0,
    status: 'running',
    text: 'click Save',
    startedAt: 1_000,
    ticks: 0,
    createdSeq: 1,
    ...overrides,
  }
}

function render(value: LiveStepRow): HTMLLIElement {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  act(() => {
    root!.render(
      <ul>
        <LiveStepRowView row={value} />
      </ul>,
    )
  })
  const li = container.querySelector('li')
  if (!li) throw new Error('the row rendered no li')
  return li
}

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
})

describe('THE LIVE STEP ROW (428 D-19/D-20)', () => {
  it('GLYPH-TABLE-TOTAL-AND-INJECTIVE: every status has a glyph and no two statuses share one', () => {
    expect(new Set(Object.keys(LIVE_STEP_GLYPHS))).toEqual(new Set(STEP_STATUSES))
    expect(new Set(Object.values(LIVE_STEP_GLYPHS)).size).toBe(STEP_STATUSES.length)
  })

  it('ROW-IS-GLYPH-AND-LABEL: each status renders a glyph and a label, and no clock, count or bar', () => {
    for (const status of STEP_STATUSES) {
      const li = render(
        row({ status, ticks: 7, startedAt: 1_000, durationMs: status === 'running' ? undefined : 65_000 }),
      )
      expect(li.children, status).toHaveLength(2)
      expect(li.textContent ?? '', status).not.toMatch(CLOCK_PATTERN)
      expect(li.textContent ?? '', status).not.toContain('action')
      expect(li.querySelector('[role="progressbar"]'), status).toBeNull()
      expect(li.querySelector(`[${TICKS_LABEL_ATTR}]`), status).toBeNull()
    }
  })

  it('RUNNING-BREATHES-AND-REKEYS: the running glyph breathes and restarts on every sub-action', () => {
    const first = render(row({ status: 'running', ticks: 3 }))
    const wrapperAt3 = first.children[0] as HTMLElement
    expect(wrapperAt3.hasAttribute('data-step-motion')).toBe(true)
    expect(wrapperAt3.getAttribute('data-motion-key')).toBe('3')
    const glyph = wrapperAt3.querySelector('svg')
    expect(glyph?.classList.contains('live-step-breathing')).toBe(true)
    // Neither green nor a dot: SC3's count of green dots must still see exactly one.
    expect(glyph?.getAttribute('class') ?? '').not.toMatch(/emerald|green|live-dot/)

    const second = render(row({ status: 'running', ticks: 4 }))
    const wrapperAt4 = second.children[0] as HTMLElement
    expect(wrapperAt4).not.toBe(wrapperAt3)
    expect(wrapperAt4.getAttribute('data-motion-key')).toBe('4')

    for (const status of STEP_STATUSES.filter((each) => each !== 'running')) {
      const li = render(row({ status, ticks: 4 }))
      expect(li.querySelector('.live-step-breathing'), status).toBeNull()
      expect(li.querySelector('[data-step-motion]'), status).toBeNull()
    }
  })

  it('STATUS-NAME-NOT-COLOUR: every glyph carries its status name, so colour is never the only signal', () => {
    for (const status of STEP_STATUSES) {
      const li = render(row({ status }))
      const wrapper = li.children[0] as HTMLElement
      expect(wrapper.getAttribute('role'), status).toBe('img')
      expect(wrapper.getAttribute('aria-label'), status).toBe(LIVE_STEP_STATUS_NAMES[status as StepStatus])
    }
  })

  it('PLAIN-LABEL-UNCHANGED: a label with no placeholder renders as is, and an empty one as step N', () => {
    expect(render(row({ text: 'click Save' })).textContent).toBe('click Save')
    expect(render(row({ text: '', stepIndex: 2 })).textContent).toBe('step 3')
  })

  it('the breathing animation is named, and it is still under prefers-reduced-motion', () => {
    const css = readFileSync(resolve(__dirname, '../../styles/globals.css'), 'utf8')
    expect(css).toContain('@keyframes live-step-breathe')
    expect(css).toMatch(/\.live-step-breathing\s*\{[^}]*animation:\s*live-step-breathe\b/)
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)]
    expect(reduced.some((block) => /\.live-step-breathing\s*\{\s*animation:\s*none;?\s*\}/.test(block[1] ?? ''))).toBe(
      true,
    )
  })
})
