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

export const HARD_DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /\bsudo\b/,
  /\bdd\b/,
  /\bkill(all)?\b/,
  /\bmkfs\b/,
  /\bmkfs\.[a-z0-9]+\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\brm\s+-[a-z]*r[a-z]*f[a-z]*\b/,
  /\bchmod\s+777\b/,
]

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

/** D-02: match action name tokens plus explicit command only. */
export function matchLexicon(name: string, command?: string): 'hard' | 'soft' | undefined {
  const nameTokens = tokens(name)
  if (nameTokens.some((token) => HARD_NAME_VERBS.has(token))) return 'hard'
  if (command !== undefined && HARD_DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command))) {
    return 'hard'
  }

  const commandTokens = command === undefined ? [] : tokens(command)
  if (
    nameTokens.some((token) => SOFT_DESTRUCTIVE_VERBS.has(token)) ||
    commandTokens.some((token) => SOFT_DESTRUCTIVE_VERBS.has(token))
  ) {
    return 'soft'
  }

  return undefined
}
