// The NAME signals the risk classifier reads (D-05). Eval's side-effect scoring classifies through
// them (`eval/src/match/risk.ts`), so they stay.
//
// 2026-10-01 (432-19, D-16): the command-string pattern list is deleted. No production descriptor
// carries a command (`projectRiskAction` omits it), so the list only ever matched test fixtures and
// enforced nothing.

export const SOFT_DESTRUCTIVE_VERBS: ReadonlySet<string> = new Set([
  'delete',
  'drop',
  'truncate',
  'remove',
  'purge',
  'destroy',
  'wipe',
  'deploy',
  'submit-payment',
  'submitpayment',
  'revoke',
  'teardown',
  'reset',
])

export const HARD_NAME_VERBS: ReadonlySet<string> = new Set([
  'sudo',
  'dd',
  'kill',
  'killall',
  'mkfs',
  'shutdown',
  'reboot',
])

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean)
}

/** D-02: match action name tokens only. */
export function matchLexicon(name: string): 'hard' | 'soft' | undefined {
  const nameTokens = tokens(name)
  if (nameTokens.some((token) => HARD_NAME_VERBS.has(token))) return 'hard'
  if (nameTokens.some((token) => SOFT_DESTRUCTIVE_VERBS.has(token))) return 'soft'
  return undefined
}
