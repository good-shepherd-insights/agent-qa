import { asRef } from '@vostride/agent-qa-schema'
import type { Action, ElementInfo } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import * as identityModule from '../identity'
import {
  computeDecisionIdentity,
  decisionIdentityKey,
  normalizeIdentityValue,
} from '../identity'
import type { DecisionIdentity } from '../identity'

function el(ref: string, role: string, nameNormalized: string): ElementInfo {
  return {
    ref: asRef(ref),
    role,
    name: nameNormalized,
    nameNormalized,
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes: {},
  }
}

function clickAction(ref: string): Action {
  return { type: 'click', ref: asRef(ref) } as unknown as Action
}

describe('computeDecisionIdentity', () => {
  it('resolves a grounded click into { opClass, target } with an ordinal among siblings', () => {
    const elements = [el('e1', 'textbox', 'Email'), el('e2', 'button', 'Log in')]

    const identity = computeDecisionIdentity(clickAction('e2'), elements)

    expect(identity).toEqual({
      opClass: 'click',
      target: { role: 'button', nameNormalized: 'Log in', ordinal: 0 },
    })
  })

  it('assigns distinct ordinals to elements sharing role and nameNormalized', () => {
    const elements = [el('e1', 'button', 'Save'), el('e2', 'button', 'Save')]

    const first = computeDecisionIdentity(clickAction('e1'), elements)
    const second = computeDecisionIdentity(clickAction('e2'), elements)

    expect(first.target?.ordinal).toBe(0)
    expect(second.target?.ordinal).toBe(1)
  })

  it('carries a normalized value for value-bearing ops and leaves it absent otherwise', () => {
    const elements = [el('e1', 'textbox', 'Email')]
    const fill = { type: 'fill', ref: asRef('e1'), text: '  hello@example.com  ', clearMode: 'replace', submit: false } as unknown as Action

    const fillIdentity = computeDecisionIdentity(fill, elements)
    expect(fillIdentity.value).toBe('hello@example.com')

    const navigate = { type: 'navigate', to: 'back' } as unknown as Action
    const navIdentity = computeDecisionIdentity(navigate, elements)
    expect(Object.hasOwn(navIdentity, 'value')).toBe(false)
    expect(navIdentity.opClass).toBe('navigate')
  })

  it('leaves target absent when the action ref does not resolve', () => {
    const elements = [el('e1', 'button', 'Log in')]

    const identity = computeDecisionIdentity(clickAction('e9'), elements)

    expect(identity.opClass).toBe('click')
    expect(Object.hasOwn(identity, 'target')).toBe(false)
  })
})

describe('decisionIdentityKey', () => {
  it('produces equal keys for identical identities regardless of key order', () => {
    const a: DecisionIdentity = { opClass: 'click', target: { role: 'button', nameNormalized: 'Log in', ordinal: 0 } }
    const b: DecisionIdentity = { target: { ordinal: 0, nameNormalized: 'Log in', role: 'button' }, opClass: 'click' } as DecisionIdentity

    expect(decisionIdentityKey(a)).toBe(decisionIdentityKey(b))
  })

  it('produces distinct keys when opClass, target, or value differ', () => {
    const base: DecisionIdentity = { opClass: 'click', target: { role: 'button', nameNormalized: 'Log in', ordinal: 0 } }
    const otherOp: DecisionIdentity = { ...base, opClass: 'doubleClick' }
    const otherTarget: DecisionIdentity = { ...base, target: { role: 'button', nameNormalized: 'Sign up', ordinal: 0 } }
    const withValue: DecisionIdentity = { ...base, value: 'x' }

    expect(decisionIdentityKey(base)).not.toBe(decisionIdentityKey(otherOp))
    expect(decisionIdentityKey(base)).not.toBe(decisionIdentityKey(otherTarget))
    expect(decisionIdentityKey(base)).not.toBe(decisionIdentityKey(withValue))
  })

  it('produces equal keys when action values differ only by casing and whitespace', () => {
    const elements = [el('e1', 'textbox', 'Email')]
    const noisy = computeDecisionIdentity(
      {
        type: 'fill',
        ref: asRef('e1'),
        text: '  Hello   World  ',
        clearMode: 'replace',
        submit: false,
      } as unknown as Action,
      elements,
    )
    const normalized = computeDecisionIdentity(
      {
        type: 'fill',
        ref: asRef('e1'),
        text: 'hello world',
        clearMode: 'replace',
        submit: false,
      } as unknown as Action,
      elements,
    )

    expect(decisionIdentityKey(noisy)).toBe(decisionIdentityKey(normalized))
  })
})

describe('normalizeIdentityValue', () => {
  it('exports the shared casefold, trim, and whitespace-collapse primitive', () => {
    const normalizeValueText = (
      identityModule as typeof identityModule & {
        normalizeValueText?: (raw: string) => string
      }
    ).normalizeValueText

    expect(normalizeValueText).toBeTypeOf('function')
    expect(normalizeValueText?.('  Hello   World  ')).toBe('hello world')
  })

  it('normalizes value-bearing fields and returns undefined for non-value ops', () => {
    const fill = {
      type: 'fill',
      ref: asRef('e1'),
      text: 'Hello  World',
      clearMode: 'replace',
      submit: false,
    } as unknown as Action
    const select = {
      type: 'select',
      ref: asRef('e1'),
      value: ' opt ',
    } as unknown as Action
    const click = clickAction('e1')

    expect(normalizeIdentityValue(fill)).toBe('hello world')
    expect(normalizeIdentityValue(select)).toBe('opt')
    expect(normalizeIdentityValue(click)).toBeUndefined()
  })
})
