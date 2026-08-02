// The entity spine, proven end to end (Phase 387, plan 01 — ENTY-01 / ENTY-02 / FUNC-04).
//
// One path, every layer: a raw reference crosses `invokeFunction`'s gate, reaches the
// `entities.*` ops, drops through the composition-bound directory port into the
// knowledge-local resolver, mints a durable short-ID in the addressing ledger, and comes
// back as a card the ONE producer rendered. Nothing here is stubbed; the bundle is really
// published to a temp knowledge root and the ledger is a real sqlite file on disk.
//
// Why the assertions are shaped the way they are: "a resolver exists" is satisfied by a
// function returning a plausible object, so every claim below is anchored to something the
// wrong implementation could not produce — the ordinal came out of a database (it survives
// a second call and a second composition), the address is the canonical one the URI codec
// prints, and the free-text case returns the typed refusal arm rather than the nearest
// bundle it happened to be holding.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invokeFunction } from '@vostride/agent-qa-agent'
import {
  ADDRESSING_LEDGER_DB_FILE,
  publishBundleForTest,
  type BundleStoreConfig,
  type PublishBundleInput,
} from '@vostride/agent-qa-knowledge-local'
import { EntityCardSchema } from '@vostride/agent-qa-schema'
import type {
  BundleDiscriminant,
  BundleDraft,
  EntityCard,
  EntityCardResolution,
  FunctionCaller,
  MaskedResolvedConfig,
} from '@vostride/agent-qa-schema'
import { MASKED_RESOLVED_CONFIG_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { composeLocalAgent } from '../compose-local-agent.js'
import type { LocalAgentHost } from '../compose-local-agent.js'

const PRODUCT = 'shop'

const CALLER: FunctionCaller = {
  surface: 'cli',
  grantedScopes: ['read'],
  safeMode: false,
}

const MASKED_CONFIG: MaskedResolvedConfig = {
  schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}

function bundleInput(name: string, createdAtOrdinal: number): PublishBundleInput {
  const draft: BundleDraft = {
    kind: 'fact',
    subtype: 'selector',
    anchors: [{ t: 'el', role: 'button', name }],
    scope: { tier: 'product', key: PRODUCT },
    summary: `${name} summary`,
    body: `${name} body`,
    distilledEvidenceRef: { id: `${name}-evidence`, sha: 'a'.repeat(64) },
    originStage: 'run-curation',
  }
  const discriminant: BundleDiscriminant = {
    kind: 'fact',
    subtype: 'selector',
    elementRef: { role: 'button', name },
  }
  return {
    draft,
    discriminant,
    originClass: 'agent-verified',
    createdAtOrdinal,
    screenStates: [],
    initialEvents: [],
    relations: [],
    provenance: {
      mode: 'run-linked',
      runId: `entity-spine-${name}`,
      testId: 'entity-spine',
      stepIndex: 0,
      sourceBuildOrdinal: createdAtOrdinal,
    },
    artifacts: [],
  }
}

describe('the entity spine through composeLocalAgent (387-01)', () => {
  let root: string
  let agentQaRoot: string
  let knowledgeRoot: string
  let host: LocalAgentHost
  let bundleId: string

  function compose(): LocalAgentHost {
    return composeLocalAgent({
      agentQaRoot,
      config: { getMasked: () => Promise.resolve(MASKED_CONFIG) },
      knowledgeRoot: () => knowledgeRoot,
      model: () => {
        throw new Error('the entity spine never authors with a model')
      },
    })
  }

  function seedBundle(name: string, createdAtOrdinal: number): string {
    const config: BundleStoreConfig = {
      knowledgeRoot,
      productKey: PRODUCT,
      auditBaseDir: agentQaRoot,
      commitArtifacts: 'none',
    }
    const outcome = publishBundleForTest(config, bundleInput(name, createdAtOrdinal))
    expect(outcome.kind).toBe('published')
    if (outcome.kind !== 'published') throw new Error('spine fixture bundle did not publish')
    return outcome.id
  }

  async function resolve(ref: string): Promise<EntityCardResolution> {
    return await invokeFunction(
      host.registry,
      'entities.resolve',
      { ref },
      CALLER,
    ) as EntityCardResolution
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-qa-entity-spine-'))
    agentQaRoot = join(root, '.agent-qa')
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    mkdirSync(agentQaRoot, { recursive: true })
    host = compose()
    bundleId = seedBundle('Checkout', 5)
  })

  afterEach(async () => {
    await host.close()
    rmSync(root, { recursive: true, force: true })
  })

  // ---- test 1: the sighting mints, and the card comes back rendered ----------------------

  it('resolves a committed bundle ref to a MEM card with a minted short-ID (D-01)', async () => {
    // The ledger is a durable file, and D-01 says nothing touches it until an entity is
    // SIGHTED. Composing a host and listing a registry must therefore leave no database
    // behind, exactly as the job store must not.
    expect(existsSync(join(agentQaRoot, ADDRESSING_LEDGER_DB_FILE))).toBe(false)

    const outcome = await resolve(bundleId)

    expect(outcome).toMatchObject({
      kind: 'resolved',
      score: 1,
      card: {
        kind: 'MEM',
        id: 'MEM-001',
        uri: 'agentqa://memory/MEM-001',
        status: 'active',
      },
    })
    expect(existsSync(join(agentQaRoot, ADDRESSING_LEDGER_DB_FILE))).toBe(true)

    // Rendered THROUGH the schema boundary, not assembled ad hoc: a card that failed its own
    // contract could still satisfy the shape assertion above.
    if (outcome.kind !== 'resolved') throw new Error('expected the resolved arm')
    expect(EntityCardSchema.safeParse(outcome.card).success).toBe(true)
    expect(outcome.card.title).toContain('Checkout')
    // D-10: no dashboard base URL is configured in v52, so the field is ABSENT rather than a
    // link that would 404.
    expect(Object.hasOwn(outcome.card, 'url')).toBe(false)
  })

  // ---- test 2: minting is idempotent across calls AND across compositions ----------------

  it('re-sights the same bundle to the SAME short-ID (ENTY-01 idempotency)', async () => {
    const first = await resolve(bundleId)
    const second = await resolve(bundleId)

    expect(first).toEqual(second)

    // A second composition over the same runtime root reads the ledger the first one wrote.
    // An in-memory counter passes both assertions above and fails this one.
    const reopened = compose()
    try {
      const third = await invokeFunction(
        reopened.registry,
        'entities.resolve',
        { ref: bundleId },
        CALLER,
      ) as EntityCardResolution
      expect(third).toEqual(first)
    } finally {
      await reopened.close()
    }
  })

  // ---- test 3: tier (a) — the published address resolves, both spellings ------------------

  it('resolves the short-ID and the agentqa:// URI to the same entity at 1.0 (tier a)', async () => {
    const minted = await resolve(bundleId)
    if (minted.kind !== 'resolved') throw new Error('expected the resolved arm')

    const byShortId = await resolve('MEM-001')
    const byUri = await resolve('agentqa://memory/MEM-001')

    expect(byShortId).toEqual(minted)
    expect(byUri).toEqual(minted)

    // `entities.get` is the simple read path: the card alone, no resolution envelope.
    const card = await invokeFunction(
      host.registry,
      'entities.get',
      { ref: 'MEM-001' },
      CALLER,
    ) as EntityCard
    expect(card).toEqual(minted.card)
  })

  // ---- test 4: the never-guess floor ------------------------------------------------------

  it('returns the typed none arm for free text rather than guessing (ENTY-01)', async () => {
    // The bundle IS about checkout, and it is the only entity in the store — so a resolver
    // that fell back to "the closest thing I have" would answer `resolved` here. Tier (b)
    // lands in 387-03; until it does, the honest answer is a refusal.
    await resolve(bundleId)

    const outcome = await resolve('that bundle about checkout')

    expect(outcome).toMatchObject({ kind: 'none', reason: 'no-match' })
  })

  // ---- the schema boundary, and the dispatch boundary --------------------------------------

  it('rejects a card whose status is not in its own kind closed union (D-12)', () => {
    const valid: EntityCard = {
      kind: 'MEM',
      id: 'MEM-001',
      uri: 'agentqa://memory/MEM-001',
      title: 'Checkout summary',
      status: 'active',
      keyFacts: [],
      actions: [],
    }
    expect(EntityCardSchema.safeParse(valid).success).toBe(true)

    // `passed` is a REAL status in this vocabulary — it is RUN's. Borrowing another kind's
    // member is the failure a per-kind union exists to catch and a single flat status enum
    // would wave through.
    expect(EntityCardSchema.safeParse({ ...valid, status: 'passed' }).success).toBe(false)
    expect(EntityCardSchema.safeParse({ ...valid, status: 'invented' }).success).toBe(false)
  })

  it('publishes the two ops as declarations only — dispatch stays behind invokeFunction', async () => {
    const listed = host.registry.list(CALLER).map((entry) => entry.id)
    expect(listed).toContain('entities.resolve')
    expect(listed).toContain('entities.get')

    for (const entry of host.registry.list(CALLER)) {
      if (entry.id !== 'entities.resolve' && entry.id !== 'entities.get') continue
      expect(entry).toMatchObject({
        requiredScopes: ['read'],
        bindingStatus: 'bound',
        risk: { readOnly: true },
      })
      // A declaration is DATA. Anything runnable reachable off a listing would be the
      // private power the function layer abolishes (T-384-01).
      expect(Object.values(entry).some((value) => typeof value === 'function')).toBe(false)
    }

    const barrel = await import('@vostride/agent-qa-agent') as Record<string, unknown>
    for (const name of ['entitiesResolveSpec', 'entitiesGetSpec', 'produceEntityCard']) {
      expect(Object.hasOwn(barrel, name)).toBe(false)
    }
  })
})
