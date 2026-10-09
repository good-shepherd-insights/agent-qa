// The stated-target judge (Phase 438, AUTO-14 · D-01/D-03/D-05).
// CRITICAL: provider-neutral + storage-neutral. No node:* imports, no fs/sharp, no
// core/model/adapter package imports — imports only schema types.
//
// Every element action carries, beside its ref, the element the planner meant: its role, its
// name and, when a label repeats, its row words. Before dispatch the loop judges that stated
// target against the element the ref names. Only a CLEAR contradiction is refused (D-03):
//   - role-kind: both roles are in ROLE_KIND and their kinds differ (a textbox where a button
//     was stated). Roles outside the map never contradict on role — mobile often exposes a
//     pressable control as `text` or `group`.
//   - name-no-shared-word: the element has words (name, value, aria-label, placeholder, title)
//     and no stated name word is one of them. A nameless element never contradicts on name.
//   - name-number: both names carry number tokens and the number multisets differ ("Invoice
//     947" stated, "Invoice 946" found) — the shared word "Invoice" alone would let it pass.
//   - row: a row was stated, the element's row is known (row-text.ts) and the stated row words
//     are not in it. An empty stated row is not stated; an unknown row never contradicts.
// A paraphrase that shares a word ("Log in" for "Sign in") agrees; exact equality is never
// required. A refusal names both identities and never picks a substitute element.
//
// M2 injection boundary: names are opaque comparison data only — never interpolated into a
// selector or an instruction, never evaluated.
//
// Pure functions: no recording, no side effects. Redaction is the caller's job.

import type { ElementInfo } from '@vostride/agent-qa-schema'
import { rowContains, rowTextOf, wordTokens } from './row-text.js'

/** The element the planner meant beside its ref (D-01); `row` names a repeated label's row. */
export interface StatedTarget {
  role?: string
  name: string
  row?: string
}

/** The element lanes an action can carry a stated target on. */
export type StatedTargetLane = 'ref' | 'fromRef' | 'toRef'

/** The stated target per element lane, kept by the gate for the pre-dispatch check (D-01, D-04). */
export type StatedTargets = Partial<Record<StatedTargetLane, StatedTarget>>

export type RoleKind = 'press' | 'entry' | 'toggle' | 'choice' | 'range'

export const ROLE_KIND: Readonly<Record<string, RoleKind>> = {
  button: 'press',
  link: 'press',
  menuitem: 'press',
  tab: 'press',
  textbox: 'entry',
  searchbox: 'entry',
  spinbutton: 'entry',
  checkbox: 'toggle',
  switch: 'toggle',
  radio: 'toggle',
  menuitemcheckbox: 'toggle',
  menuitemradio: 'toggle',
  combobox: 'choice',
  listbox: 'choice',
  option: 'choice',
  slider: 'range',
}

export type TargetMismatchReason = 'role-kind' | 'name-no-shared-word' | 'name-number' | 'row'

export type StatedTargetJudgement =
  | { verdict: 'agrees'; rowStated: boolean; rowKnown: boolean; observedRow?: string }
  | {
      verdict: 'contradicts'
      reasons: TargetMismatchReason[]
      rowStated: boolean
      observedRow?: string
    }

const NUMBER_TOKEN = /^\p{N}+$/u

function numberTokens(text: string | undefined): string[] {
  return wordTokens(text).filter((word) => NUMBER_TOKEN.test(word)).sort()
}

function numbersDiffer(stated: string, observed: string): boolean {
  const a = numberTokens(stated)
  const b = numberTokens(observed)
  if (a.length === 0 || b.length === 0) return false
  return a.length !== b.length || a.some((word, index) => word !== b[index])
}

function observedWords(element: ElementInfo): Set<string> {
  const { testId: _testId, ...labels } = element.labels
  const sources = [element.name, element.value, ...Object.values(labels)]
  const words = new Set<string>()
  for (const source of sources) {
    if (typeof source !== 'string') continue
    for (const word of wordTokens(source)) words.add(word)
  }
  return words
}

/**
 * Judge a stated target against the element its ref names (D-03). `elements` is the observation
 * the element belongs to; the element's row is read from it (D-02).
 */
export function judgeStatedTarget(
  stated: StatedTarget,
  element: ElementInfo,
  elements: readonly ElementInfo[],
): StatedTargetJudgement {
  const reasons: TargetMismatchReason[] = []

  const statedKind = stated.role !== undefined ? ROLE_KIND[stated.role] : undefined
  const observedKind = ROLE_KIND[element.role]
  if (statedKind !== undefined && observedKind !== undefined && statedKind !== observedKind) {
    reasons.push('role-kind')
  }

  const observed = observedWords(element)
  const statedWords = wordTokens(stated.name)
  if (observed.size > 0 && statedWords.length > 0) {
    if (!statedWords.some((word) => observed.has(word))) reasons.push('name-no-shared-word')
    if (numbersDiffer(stated.name, element.name)) reasons.push('name-number')
  }

  const statedRow =
    typeof stated.row === 'string' && stated.row.trim().length > 0 ? stated.row : undefined
  const rowStated = statedRow !== undefined
  const observedRow = rowTextOf(element, elements)
  const rowKnown = observedRow !== undefined
  if (statedRow !== undefined && observedRow !== undefined && !rowContains(observedRow, statedRow)) {
    reasons.push('row')
  }

  const row = observedRow !== undefined ? { observedRow } : {}
  return reasons.length > 0
    ? { verdict: 'contradicts', reasons, rowStated, ...row }
    : { verdict: 'agrees', rowStated, rowKnown, ...row }
}

/** One identity as the refusal message renders it. */
export interface TargetIdentity {
  role?: string
  name: string
  row?: string
}

export interface TargetMismatchInput {
  lane: StatedTargetLane
  ref: string
  stated: TargetIdentity
  observed: TargetIdentity
  reasons: readonly TargetMismatchReason[]
}

const MESSAGE_TEXT_CAP = 80

function quoted(text: string): string {
  const oneLine = text.replace(/\s*[\r\n]+\s*/g, ' ')
  const capped =
    oneLine.length > MESSAGE_TEXT_CAP ? `${oneLine.slice(0, MESSAGE_TEXT_CAP)}…` : oneLine
  return JSON.stringify(capped)
}

function renderIdentity(identity: TargetIdentity): string {
  const role = identity.role !== undefined && identity.role.length > 0 ? identity.role : 'element'
  const row =
    identity.row !== undefined && identity.row.length > 0 ? ` in row ${quoted(identity.row)}` : ''
  return `${role} ${quoted(identity.name)}${row}`
}

/**
 * The self-correcting refusal line the planner reads (§7.1 form). Names are quoted, collapsed to
 * one line and capped, so app text cannot break the message's shape.
 */
export function renderTargetMismatch(input: TargetMismatchInput): string {
  return (
    `target-mismatch: ${input.lane} ${input.ref} is ${renderIdentity(input.observed)}, `
    + `but the stated target is ${renderIdentity(input.stated)} (${input.reasons.join(', ')}). `
    + 'No input was sent. Re-observe the screen and use the ref of the element you mean, '
    + 'or state the element this ref really is.'
  )
}
