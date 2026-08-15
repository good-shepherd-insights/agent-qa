// Start-time credential resolution for the MCP host (Phase 396 plan 05, D-06 / D-07 · MCPS-04).
//
// WHY THIS FILE EXISTS, AND WHY IT IS IN THE HOST. Reading `process.env` is a HOST capability. The
// schema declares a token by env-var NAME and the function layer declares what a scope means;
// neither of them may touch an environment, and the whole refs-only law would be theatre if the
// dereference happened anywhere a DTO or an op could reach. So the one place a declared name
// becomes a value is here, in the composition layer, once, at start.
//
// THREE THINGS HAPPEN HERE AND NOTHING ELSE HAPPENS ANYWHERE:
//
//   1. `DEFAULT_MCP_SCOPES` — D-07's default grant, DERIVED from the closed scope union by
//      excluding `config-write`. Never a literal list. A scope minted tomorrow reaches this host
//      by default and the diff that mints it is the diff that decides; a literal would silently
//      withhold it by an omission nobody reviewed.
//   2. `resolveMcpTokens` — each declared entry's variable is read ONCE. A declared variable that
//      is unset REFUSES STARTUP, naming the VARIABLE and never a value. The refusal is loud
//      because the quiet alternative is a server that starts with a credential nobody can present,
//      which reads to an operator exactly like a server that is rejecting their token.
//   3. `matchBearer` — the header verdict. Three answers and no fourth: the declared entry's
//      scopes on a match, the D-07 default set when NO credential was presented, and a REFUSAL
//      when one was presented and did not match. That third answer is the one worth naming: a
//      wrong credential must never degrade to anonymous success. Degrading it would make the
//      default grant reachable by presenting garbage, which is a strictly worse posture than
//      having no tokens at all — the operator who declared a token believes they narrowed the
//      surface, and instead they widened it for anybody who typos.
//
// TOKEN VALUES ARE COMPARED IN EXACTLY ONE PLACE, with `timingSafeEqual` over a length guard, and
// they leave this module by exactly one door — `mcpTokenSecretStore`, which hands them to the run
// masker so every other channel in the process can only print them masked. They are not logged,
// not echoed, not interpolated into any message, and not attached to any error.

import { createHash, timingSafeEqual } from 'node:crypto'

import { FunctionScopeSchema } from '@vostride/agent-qa-schema'
import type { FunctionScope, McpTokenEntry } from '@vostride/agent-qa-schema'

/**
 * What an unauthenticated local caller may do (D-07).
 *
 * DERIVED BY EXCLUSION from the scope enum — see the file header. `config-write` is the one
 * exclusion because configuration is where irreversibility lives: the propose+apply workflow still
 * works out of the box (proposals commit nothing), and committing a config change needs a grant
 * this host does not hand itself.
 */
export const DEFAULT_MCP_SCOPES: readonly FunctionScope[] = Object.freeze(
  FunctionScopeSchema.options.filter((scope) => scope !== 'config-write'),
)

/**
 * A declared token whose environment variable is not set (D-06).
 *
 * NAMES THE VARIABLE AND THE ENTRY LABEL, AND NOTHING ELSE. There is no value to name — that is
 * the point of the class, and the reason it takes the two fields it takes rather than a free-form
 * message somebody could later interpolate a resolved token into. `cause` is deliberately not
 * attached: 395-16 measured that Node's default uncaught printer walks the cause chain with
 * `util.inspect`, which is how a config file's contents once reached a person's terminal.
 */
export class McpTokenEnvVarUnsetError extends Error {
  constructor(
    readonly entryName: string,
    readonly tokenEnvVar: string,
  ) {
    super(
      `MCP token "${entryName}" declares tokenEnvVar ${tokenEnvVar}, which is not set in this `
      + `process's environment. Set ${tokenEnvVar} or remove the entry from services.mcp.tokens.`,
    )
    this.name = 'McpTokenEnvVarUnsetError'
  }
}

/** One declared entry, with its variable dereferenced. */
export interface ResolvedMcpToken {
  /** The operator's label. Not a secret, and not matched against anything a caller sends. */
  readonly name: string
  /** The variable the value came from — carried so a diagnostic can name it without the value. */
  readonly tokenEnvVar: string
  /** The credential. Read by `matchBearer` and by `mcpTokenSecretStore`; by nothing else. */
  readonly value: string
  readonly scopes: readonly FunctionScope[]
}

/**
 * Dereference every declared entry, once, at start (D-06).
 *
 * An empty or whitespace-only value counts as UNSET. `FOO=` in a shell is what an operator writes
 * when they meant to set something and the substitution came back empty, and treating it as a
 * present credential would mint a token that matches an empty `Authorization: Bearer ` — the one
 * value an attacker does not have to guess.
 */
export function resolveMcpTokens(
  entries: readonly McpTokenEntry[],
  env: NodeJS.ProcessEnv,
): readonly ResolvedMcpToken[] {
  return entries.map((entry) => {
    const value = env[entry.tokenEnvVar]
    if (value === undefined || value.trim() === '') {
      throw new McpTokenEnvVarUnsetError(entry.name, entry.tokenEnvVar)
    }
    return {
      name: entry.name,
      tokenEnvVar: entry.tokenEnvVar,
      value,
      scopes: Object.freeze([...entry.scopes]),
    }
  })
}

/**
 * The verdict on one request's `Authorization` header.
 *
 * A discriminated union rather than `scopes | undefined`, because the caller of this function has
 * to answer three different HTTP questions and `undefined` collapses two of them: "nobody
 * presented anything, serve the default grant" and "somebody presented something wrong, answer
 * 401" are opposite outcomes, and a shape that cannot tell them apart is a shape in which the
 * prohibited degradation is one careless `??` away.
 */
export type BearerVerdict =
  | { readonly kind: 'anonymous'; readonly scopes: readonly FunctionScope[] }
  | { readonly kind: 'token'; readonly clientId: string; readonly scopes: readonly FunctionScope[] }
  | { readonly kind: 'refused'; readonly reason: 'malformed_authorization' | 'invalid_token' }

/**
 * Constant-time equality over two secrets of possibly different lengths.
 *
 * `timingSafeEqual` THROWS on a length mismatch, so a bare call would turn every wrong-length
 * token into a 500 and would leak the declared token's length through the difference. Hashing both
 * sides to a fixed width first is the standard answer: the comparison is then always over 32 equal
 * bytes, and what an attacker can time is a comparison of digests.
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
 * Resolve a request's `Authorization` header to a scope set (D-06 / D-07).
 *
 * ABSENT header -> the D-07 default grant. This is the local, unauthenticated caller the decision
 * is written for, and it is the reason the whole propose+apply workflow works with no setup.
 *
 * PRESENT header -> it must parse as `Bearer <value>` (the scheme is compared case-insensitively,
 * per RFC 7235) and the value must match a declared entry. Anything else is `refused`. Every
 * declared entry is compared even after a match, so the number of comparisons does not depend on
 * WHICH entry matched.
 */
export function matchBearer(
  header: string | null | undefined,
  tokens: readonly ResolvedMcpToken[],
): BearerVerdict {
  if (header === undefined || header === null || header.trim() === '') {
    return { kind: 'anonymous', scopes: DEFAULT_MCP_SCOPES }
  }

  const match = /^bearer[ \t]+(\S.*)$/i.exec(header.trim())
  if (match === null) {
    return { kind: 'refused', reason: 'malformed_authorization' }
  }
  const presented = match[1]!.trim()

  let hit: ResolvedMcpToken | undefined
  for (const token of tokens) {
    if (secretEquals(presented, token.value)) hit = token
  }
  if (hit === undefined) {
    return { kind: 'refused', reason: 'invalid_token' }
  }
  return { kind: 'token', clientId: hit.name, scopes: hit.scopes }
}

/**
 * What a stdio caller may do (D-07's second half).
 *
 * `DEFAULT_MCP_SCOPES` plus `config-write` only when the config block says so. Built by ADDING to
 * the derived set rather than by filtering a second time, so the two grants can never drift on any
 * scope other than the one this function exists to decide.
 */
export function resolveStdioScopes(grantConfigWrite: boolean): readonly FunctionScope[] {
  if (!grantConfigWrite) return DEFAULT_MCP_SCOPES
  return Object.freeze([...DEFAULT_MCP_SCOPES, 'config-write' as const])
}

/**
 * The resolved token values, shaped as the run masker's own secret-store port.
 *
 * WHY THIS EXISTS RATHER THAN TRUSTING THE ENV SLICE. The run masker is seeded from
 * `sensitiveEnvSlice`, which selects environment variables BY NAME SUFFIX — `…_TOKEN`, `…_KEY`
 * and kin. An operator is free to point `tokenEnvVar` at `MY_MCP_CRED`, and that name matches no
 * suffix, so the one credential this host is definitionally holding would be the one credential
 * the masker did not know about. The host knows these names by declaration, so it seeds them by
 * declaration. 395-04's sibling-input law, one directory over: the values a surface hides and the
 * values a run hides must be one set by construction.
 *
 * This is the ONLY door a token value leaves this module through, and what is on the other side of
 * it is a function that replaces the value with a mask.
 */
export function mcpTokenSecretStore(tokens: readonly ResolvedMcpToken[]): {
  forEachSecret(cb: (name: string, value: string) => void): void
} {
  return {
    forEachSecret(cb) {
      for (const token of tokens) cb(token.tokenEnvVar, token.value)
    },
  }
}
