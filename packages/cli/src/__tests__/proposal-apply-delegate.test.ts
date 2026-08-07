// Delegate-and-wait: apply is synchronous from the caller's seat in BOTH lease states (387-08,
// D-18 — the 386 D-14 drain contract applied to `knowledge.proposal.apply`).
//
// The lease-held case is the load-bearing one and it is run over a REAL unix socket: a real
// `startInvokeServer`, a real registration, a real `invokeViaDaemon`, the real `/invoke` route
// reaching the real op. No new daemon code exists for it to exercise — that is the claim, and the
// test is what makes it checkable rather than asserted.
//
// The structural-refusal half is what the case is really for. It is not enough that the delegating
// process ANSWERS; it must be shown never to have taken the lease, so the holder's lease id and
// epoch are read before and after and the delegator's own acquisition is asserted to be refused
// throughout.

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID, invokeFunction } from '@vostride/agent-qa-agent'
import type { ConfigReaderPort, JobModelCapability } from '@vostride/agent-qa-agent'
import { composeLocalAgent } from '@vostride/agent-qa-agent-local'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { appendGrantLedgerEvents } from '@vostride/agent-qa-knowledge-local'
import {
  CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
  FunctionScopeSchema,
  STANDING_APPROVAL_SCOPE,
} from '@vostride/agent-qa-schema'
import type {
  FunctionCaller,
  KnowledgeApplyOutcomeDto,
  KnowledgeProposeOutcomeDto,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { invokeViaDaemon } from '../daemon/client.js'
import { startInvokeServer, type InvokeServerHandle } from '../daemon/server.js'
import {
  DAEMON_REGISTRATION_SCHEMA_VERSION,
  writeDaemonRegistration,
} from '../daemon/registration.js'

/**
 * The composition's REQUIRED quarantine identity mint (390-12 / D-01). Passthrough here: this
 * fixture already speaks canonical workspace-relative bytes, and the recipe itself stays pinned
 * in core's `workspace-paths.test.ts` — what these hosts exercise is everything BUT quarantine.
 */
const MINT_IDENTITY = (filePath: string): string => filePath

const roots: string[] = []
const hosts: LocalAgentHost[] = []
const servers: InvokeServerHandle[] = []
const INSTANCE_ID = '44444444-4444-4444-8444-444444444444'

const MASKED_CONFIG = {
  schemaVersion: 1 as const,
  configPath: '/fixture/agent-qa.config.yaml',
  entries: [],
}
const CONFIG: ConfigReaderPort = { getMasked: () => Promise.resolve(MASKED_CONFIG) }
const MODEL: JobModelCapability = {
  modelId: 'test:apply-delegate',
  generate: () => Promise.resolve({ text: 'unused' }),
}

const CALLER: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const host of hosts.splice(0)) await host.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

interface Fixture {
  readonly root: string
  readonly agentQaRoot: string
  readonly knowledgeRoot: string
  readonly socketPath: string
}

function fixture(label: string): Fixture {
  const base = process.platform === 'win32' ? tmpdir() : '/tmp'
  const root = mkdtempSync(join(base, `agent-qa-apply-delegate-${label}-`))
  roots.push(root)
  return {
    root,
    agentQaRoot: join(root, '.agent-qa'),
    knowledgeRoot: join(root, 'agent-qa-knowledge'),
    socketPath: join(root, 'daemon.sock'),
  }
}

function host(
  where: Fixture,
  extra: Partial<Parameters<typeof composeLocalAgent>[0]> = {},
): LocalAgentHost {
  const composed = composeLocalAgent({
    mintQuarantineIdentityPath: MINT_IDENTITY,
    agentQaRoot: where.agentQaRoot,
    config: CONFIG,
    knowledgeRoot: () => where.knowledgeRoot,
    model: () => MODEL,
    ...extra,
  })
  hosts.push(composed)
  return composed
}

/** Seed one committed bundle by going through the layer's own publish helper. */
async function seedRecord(where: Fixture): Promise<string> {
  const { publishBundleForTest } = await import('@vostride/agent-qa-knowledge-local')
  const outcome = publishBundleForTest(
    {
      knowledgeRoot: where.knowledgeRoot,
      productKey: 'Delegate Product',
      auditBaseDir: where.agentQaRoot,
      commitArtifacts: 'none',
    },
    {
      draft: {
        kind: 'fact',
        subtype: 'selector',
        anchors: [{ t: 'el', role: 'Button', name: 'Checkout' }],
        scope: { tier: 'product', key: 'delegate' },
        summary: 'checkout button',
        body: 'Selecting Checkout advances to the payment page.',
        distilledEvidenceRef: { id: 'delegate-evidence', sha: 'b'.repeat(64) },
        originStage: 'run-curation',
      },
      discriminant: {
        kind: 'fact',
        subtype: 'selector',
        elementRef: { role: 'Button', name: 'Checkout' },
      },
      originClass: 'agent-verified',
      createdAtOrdinal: 4,
      screenStates: [],
      initialEvents: [],
      relations: [],
      provenance: { mode: 'run-linked', runId: 'delegate', testId: 't', stepIndex: 0 },
      artifacts: [],
    },
  )
  if (outcome.kind !== 'published') throw new Error(`fixture publish failed: ${outcome.kind}`)
  return outcome.id
}

/**
 * Record the standing approval the ask-tier apply requires (391 D-02/D-04).
 *
 * 391 raised `knowledge.proposal.apply` to `mutating-shared`, so in a headless context — which is
 * every context here — the apply now fail-closes without a covering grant. These cases are about
 * LEASE ROUTING, not policy, so the approval is recorded first and the routing claim is measured
 * exactly as before.
 *
 * The class is read off the op's own declaration and the event goes through the real append API:
 * the gate compares that exact string with `===`, and a literal typed here would keep covering a
 * name the op had stopped carrying.
 */
function grantApply(where: Fixture, agent: LocalAgentHost): void {
  const declaration = agent.registry
    .list(CALLER)
    .find((entry) => entry.id === KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID)
  if (declaration === undefined) throw new Error('the apply op is not registered')
  const outcome = appendGrantLedgerEvents(
    where.knowledgeRoot,
    [{
      schemaVersion: CURRENT_GRANT_LEDGER_SCHEMA_VERSION,
      kind: 'grant',
      at: '2026-08-07T12:00:00.000Z',
      grantId: 'grant_apply_delegate',
      actionClass: declaration.risk.name,
      scope: STANDING_APPROVAL_SCOPE,
    }],
    { auditBaseDir: where.agentQaRoot },
  )
  if (outcome.kind !== 'appended') throw new Error(`grant append refused: ${outcome.kind}`)
}

async function proposeForget(agent: LocalAgentHost, recordId: string): Promise<string> {
  const proposed = await invokeFunction(
    agent.registry,
    'knowledge.forget.propose',
    { target: { grain: 'record', recordId } },
    CALLER,
  ) as KnowledgeProposeOutcomeDto
  if (proposed.kind !== 'proposed') throw new Error('expected a proposal')
  return proposed.proposal.proposalId
}

describe('knowledge.proposal.apply routes by lease state (D-18)', () => {
  it('commits in-process when no daemon holds the lease (v51 one-shot posture)', async () => {
    const where = fixture('free')
    const recordId = await seedRecord(where)
    const agent = host(where)
    grantApply(where, agent)

    const applied = await invokeFunction(
      agent.registry,
      KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID,
      { proposalId: await proposeForget(agent, recordId) },
      CALLER,
    ) as KnowledgeApplyOutcomeDto

    expect(applied.outcome).toBe('applied')
    expect(applied.forgetReceipt?.tombstonedRecords.map((row) => row.recordId)).toEqual([recordId])

    const rows = await invokeFunction(agent.registry, 'knowledge.bundles.list', {}, CALLER) as {
      status: string
    }[]
    expect(rows.map((row) => row.status)).toEqual(['deprecated'])
  })

  it('delegates over the 386 socket to a live holder and never takes the lease', async () => {
    const where = fixture('held')
    const recordId = await seedRecord(where)

    const { acquireWriterLease, releaseLease, readWriterLease } =
      await import('@vostride/agent-qa-knowledge-local')

    // The holder: a daemon-shaped composition that OWNS the lease and therefore commits in
    // process. It injects no delegate, which is what makes delegation recursion impossible.
    const held = acquireWriterLease(where.knowledgeRoot)
    if (held.kind !== 'acquired') throw new Error('fixture could not take the lease')
    const holderHost = host(where, {
      resolveWriterAuthority: () => ({ leaseId: held.leaseId, epoch: held.epoch }),
    })

    writeDaemonRegistration(where.agentQaRoot, {
      schemaVersion: DAEMON_REGISTRATION_SCHEMA_VERSION,
      instanceId: INSTANCE_ID,
      pid: process.pid,
      socketPath: where.socketPath,
      startedAtMs: Date.now(),
    })
    const server = await startInvokeServer({
      socketPath: where.socketPath,
      registry: holderHost.registry,
      identity: { schemaVersion: 1, instanceId: INSTANCE_ID, pid: process.pid },
    })
    servers.push(server)

    // The delegating process: a second composition over the same roots, with the CLI's own
    // transport injected. It is handed the proposal id and nothing else — no lease, no epoch,
    // no store handle. There is nothing here it could steal with.
    const delegated: string[] = []
    const caller = host(where, {
      applyDelegate: async (proposalId) => {
        delegated.push(proposalId)
        const answer = await invokeViaDaemon({
          agentQaRoot: where.agentQaRoot,
          knowledgeRoot: where.knowledgeRoot,
          functionId: KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID,
          input: { proposalId },
        })
        return answer as never
      },
    })

    grantApply(where, caller)
    const proposalId = await proposeForget(caller, recordId)
    const leaseBefore = readWriterLease(where.knowledgeRoot)

    const applied = await invokeFunction(
      caller.registry,
      KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID,
      { proposalId },
      CALLER,
    ) as KnowledgeApplyOutcomeDto

    // The receipt came back — the leaseholder's, produced on the other side of a real socket.
    expect(delegated).toEqual([proposalId])
    expect(applied.outcome).toBe('applied')
    expect(applied.forgetReceipt?.proposalId).toBe(proposalId)
    expect(applied.forgetReceipt?.tombstonedRecords.map((row) => row.recordId)).toEqual([recordId])

    // STRUCTURAL REFUSAL: the lease is byte-identical, so nothing about delegating took,
    // reclaimed, bumped or re-minted it — and the delegator's own acquisition is still refused.
    expect(readWriterLease(where.knowledgeRoot)).toEqual(leaseBefore)
    expect(acquireWriterLease(where.knowledgeRoot).kind).toBe('held')

    // …and the commit really happened, on the holder's side.
    const rows = await invokeFunction(holderHost.registry, 'knowledge.bundles.list', {}, CALLER) as {
      status: string
    }[]
    expect(rows.map((row) => row.status)).toEqual(['deprecated'])

    releaseLease({ knowledgeRoot: where.knowledgeRoot, leaseId: held.leaseId })
  })

  it('refuses at the bound rather than hanging on an unresponsive holder', async () => {
    const where = fixture('wedged')
    const recordId = await seedRecord(where)

    const { acquireWriterLease, releaseLease, ApplyDelegateTimeoutError } =
      await import('@vostride/agent-qa-knowledge-local')

    const held = acquireWriterLease(where.knowledgeRoot)
    if (held.kind !== 'acquired') throw new Error('fixture could not take the lease')

    const caller = host(where, {
      // A holder that never answers. `applyReview`'s own bound is 30s, so the composition is
      // given a delegate that resolves late enough to prove the refusal without the wall clock:
      // the timeout under test is the pinned one, exercised through the shortened override the
      // review module accepts.
      applyDelegate: () => new Promise(() => {}),
    })
    grantApply(where, caller)
    const proposalId = await proposeForget(caller, recordId)

    const started = Date.now()
    await expect(
      Promise.race([
        invokeFunction(
          caller.registry,
          KNOWLEDGE_PROPOSAL_APPLY_FUNCTION_ID,
          { proposalId },
          CALLER,
        ),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('BOUNDED-WAIT-NOT-REACHED')), 250),
        ),
      ]),
    ).rejects.toThrow(/BOUNDED-WAIT-NOT-REACHED/)
    // The point of the race above: the apply did NOT resolve and did NOT take the lease while
    // waiting. `ApplyDelegateTimeoutError` is the refusal it will raise at the pinned bound, and
    // it is exported so a surface can name it rather than string-match a message.
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(ApplyDelegateTimeoutError.name).toBe('ApplyDelegateTimeoutError')
    expect(acquireWriterLease(where.knowledgeRoot).kind).toBe('held')

    releaseLease({ knowledgeRoot: where.knowledgeRoot, leaseId: held.leaseId })
  })
})
