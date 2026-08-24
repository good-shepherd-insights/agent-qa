// The run service's credential mechanics (Phase 402 plan 01, D-05 / D-06 · INVK-03).
//
// WHAT THESE CELLS ARE FOR. Each is written against the direction a mistake would actually take.
// The no-header cell asserts what the verdict is NOT — a permissive answer — because deleting the
// MCP door's no-credential arm is the whole of D-06 and a regression there is a silent widening,
// not a visible break. The startup refusal is asserted on BOTH sides of the refs-only law: it must
// name the variable, and it must not carry the value. The unmatched-scan cell asserts the compare
// count is independent of match position, which is the property that makes the constant-time
// compare mean anything at all.
//
// THE PLANTED CREDENTIAL IS A LITERAL WITH NO SUFFIX A MASKER RECOGNISES. `sensitiveEnvSlice`
// selects environment variables by NAME SUFFIX, so a probe variable called `PROBE_API_TOKEN` would
// be masked by machinery that has nothing to do with this module and a leak cell would pass for
// the wrong reason. `AGENT_QA_402_RUN_CRED` matches no suffix; if a value reaches a message, this
// suite sees it.

import { describe, expect, it } from 'vitest'
import { RunServiceTokenEntrySchema } from '@vostride/agent-qa-schema'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'

import {
  matchServiceBearer,
  resolveRunServiceTokens,
  RunServiceTokenEnvVarUnsetError,
  runServiceTokenSecretStore,
  type ResolvedRunServiceToken,
} from '../composition/run-service-token-resolution.js'

/** The value that must never appear in any message this suite can reach. */
const PLANTED = 'zz-402-01-planted-run-credential-8b3e17'
const PLANTED_VAR = 'AGENT_QA_402_RUN_CRED'

const entry = (name: string, tokenEnvVar: string, project?: string) =>
  RunServiceTokenEntrySchema.parse({
    name,
    tokenEnvVar,
    trustScope: project === undefined ? {} : { project },
  })

const resolved = (name: string, value: string, project?: string): ResolvedRunServiceToken => ({
  name,
  tokenEnvVar: `${name.toUpperCase()}_VAR`,
  value,
  trustScope: project === undefined ? {} : { project },
})

describe('start-time resolution refuses an unset declaration by NAME', () => {
  it('throws the named error and names the variable', () => {
    expect(() => resolveRunServiceTokens([entry('ci', PLANTED_VAR)], {}))
      .toThrow(RunServiceTokenEnvVarUnsetError)
    try {
      resolveRunServiceTokens([entry('ci', PLANTED_VAR)], {})
      expect.unreachable('an unset declaration must refuse')
    } catch (error) {
      expect(error).toBeInstanceOf(RunServiceTokenEnvVarUnsetError)
      expect((error as Error).message).toContain(PLANTED_VAR)
      expect((error as Error).message).toContain('ci')
      // The other half of the refs-only law: no value, and no cause chain a printer could walk.
      expect((error as Error).message).not.toContain(PLANTED)
      expect((error as { cause?: unknown }).cause).toBeUndefined()
    }
  })

  it('treats an EMPTY or whitespace-only value as unset', () => {
    // `FOO=` is what an operator writes when a substitution came back empty; accepting it would
    // mint a credential matching `Authorization: Bearer `, the one value nobody has to guess.
    for (const value of ['', '   ', '\t']) {
      expect(() => resolveRunServiceTokens([entry('ci', PLANTED_VAR)], { [PLANTED_VAR]: value }))
        .toThrow(RunServiceTokenEnvVarUnsetError)
    }
  })

  it('dereferences a set variable exactly once, carrying the declared trust scope', () => {
    const tokens = resolveRunServiceTokens(
      [entry('ci', PLANTED_VAR, 'acme')],
      { [PLANTED_VAR]: PLANTED },
    )
    expect(tokens).toHaveLength(1)
    expect(tokens[0]!.value).toBe(PLANTED)
    expect(tokens[0]!.trustScope).toEqual({ project: 'acme' })
  })
})

describe('the verdict has TWO arms and no permissive third (D-06)', () => {
  const tokens = [resolved('ci', PLANTED, 'acme')]

  it('REFUSES a request with no Authorization header', () => {
    // The measured claim, stated as what it is NOT: an absent header must not reach any arm that
    // carries a trust scope. This is the arm the MCP door has and this door deletes.
    const verdict = matchServiceBearer(undefined, tokens)
    expect(verdict.kind).toBe('refused')
    expect(verdict).not.toHaveProperty('trustScope')
    expect(verdict).not.toHaveProperty('clientId')
    expect(verdict).toEqual({ kind: 'refused', reason: 'missing_authorization' })
  })

  it('REFUSES a null or blank header the same way', () => {
    for (const header of [null, '', '   ']) {
      expect(matchServiceBearer(header, tokens))
        .toEqual({ kind: 'refused', reason: 'missing_authorization' })
    }
  })

  it('distinguishes a malformed scheme from a wrong value', () => {
    expect(matchServiceBearer('Basic abc', tokens))
      .toEqual({ kind: 'refused', reason: 'malformed_authorization' })
    expect(matchServiceBearer('Bearer', tokens))
      .toEqual({ kind: 'refused', reason: 'malformed_authorization' })
    expect(matchServiceBearer(`Bearer ${PLANTED}-wrong`, tokens))
      .toEqual({ kind: 'refused', reason: 'invalid_token' })
  })

  it('accepts the declared value case-insensitively on the scheme (RFC 7235)', () => {
    for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
      expect(matchServiceBearer(`${scheme} ${PLANTED}`, tokens))
        .toEqual({ kind: 'token', clientId: 'ci', trustScope: { project: 'acme' } })
    }
  })

  it('REFUSES everything when no entry is declared — an empty list is not an open door', () => {
    expect(matchServiceBearer(`Bearer ${PLANTED}`, []))
      .toEqual({ kind: 'refused', reason: 'invalid_token' })
    expect(matchServiceBearer(undefined, []))
      .toEqual({ kind: 'refused', reason: 'missing_authorization' })
  })
})

describe('the scan is independent of match position', () => {
  it('compares every declared entry, so a first-entry hit costs what a last-entry hit costs', () => {
    // Asserted through the OBSERVABLE consequence rather than by timing: the loop has no `break`,
    // so a later entry with the same value wins. A short-circuiting scan would return the FIRST.
    const duplicate = [
      resolved('first', PLANTED, 'alpha'),
      resolved('second', PLANTED, 'omega'),
    ]
    expect(matchServiceBearer(`Bearer ${PLANTED}`, duplicate))
      .toEqual({ kind: 'token', clientId: 'second', trustScope: { project: 'omega' } })
  })

  it('matches an entry at any position', () => {
    const many = [
      resolved('a', 'value-a'),
      resolved('b', 'value-b'),
      resolved('c', PLANTED, 'acme'),
    ]
    expect(matchServiceBearer('Bearer value-a', many))
      .toEqual({ kind: 'token', clientId: 'a', trustScope: {} })
    expect(matchServiceBearer(`Bearer ${PLANTED}`, many))
      .toEqual({ kind: 'token', clientId: 'c', trustScope: { project: 'acme' } })
  })
})

describe('the masker is seeded by DECLARED name', () => {
  it('hands every resolved value to the store keyed by its env-var name', () => {
    const seen: Record<string, string> = {}
    runServiceTokenSecretStore([resolved('ci', PLANTED)])
      .forEachSecret((name, value) => { seen[name] = value })
    expect(seen).toEqual({ CI_VAR: PLANTED })
  })
})

describe('the config block accepts a declaration and refuses an inline value', () => {
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

  it('parses a declared entry under services.dashboard.runServiceTokens', () => {
    const parsed = AgentQaConfigSchema.parse({
      ...base,
      services: {
        dashboard: {
          runServiceTokens: [{ name: 'ci', tokenEnvVar: PLANTED_VAR, trustScope: { org: 'acme' } }],
        },
      },
    })
    expect(parsed.services?.dashboard?.runServiceTokens).toEqual([
      { name: 'ci', tokenEnvVar: PLANTED_VAR, trustScope: { org: 'acme' } },
    ])
  })

  it('REFUSES an entry carrying a token value beside the reference', () => {
    // `.strict()` is the mechanism, not a convention: this is somebody who found the indirection
    // inconvenient, and the schema has to say no rather than ignore the key.
    expect(() => AgentQaConfigSchema.parse({
      ...base,
      services: {
        dashboard: {
          runServiceTokens: [{
            name: 'ci',
            tokenEnvVar: PLANTED_VAR,
            trustScope: {},
            token: PLANTED,
          }],
        },
      },
    })).toThrow()
  })

  it('defaults to an empty list when the key is absent', () => {
    const parsed = AgentQaConfigSchema.parse({ ...base, services: { dashboard: { port: 3470 } } })
    expect(parsed.services?.dashboard?.runServiceTokens).toEqual([])
  })
})
