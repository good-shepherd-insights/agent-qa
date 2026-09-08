// The MCP credential mechanics (Phase 396 plan 05, D-06 / D-07 · MCPS-04).
//
// WHAT THESE CELLS ARE FOR. Every one of them is written against the direction a mistake would
// actually take. The default grant is asserted as a RELATION to the closed scope union rather than
// as five names, because a literal here would agree with a literal in the implementation and the
// pair would be one opinion spelled twice. The unmatched-bearer cell asserts what the verdict is
// NOT, because the failure this whole seam exists to forbid is a wrong credential quietly becoming
// an anonymous success. The startup refusal is asserted on both sides of the refs-only law: it
// must name the variable, and it must not carry the value.
//
// THE PLANTED CREDENTIAL IS A LITERAL WITH NO SUFFIX A MASKER RECOGNISES. `sensitiveEnvSlice`
// selects environment variables by NAME SUFFIX, so a probe variable called `PROBE_API_TOKEN` would
// be masked by machinery that has nothing to do with this module and the cell would pass for the
// wrong reason. `AGENT_QA_396_MCP_CRED` matches no suffix; if a value reaches a message, this
// suite sees it.

import { describe, expect, it } from 'vitest'
import { McpTokenEntrySchema, FunctionScopeSchema, STANDING_APPROVAL_SCOPE } from '@vostride/agent-qa-schema'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'

import {
  DEFAULT_MCP_SCOPES,
  credentialForBearer,
  matchBearer,
  mcpTokenSecretStore,
  McpTokenEnvVarUnsetError,
  resolveMcpTokens,
  resolveStdioScopes,
} from '../composition/mcp-token-resolution.js'

/** The value that must never appear in any message, header or body this suite can reach. */
const PLANTED = 'zz-396-05-planted-credential-4f1c9a'
const PLANTED_VAR = 'AGENT_QA_396_MCP_CRED'

describe('419 declared bearer credentials', () => {
  it('mints exactly the standing scope for a declared knowledge writer, regardless of label', () => {
    expect(credentialForBearer({ kind: 'token', clientId: 'anonymous', scopes: ['knowledge-write'] }))
      .toEqual({ scope: STANDING_APPROVAL_SCOPE })
  })
  it('mints nothing for anonymous defaults, readers or rejected credentials', () => {
    expect(DEFAULT_MCP_SCOPES).toContain('knowledge-write')
    expect(credentialForBearer({ kind: 'anonymous', scopes: DEFAULT_MCP_SCOPES })).toBeUndefined()
    expect(credentialForBearer({ kind: 'token', clientId: 'reader', scopes: ['read'] })).toBeUndefined()
    expect(credentialForBearer({ kind: 'refused', reason: 'invalid_token' })).toBeUndefined()
    expect(credentialForBearer({ kind: 'refused', reason: 'malformed_authorization' })).toBeUndefined()
  })
})

describe('the D-07 default grant is derived, not restated', () => {
  it('is the closed scope union minus exactly config-write', () => {
    // The relation, not the list: this cell keeps holding the day 397 mints a seventh scope, and
    // it reds the day somebody adds a second exclusion without saying so.
    const all = FunctionScopeSchema.options
    expect([...DEFAULT_MCP_SCOPES].sort()).toEqual(
      all.filter((scope) => scope !== 'config-write').sort(),
    )
    expect(DEFAULT_MCP_SCOPES).not.toContain('config-write')
    expect(DEFAULT_MCP_SCOPES).toHaveLength(all.length - 1)
  })

  it('carries every other member of the union, one at a time', () => {
    // Asserted member by member rather than by length alone, because a set of the right SIZE that
    // omits `run` and includes `config-write` would satisfy a count.
    for (const scope of FunctionScopeSchema.options) {
      if (scope === 'config-write') continue
      expect(DEFAULT_MCP_SCOPES, `default grant is missing ${scope}`).toContain(scope)
    }
  })
})

describe('the token entry vocabulary speaks names, never values (D-06 refs-only)', () => {
  it('accepts an entry declaring an env-var NAME and a scope set', () => {
    const parsed = McpTokenEntrySchema.parse({
      name: 'ci',
      tokenEnvVar: PLANTED_VAR,
      scopes: ['read', 'run'],
    })
    expect(parsed.tokenEnvVar).toBe(PLANTED_VAR)
  })

  it('REFUSES an entry that carries a token value beside the reference', () => {
    // The other side of the same line. `.strict()` is the mechanism, and this is the input it
    // exists for: somebody who found the indirection inconvenient and wrote the secret down.
    const refused = McpTokenEntrySchema.safeParse({
      name: 'ci',
      tokenEnvVar: PLANTED_VAR,
      token: PLANTED,
      scopes: ['read'],
    })
    expect(refused.success).toBe(false)
  })

  it('refuses an entry with no scopes at all', () => {
    expect(
      McpTokenEntrySchema.safeParse({ name: 'ci', tokenEnvVar: PLANTED_VAR, scopes: [] }).success,
    ).toBe(false)
  })

  it('refuses a scope the closed union does not declare', () => {
    expect(
      McpTokenEntrySchema.safeParse({
        name: 'ci',
        tokenEnvVar: PLANTED_VAR,
        scopes: ['everything'],
      }).success,
    ).toBe(false)
  })
})

describe('the config block lands on services.mcp and defaults safely', () => {
  const base = {
    workspace: {
      testMatch: ['tests/**/*.yaml'],
      testPathIgnore: [],
      suiteMatch: ['suites/**/*.suite.yaml'],
      hooksFile: 'hooks.yaml',
      envFile: '.env',
      secretsFile: '.env.secrets.local',
    },
    use: { mobile: { appState: 'preserve' } },
  }

  it('materialises an empty token list and a false stdio grant when nothing is declared', () => {
    const parsed = AgentQaConfigSchema.parse({ ...base, services: { mcp: {} } })
    expect(parsed.services?.mcp?.tokens).toEqual([])
    // `.prefault({})` and not `.default({})` — the inner default has to actually run.
    expect(parsed.services?.mcp?.stdio?.grantConfigWrite).toBe(false)
  })

  it('carries declared entries through the whole config parse', () => {
    const parsed = AgentQaConfigSchema.parse({
      ...base,
      services: {
        mcp: {
          tokens: [{ name: 'ci', tokenEnvVar: PLANTED_VAR, scopes: ['read', 'config-write'] }],
          stdio: { grantConfigWrite: true },
        },
      },
    })
    expect(parsed.services?.mcp?.tokens).toHaveLength(1)
    expect(parsed.services?.mcp?.tokens?.[0]?.scopes).toEqual(['read', 'config-write'])
    expect(parsed.services?.mcp?.stdio?.grantConfigWrite).toBe(true)
  })

  it('refuses a token value written into the config file', () => {
    const refused = AgentQaConfigSchema.safeParse({
      ...base,
      services: {
        mcp: { tokens: [{ name: 'ci', tokenEnvVar: PLANTED_VAR, token: PLANTED, scopes: ['read'] }] },
      },
    })
    expect(refused.success).toBe(false)
  })
})

describe('resolveMcpTokens dereferences once, at start (D-06)', () => {
  it('resolves a declared entry against the supplied environment', () => {
    const [resolved] = resolveMcpTokens(
      [{ name: 'ci', tokenEnvVar: PLANTED_VAR, scopes: ['read'] }],
      { [PLANTED_VAR]: PLANTED },
    )
    expect(resolved?.name).toBe('ci')
    expect(resolved?.scopes).toEqual(['read'])
  })

  it('REFUSES startup naming the variable — and the refusal carries no value', () => {
    // Two-sided on the one law this class exists for. A message that named the value would be the
    // T-396-17 leak arriving through the diagnostic written to prevent it.
    let thrown: unknown
    try {
      resolveMcpTokens([{ name: 'ci', tokenEnvVar: PLANTED_VAR, scopes: ['read'] }], {})
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(McpTokenEnvVarUnsetError)
    const message = (thrown as Error).message
    expect(message).toContain(PLANTED_VAR)
    expect(message).toContain('ci')
    expect(message).not.toContain(PLANTED)
    // The cause chain too: Node's default uncaught printer walks it (395-16 · CR-01).
    expect(JSON.stringify((thrown as Error).cause ?? null)).not.toContain(PLANTED)
  })

  it('treats an empty variable as unset', () => {
    // `FOO=` is what a failed substitution leaves behind. Accepting it would mint a credential that
    // matches `Authorization: Bearer ` — the one value nobody has to guess.
    expect(() =>
      resolveMcpTokens([{ name: 'ci', tokenEnvVar: PLANTED_VAR, scopes: ['read'] }], {
        [PLANTED_VAR]: '   ',
      }),
    ).toThrow(McpTokenEnvVarUnsetError)
  })
})

describe('matchBearer answers three ways and never degrades a wrong credential (D-07)', () => {
  const tokens = resolveMcpTokens(
    [
      { name: 'ci', tokenEnvVar: PLANTED_VAR, scopes: ['read', 'config-write'] },
      { name: 'editor', tokenEnvVar: 'AGENT_QA_396_MCP_CRED_B', scopes: ['read'] },
    ],
    { [PLANTED_VAR]: PLANTED, AGENT_QA_396_MCP_CRED_B: 'zz-396-05-second-credential-b7e2' },
  )

  it('ABSENT header -> the D-07 default grant', () => {
    const verdict = matchBearer(undefined, tokens)
    expect(verdict.kind).toBe('anonymous')
    expect(verdict.kind === 'anonymous' && verdict.scopes).toEqual(DEFAULT_MCP_SCOPES)
  })

  it('MATCHED bearer -> exactly that entry\'s scopes, attributed to its label', () => {
    const verdict = matchBearer(`Bearer ${PLANTED}`, tokens)
    expect(verdict.kind).toBe('token')
    expect(verdict.kind === 'token' && verdict.clientId).toBe('ci')
    expect(verdict.kind === 'token' && verdict.scopes).toEqual(['read', 'config-write'])
  })

  it('UNMATCHED bearer -> refused, and specifically NOT the default grant', () => {
    // The prohibited direction, asserted as an absence rather than only as a presence: a verdict
    // that happened to be `anonymous` would carry `scopes` and this cell would see it.
    const verdict = matchBearer('Bearer zz-not-a-declared-credential', tokens)
    expect(verdict.kind).toBe('refused')
    expect(verdict.kind).not.toBe('anonymous')
    expect((verdict as { scopes?: unknown }).scopes).toBeUndefined()
    expect(verdict.kind === 'refused' && verdict.reason).toBe('invalid_token')
  })

  it('MALFORMED header -> refused, never the default grant', () => {
    for (const header of ['Basic abc', 'Bearer', 'Bearer   ', 'nonsense']) {
      const verdict = matchBearer(header, tokens)
      expect(verdict.kind, `header ${JSON.stringify(header)} was not refused`).toBe('refused')
    }
  })

  it('accepts the scheme case-insensitively, per RFC 7235', () => {
    expect(matchBearer(`bearer ${PLANTED}`, tokens).kind).toBe('token')
    expect(matchBearer(`BEARER ${PLANTED}`, tokens).kind).toBe('token')
  })

  it('does not throw on a presented value of a different length than any declared one', () => {
    // The length guard, measured as behaviour rather than read off the source. A bare
    // `timingSafeEqual` over two raw buffers throws `RangeError` here, which would turn every
    // wrong-length credential into a 500 and leak the declared length through the difference.
    for (const presented of ['x', PLANTED.repeat(4), '']) {
      expect(() => matchBearer(`Bearer ${presented}`, tokens)).not.toThrow()
    }
  })

  it('with NO declared tokens, a presented credential is still refused', () => {
    // The empty-token-list posture: absence of declared credentials is not a reason to honour an
    // undeclared one. Absent header still gets the default grant.
    expect(matchBearer(`Bearer ${PLANTED}`, []).kind).toBe('refused')
    expect(matchBearer(undefined, []).kind).toBe('anonymous')
  })
})

describe('the stdio grant is an opt-in that flips exactly one scope (D-07)', () => {
  it('withholds config-write by default', () => {
    expect(resolveStdioScopes(false)).toEqual(DEFAULT_MCP_SCOPES)
    expect(resolveStdioScopes(false)).not.toContain('config-write')
  })

  it('adds config-write and nothing else when the config opts in', () => {
    const granted = resolveStdioScopes(true)
    expect(granted).toContain('config-write')
    // Both sides: the opt-in adds one member and removes none.
    expect([...granted].sort()).toEqual([...FunctionScopeSchema.options].sort())
    expect(granted).toHaveLength(DEFAULT_MCP_SCOPES.length + 1)
  })
})

describe('the resolved values reach the masker by declaration, not by luck', () => {
  it('offers every declared variable name and its value to a secret store consumer', () => {
    // The name has no suffix `sensitiveEnvSlice` recognises, which is exactly why this door has to
    // exist: without it the one credential this host definitionally holds is the one the run
    // masker does not know about.
    const tokens = resolveMcpTokens([{ name: 'ci', tokenEnvVar: PLANTED_VAR, scopes: ['read'] }], {
      [PLANTED_VAR]: PLANTED,
    })
    const seen: Array<[string, string]> = []
    mcpTokenSecretStore(tokens).forEachSecret((name, value) => seen.push([name, value]))
    expect(seen).toEqual([[PLANTED_VAR, PLANTED]])
  })
})
