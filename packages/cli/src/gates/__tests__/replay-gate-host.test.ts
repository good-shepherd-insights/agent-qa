import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeReaderPort } from '@vostride/agent-qa-agent'
import { LOCAL_CURATION_CAPABILITIES } from '@vostride/agent-qa-agent-local'
import {
  asEvidenceToken,
  asRecordId,
  GateReceiptSchema,
  receiptDigestOf,
} from '@vostride/agent-qa-schema'
import { gateReceiptsFor } from '@vostride/agent-qa-knowledge-local/reader'
import { createLocalKnowledgeStore } from '@vostride/agent-qa-knowledge-local'
import {
  resolveEvalSession,
  runReplayGateVerb,
  serializeReplayGateReceipt,
} from '../../eval-session-composition.js'
import { createReplayGateHost, type ReplayGateHostDeps } from '../replay-gate-host.js'
import * as bridge from '../replay-gate-host.js'
import * as llm from '../../llm-utils.js'
import * as fsPromises from 'node:fs/promises'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
})
// Runtime-only fixture reuse keeps another package's source outside the CLI tsc rootDir.
const { completeGate1Receipt, createPromotionFloorFixture, resolvedPromotionPosture } =
  await import(
    new URL(
      '../../../../knowledge-local/src/curator/__tests__/fixtures/promotion-floor-fixture.js',
      import.meta.url,
    ).href
  )

describe('417 DATA replay gate bridge', () => {
  let root: string
  let knowledgeRoot: string
  let candidateId: string
  let deps: ReplayGateHostDeps
  let calls: string[]
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), '417-gate-host-'))
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    const fixture = createPromotionFloorFixture({
      knowledgeRoot,
      auditBaseDir: join(root, '.agent-qa'),
    })
    candidateId = fixture.publishHeldCandidate('rg').published.id
    const configPath = join(root, 'agent-qa.config.yaml')
    writeFileSync(
      configPath,
      'workspace:\n  testMatch: [tests/**/*.yaml]\n  suiteMatch: [suites/**/*.suite.yaml]\n  hooksFile: hooks.yaml\n  envFile: .env\n  secretsFile: .env.secrets.local\nuse:\n  mobile:\n    appState: preserve\n',
    )
    const session = await resolveEvalSession({ configPath, keyOnly: true })
    calls = []
    deps = {
      configPath,
      agentQaRoot: join(root, '.agent-qa'),
      record: true,
      session,
      composition: {
        identity: {
          plannerModelId: 'gpt-stub',
          matcherVersion: 1,
          fingerprint: 'f'.repeat(64),
          profileKey: 'p',
        },
        planner: {
          profile: { provider: 'openai-compatible', model: 'gpt-stub', auth: { mode: 'none' } },
          resolveAuth: async () => {
            throw new Error('fake bridge must not resolve auth')
          },
        },
        k: 3,
        kSource: 'default',
        maxScreens: 64,
        judgeOverrideConfigured: false,
        baselineSeed: { floorSeeds: [11, 29] },
      },
      runReplayGate: vi.fn<NonNullable<ReplayGateHostDeps['runReplayGate']>>(async (input) => ({
        kind: 'receipt',
        receipt: completeGate1Receipt(input.injection.candidateId),
        lines: ['gate 1 · pass'],
        notices: [],
        refusals: [],
        modelCalls: 0,
        wallClockMs: 0,
      })),
      curation: {
        recordGateReceipt: vi.fn(async () => {
          calls.push('write')
          return { kind: 'appended' as const }
        }),
        maintenance: {
          acquireWriterLease: vi.fn(() => {
            calls.push('acquire')
            return { kind: 'acquired' as const, leaseId: 'L', epoch: 1 }
          }),
          releaseLease: vi.fn(() => {
            calls.push('release')
            return { kind: 'released' as const }
          }),
        },
      },
    }
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it('records DATA with the actual lease epoch, then releases; its port returns the receipt', async () => {
    const host = createReplayGateHost(deps)
    const result = await host.run(candidateId)
    expect(result).toMatchObject({ kind: 'receipt', recorded: 'appended', exit: 0 })
    expect(deps.curation!.recordGateReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        lease: { leaseId: 'L', epoch: 1 },
        knowledgeRoot,
        executionContext: deps.session.executionContext,
        receipt: completeGate1Receipt(candidateId),
        sourceBuildOrdinal: 44,
      }),
    )
    expect(calls).toEqual(['acquire', 'write', 'release'])
    expect(deps.runReplayGate).toHaveBeenCalledWith(
      expect.objectContaining({
        injection: expect.objectContaining({ candidateId }),
        producedBy: { opId: 'eval.replay-gate' },
        committedRoot: join(root, 'agent-qa-eval'),
        maskingContextFactory: deps.session.maskingContextFactory,
      }),
    )
    expect(await host.port.runReplayGate(asRecordId(candidateId))).toEqual(
      completeGate1Receipt(candidateId),
    )
  })
  it.each([
    ['fail', 1],
    ['abstain', 2],
  ] as const)('maps %s to exit %s', async (verdict, exit) => {
    deps.runReplayGate = async () => ({
      kind: 'receipt',
      receipt: completeGate1Receipt(candidateId, { verdict }),
      lines: [],
      notices: [],
      refusals: [],
      modelCalls: 0,
      wallClockMs: 0,
    })
    expect(await createReplayGateHost(deps).run(candidateId)).toMatchObject({ exit })
  })
  it('dry-run never acquires a lease', async () => {
    expect(await createReplayGateHost({ ...deps, record: false }).run(candidateId)).toMatchObject({
      recorded: 'dry-run',
    })
    expect(calls).toEqual([])
  })
  it('refuses missing reader support and unknown candidates without a lease', async () => {
    await expect(
      createReplayGateHost({ ...deps, reader: {} as KnowledgeReaderPort }).run(candidateId),
    ).rejects.toThrow('knowledge reader binds no candidateInjection')
    const host = createReplayGateHost(deps)
    expect(await host.run('missing')).toMatchObject({
      kind: 'refused',
      exit: 2,
      refusal: { reason: 'candidate missing not found' },
    })
    await expect(host.port.runReplayGate(asRecordId('missing'))).rejects.toThrow(
      'candidate missing not found',
    )
    expect(calls).toEqual([])
  })
  it('passes a composition refusal through without acquiring a lease', async () => {
    deps.runReplayGate = async () => ({
      kind: 'refused',
      refusal: { path: root, reason: 'no-floor' },
      notices: [],
    })
    expect(await createReplayGateHost(deps).run(candidateId)).toMatchObject({
      kind: 'refused',
      exit: 2,
    })
    expect(calls).toEqual([])
  })
  it('reports lease-held without writing or releasing another writer lease', async () => {
    deps.curation = {
      ...deps.curation!,
      maintenance: {
        ...deps.curation!.maintenance,
        acquireWriterLease: vi.fn(() => ({
          kind: 'held' as const,
          holder: {
            leaseId: 'other',
            epoch: 5,
            pid: 1,
            heartbeatAtMs: 0,
          },
        })),
      },
    }
    const result = await createReplayGateHost(deps).run(candidateId)
    expect(result).toMatchObject({
      recorded: 'lease-held',
      exit: 2,
      notices: [expect.stringContaining('receipt printed, not recorded')],
    })
    expect(calls).toEqual([])
  })
  it('releases the acquired lease even when recording fails', async () => {
    deps.curation = {
      ...deps.curation!,
      recordGateReceipt: vi.fn(async () => {
        calls.push('write')
        throw new Error('write refused')
      }),
    }
    await expect(createReplayGateHost(deps).run(candidateId)).rejects.toThrow('write refused')
    expect(calls).toEqual(['acquire', 'write', 'release'])
  })
  it('rejects a foreign receipt before writing', async () => {
    deps.runReplayGate = async () => ({
      kind: 'receipt',
      receipt: completeGate1Receipt('foreign'),
      lines: [],
      notices: [],
      refusals: [],
      modelCalls: 0,
      wallClockMs: 0,
    })
    await expect(createReplayGateHost(deps).run(candidateId)).rejects.toThrow('foreign candidate')
    expect(calls).toEqual([])
  })
  it('reads the real appended receipt and duplicate back, holding at gate2-receipt-required', async () => {
    // A Gate 1 pass cannot bypass the independent confirmed-evidence prerequisite.
    const lease = LOCAL_CURATION_CAPABILITIES.maintenance.acquireWriterLease(knowledgeRoot)
    if (lease.kind !== 'acquired')
      throw new Error('fixture confirmation needs its own writer lease')
    try {
      const store = createLocalKnowledgeStore({
        knowledgeRoot,
        auditBaseDir: deps.agentQaRoot,
        executionContext: 'local-interactive',
        writerLeaseId: lease.leaseId,
        epoch: lease.epoch,
        sourceBuildOrdinal: 43,
      })
      await store.commit([
        {
          kind: 'Confirm',
          origin: 'agent',
          scope: { tier: 'product', key: 'storefront' },
          citedIds: [asRecordId(candidateId)],
          targetId: asRecordId(candidateId),
          evidenceToken: asEvidenceToken('417-fixture-confirmation'),
          authorship: { path: 'deterministic-fallback', executionContext: 'local-interactive' },
        },
      ])
    } finally {
      LOCAL_CURATION_CAPABILITIES.maintenance.releaseLease({
        knowledgeRoot,
        leaseId: lease.leaseId,
      })
    }
    const resolvePromotionPosture = () => resolvedPromotionPosture()
    const host = createReplayGateHost({
      ...deps,
      curation: LOCAL_CURATION_CAPABILITIES,
      resolvePromotionPosture,
    })
    expect(await host.run(candidateId)).toMatchObject({ recorded: 'appended' })
    expect(await host.run(candidateId)).toMatchObject({ recorded: 'duplicate' })
    const read = gateReceiptsFor({ knowledgeRoot, candidateId, resolvePromotionPosture })
    expect(read).toMatchObject({
      kind: 'found',
      lines: [{ gate: 1, verdict: 'pass' }],
      standing: [{ gate: 1 }],
      live: { verdict: 'hold', reason: 'gate2-receipt-required' },
    })
    if (read.kind !== 'found') throw new Error('missing persisted receipt')
    expect(read.lines).toHaveLength(1)
    expect(GateReceiptSchema.parse(read.lines[0]).receiptDigest).toBe(
      receiptDigestOf(read.lines[0]!),
    )
  })
  it('serializes only schema-valid, committed-egress-safe receipts', () => {
    const receipt = completeGate1Receipt(candidateId)
    expect(JSON.parse(serializeReplayGateReceipt(receipt))).toEqual(receipt)
    expect(() => serializeReplayGateReceipt({ kind: 'refused', reason: 'private' })).toThrow()
    expect(() =>
      serializeReplayGateReceipt({ ...receipt, candidateId: 'AKIAIOSFODNN7EXAMPLE' }),
    ).toThrow()
  })
  it('defers auth and full masking setup until the spend boundary, then masks workspace secrets', async () => {
    writeFileSync(
      deps.configPath,
      readFileSync(deps.configPath, 'utf8') +
        '\nregistry:\n  llms:\n    - name: planner\n      provider: openai-compatible\n      model: gpt-stub\n      baseURL: http://localhost:9999/v1\n    - name: judge\n      provider: openai-compatible\n      model: claude-stub\n      baseURL: http://localhost:9999/v1\neval:\n  judge: judge\n',
    )
    const config = readFileSync(deps.configPath, 'utf8').replace('use:\n', 'use:\n  llm: planner\n')
    writeFileSync(deps.configPath, config)
    const secret = 'fixture-masking-token-417-only'
    writeFileSync(join(root, '.env.secrets.local'), `FIXTURE_SECRET=${secret}\n`)
    const session = await resolveEvalSession({ configPath: deps.configPath, keyOnly: true })
    const auth = vi
      .spyOn(llm, 'resolveModelAuth')
      .mockResolvedValue({
        kind: 'unauthenticated',
        credentialKey: 'fixture',
        provider: 'openai-compatible',
        optional: true,
        message: 'fixture',
      })
    const reads = vi.spyOn(fsPromises, 'readFile')
    let spend = false
    vi.spyOn(bridge, 'createReplayGateHost').mockImplementation((input) => ({
      port: { runReplayGate: async () => completeGate1Receipt(candidateId) },
      run: async () => {
        expect(auth).not.toHaveBeenCalled()
        expect(reads.mock.calls.some(([path]) => String(path).endsWith('.env.secrets.local'))).toBe(
          false,
        )
        expect(input.composition.judge).toBeDefined()
        if (spend) {
          await input.composition.planner.resolveAuth()
          expect(auth).toHaveBeenCalledTimes(1)
          const masker = input.session.maskingContextFactory()
          expect(masker.mask(secret)).not.toContain(secret)
          masker.dispose()
          await input.composition.judge!.resolveAuth()
          expect(auth).toHaveBeenCalledTimes(3)
        }
        return {
          kind: 'refused',
          refusal: { path: root, reason: 'fixture-preflight' },
          notices: [],
          exit: 2,
        }
      },
    }))
    await runReplayGateVerb(session, candidateId)
    expect(auth).not.toHaveBeenCalled()
    spend = true
    reads.mockClear()
    await runReplayGateVerb(session, candidateId)
    expect(auth).toHaveBeenCalledTimes(3)
  })
  it('keeps the bridge behind the existing eval session seam with DATA-only imports', () => {
    const source = readFileSync(new URL('../replay-gate-host.ts', import.meta.url), 'utf8')
    expect(source).not.toMatch(/from ['"]@vostride\/agent-qa-(eval|knowledge)/)
    expect(source).toContain("await import('../eval-session-composition.js')")
    expect(source).toMatch(/import type \{\s+EvalSession,\s+RunReplayGateInput,\s+RunReplayGateResult,?\s+\} from '\.\.\/eval-session-composition.js'/)
  })
})
