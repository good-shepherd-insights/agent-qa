// Module-private first-party capability token (HOOK-03, D-03).
//
// The threat is arbitrary in-process JavaScript attempting to attach hooks to
// the safety seam. Hooks run in-process with full access, so a compile-time-only
// TypeScript brand is defeatable in JS — the gate must be a runtime identity
// check against a Symbol created here and NEVER re-exported from the package
// barrel (src/index.ts). An unexported Symbol is unreachable to external code,
// and a forged Symbol('agent-qa-safety-first-party') has a distinct identity, so
// `capability === FIRST_PARTY` holds only for the genuine first-party registrar.
export const FIRST_PARTY: unique symbol = Symbol('agent-qa-safety-first-party')

export class FirstPartyHookError extends Error {
  constructor(
    message = 'Third-party hooks are rejected at registration: hooks run in-process with full access. First-party only until the M7 container sandbox (HOOK-03).',
  ) {
    super(message)
    this.name = 'FirstPartyHookError'
  }
}
