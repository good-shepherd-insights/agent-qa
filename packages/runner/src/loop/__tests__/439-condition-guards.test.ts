// C439-GUARDS (439 D-16, D-18, D-19): the runner's own checks, called directly. Open dialogs per
// platform, real limits from reported attributes, and the rule that a guard only ever lowers a
// met verdict.

import { describe, expect, it } from 'vitest'
import { asRef } from '@vostride/agent-qa-schema'
import type { ConditionRecord, ElementInfo } from '@vostride/agent-qa-schema'
import { applyDialogGuard, applyLimitGuard, openDialogsOn } from '../condition-guards.js'
import { judgeConditions } from '../requested-conditions.js'
import type { CitationSources } from '../requested-conditions.js'
import type { ConditionJudgment, VerificationResult } from '../types.js'

const identity = (value: string) => value

function element(
  ref: string,
  role: string,
  name: string,
  attributes: Record<string, string> = {},
): ElementInfo {
  return {
    ref: asRef(ref),
    role,
    name,
    nameNormalized: name.toLowerCase(),
    state: { enabled: true, focused: false, visible: true },
    labels: {},
    attributes,
  }
}

function judgment(overrides: Partial<ConditionJudgment> = {}): ConditionJudgment {
  return {
    quote: 'Set the brightness to its maximum',
    verdict: 'met',
    needs: 'limit-max',
    controlRef: 'e1',
    file: { name: '', match: 'none', text: '' },
    citations: [{ source: 'final-screen', quote: 'slider "Brightness"' }],
    reasoning: 'The slider is at its maximum',
    ...overrides,
  }
}

function met(): ConditionRecord {
  return {
    quote: 'Set the brightness to its maximum',
    verdict: 'met',
    needs: 'limit-max',
    reason: 'The slider is at its maximum',
    citations: [{ source: 'final-screen', quote: 'slider "Brightness"', found: true }],
  }
}

function sources(finalScreen: string): CitationSources {
  return { 'start-screen': '', 'final-screen': finalScreen, action: '', read: '', carried: '' }
}

function output(conditions: ConditionJudgment[]): VerificationResult {
  return { conditions, dialogs: [], isAppError: false, reasoning: 'overall' }
}

describe('C439-GUARDS', () => {
  it('an Android alert title is one open dialog named by it', () => {
    const elements = [
      element('e1', 'text', 'Delete address?', { 'resource-id': 'android:id/alertTitle' }),
      element('e2', 'text', 'This cannot be undone', { 'resource-id': 'android:id/message' }),
      element('e3', 'button', 'Delete', { 'resource-id': 'android:id/button1' }),
    ]
    expect(openDialogsOn(elements, 'android')).toEqual([{ name: 'Delete address?', role: 'dialog' }])
    expect(
      openDialogsOn([element('e1', 'button', 'OK', { 'resource-id': 'android:id/button1' })], 'android'),
    ).toEqual([{ name: '', role: 'dialog' }])
  })

  it('an iOS alert is an open dialog and a web alert is not', () => {
    expect(openDialogsOn([element('e1', 'alert', 'Allow notifications?')], 'ios')).toEqual([
      { name: 'Allow notifications?', role: 'alert' },
    ])
    expect(openDialogsOn([element('e1', 'alert', 'Saved')], 'web')).toEqual([])
    expect(openDialogsOn([element('e1', 'alertdialog', 'Delete address?')], 'web')).toEqual([
      { name: 'Delete address?', role: 'alertdialog' },
    ])
  })

  it('a dialog is matched to its account by name, and an unaccounted dialog blocks the pass', () => {
    const dialogs = [
      { name: 'Unsaved  Changes', role: 'dialog' },
      { name: 'Cookies', role: 'dialog' },
      { name: '', role: 'dialog' },
    ]
    const accounts = applyDialogGuard(
      dialogs,
      [
        { name: 'unsaved changes', account: 'bears-on-condition', reasoning: 'r' },
        { name: 'dialog', account: 'unrelated', reasoning: 'r' },
      ],
      identity,
    )
    expect(accounts).toEqual([
      { name: 'Unsaved Changes', account: 'bears-on-condition' },
      { name: 'Cookies', account: 'unaccounted' },
      { name: '', account: 'unrelated' },
    ])

    const judged = judgeConditions({
      stepText: 'Click Save',
      output: {
        ...output([
          judgment({
            quote: 'Click Save',
            needs: 'none',
            controlRef: '',
            citations: [{ source: 'final-screen', quote: 'heading "Saved"' }],
          }),
        ]),
        dialogs: [{ name: 'Cookies', account: 'unrelated', reasoning: 'a cookie banner' }],
      },
      sources: sources('- heading "Saved" [ref=e1]'),
      mask: identity,
      imageAttached: false,
      ending: 'completion',
      guards: {
        finalElements: [element('e1', 'heading', 'Saved'), element('e2', 'dialog', 'Unsaved changes'), element('e3', 'dialog', 'Cookies')],
        platform: 'web',
        imageAttached: false,
      },
    })
    expect(judged.pass).toBe(false)
    expect(judged.evidence.openDialogs).toEqual([
      { name: 'Unsaved changes', account: 'unaccounted' },
      { name: 'Cookies', account: 'unrelated' },
    ])
    expect(judged.reason).toBe('Unverified: open dialog "Unsaved changes" was not accounted for')
  })

  it('a range input at its default maximum meets limit-max', () => {
    const range = element('e1', 'slider', 'Volume', { valuenow: '100', valuemin: '0', valuemax: '100' })
    expect(applyLimitGuard(met(), judgment(), [range], identity)).toEqual(met())
  })

  it('one unit short of the reported maximum is not met', () => {
    const slider = element('e1', 'slider', 'Brightness', {
      valuenow: '65534',
      valuemin: '0',
      valuemax: '65535',
    })
    expect(applyLimitGuard(met(), judgment(), [slider], identity)).toMatchObject({
      verdict: 'not-met',
      judged: 'met',
      guard: 'limit',
      reason: '65534 of 65535',
    })
    const atMin = element('e1', 'slider', 'Brightness', { valuenow: '3', valuemin: '0', valuemax: '9' })
    expect(applyLimitGuard(met(), judgment({ needs: 'limit-min' }), [atMin], identity)).toMatchObject({
      verdict: 'not-met',
      guard: 'limit',
      reason: '3, not its minimum 0',
    })
  })

  it('a control with no reported limit, or no such control, leaves the condition unverified', () => {
    const spin = element('e1', 'spinbutton', 'Volume', { valuenow: '50' })
    expect(applyLimitGuard(met(), judgment(), [spin], identity)).toMatchObject({
      verdict: 'unverified',
      judged: 'met',
      guard: 'limit',
    })
    expect(applyLimitGuard(met(), judgment({ controlRef: 'e9' }), [spin], identity)).toMatchObject({
      verdict: 'unverified',
      guard: 'limit',
    })
  })

  it('a guard never raises a not-met or unverified verdict', () => {
    const atMax = element('e1', 'slider', 'Brightness', {
      valuenow: '65535',
      valuemin: '0',
      valuemax: '65535',
    })
    for (const verdict of ['not-met', 'unverified', 'inconclusive'] as const) {
      const record: ConditionRecord = { ...met(), verdict }
      expect(applyLimitGuard(record, judgment({ verdict }), [atMax], identity)).toEqual(record)
      const judged = judgeConditions({
        stepText: 'Set the brightness to its maximum',
        output: output([judgment({ verdict })]),
        sources: sources('- slider "Brightness" [ref=e1]'),
        mask: identity,
        imageAttached: true,
        ending: 'completion',
        guards: { finalElements: [atMax], platform: 'web', imageAttached: true },
      })
      expect(judged.evidence.conditions[0].verdict).toBe(verdict)
      expect(judged.pass).toBe(false)
    }
  })
})
