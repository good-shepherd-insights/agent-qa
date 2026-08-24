// Start-time credential resolution for the authed run service (Phase 402 plan 01, D-05 / D-06 ·
// INVK-03).
//
// THIS IS `mcp-token-resolution.ts` WITH TWO CHANGES AND NOTHING ELSE, which is what D-05 means by
// reusing the Phase 396 idiom WHOLESALE. Everything load-bearing is carried over unaltered: the
// dereference happens once, at start, in the composition layer — because reading `process.env` is
// a HOST capability and the whole refs-only law would be theatre if a DTO or an op could reach an
// environment; a declared variable that is unset REFUSES STARTUP naming the VARIABLE and never a
// value; values are compared in exactly one place, in constant time over hashed inputs; every
// declared entry is compared even after a match so the comparison count does not depend on WHICH
// entry matched; and the values leave this module by exactly one door, into the run masker.
//
// THE TWO CHANGES:
//
//   1. AN ENTRY GRANTS A TRUST SCOPE, NOT A FUNCTION SCOPE SET (D-06). The remote door's capability
//      is FIXED at composition — exactly what starting a run and streaming its events needs, least
//      privilege by construction, with nothing an operator can misdeclare. What varies per holder
//      is whose project or org they act for, which is the v48 `TrustScope` the policy gate reads.
//      One credential family: the access token IS the `TrustCredential`.
//   2. THERE IS NO NO-CREDENTIAL ARM. `matchBearer` answers a request with no `Authorization`
//      header by handing it the local default grant; that is a LOCAL posture for a door a person
//      is already sitting in front of. This door is the REMOTE one, so an absent header is a
//      REFUSAL — `missing_authorization` — exactly like a wrong value. The verdict type has two
//      arms and no third, so the permissive answer is unrepresentable rather than merely undone,
//      and no careless `??` can produce one.
//
// TOKEN VALUES ARE NOT LOGGED, NOT ECHOED, NOT INTERPOLATED INTO ANY MESSAGE AND NOT ATTACHED TO
// ANY ERROR. `RunServiceTokenEnvVarUnsetError` deliberately takes two named fields rather than a
// free-form message somebody could later interpolate a resolved value into, and deliberately
// attaches no `cause`: 395-16 measured that Node's default uncaught printer walks the cause chain
// with `util.inspect`, which is how a config file's contents once reached a person's terminal.

import { createHash, timingSafeEqual } from 'node:crypto'

import type {
  RunServiceTokenEntry,
  ServiceBearerVerdict,
  TrustScope,
} from '@vostride/agent-qa-schema'

/**
 * A declared run-service credential whose environment variable is not set (D-05).
 *
 * NAMES THE VARIABLE AND THE ENTRY LABEL, AND NOTHING ELSE. There is no value to name — that is
 * the point of the class. See the module header for why there is no `cause`.
 */
export class RunServiceTokenEnvVarUnsetError extends Error {
  constructor(
    readonly entryName: string,
    readonly tokenEnvVar: string,
  ) {
    super(
      `Run service token "${entryName}" declares tokenEnvVar ${tokenEnvVar}, which is not set in `
      + `this process's environment. Set ${tokenEnvVar} or remove the entry from `
      + 'services.dashboard.runServiceTokens.',
    )
    this.name = 'RunServiceTokenEnvVarUnsetError'
  }
}

/** One declared entry, with its variable dereferenced. */
export interface ResolvedRunServiceToken {
  /** The operator's label. Not a secret, and not matched against anything a caller sends. */
  readonly name: string
  /** The variable the value came from — carried so a diagnostic can name it without the value. */
  readonly tokenEnvVar: string
  /** The credential. Read by `matchServiceBearer` and by the secret store; by nothing else. */
  readonly value: string
  /** What the holder acts for, handed to the policy gate as `TrustCredential.scope`. */
  readonly trustScope: TrustScope
}

/**
 * Dereference every declared entry, once, at start (D-05).
 *
 * An empty or whitespace-only value counts as UNSET. `FOO=` in a shell is what an operator writes
 * when they meant to set something and the substitution came back empty, and treating it as a
 * present credential would mint a token that matches an empty `Authorization: Bearer ` — the one
 * value an attacker does not have to guess.
 */
export function resolveRunServiceTokens(
  entries: readonly RunServiceTokenEntry[],
  env: NodeJS.ProcessEnv,
): readonly ResolvedRunServiceToken[] {
  return entries.map((entry) => {
    const value = env[entry.tokenEnvVar]
    if (value === undefined || value.trim() === '') {
      throw new RunServiceTokenEnvVarUnsetError(entry.name, entry.tokenEnvVar)
    }
    return {
      name: entry.name,
      tokenEnvVar: entry.tokenEnvVar,
      value,
      trustScope: Object.freeze({ ...entry.trustScope }),
    }
  })
}

/**
 * Constant-time equality over two secrets of possibly different lengths.
 *
 * The constant-time primitive THROWS on a length mismatch, so a bare call would turn every wrong-length
 * token into a 500 and would leak the declared token's length through the difference. Hashing both
 * sides to a fixed width first is the standard answer: the comparison is then always over 32 equal
 * bytes, and what an attacker can time is a comparison of digests.
 *
 * THE ONE COMPARE SITE FOR THIS DOOR. `matchServiceBearer` below is its only caller, and nothing
 * else in this package compares a run-service credential.
 */
function secretEquals(presented: string, declared: string): boolean {
  const a = sha256(presented)
  const b = sha256(declared)
  return timingSafeEqual(a, b)
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Resolve a request's `Authorization` header to a verdict (D-06).
 *
 * ABSENT header -> REFUSED, `missing_authorization`. This is the whole of the second change from
 * the MCP idiom, and it is why the return type has two arms: on the remote door there is no caller
 * this process can see well enough to hand a grant to for free.
 *
 * PRESENT header -> it must parse as `Bearer <value>` (the scheme is compared case-insensitively,
 * per RFC 7235) and the value must match a declared entry. Anything else is `refused`. Every
 * declared entry is compared even after a match, so the number of comparisons does not depend on
 * WHICH entry matched.
 *
 * A ZERO-ENTRY LIST REFUSES EVERYTHING, which is the honest reading of "this process holds no
 * credential": there is no value a caller could present that matches, so every request is
 * `invalid_token`. A door mounted with no tokens is a door nobody can open, not a door left ajar.
 *
 * HEADER-ONLY CARRIAGE. There is no query-parameter fallback, and there must never be one: a URL
 * is written to access logs, proxy logs and browser history, so a token carried there is a token
 * published. Browser `EventSource` cannot set an `Authorization` header, which is exactly why this
 * door's clients are `curl`, `fetch` and CI rather than a bare `EventSource` (RESEARCH A1).
 */
export function matchServiceBearer(
  header: string | null | undefined,
  tokens: readonly ResolvedRunServiceToken[],
): ServiceBearerVerdict {
  if (header === undefined || header === null || header.trim() === '') {
    return { kind: 'refused', reason: 'missing_authorization' }
  }

  const match = /^bearer[ \t]+(\S.*)$/i.exec(header.trim())
  if (match === null) {
    return { kind: 'refused', reason: 'malformed_authorization' }
  }
  const presented = match[1]!.trim()

  let hit: ResolvedRunServiceToken | undefined
  for (const token of tokens) {
    if (secretEquals(presented, token.value)) hit = token
  }
  if (hit === undefined) {
    return { kind: 'refused', reason: 'invalid_token' }
  }
  return { kind: 'token', clientId: hit.name, trustScope: hit.trustScope }
}

/**
 * The resolved token values, shaped as the run masker's own secret-store port.
 *
 * WHY THIS EXISTS RATHER THAN TRUSTING THE ENV SLICE. The run masker is seeded from
 * `sensitiveEnvSlice`, which selects environment variables BY NAME SUFFIX — `…_TOKEN`, `…_KEY` and
 * kin. An operator is free to point `tokenEnvVar` at `MY_RUN_CRED`, and that name matches no
 * suffix, so the one credential this door is definitionally holding would be the one credential
 * the masker did not know about. The host knows these names by declaration, so it seeds them by
 * declaration.
 *
 * This is the ONLY door a token value leaves this module through, and what is on the other side of
 * it is a function that replaces the value with a mask.
 */
export function runServiceTokenSecretStore(tokens: readonly ResolvedRunServiceToken[]): {
  forEachSecret(cb: (name: string, value: string) => void): void
} {
  return {
    forEachSecret(cb) {
      for (const token of tokens) cb(token.tokenEnvVar, token.value)
    },
  }
}
