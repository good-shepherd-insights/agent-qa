// C438-JUDGE (438 D-03): the stated-target judge refuses only a clear contradiction — a different
// role kind, a name sharing no word with the element's words, or different numbers in otherwise
// matching names — and the refusal line names both identities on one line.
import { describe, expect, it } from 'vitest'

import { asRef } from '@vostride/agent-qa-schema'
import type { ElementInfo, ElementLabels } from '@vostride/agent-qa-schema'

import { judgeStatedTarget, renderTargetMismatch } from '../stated-target.js'
import type { StatedTarget, TargetMismatchReason } from '../stated-target.js'

interface ElementOverrides {
  value?: string
  labels?: ElementLabels
}

function element(role: string, name: string, overrides: ElementOverrides = {}): ElementInfo {
  return {
    ref: asRef('e1'),
    role,
    name,
    nameNormalized: name.toLowerCase(),
    ...(overrides.value !== undefined ? { value: overrides.value } : {}),
    state: { enabled: true, focused: false, visible: true },
    labels: overrides.labels ?? {},
    attributes: {},
  }
}

function reasons(stated: StatedTarget, observed: ElementInfo): TargetMismatchReason[] {
  const judgement = judgeStatedTarget(stated, observed, [observed])
  return judgement.verdict === 'contradicts' ? judgement.reasons : []
}

describe('C438-JUDGE', () => {
  it('button vs textbox is a role-kind contradiction', () => {
    expect(reasons({ role: 'button', name: 'Submit' }, element('textbox', ''))).toEqual([
      'role-kind',
    ])
  })

  it('button vs link agrees (both press)', () => {
    expect(reasons({ role: 'button', name: 'Help' }, element('link', 'Help'))).toEqual([])
  })

  it('a stated button agrees with an observed text or cell', () => {
    expect(reasons({ role: 'button', name: 'Pay' }, element('text', 'Pay'))).toEqual([])
    expect(reasons({ role: 'button', name: 'Pay' }, element('cell', 'Pay'))).toEqual([])
  })

  it('a stated target with no role never contradicts on role', () => {
    expect(reasons({ name: 'Email' }, element('textbox', 'Email'))).toEqual([])
    expect(reasons({ name: 'Email' }, element('button', 'Email'))).toEqual([])
  })

  it('"Log in" vs "Sign in" agrees', () => {
    expect(reasons({ role: 'button', name: 'Log in' }, element('button', 'Sign in'))).toEqual([])
  })

  it('"Delete" vs "Save" shares no word', () => {
    expect(reasons({ role: 'button', name: 'Delete' }, element('button', 'Save'))).toEqual([
      'name-no-shared-word',
    ])
  })

  it('an unnamed textbox stated "Email" agrees', () => {
    expect(reasons({ role: 'textbox', name: 'Email' }, element('textbox', ''))).toEqual([])
  })

  it('the value, aria-label, placeholder and title are observed words; the test id is not', () => {
    const stated = { role: 'textbox', name: 'Email' }
    const login = (overrides: ElementOverrides) =>
      reasons(stated, element('textbox', 'Login', overrides))
    expect(login({ value: 'email' })).toEqual([])
    expect(login({ labels: { ariaLabel: 'Email' } })).toEqual([])
    expect(login({ labels: { placeholder: 'Email' } })).toEqual([])
    expect(login({ labels: { title: 'Email' } })).toEqual([])
    expect(login({ labels: { testId: 'email' } })).toEqual(['name-no-shared-word'])
  })

  it('"Invoice 947" vs "Invoice 946" is a name-number contradiction', () => {
    expect(reasons({ role: 'link', name: 'Invoice 947' }, element('link', 'Invoice 946'))).toEqual([
      'name-number',
    ])
  })

  it('"Invoice 947" vs "Invoice 947" agrees', () => {
    const observed = element('link', 'Invoice 947')
    expect(reasons({ role: 'link', name: 'Invoice 947' }, observed)).toEqual([])
  })

  it('"Cart" vs "Cart (3)" agrees (only one side has a number)', () => {
    expect(reasons({ role: 'button', name: 'Cart' }, element('button', 'Cart (3)'))).toEqual([])
  })

  it('a full-width "Ｓｕｂｍｉｔ" agrees with "Submit"', () => {
    const observed = element('button', 'Submit')
    expect(reasons({ role: 'button', name: 'Ｓｕｂｍｉｔ' }, observed)).toEqual([])
  })

  it('"SUBMIT" agrees with "Submit"', () => {
    expect(reasons({ role: 'button', name: 'SUBMIT' }, element('button', 'Submit'))).toEqual([])
  })

  it('an agreeing judgement reports whether a row was stated', () => {
    const observed = element('button', 'Edit label')
    const unrowed = judgeStatedTarget({ role: 'button', name: 'Edit label' }, observed, [observed])
    expect(unrowed).toEqual({ verdict: 'agrees', rowStated: false, rowKnown: false })
    const rowed = { role: 'button', name: 'Edit label', row: '7 Elm Street' }
    expect(judgeStatedTarget(rowed, observed, [observed])).toMatchObject({
      verdict: 'agrees',
      rowStated: true,
    })
  })

  it('renderTargetMismatch names both identities on one line', () => {
    const line = renderTargetMismatch({
      lane: 'ref',
      ref: 'e4',
      stated: { role: 'button', name: 'Submit' },
      observed: { role: 'textbox', name: 'First\nSecond' },
      reasons: ['role-kind'],
    })
    expect(line.startsWith('target-mismatch: ')).toBe(true)
    expect(line).toContain('"Submit"')
    expect(line).toContain('"First Second"')
    expect(line).toContain('button')
    expect(line).toContain('textbox')
    expect(line).not.toContain('\n')
  })

  it('renderTargetMismatch caps each name at 80 characters', () => {
    const line = renderTargetMismatch({
      lane: 'ref',
      ref: 'e4',
      stated: { role: 'button', name: 'x'.repeat(200) },
      observed: { role: 'button', name: 'Save' },
      reasons: ['name-no-shared-word'],
    })
    expect(line).toContain(`"${'x'.repeat(80)}…"`)
    expect(line).not.toContain('x'.repeat(81))
  })
})
