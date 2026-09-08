// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MARKS, type RunDetailMemberMark } from '@vostride/agent-qa-schema'
import { StepTreeItem } from '../step-tree-item'
import { fromRunDetailStep } from '@/lib/display-step'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
const step = fromRunDetailStep({ testIndex: 7, stepIndex: 2, stepText: 'Check cart', cacheStatus: 'miss',
  verifierVerdict: { pass: false, reasoning: 'Cart differs' }, selfHealOccurred: false, briefDigest: 'digest' }, [])
function mount(marks: readonly RunDetailMemberMark[] | undefined = []) {
  const onMark = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><ul><StepTreeItem step={step} isSelected={false} isExpanded
    selection={null} onSelect={() => {}} onMark={onMark} marks={marks} /></ul></MemoryRouter>))
  return onMark
}
const click = (selector: string) => act(() => { container.querySelector<HTMLButtonElement>(selector)!.click() })
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('419 step marking', () => {
  it('uses durable member and step indexes, with the same explicit note/submit flow', () => {
    const onMark = mount()
    const buttons = [...container.querySelectorAll('[data-mark-kind]')]
    expect(buttons.map(button => button.getAttribute('data-mark-kind'))).toEqual(MARKS)
    expect(buttons.map(button => button.getAttribute('data-mark-step'))).toEqual(['2', '2', '2'])
    click('[data-mark-kind="confirmed-bug"]')
    expect(onMark).not.toHaveBeenCalled()
    expect(container.querySelector('[data-mark-note]')).not.toBeNull()
    click('[data-mark-submit]')
    expect(onMark).toHaveBeenCalledExactlyOnceWith(7, 2, 'confirmed-bug', undefined)
  })
  it('renders only the matching step receipt', () => {
    mount([
      { markId: 'mark_0123456789ab', kind: 'false-fail', ordinal: 1, disposition: { kind: 'quarantined', class: 'flake' } },
      { markId: 'mark_0123456789ac', kind: 'confirmed-bug', ordinal: 2, stepIndex: 2, disposition: { kind: 'confirmed-bug', confirmedRecords: 0 } },
      { markId: 'mark_0123456789ad', kind: 'false-pass', ordinal: 3, stepIndex: 3, disposition: { kind: 'quarantined', class: 'timeout' } },
    ])
    expect(container.querySelectorAll('[data-mark-chip]')).toHaveLength(1)
    expect(container.querySelector('[data-mark-chip]')?.textContent).toBe('marked confirmed-bug by user · 2')
    expect(container.querySelector('[data-mark-triage]')?.textContent).toBe('confirmed-bug: no fix drafted')
    expect(readFileSync('src/components/run-detail/step-tree-item.tsx', 'utf8')).not.toContain('dangerouslySetInnerHTML')
  })
  it('cancel does not submit', () => {
    const onMark = mount()
    click('[data-mark-kind="false-pass"]')
    click('[data-mark-cancel]')
    expect(onMark).not.toHaveBeenCalled()
  })
})
