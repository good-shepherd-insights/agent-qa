// The runner's own checks on top of the verifier's cited verdicts (439 D-16, D-18, D-19). Pure:
// each reads the final screen's elements or the step's record and only lowers a met verdict;
// none turns a not-met, unverified or inconclusive condition into met.
//
// Open dialogs: on web an element with role 'dialog' or 'alertdialog' ('alert' is a live region,
// never a dialog); on iOS role 'alert'; on Android an element whose resource-id is
// android:id/alertTitle (named by it) or, with no title, android:id/button1 (unnamed). Compose
// dialogs and iOS sheets stay undetected; the verifier still judges them.

import type {
  ConditionGuard,
  ConditionRecord,
  ConditionVerdict,
  ElementInfo,
  OpenDialogAccount,
  Platform,
} from '@vostride/agent-qa-schema'
import type { ConditionJudgment, DialogAccount } from './types.js'

const REASON_MAX = 200
const NAME_MAX = 300
const LIMIT_LINES_MAX = 50
const WEB_DIALOG_ROLES: ReadonlySet<string> = new Set(['dialog', 'alertdialog'])
const ANDROID_DIALOG_TITLE = 'android:id/alertTitle'
const ANDROID_DIALOG_BUTTON = 'android:id/button1'

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function bound(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

/** Lower a met condition: `judged` keeps the verdict the record held before. */
export function demote(
  record: ConditionRecord,
  verdict: ConditionVerdict,
  guard: ConditionGuard,
  reason: string,
): ConditionRecord {
  const judged = record.judged ?? record.verdict
  return {
    ...record,
    verdict,
    ...(judged !== verdict ? { judged } : {}),
    guard,
    reason: bound(collapse(reason), REASON_MAX),
  }
}

export interface OpenDialog {
  name: string
  /** The word an unnamed dialog may be accounted by. */
  role: string
}

/** Every dialog still open among the final screen's elements. */
export function openDialogsOn(elements: readonly ElementInfo[], platform: Platform): OpenDialog[] {
  if (platform === 'web') {
    return elements
      .filter((element) => WEB_DIALOG_ROLES.has(element.role))
      .map((element) => ({ name: element.name, role: element.role }))
  }
  if (platform === 'ios') {
    return elements
      .filter((element) => element.role === 'alert')
      .map((element) => ({ name: element.name, role: 'alert' }))
  }
  const titles = elements.filter(
    (element) => element.attributes['resource-id'] === ANDROID_DIALOG_TITLE,
  )
  if (titles.length > 0) return titles.map((element) => ({ name: element.name, role: 'dialog' }))
  const unnamed = elements.some(
    (element) => element.attributes['resource-id'] === ANDROID_DIALOG_BUTTON,
  )
  return unnamed ? [{ name: '', role: 'dialog' }] : []
}

/**
 * Each open dialog with the verifier's account of it, matched by whitespace-collapsed, masked,
 * case-insensitive name; an unnamed dialog matches an account named '' or its role word. A dialog
 * the verifier did not account for is 'unaccounted'.
 */
export function applyDialogGuard(
  dialogs: readonly OpenDialog[],
  accounts: readonly DialogAccount[],
  mask: (value: string) => string,
): OpenDialogAccount[] {
  const key = (value: string) => collapse(mask(value)).toLowerCase()
  return dialogs.map((dialog) => {
    const name = key(dialog.name)
    const match = accounts.find((account) => {
      const accounted = key(typeof account.name === 'string' ? account.name : '')
      return name === '' ? accounted === '' || accounted === dialog.role : accounted === name
    })
    const account =
      match?.account === 'bears-on-condition' || match?.account === 'unrelated'
        ? match.account
        : 'unaccounted'
    return { name: bound(collapse(mask(dialog.name)), NAME_MAX), account }
  })
}

function numeric(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function refOf(controlRef: string): string {
  return collapse(controlRef).replace(/^\[?ref=/, '').replace(/\]$/, '')
}

/**
 * A met limit-max or limit-min condition holds only when the named control's reported value
 * equals the limit the screen reports for it: not-met when it does not, unverified when the
 * control or its limit is not reported.
 */
export function applyLimitGuard(
  record: ConditionRecord,
  judgment: ConditionJudgment,
  finalElements: readonly ElementInfo[],
  mask: (value: string) => string,
): ConditionRecord {
  if (record.verdict !== 'met') return record
  const need = judgment.needs
  if (need !== 'limit-max' && need !== 'limit-min') return record
  const ref = refOf(typeof judgment.controlRef === 'string' ? judgment.controlRef : '')
  if (ref === '') return demote(record, 'unverified', 'limit', 'no control was named for the limit')
  const control = finalElements.find((element) => element.ref === ref)
  if (control === undefined) {
    return demote(record, 'unverified', 'limit', `no control ${mask(ref)} on the final screen`)
  }
  const limitKey = need === 'limit-max' ? 'valuemax' : 'valuemin'
  const nowText = control.attributes.valuenow
  const limitText = control.attributes[limitKey]
  const now = numeric(nowText)
  const limit = numeric(limitText)
  const which = need === 'limit-max' ? 'maximum' : 'minimum'
  if (now === undefined || limit === undefined) {
    const missing = now === undefined ? 'value' : which
    return demote(record, 'unverified', 'limit', `the control reports no ${missing}`)
  }
  if (now === limit) return record
  const value = mask(nowText!.trim())
  const reported = mask(limitText!.trim())
  const reason = need === 'limit-max' ? `${value} of ${reported}` : `${value}, not its minimum ${reported}`
  return demote(record, 'not-met', 'limit', reason)
}

/**
 * The final screen's controls that report a minimum or maximum, one line each:
 * `<role> "<name>" [ref=…] value <now> (min <min>, max <max>)`.
 */
export function renderControlLimits(elements: readonly ElementInfo[]): string {
  const lines: string[] = []
  for (const element of elements) {
    const { valuenow, valuemin, valuemax } = element.attributes
    if (valuemin === undefined && valuemax === undefined) continue
    const limits = [
      ...(valuemin !== undefined ? [`min ${valuemin}`] : []),
      ...(valuemax !== undefined ? [`max ${valuemax}`] : []),
    ].join(', ')
    const name = element.name ? ` "${collapse(element.name)}"` : ''
    lines.push(
      `${element.role}${name} [ref=${element.ref}] value ${valuenow ?? 'not reported'} (${limits})`,
    )
  }
  if (lines.length <= LIMIT_LINES_MAX) return lines.join('\n')
  const omitted = lines.length - LIMIT_LINES_MAX
  return [...lines.slice(0, LIMIT_LINES_MAX), `… ${omitted} more controls omitted …`].join('\n')
}
