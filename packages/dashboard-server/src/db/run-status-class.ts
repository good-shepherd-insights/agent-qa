export const RUN_STATUS_WORDS = [
  'pending',
  'running',
  'passed',
  'healed',
  'failed',
  'timeout',
  'cancelled',
] as const

export type RunStatusWord = (typeof RUN_STATUS_WORDS)[number]

export type RunStatusClass = 'pass' | 'fail' | 'cancelled' | 'live'

const CLASS_OF: Record<RunStatusWord, RunStatusClass> = {
  pending: 'live',
  running: 'live',
  passed: 'pass',
  healed: 'pass',
  failed: 'fail',
  timeout: 'fail',
  cancelled: 'cancelled',
}

export function isRunStatusWord(word: string): word is RunStatusWord {
  return Object.hasOwn(CLASS_OF, word)
}

export function runStatusClass(status: string): RunStatusClass {
  if (!isRunStatusWord(status)) throw new Error(`runStatusClass: unknown run status "${status}"`)
  return CLASS_OF[status]
}

// 2026-10-17 (444-05, D-35): a member outcome is a run word or `skipped`; a member with none is live.
// 2026-10-18 (444-27, D-62 IN-05): run_members.outcome has no CHECK, so any other word is
// unclassified (`undefined`) and every reader skips it; runs.status has one, so runStatusClass throws.
export function memberOutcomeClass(outcome: string | null): RunStatusClass | 'skipped' | undefined {
  if (outcome === null) return 'live'
  if (outcome === 'skipped') return 'skipped'
  if (isRunStatusWord(outcome)) return runStatusClass(outcome)
  return undefined
}
