// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { actionWireSchema } from '@vostride/agent-qa-schema'
import { ADD_CORRECTION_LABEL } from '@/lib/feedback-view'
import {
  CORRECTED_ACTION_ERROR,
  CORRECTED_ACTION_EXAMPLE,
  CORRECTED_ACTION_LABEL,
  CORRECTED_EXPECTATION_HELP,
  CORRECTED_EXPECTATION_LABEL,
  CorrectionFields,
  MarkCorrectionFields,
  parseCorrectedAction,
} from '../mark-correction-fields'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
function mount(two = false) {
  const onChange = vi.fn()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<>
    <MarkCorrectionFields disabled={false} onChange={onChange} />
    {two ? <MarkCorrectionFields disabled={false} onChange={() => {}} /> : null}
  </>))
  return onChange
}
function fill(label: string, value: string) {
  act(() => {
    const field = container.querySelector<HTMLTextAreaElement>(`[aria-label="${label}"]`)!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
afterEach(() => { act(() => root.unmount()); container.remove() })

describe('419-15 optional correction guidance', () => {
  it('visibly labels two concurrent forms with unique controls and help', () => {
    mount(true)
    const fields = [...container.querySelectorAll<HTMLTextAreaElement>('textarea')]
    expect(new Set(fields.map(field => field.id)).size).toBe(4)
    for (const field of fields) {
      const label = [...container.querySelectorAll('label')].find(label => label.htmlFor === field.id)
      expect(label?.textContent).toBe(`${field.getAttribute('aria-label')} (optional)`)
      expect(field.getAttribute('aria-describedby')).toBeTruthy()
      for (const id of field.getAttribute('aria-describedby')!.split(' ')) expect(document.getElementById(id)?.textContent).toBeTruthy()
    }
    const example = container.querySelector('code')?.textContent
    expect(example).toBe('{"type":"click","ref":"e1"}')
    expect(actionWireSchema.safeParse(JSON.parse(example!)).success).toBe(true)
    expect(container.textContent).toContain('intended target in the recorded decision')
  })
  it('keeps blank and prose-only corrections valid without supplying an example', () => {
    const onChange = mount()
    expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Corrected action JSON"]')?.value).toBe('')
    fill('Corrected expectation', 'Expected the cart')
    expect(onChange).toHaveBeenLastCalledWith({ correctedExpectation: 'Expected the cart' }, true)
    fill('Corrected expectation', '')
    expect(onChange).toHaveBeenLastCalledWith(undefined, true)
  })
  it.each(['{', '{}', '{"type":"click"}'])('identifies invalid action %s and recovers without echoing it', raw => {
    const onChange = mount()
    fill('Corrected action JSON', raw)
    expect(onChange).toHaveBeenLastCalledWith(undefined, false)
    const field = container.querySelector('[aria-label="Corrected action JSON"]')!
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Corrected action JSON')
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain(raw)
    fill('Corrected action JSON', '{"type":"click","ref":"e1"}')
    expect(field.getAttribute('aria-invalid')).toBe('false')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith({ correctedAction: { type: 'click', ref: 'e1' } }, true)
  })
})

// THE CONTROLLED CORRECTION FIELDS (426-08 · D-15, RESEARCH Pitfall 10). The composer's draft holds the
// raw text, so these fields keep no value of their own: they paint what they are given and report every
// keystroke. The shipped labels, help and error copy are shared with the pill form above.
type Controlled = Parameters<typeof CorrectionFields>[0]
function renderControlled(props: Controlled) {
  if (container === undefined || !container.isConnected) {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  act(() => root.render(<CorrectionFields {...props} />))
}
function byLabel(text: string) {
  const label = [...container.querySelectorAll('label')].find(entry => entry.textContent === text)
  return label === undefined ? null : document.getElementById(label.htmlFor) as HTMLTextAreaElement | null
}
function type(field: HTMLTextAreaElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function openCorrection() {
  act(() => { container.querySelector<HTMLButtonElement>('[data-feedback-correction]')!.click() })
}

describe('426-08 the controlled correction fields', () => {
  it('CORRECTION-FIELDS-CONTROLLED: collapsed under Add a correction; opened, the expectation and action fields carry the shipped words', () => {
    renderControlled({ expectation: '', actionText: '', disabled: false, actionField: { shown: true }, onChange: vi.fn() })
    const trigger = container.querySelector('[data-feedback-correction]')
    expect(trigger, 'no Add a correction trigger').not.toBeNull()
    expect(trigger!.textContent).toBe(ADD_CORRECTION_LABEL)
    expect(trigger!.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('textarea')).toBeNull()

    openCorrection()
    expect(trigger!.getAttribute('aria-expanded')).toBe('true')
    const expectation = byLabel(CORRECTED_EXPECTATION_LABEL)
    expect(expectation, 'no labelled expectation field').not.toBeNull()
    expect(expectation!.hasAttribute('aria-label')).toBe(false)
    expect(document.getElementById(expectation!.getAttribute('aria-describedby')!)?.textContent).toBe(CORRECTED_EXPECTATION_HELP)
    const action = byLabel(CORRECTED_ACTION_LABEL)
    expect(action, 'no labelled action field').not.toBeNull()
    expect(action!.closest('[data-feedback-action-gate]')?.getAttribute('data-feedback-action-gate')).toBe('shown')
    expect(action!.className).toContain('font-mono')
    expect(action!.getAttribute('aria-invalid')).toBe('false')
    const help = document.getElementById(action!.getAttribute('aria-describedby')!)
    expect(help?.querySelector('code')?.textContent).toBe(CORRECTED_ACTION_EXAMPLE)
    expect(help?.textContent).toContain('intended target in the recorded decision')
    for (const field of [expectation!, action!]) {
      expect(field.className).toContain('max-h-40')
      expect(field.className).toContain('overflow-y-auto')
    }
  })

  it('CORRECTION-FIELDS-CONTROLLED: typing reports the raw strings, and the fields show only what they are given', () => {
    const onChange = vi.fn()
    renderControlled({ expectation: 'Expected the cart', actionText: '', disabled: false, actionField: { shown: true }, onChange })
    openCorrection()
    type(byLabel(CORRECTED_ACTION_LABEL)!, '{')
    expect(onChange).toHaveBeenLastCalledWith('Expected the cart', '{')
    expect(byLabel(CORRECTED_ACTION_LABEL)!.value).toBe('')
    type(byLabel(CORRECTED_EXPECTATION_LABEL)!, 'Expected the receipt')
    expect(onChange).toHaveBeenLastCalledWith('Expected the receipt', '')

    renderControlled({ expectation: 'Expected the cart', actionText: '{', disabled: false, actionField: { shown: true }, onChange })
    const action = byLabel(CORRECTED_ACTION_LABEL)!
    expect(action.value).toBe('{')
    expect(action.getAttribute('aria-invalid')).toBe('true')
    const alert = container.querySelector('[role="alert"]')
    expect(alert?.textContent).toBe(CORRECTED_ACTION_ERROR)
    expect(action.getAttribute('aria-describedby')!.split(' ')).toContain(alert!.id)

    renderControlled({ expectation: '', actionText: CORRECTED_ACTION_EXAMPLE, disabled: false, actionField: { shown: true }, onChange })
    expect(byLabel(CORRECTED_ACTION_LABEL)!.getAttribute('aria-invalid')).toBe('false')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('CORRECTION-FIELDS-CONTROLLED: a hidden action field is replaced by its reason, and its text is not on the page', () => {
    const reason = 'A corrected action isn\'t used — this mark is quarantined.'
    renderControlled({ expectation: '', actionText: '{', disabled: false, actionField: { shown: false, reason }, onChange: vi.fn() })
    openCorrection()
    const hidden = container.querySelector('[data-feedback-action-gate="hidden"]')
    expect(hidden?.textContent).toBe(reason)
    expect(byLabel(CORRECTED_ACTION_LABEL)).toBeNull()
    expect(container.querySelectorAll('textarea')).toHaveLength(1)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('CORRECTION-FIELDS-CONTROLLED: one validation serves both forms — empty, valid and invalid', () => {
    expect(parseCorrectedAction('  ')).toEqual({ kind: 'empty' })
    expect(parseCorrectedAction(CORRECTED_ACTION_EXAMPLE)).toEqual({ kind: 'valid', action: { type: 'click', ref: 'e1' } })
    for (const raw of ['{', '{}', '{"type":"click"}']) expect(parseCorrectedAction(raw)).toEqual({ kind: 'invalid' })
  })
})
