// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { actionWireSchema } from '@vostride/agent-qa-schema'
import { MarkCorrectionFields } from '../mark-correction-fields'

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
