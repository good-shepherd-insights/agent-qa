import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

import {
  DEFAULT_EMBEDDING_PROFILE,
  asEvidenceToken,
  RETRIEVAL_RUNG_REASONS,
  type EmbeddingProfile,
} from '@vostride/agent-qa-schema'

import {
  EMBEDDER_WORKER_NOT_REGISTERED_TEXT,
  NO_KNOWLEDGE_ROOT_MESSAGE,
  RUNG_CAUSE_LABELS,
  createKnowledgeChecks,
  type KnowledgeCheckProbes,
} from '../commands/doctor-knowledge-checks.js'
import type { PromotionPostureHostFacts, PromotionPostureResolution } from '../curation/promotion-posture.js'
import { buildPromotionPostureResolver } from '../curation/promotion-posture.js'
import { emptyCanaryCreditCounters } from '../curation/canary-credit.js'
import { completedRunsRoot, CURATION_TAIL_RECEIPT_FILE, readCurationTailReceipt } from '../curation/curation-tail.js'
import { promotionHostProof } from './promotion-host-proof.js'
import { publishBundleForTest, appendPromotionReceipt } from '@vostride/agent-qa-knowledge-local'

const PRIOR_SUFFIX = '; label calibration: absent; trust priors: provisional; judge panel: capability gap: panel-not-configured'

const STATIC_PROFILE: EmbeddingProfile = { ...DEFAULT_EMBEDDING_PROFILE, backend: 'static' }

/** `ready` carries a live `EmbedderPort`; no row reads it, so the cells hand over a stub. */
function ready(rung: 'native' | 'floor', profile: EmbeddingProfile = DEFAULT_EMBEDDING_PROFILE) {
  return { kind: 'ready', rung, profile, embedder: {} } as never
}

function deferred(reason: string) {
  return { kind: 'deferred', reason } as never
}

const LEXICAL_ONLY = { kind: 'lexical-only' } as never

interface Project {
  config: Record<string, unknown>
  configPath: string
  knowledgeRoot: string
  agentQaRoot: string
  projectRoot: string
}

const created: string[] = []

function receipt(project: Project, name: string, canary = emptyCanaryCreditCounters(), extra: Record<string, unknown> = {}) {
  const dir = join(completedRunsRoot(project.agentQaRoot), name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'handoff.json'), '{}')
  writeFileSync(join(dir, CURATION_TAIL_RECEIPT_FILE), JSON.stringify({ schemaVersion: 4,
    runId: name, handoffDigest: 'a'.repeat(64), projectionVersion: 1, drainKind: 'drained',
    handoffHolderPid: null, candidateIds: [], canary, ...extra }))
  return dir
}

function makeProject(options: { withKnowledgeDir?: boolean } = {}): Project {
  const projectRoot = mkdtempSync(join(tmpdir(), 'doctor-knowledge-'))
  created.push(projectRoot)
  const knowledgeRoot = join(projectRoot, 'agent-qa-knowledge')
  if (options.withKnowledgeDir !== false) mkdirSync(knowledgeRoot, { recursive: true })
  return {
    config: { knowledge: { dir: 'agent-qa-knowledge' } },
    configPath: join(projectRoot, 'agent-qa.config.yaml'),
    knowledgeRoot,
    agentQaRoot: join(projectRoot, '.agent-qa'),
    projectRoot,
  }
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

function baseProbes(overrides: Partial<KnowledgeCheckProbes> = {}): KnowledgeCheckProbes {
  return {
    classifyIndexFace: () => ({ source: 'index' }),
    resolveEmbedderCapability: () => Promise.resolve(ready('native')),
    readWriterLease: () => ({ kind: 'absent' }),
    readEmbedderWorkerRegistration: () => ({ kind: 'absent' }),
    readDaemonEventLedger: () => ({ events: [] }),
    ...overrides,
  }
}

async function runChecks(project: Project, probes: KnowledgeCheckProbes) {
  const checks = createKnowledgeChecks({
    config: project.config,
    configPath: project.configPath,
    probes,
  })
  const results = await Promise.all(checks.map(check => check.check()))
  return {
    checks,
    store: results[0]!,
    embedder: results[1]!,
    rung: results[2]!,
    learning: results[3],
  }
}

describe('createKnowledgeChecks', () => {
  it('returns exactly four rows named store, embedder, rung, learning in that order', () => {
    const project = makeProject()
    const checks = createKnowledgeChecks({ config: project.config, configPath: project.configPath })
    expect(checks.map(check => check.name)).toEqual([
      'Knowledge store',
      'Embedder',
      'Retrieval rung',
      'Learning mode',
    ])
  })

  it('skips all four rows when the raw config is null', async () => {
    const project = makeProject()
    const checks = createKnowledgeChecks({ config: null, configPath: project.configPath })
    const results = await Promise.all(checks.map(check => check.check()))
    expect(results).toEqual([
      { status: 'skip', message: NO_KNOWLEDGE_ROOT_MESSAGE },
      { status: 'skip', message: NO_KNOWLEDGE_ROOT_MESSAGE },
      { status: 'skip', message: NO_KNOWLEDGE_ROOT_MESSAGE },
      { status: 'skip', message: NO_KNOWLEDGE_ROOT_MESSAGE + PRIOR_SUFFIX },
    ])
  })

  it('skips all four rows when the configured knowledge dir does not exist on disk', async () => {
    const project = makeProject({ withKnowledgeDir: false })
    const classifyIndexFace = vi.fn(() => ({ source: 'index' as const }))
    const buildPromotionPosture = vi.fn()
    const { store, embedder, rung, learning } = await runChecks(project, baseProbes({ classifyIndexFace, buildPromotionPosture }))
    expect(learning).toEqual({ status: 'skip', message: NO_KNOWLEDGE_ROOT_MESSAGE + PRIOR_SUFFIX })
    expect(buildPromotionPosture).not.toHaveBeenCalled()
    expect(store.status).toBe('skip')
    expect(embedder.status).toBe('skip')
    expect(rung.status).toBe('skip')
    expect(store.message).toBe(NO_KNOWLEDGE_ROOT_MESSAGE)
    expect(classifyIndexFace).not.toHaveBeenCalled()
  })

  it('passes all three rows on an open index with a native embedder', async () => {
    const project = makeProject()
    const { store, embedder, rung } = await runChecks(project, baseProbes())
    const relativeRoot = relative(process.cwd(), project.knowledgeRoot) || '.'
    expect(store).toEqual({ status: 'pass', message: `index open at ${relativeRoot} (memidex)` })
    expect(embedder).toEqual({
      status: 'pass',
      message: `native (${DEFAULT_EMBEDDING_PROFILE.model_id})`,
    })
    expect(rung).toEqual({ status: 'pass', message: 'memidex' })
  })

  it('warns store and rung on an absent index, and still probes the embedder for its own row', async () => {
    const project = makeProject()
    const resolveEmbedderCapability = vi.fn(() => Promise.resolve(ready('native')))
    const { store, embedder, rung } = await runChecks(project, baseProbes({
      classifyIndexFace: () => ({
        source: 'scan',
        reason: 'absent',
        detail: 'derived index file is absent',
        filePresent: false,
      }),
      resolveEmbedderCapability,
    }))
    const relativeRoot = relative(process.cwd(), project.knowledgeRoot) || '.'
    expect(store).toEqual({
      status: 'warn',
      message: `no index at ${relativeRoot} — scanning bundles (${RUNG_CAUSE_LABELS['index-unavailable']})`,
    })
    expect(rung).toEqual({
      status: 'warn',
      message: `bundle-scan — ${RUNG_CAUSE_LABELS['index-unavailable']}`,
    })
    expect(embedder.status).toBe('pass')
    expect(resolveEmbedderCapability).toHaveBeenCalledTimes(1)
  })

  it.each(['corrupt', 'locked', 'schema-version'] as const)(
    'fails the store row on a present-but-unopenable index (%s), naming the reason word not the driver detail',
    async (reason) => {
      const project = makeProject()
      const { checks, store, rung } = await runChecks(project, baseProbes({
        classifyIndexFace: () => ({
          source: 'scan',
          reason,
          detail: 'SQLITE_NOTADB: file is not a database (deep driver text)',
          filePresent: true,
        }),
      }))
      const indexPath = relative(process.cwd(), join(project.knowledgeRoot, 'memory', 'index', 'knowledge.db'))
      expect(store.status).toBe('fail')
      expect(store.message).toBe(`index at ${indexPath} could not be opened: ${reason}`)
      expect(store.message).not.toContain('SQLITE_NOTADB')
      expect(checks[0].fixInstructions).toContain('agent-qa knowledge rebuild-index')
      expect(rung.status).toBe('warn')
    },
  )

  it('warns the embedder and rung rows on a static floor reached because native could not load', async () => {
    const project = makeProject()
    const { embedder, rung } = await runChecks(project, baseProbes({
      resolveEmbedderCapability: () => Promise.resolve(ready('floor')),
    }))
    expect(embedder).toEqual({
      status: 'warn',
      message: `static floor — ${RUNG_CAUSE_LABELS['native-runtime-unavailable']}`,
    })
    expect(rung).toEqual({
      status: 'warn',
      message: `static-floor — ${RUNG_CAUSE_LABELS['native-runtime-unavailable']}`,
    })
  })

  it('names a deliberately static PREFERRED profile as configured rather than as a fault', async () => {
    const project = makeProject()
    const checks = createKnowledgeChecks({
      config: project.config,
      configPath: project.configPath,
      preferredProfile: STATIC_PROFILE,
      probes: baseProbes({
        resolveEmbedderCapability: () => Promise.resolve(ready('floor', STATIC_PROFILE)),
      }),
    })
    const [, embedder, rung] = await Promise.all(checks.map(check => check.check()))
    expect(embedder).toEqual({
      status: 'warn',
      message: `static floor — ${RUNG_CAUSE_LABELS['profile-static-configured']}`,
    })
    expect(rung).toEqual({
      status: 'warn',
      message: `static-floor — ${RUNG_CAUSE_LABELS['profile-static-configured']}`,
    })
  })

  it.each([
    ['ram-budget', 'low-ram-deferral'],
    ['cold-artifact', 'model-not-downloaded'],
    ['load-failure', 'embedder-load-failed'],
    ['worker-unavailable', 'profile-unresolved'],
  ] as const)('warns embedder and rung for a deferred embedder (%s)', async (reason, expected) => {
    const project = makeProject()
    const { embedder, rung } = await runChecks(project, baseProbes({
      resolveEmbedderCapability: () => Promise.resolve(deferred(reason)),
    }))
    expect(embedder).toEqual({ status: 'warn', message: `none — ${RUNG_CAUSE_LABELS[expected]}` })
    expect(rung).toEqual({ status: 'warn', message: `lexical-only — ${RUNG_CAUSE_LABELS[expected]}` })
  })

  it('warns embedder and rung when the static floor was explicitly disabled', async () => {
    const project = makeProject()
    const { embedder, rung } = await runChecks(project, baseProbes({
      resolveEmbedderCapability: () => Promise.resolve(LEXICAL_ONLY),
    }))
    expect(embedder).toEqual({
      status: 'warn',
      message: `none — ${RUNG_CAUSE_LABELS['floor-disabled']}`,
    })
    expect(rung).toEqual({
      status: 'warn',
      message: `lexical-only — ${RUNG_CAUSE_LABELS['floor-disabled']}`,
    })
  })

  it('folds a rejecting capability probe into a load failure rather than throwing', async () => {
    const project = makeProject()
    const { embedder, rung } = await runChecks(project, baseProbes({
      resolveEmbedderCapability: () => Promise.reject(new Error('probe exploded')),
    }))
    expect(embedder.message).toBe(`none — ${RUNG_CAUSE_LABELS['embedder-load-failed']}`)
    expect(rung.message).toBe(`lexical-only — ${RUNG_CAUSE_LABELS['embedder-load-failed']}`)
    expect(embedder.message).not.toContain('probe exploded')
  })

  it('fails the embedder row with the 399 wording when a live daemon lease has no worker registration', async () => {
    const project = makeProject()
    const { checks, embedder, rung } = await runChecks(project, baseProbes({
      readWriterLease: () => ({ kind: 'parsed', lease: {} as never }),
      readEmbedderWorkerRegistration: () => ({ kind: 'absent' }),
      readDaemonEventLedger: () => ({
        events: [
          { kind: 'embedder-worker-start' },
          {
            kind: 'embedder-worker-exit',
            reason: 'crash',
            stderr: 'Error: Embedder worker could not resolve profile: deferred\n    at /home/u/.agent-qa/worker.js',
          },
        ],
      }),
    }))
    expect(embedder).toEqual({ status: 'fail', message: EMBEDDER_WORKER_NOT_REGISTERED_TEXT })
    expect(embedder.message).not.toContain('/home/u/.agent-qa/worker.js')
    expect(checks[1].fixInstructions).toContain('Set an explicit embedder profile')
    expect(rung.status).not.toBe('fail')
  })

  it('fails the embedder row with the ledger reason word when the exit was not a profile failure', async () => {
    const project = makeProject()
    const { embedder } = await runChecks(project, baseProbes({
      readWriterLease: () => ({ kind: 'parsed', lease: {} as never }),
      readEmbedderWorkerRegistration: () => ({ kind: 'absent' }),
      readDaemonEventLedger: () => ({
        events: [{ kind: 'embedder-worker-exit', reason: 'terminated', stderr: 'SIGKILL' }],
      }),
    }))
    expect(embedder).toEqual({
      status: 'fail',
      message: 'embedder worker failed to start: terminated',
    })
  })

  it('fails with `no registration published` when a live lease has no exit row at all', async () => {
    const project = makeProject()
    const { embedder } = await runChecks(project, baseProbes({
      readWriterLease: () => ({ kind: 'parsed', lease: {} as never }),
      readEmbedderWorkerRegistration: () => ({ kind: 'absent' }),
      readDaemonEventLedger: () => ({ events: [] }),
    }))
    expect(embedder).toEqual({
      status: 'fail',
      message: 'embedder worker failed to start: no registration published',
    })
  })

  it('does not consult the daemon half at all when no writer lease is live', async () => {
    const project = makeProject()
    const readEmbedderWorkerRegistration = vi.fn(() => ({ kind: 'absent' as const }))
    const readDaemonEventLedger = vi.fn(() => ({ events: [] }))
    const { embedder } = await runChecks(project, baseProbes({
      readWriterLease: () => ({ kind: 'absent' }),
      readEmbedderWorkerRegistration,
      readDaemonEventLedger,
    }))
    expect(readEmbedderWorkerRegistration).not.toHaveBeenCalled()
    expect(readDaemonEventLedger).not.toHaveBeenCalled()
    expect(embedder.status).toBe('pass')
  })

  it('leaves the embedder row PASSING when a live lease did publish a parsed registration', async () => {
    const project = makeProject()
    const { embedder } = await runChecks(project, baseProbes({
      readWriterLease: () => ({ kind: 'parsed', lease: {} as never }),
      readEmbedderWorkerRegistration: () => ({ kind: 'parsed', registration: {} as never }),
      readDaemonEventLedger: () => ({ events: [] }),
    }))
    expect(embedder).toEqual({
      status: 'pass',
      message: `native (${DEFAULT_EMBEDDING_PROFILE.model_id})`,
    })
  })

  it('warns Learning mode when the eval root is absent, using the display path', async () => {
    const project = makeProject()
    const committedRoot = join(project.projectRoot, 'agent-qa-eval')
    const { learning } = await runChecks(project, baseProbes({
      buildPromotionPosture: async () => ({ kind: 'no-eval-root', committedRoot }),
    }))
    expect(learning).toEqual({ status: 'warn', message: `deterministic-verdict-floor — no eval root at ${relative(process.cwd(), committedRoot)}` + PRIOR_SUFFIX })
  })

  it('passes the production replay port to the posture probe', async () => {
    const project = makeProject()
    const buildPromotionPosture = vi.fn(async () => ({ kind: 'no-eval-root' as const, committedRoot: join(project.projectRoot, 'agent-qa-eval') }))
    await runChecks(project, baseProbes({ buildPromotionPosture }))
    expect(buildPromotionPosture).toHaveBeenCalledWith(expect.objectContaining({
      configPath: expect.any(String), replayGate: { runReplayGate: expect.any(Function) },
    }))
  })

  it.each([
    [true, { capable: false, reason: 'no-judge-configured' }, { kind: 'not-provided', rarePathEligible: false }, 'pass', 'gated (Gate 1 bound; judge none; canary evidence none)'],
    [false, { capable: false, reason: 'no-judge-configured' }, { kind: 'not-provided', rarePathEligible: false }, 'warn', 'deterministic-verdict-floor — no replay gate bound, no judge configured'],
    [false, { capable: true, reason: 'eligible', judgeFamily: 'anthropic' }, { kind: 'not-provided', rarePathEligible: false }, 'warn', 'deterministic-verdict-floor — no replay gate bound; judge anthropic configured'],
    [true, { capable: true, reason: 'eligible', judgeFamily: 'anthropic' }, { kind: 'provided', attributedRows: 4, rarePathEligible: false }, 'pass', 'gated (Gate 1 bound; judge anthropic; canary evidence 4)'],
    [true, { capable: true, reason: 'eligible', judgeFamily: 'anthropic' }, { kind: 'not-provided', rarePathEligible: false }, 'pass', 'gated (Gate 1 bound; judge anthropic; canary evidence none)'],
    [false, { capable: false, reason: 'no-eligible-judge' }, { kind: 'not-provided', rarePathEligible: false }, 'warn', 'deterministic-verdict-floor — no replay gate bound; configured judge ineligible'],
    [true, { capable: false, reason: 'no-eligible-judge' }, { kind: 'not-provided', rarePathEligible: false }, 'pass', 'gated (Gate 1 bound; judge ineligible; canary evidence none)'],
    [true, { capable: true, reason: 'eligible', judgeFamily: 'anthropic' }, { kind: 'provided', rarePathEligible: false }, 'pass', 'gated (Gate 1 bound; judge anthropic; canary evidence not reported)'],
    [true, { capable: true, reason: 'eligible', judgeFamily: 'anthropic' }, { kind: 'provided', attributedRows: 0, rarePathEligible: false }, 'pass', 'gated (Gate 1 bound; judge anthropic; canary evidence 0)'],
  ] as const)('reports Learning mode for bound=%s, judge=%j, canary=%j', async (replayGateAvailable, judge, canary, status, message) => {
    const project = makeProject()
    const host: PromotionPostureHostFacts = { lowerTrustShares: [], canaryHorizonBuilds: 5, canaryHorizonBuildsSource: 'default', maxLowerTrustPerScope: 2, maxLowerTrustPerScopeSource: 'default', notices: [], replayGateAvailable, judge, canary, corpusDigest: 'a'.repeat(64), minimumGateSet: 3, profileKey: 'test-profile' }
    const { learning } = await runChecks(project, baseProbes({
      buildPromotionPosture: async () => ({ kind: 'ready', committedRoot: join(project.projectRoot, 'agent-qa-eval'), host, resolve: () => undefined }),
    }))
    expect(learning).toEqual({ status, message: (replayGateAvailable
      ? `${message.slice(0, -1)}; since-v4 ride-along 0; cap-exceeded 0; lower-trust none; staged 0)`
      : message) + PRIOR_SUFFIX })
  })

  it('folds only validated v4 receipts into since-v4 counts and renders per-product shares', async () => {
    const project = makeProject()
    receipt(project, 'first', { ...emptyCanaryCreditCounters(), rideAlongUncredited: 1, ablationCapExceeded: 1 })
    receipt(project, 'second', { ...emptyCanaryCreditCounters(), rideAlongUncredited: 2, staged: 3 })
    for (const [name, extra] of [['old', { schemaVersion: 3 }], ['extra', { unexpected: true }],
      ['bad-count', { canary: { ...emptyCanaryCreditCounters(), staged: -1 } }]] as const) {
      const dir = receipt(project, name, { ...emptyCanaryCreditCounters(), rideAlongUncredited: 100 }, extra)
      expect(readCurationTailReceipt(dir)).toBeUndefined()
    }
    const missing = join(completedRunsRoot(project.agentQaRoot), 'missing')
    mkdirSync(missing)
    writeFileSync(join(missing, 'handoff.json'), '{}')
    const host: PromotionPostureHostFacts = { replayGateAvailable: true,
      judge: { capable: false, reason: 'no-judge-configured' }, canary: { kind: 'not-provided', rarePathEligible: false },
      corpusDigest: 'a'.repeat(64), minimumGateSet: 3, profileKey: 'test-profile',
      lowerTrustShares: [{ product: 'example-web', active: 4, lowerTrust: 1 },
        { product: 'empty-product', active: 0, lowerTrust: 0 }],
      canaryHorizonBuilds: 5, canaryHorizonBuildsSource: 'default', maxLowerTrustPerScope: 2,
      maxLowerTrustPerScopeSource: 'default', notices: [] }
    const { checks, learning } = await runChecks(project, baseProbes({
      buildPromotionPosture: async () => ({ kind: 'ready', committedRoot: '', host, resolve: () => undefined }),
    }))
    expect(checks).toHaveLength(4)
    expect(learning).toEqual({ status: 'pass', message: 'gated (Gate 1 bound; judge none; canary evidence none; since-v4 ride-along 3; cap-exceeded 1; lower-trust 1/4 active in example-web, 0/0 active in empty-product; staged 3)' + PRIOR_SUFFIX })
  })

  it('discloses actual on-disk shares through the production doctor facts binding without replay or writes', async () => {
    const project = makeProject()
    promotionHostProof(project.configPath)
    const appendConfig = { knowledgeRoot: project.knowledgeRoot, auditBaseDir: project.agentQaRoot,
      productKey: 'storefront', commitArtifacts: 'none' as const, writerLeaseId: 'fixture' }
    for (let index = 0; index < 4; index += 1) {
      const name = ['alpha', 'beta', 'gamma', 'delta'][index]!
      const published = publishBundleForTest(appendConfig, {
        draft: { kind: 'caution', scope: { tier: 'product', key: 'storefront' },
          anchors: [{ t: 'error', message: name }], summary: name, body: `Observed ${name}.`,
          originStage: 'run-curation', distilledEvidenceRef: { id: name, sha: 'a'.repeat(64) } },
        discriminant: { kind: 'caution', errorKey: name }, originClass: 'agent-verified',
        createdAtOrdinal: 42, screenStates: [], relations: [], artifacts: [],
        initialEvents: [{ type: 'promoted', evidenceToken: asEvidenceToken(name), curationJobId: name, buildOrdinal: 45 }],
        provenance: { mode: 'standalone', sourceDescription: 'doctor fixture' },
        evidenceMarkdown: 'Observed caution.\n',
      })
      if (published.kind !== 'published') throw new Error(published.kind)
      if (index === 0) expect(appendPromotionReceipt(appendConfig, published.id, {
        schemaVersion: 1, kind: 'promotion', candidateId: published.id, promotionPath: 'gate1-lower-trust',
        citedReceiptDigests: [], producedAtOrdinal: 45, producedBy: { opId: 'doctor-fixture' },
      })).toEqual({ kind: 'appended' })
    }
    receipt(project, 'live', { ...emptyCanaryCreditCounters(), rideAlongUncredited: 3, ablationCapExceeded: 1, staged: 3 })
    const replay = vi.fn(() => { throw new Error('doctor must never run replay') })
    const buildPromotionPosture = vi.fn<NonNullable<KnowledgeCheckProbes['buildPromotionPosture']>>(async input => {
      expect(input.knowledgeRoot).toBe(project.knowledgeRoot)
      expect(input.agentQaRoot).toBe(project.agentQaRoot)
      expect(input.canaryFacts).toBeTypeOf('function')
      expect(input.lowerTrustShares).toBeTypeOf('function')
      expect(input.currentBuildOrdinal).toBeTypeOf('function')
      vi.spyOn(input.replayGate!, 'runReplayGate').mockImplementation(replay)
      return buildPromotionPostureResolver(input)
    })
    const snapshot = () => readdirSync(project.projectRoot, { recursive: true, withFileTypes: true })
      .filter(row => row.isFile()).map(row => {
        const path = join(row.parentPath, row.name)
        return [relative(project.projectRoot, path), readFileSync(path).toString('base64')]
      }).sort((a, b) => a[0]!.localeCompare(b[0]!))
    const before = snapshot()
    const { learning } = await runChecks(project, baseProbes({ buildPromotionPosture }))
    expect(learning?.message).toContain('since-v4 ride-along 3; cap-exceeded 1; lower-trust 1/4 active in storefront; staged 3')
    expect(learning?.status).toBe('pass')
    expect(buildPromotionPosture).toHaveBeenCalledTimes(1)
    expect(replay).not.toHaveBeenCalled()
    expect(snapshot()).toEqual(before)
  })

  it('fails Learning mode with a safe cause while retaining the complete internal refusal', async () => {
    const project = makeProject()
    const refusals = ['noise-floor: no artefact for profile X', 'second refusal']
    const { learning } = await runChecks(project, baseProbes({
      buildPromotionPosture: async () => ({ kind: 'unavailable', committedRoot: join(project.projectRoot, 'agent-qa-eval'), refusals, resolve: () => undefined }),
    }))
    expect(learning).toEqual({ status: 'fail', message: 'posture-unavailable — noise-floor: no artefact for the active profile' + PRIOR_SUFFIX })
    expect(refusals).toEqual(['noise-floor: no artefact for profile X', 'second refusal'])
  })

  it.each([
    ['noise-floor: no artefact for profile private-provider/private-model', 'noise-floor: no artefact for the active profile'],
    ['noise-floor: no minimumGateSet value at /private/project/agent-qa-eval/noise-floor/private-profile.json', 'noise-floor: no minimumGateSet value'],
    ['/private/project/agent-qa-eval/corpus.json: invalid entry AKIAIOSFODNN7EXAMPLE', 'eval posture could not be resolved'],
  ])('does not echo profile, path or input text from a refused posture', async (refusal, cause) => {
    const project = makeProject()
    const refusals = [refusal]
    const { learning } = await runChecks(project, baseProbes({
      buildPromotionPosture: async () => ({ kind: 'unavailable', committedRoot: join(project.projectRoot, 'agent-qa-eval'), refusals, resolve: () => undefined }),
    }))
    expect(learning).toEqual({ status: 'fail', message: `posture-unavailable — ${cause}` + PRIOR_SUFFIX })
    expect(refusals).toEqual([refusal])
  })

  it('folds a throwing posture builder into an unavailable row without its raw message or stack', async () => {
    const project = makeProject()
    const { learning } = await runChecks(project, baseProbes({
      buildPromotionPosture: async () => { throw new Error('posture read refused for private-model: Bearer synthetic-receipt-token') },
    }))
    expect(learning).toEqual({ status: 'fail', message: 'posture-unavailable — eval posture could not be resolved' + PRIOR_SUFFIX })
  })

  it('probes each axis exactly once across all four rows', async () => {
    const project = makeProject()
    const classifyIndexFace = vi.fn(() => ({ source: 'index' as const }))
    const resolveEmbedderCapability = vi.fn(() => Promise.resolve(ready('native')))
    const buildPromotionPosture = vi.fn(async (): Promise<PromotionPostureResolution> => ({ kind: 'no-eval-root', committedRoot: join(project.projectRoot, 'agent-qa-eval') }))
    const { checks } = await runChecks(project, baseProbes({ classifyIndexFace, resolveEmbedderCapability, buildPromotionPosture }))
    await Promise.all(checks.map(check => check.check()))
    expect(classifyIndexFace).toHaveBeenCalledTimes(1)
    expect(resolveEmbedderCapability).toHaveBeenCalledTimes(1)
    expect(buildPromotionPosture).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ configPath: project.configPath,
      replayGate: { runReplayGate: expect.any(Function) },
      canaryFacts: expect.any(Function), lowerTrustShares: expect.any(Function),
      currentBuildOrdinal: expect.any(Function),
    }))
  })

  it('hard-codes allowDownload false on the capability probe (D-20: asking must not change the answer)', async () => {
    const project = makeProject()
    const resolveEmbedderCapability = vi.fn(() => Promise.resolve(ready('native')))
    await runChecks(project, baseProbes({ resolveEmbedderCapability }))
    expect(resolveEmbedderCapability).toHaveBeenCalledWith(
      expect.objectContaining({ allowDownload: false, agentQaRoot: project.agentQaRoot }),
    )
  })

  it('never returns fail on the Retrieval rung row, over every index face x embedder outcome', async () => {
    const project = makeProject()
    const faces = [
      { source: 'index' as const },
      ...(['absent', 'corrupt', 'locked', 'schema-version'] as const).flatMap(reason => (
        [true, false].map(filePresent => ({
          source: 'scan' as const,
          reason,
          detail: 'detail',
          filePresent,
        }))
      )),
    ]
    const embedders = [
      ready('native'),
      ready('floor'),
      deferred('ram-budget'),
      deferred('cold-artifact'),
      deferred('load-failure'),
      deferred('worker-unavailable'),
      LEXICAL_ONLY,
    ]

    for (const face of faces) {
      for (const embedder of embedders) {
        const { rung } = await runChecks(project, baseProbes({
          classifyIndexFace: () => face,
          resolveEmbedderCapability: () => Promise.resolve(embedder),
        }))
        expect(rung.status).not.toBe('fail')
        expect(rung.message.trim()).not.toBe('')
        if (rung.status === 'warn') expect(rung.message).toContain(' — ')
      }
    }
  })

  it('maps every reason word in the closed vocabulary to a non-empty label', () => {
    for (const reason of RETRIEVAL_RUNG_REASONS) {
      expect(RUNG_CAUSE_LABELS[reason]).toBeTruthy()
    }
    expect(Object.keys(RUNG_CAUSE_LABELS).sort()).toEqual([...RETRIEVAL_RUNG_REASONS].sort())
  })

  it('is idempotent against a real knowledge root: same answers, byte-identical listing, nothing written', async () => {
    const project = makeProject()
    mkdirSync(join(project.knowledgeRoot, 'memory'), { recursive: true })
    writeFileSync(join(project.knowledgeRoot, 'memory', '.keep'), '', 'utf8')

    // Everything real EXCEPT the capability probe: a live probe may load a model, and this cell's
    // subject is what the checks WRITE, not which rung this machine happens to be on.
    const probes: KnowledgeCheckProbes = {
      resolveEmbedderCapability: () => Promise.resolve(LEXICAL_ONLY),
    }

    const listing = () => readdirSync(project.projectRoot, { recursive: true }).map(String).sort()
    const before = listing()

    const first = await runChecks(project, probes)
    const afterFirst = listing()
    const second = await runChecks(project, probes)
    const afterSecond = listing()

    expect(second.store).toEqual(first.store)
    expect(second.embedder).toEqual(first.embedder)
    expect(second.rung).toEqual(first.rung)
    expect(second.learning).toEqual(first.learning)
    expect(first.learning).toEqual({ status: 'warn', message: `deterministic-verdict-floor — no eval root at ${relative(process.cwd(), join(project.projectRoot, 'agent-qa-eval'))}` + PRIOR_SUFFIX })

    expect(afterFirst).toEqual(before)
    expect(afterSecond).toEqual(before)
    expect(afterSecond.some(entry => entry.includes('.rebuild-requested'))).toBe(false)
    expect(afterSecond.some(entry => entry.includes('lease'))).toBe(false)
    expect(afterSecond.some(entry => entry.includes('.agent-qa'))).toBe(false)

    expect(first.rung).toEqual({
      status: 'warn',
      message: `bundle-scan — ${RUNG_CAUSE_LABELS['index-unavailable']}`,
    })
  })
})
