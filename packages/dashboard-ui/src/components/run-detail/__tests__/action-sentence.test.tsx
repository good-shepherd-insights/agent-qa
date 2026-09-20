// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { asRef, maskedMarker, type RunDetailSubAction } from '@vostride/agent-qa-schema'
import { afterEach, expect, it } from 'vitest'
import { copyTextOf } from '@/lib/display-text'

const modules = import.meta.glob<typeof import('../action-sentence')>('../action-sentence.tsx', { eager: true })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
let container: HTMLDivElement
afterEach(() => { act(() => root?.unmount()); container?.remove() })

it('SENTENCE-SECRET-CHIP renders masked parts, safe names and the outcome icon', () => {
  const module = modules['../action-sentence.tsx']
  expect(module, 'the masked action sentence renderer exists').toBeDefined()
  const { ActionSentence } = module!
  const secret = maskedMarker('secret')
  const sub: RunDetailSubAction = {
    testIndex: 0, stepIndex: 0, subActionIndex: 0, plan: 'Do not render reasoning here',
    plannedAction: { type: 'fill', ref: asRef('e1'), text: secret, clearMode: 'replace', submit: false },
    grounding: { descriptor: { name: '<img src=x onerror=alert(1)>' }, attempts: [] },
    result: { success: false }, screenStateHash: 'screen',
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<ActionSentence sub={sub} wrap='truncate' />))
  expect(container.querySelector('[data-masked="secret"]')).not.toBeNull()
  expect(container.textContent).toContain(copyTextOf(secret).slice(1, -1))
  expect(container.textContent).toContain("Tried to fill '<img src=x onerror=alert(1)>' with ")
  expect(container.textContent).toContain(' — failed')
  expect(container.querySelector('img')).toBeNull()
  expect(container.innerHTML).not.toContain(secret)
  expect(container.querySelector('[data-action-family="input"][data-action-outcome="failed"]')).not.toBeNull()
  expect(container.querySelector('svg.text-red-500')).not.toBeNull()
  expect(container.querySelector('.truncate')).not.toBeNull()
})
