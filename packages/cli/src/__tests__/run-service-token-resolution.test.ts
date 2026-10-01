// The run service's credential mechanics (Phase 402 plan 01, D-05 / D-06 · INVK-03), RETIRED
// 2026-10-01.
//
// 2026-10-01 (432-21, D-12): RE-SPELLED from the resolver's own cells.
// `run-service-token-resolution.ts` — `resolveRunServiceTokens`, `matchServiceBearer`,
// `runServiceTokenSecretStore` and `RunServiceTokenEnvVarUnsetError` — is deleted with the
// run-service tokens, and the router's `verifyBearer` port with it. Each retired cell is replaced by
// the claim that now holds in its place:
//
//   * the startup refusal for an unset declaration -> the composer dereferences nothing, so it
//     composes with a declaration on disk and an empty environment alike;
//   * the two-arm verdict with no permissive third -> the door reads no `Authorization` header, and
//     what it refuses first is a cross-site request (`run-service-auth-hardening.test.ts`);
//   * the masker seeded by declared name -> the composer binds no store at all;
//   * `/ok`'s `authConfigured` from a resolved count -> always `false`.
//
// The refs-only config cells stay unchanged below: `services.dashboard.runServiceTokens` is still
// declared, unread, until 432-22 deletes the key.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'

import { composeRunServicePorts, createRunServiceReadiness } from '../commands/dashboard.js'

/** The value that must never appear in any message this suite can reach. */
const PLANTED = 'zz-402-01-planted-run-credential-8b3e17'
const PLANTED_VAR = 'AGENT_QA_402_RUN_CRED'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

function door(bound: unknown[] = []) {
  return {
    resolveHost: () => undefined,
    observeSessions: () => () => {},
    bindMaskingSecrets: (store: unknown) => { bound.push(store) },
  }
}

describe('C432-TOKENLESS-RUN-SERVICE: the run-service bearer resolver is deleted, not bypassed', () => {
  it('C432-TOKENLESS-RUN-SERVICE: the resolver module is gone and no CLI source imports it', () => {
    expect(existsSync(join(SRC, 'composition', 'run-service-token-resolution.ts'))).toBe(false)
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(path) }
        else if (entry.name.endsWith('.ts') && readFileSync(path, 'utf8').includes("run-service-token-resolution.js'")) {
          offenders.push(path)
        }
      }
    }
    walk(SRC)
    expect(offenders).toEqual([])
  })

  // RE-SPELLED from 'start-time resolution refuses an unset declaration by NAME' and 'the masker is
  // seeded by DECLARED name': nothing is declared to the composer, so nothing can refuse, and no
  // store is bound to the door.
  it('C432-TOKENLESS-RUN-SERVICE: the composer takes no declarations, refuses nothing, binds no store', () => {
    const bound: unknown[] = []
    const composition = composeRunServicePorts({ door: door(bound) })
    try {
      expect(Object.keys(composition.ports).sort()).toEqual(['attach', 'invokeRunStart', 'mintLiveUrl', 'readiness'])
      expect('secretStore' in composition).toBe(false)
      expect('tokenCount' in composition).toBe(false)
      expect(bound).toEqual([])
      expect(JSON.stringify(Object.keys(composition))).not.toContain(PLANTED_VAR)
    } finally {
      composition.dispose()
    }
  })

  // RE-SPELLED from 'the verdict has TWO arms and no permissive third (D-06)': there is no verdict.
  // Readiness reports `authConfigured: false` always — no credential can be configured.
  it('C432-TOKENLESS-RUN-SERVICE: readiness reports no credential configured, whatever the environment holds', () => {
    const previous = process.env[PLANTED_VAR]
    process.env[PLANTED_VAR] = PLANTED
    try {
      const readiness = createRunServiceReadiness({ resolveHost: () => undefined })()
      expect(readiness).toMatchObject({ service: 'up', hostComposed: false, authConfigured: false })
      expect(JSON.stringify(readiness)).not.toContain(PLANTED)
    } finally {
      if (previous === undefined) delete process.env[PLANTED_VAR]
      else process.env[PLANTED_VAR] = previous
    }
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
