// D-10 end to end, through the REAL config path (Phase 387 plan 07, ENTY-02 / D-10).
//
// The agent-side suite proves the producer's rules against `MaskedResolvedConfig` values it
// constructs. That is necessary and not sufficient: a hand-built DTO can carry a shape the
// real masker is structurally incapable of producing, and a card URL proven only against one
// would be the input-domain vacuity this phase keeps finding. Nothing in `packages/agent` can
// reach the masker — it lives here, in the composition root — so the join is proven HERE, and
// this is the only place in the workspace where it can be.
//
// What "real" means in this file, stated so it can be checked rather than trusted: an actual
// YAML file on disk, resolved by `resolveConfig` through the shipped `AgentQaConfigSchema`
// (which is `.strict()`, so an undeclared `services.dashboard` key would fail the read
// outright), masked by `buildMaskedResolvedConfig` under the schema-derived visibility oracle,
// and handed to the real `entities.get` op through `createFunctionRegistry` and
// `invokeFunction`. The only stubs are the ports this claim is not about.

import { createFunctionRegistry, invokeFunction } from '@vostride/agent-qa-agent'
import type { FunctionDeps } from '@vostride/agent-qa-agent'
import type { AuditSink } from '@vostride/agent-qa-safety'
import type {
  EntityCard,
  EntityDescriptor,
  FunctionCaller,
} from '@vostride/agent-qa-schema'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { createMaskedConfigReader } from '../local-agent-host.js'

const CALLER: FunctionCaller = {
  surface: 'cli',
  grantedScopes: ['read'],
  safeMode: false,
  origin: 'agent',
}

const AUDIT_SINK: AuditSink = {
  appendExecutionAudit: () => undefined,
  appendGuardrailAudit: () => undefined,
}

const DESCRIPTOR: EntityDescriptor = {
  kind: 'MEM',
  shortId: 'MEM-004',
  uri: 'agentqa://memory/MEM-004',
  machineId: 'shop.cart.fact.0001',
  title: 'Cart totals VAT',
  statusSource: 'active',
}

/** Write a real config file whose `services.dashboard` block carries the D-10 keys. */
function writeConfig(dashboard: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-qa-card-url-'))
  const configPath = join(dir, 'agent-qa.config.yaml')
  writeFileSync(
    configPath,
    JSON.stringify({
      workspace: {
        testMatch: ['tests/**/*.test.yaml'],
        suiteMatch: ['tests/**/*.suite.yaml'],
        hooksFile: 'agent-qa.hooks.ts',
        envFile: '.env',
        secretsFile: '.env.secrets',
      },
      use: { mobile: { appState: 'reset' } },
      services: { dashboard },
    }),
    'utf8',
  )
  return configPath
}

function depsFor(configPath: string): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) => Promise.resolve({
        kind: 'not-found' as const,
        schemaVersion: 1 as const,
        recordId,
      }),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: (ref) => Promise.resolve(ref === DESCRIPTOR.shortId ? DESCRIPTOR : undefined),
    },
    // THE point of this file: the real reader, over a real file, through the real masker.
    config: createMaskedConfigReader(configPath),
  }
}

async function cardFor(dashboard: Record<string, unknown>): Promise<EntityCard> {
  const registry = createFunctionRegistry({
    deps: depsFor(writeConfig(dashboard)),
    auditSink: AUDIT_SINK,
    resolveExecutionContext: () => 'local-headless',
  })
  const result = await invokeFunction(
    registry,
    'entities.get',
    { ref: DESCRIPTOR.shortId },
    CALLER,
  )
  return result as EntityCard
}

describe('the card url is derived through the real masked-config path (D-10)', () => {
  it('renders the pinned route from a base the masker publishes verbatim', async () => {
    const card = await cardFor({
      baseUrl: 'https://qa.example.com',
      workspace: 'acme',
    })
    expect(card.url).toBe('https://qa.example.com/t/acme/memory/MEM-004/cart-totals-vat')
  })

  it('omits the url when the config declares no dashboard base — the v52 default', async () => {
    const card = await cardFor({ port: 4400 })
    // Key presence, not value: a card that carried `url: undefined` would pass a value check.
    expect('url' in card).toBe(false)
  })

  it('omits the url when the masker REDUCED the base, rather than linking to the reduction',
    async () => {
      // `services.dashboard.baseUrl` is a registered address leaf, so a base carrying a path
      // prefix comes back as its bare origin with `masked: true`. Rendering against that
      // reduction would point every card at `/t/...` on a host that serves the app under
      // `/qa/` — a dead link shown with confidence. This is the case a hand-built DTO cannot
      // produce, and the reason this file exists.
      const card = await cardFor({
        baseUrl: 'https://qa.example.com/qa',
        workspace: 'acme',
      })
      expect('url' in card).toBe(false)
    })

  it('omits the url when only one half is configured', async () => {
    expect('url' in await cardFor({ baseUrl: 'https://qa.example.com' })).toBe(false)
    expect('url' in await cardFor({ workspace: 'acme' })).toBe(false)
  })
})
