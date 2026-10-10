// 439 D-03: the whole step's record the verifier judges from. Every action with its outcome and
// operation evidence, every value read, the settled start screen and the items carried from earlier
// steps. The planner's reasoning is never part of it. Callers mask and redact what they add.
import type { InputEvidence, OperationEvidence, ScreenState } from '@vostride/agent-qa-schema'
import type { Action } from '../platform.js'
import { renderInputEvidence, renderOperationEvidence, verifierActionDescription } from './prompts.js'

export type RecordedActionOutcome = 'success' | 'failure' | 'no-input' | 'refused'

export interface RecordedAction {
  /** 1-based position of the action in the step. */
  index: number
  action: Action
  /** The element the action's ref named on the screen it acted on. */
  element?: { role: string; name: string }
  outcome: RecordedActionOutcome
  error?: string
  operationEvidence?: OperationEvidence
}

export type RecordedReadKind = 'assertValue' | 'assertAI' | 'extractAI' | 'reportValue'

export interface RecordedRead {
  /** The 1-based index of the action that read the value. */
  index: number
  kind: RecordedReadKind
  text: string
  assert?: { source: string; op: string; expected?: string; passed: boolean }
  claim?: string
  mode?: string
}

export interface CarriedLine {
  stepNumber: number
  actionIndex: number
  text: string
}

export interface VerifierStepRecord {
  startScreen: ScreenState
  actions: RecordedAction[]
  reads: RecordedRead[]
  carried: CarriedLine[]
}

export interface RenderedStepRecord {
  actions: string
  operationEvidence: string
  reads: string
  carried: string
}

export const RECORD_ACTION_LINE_CAP = 40
export const RECORD_LINE_CHAR_CAP = 300
export const RECORD_LIST_CAP = 50
const RECORD_HEAD_ACTIONS = 5

export class StepRecordAccumulator {
  private startScreen: ScreenState | undefined
  private readonly actions: RecordedAction[] = []
  private readonly reads: RecordedRead[] = []
  private readonly carried: CarriedLine[] = []

  /** Keeps the first settled observation of the step; later calls are ignored. */
  start(screen: ScreenState): void {
    if (this.startScreen === undefined) this.startScreen = screen
  }

  addAction(entry: Omit<RecordedAction, 'index'>): number {
    const index = this.actions.length + 1
    this.actions.push({ index, ...entry })
    return index
  }

  /** A read belongs to the action about to be recorded. */
  addRead(entry: Omit<RecordedRead, 'index'>): void {
    this.reads.push({ index: this.actions.length + 1, ...entry })
  }

  addCarried(line: CarriedLine): void {
    this.carried.push(line)
  }

  snapshot(): VerifierStepRecord {
    if (this.startScreen === undefined) throw new Error('The step record has no start screen')
    return {
      startScreen: this.startScreen,
      actions: [...this.actions],
      reads: [...this.reads],
      carried: [...this.carried],
    }
  }
}

function capLine(line: string): string {
  return line.length > RECORD_LINE_CHAR_CAP ? `${line.slice(0, RECORD_LINE_CHAR_CAP - 1)}…` : line
}

function capList(lines: string[], noun: string): string[] {
  if (lines.length <= RECORD_LIST_CAP) return lines
  const omitted = lines.length - RECORD_LIST_CAP
  return [...lines.slice(0, RECORD_LIST_CAP), `… ${omitted} more ${noun} omitted …`]
}

function actionLine(entry: RecordedAction): string {
  const error = entry.error !== undefined && entry.error.length > 0 ? `: ${entry.error}` : ''
  const element = entry.element ? ` (${entry.element.role} "${entry.element.name}")` : ''
  const description = `${verifierActionDescription(entry.action)}${element}`
  return capLine(`${entry.index}. ${description} → ${entry.outcome}${error}`)
}

function fieldOf(action: Action): string {
  return 'ref' in action && typeof action.ref === 'string' && action.ref.length > 0
    ? ` on ref="${action.ref}"`
    : ''
}

// D-03 sees every fill verdict: an entry the notable renderer skips still gets a plain line.
function inputLines(entry: InputEvidence, action: Action): string[] {
  const notable = renderInputEvidence(entry)
  if (notable !== undefined) return notable.split('\n')
  const parts = [`input ${entry.inputSent ? 'sent' : 'not sent'}`]
  if (entry.fillVerdict !== undefined) parts.push(`fill verdict ${entry.fillVerdict}`)
  if (entry.submit !== undefined) parts.push(`Enter ${entry.submit}`)
  return [`${entry.verb}${fieldOf(action)}: ${parts.join(', ')}`]
}

function evidenceLines(entry: RecordedAction): string[] {
  const evidence = entry.operationEvidence
  if (evidence === undefined) return []
  const lines: string[] = []
  for (const download of evidence.downloads ?? []) {
    lines.push(renderOperationEvidence({ downloads: [download] }))
  }
  for (const write of evidence.clipboard ?? []) {
    lines.push(renderOperationEvidence({ clipboard: [write] }))
  }
  for (const input of evidence.input ?? []) lines.push(...inputLines(input, entry.action))
  return lines.map((line) => capLine(`action ${entry.index}: ${line}`))
}

function actionLines(actions: RecordedAction[]): string[] {
  if (actions.length <= RECORD_ACTION_LINE_CAP) return actions.map(actionLine)
  const tail = RECORD_ACTION_LINE_CAP - RECORD_HEAD_ACTIONS
  const omitted = actions.length - RECORD_ACTION_LINE_CAP
  return [
    ...actions.slice(0, RECORD_HEAD_ACTIONS).map(actionLine),
    `… ${omitted} actions omitted …`,
    ...actions.slice(actions.length - tail).map(actionLine),
  ]
}

/** The record as the verifier turn and the citation sources show it, one string per part. */
export function renderStepRecord(record: VerifierStepRecord): RenderedStepRecord {
  const evidence = record.actions.flatMap(evidenceLines)
  const reads = record.reads.map((read) => capLine(`read ${read.index}: ${read.kind} ${read.text}`))
  const carried = record.carried.map((line) =>
    capLine(`carried from step ${line.stepNumber}, action ${line.actionIndex}: ${line.text}`),
  )
  return {
    actions: actionLines(record.actions).join('\n'),
    operationEvidence: capList(evidence, 'operation evidence lines').join('\n'),
    reads: capList(reads, 'reads').join('\n'),
    carried: capList(carried, 'carried items').join('\n'),
  }
}
