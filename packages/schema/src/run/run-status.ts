export type RunStatus = 'passed' | 'failed' | 'healed' | 'timeout' | 'cancelled'

export type ExecutionContext = 'local-interactive' | 'local-headless' | 'ci' | 'cloud'

/**
 * The execution-context vocabulary as a VALUE, so more than one zod schema can enumerate it
 * without each keeping its own copy (393: the analyze-run payload mirror is the second reader).
 * Spelled once, beside the type it closes over, per the one-exported-vocabulary rule.
 */
export const EXECUTION_CONTEXT_VALUES = [
  'local-interactive',
  'local-headless',
  'ci',
  'cloud',
] as const satisfies readonly ExecutionContext[]
