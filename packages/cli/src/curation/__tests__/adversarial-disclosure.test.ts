// 422-17: what the chain terminal line and the doctor Learning-mode row say about the third
// stage, its probe gap, its ungated remainder and what actually backs its circularity claim.
//
// THE ONE LAW EVERY CELL HERE ENFORCES IS "ABSENT IS NOT ZERO". Four upstream sources in this
// phase are deliberately three-valued — 422-06's `usageKnown`, 422-19's `metadataUnavailable`,
// 422-20's `judgeTargeted`, and this plan's own `stages.proposals` — and a surface that rendered
// any of them as a flat `0` would make "nothing was recorded" indistinguishable from "nothing
// happened". Those are opposite statements to the operator reading the line.
//
// The cells are BEHAVIOURAL: they drive the real renderer and the real doctor rows over real
// persisted bytes. The #427 structural cell pins agreement between the honesty constant and
// the shipped composition's source.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  CurationSnapshotSchema,
  guardRunNotification,
  type RecordChange,
  type RunNotification,
} from '@vostride/agent-qa-schema'
import type { ProposeGate1Report } from '@vostride/agent-qa-agent'
import {
  ADVERSARIAL_MANIFEST_FILE,
  ADVERSARIAL_STAGING_SUBDIR,
} from '@vostride/agent-qa-eval-local'

import {
  MISDIRECTION_POSTURE_BOUND_AT_HOST,
  defaultPostRunTailOperations,
  renderChainTerminalLine,
  type CircularityGuardDisclosure,
  type ProposalGate1Disclosure,
} from '../post-run-tail.js'
import { createKnowledgeChecks, type KnowledgeCheckProbes } from '../../commands/doctor-knowledge-checks.js'

const created: string[] = []
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

function project(config: Record<string, unknown> = { knowledge: { dir: 'agent-qa-knowledge' } }) {
  const root = mkdtempSync(join(tmpdir(), 'adversarial-disclosure-'))
  created.push(root)
  mkdirSync(join(root, 'agent-qa-knowledge'), { recursive: true })
  return {
    root,
    config,
    configPath: join(root, 'agent-qa.config.yaml'),
    agentQaRoot: join(root, '.agent-qa'),
  }
}

function notification(
  stages: Partial<RunNotification['stages']> = {},
  outcome: RunNotification['outcome'] = 'done',
): RunNotification {
  return {
    schemaVersion: 4,
    runId: 'fixture-run',
    outcome,
    verdictSummary: { total: 1, byClass: { app_bug: 1 } },
    stages: {
      analysis: { status: 'done' },
      curation: { status: 'done', curated: 2, deprecated: 1 },
      ...stages,
    },
  }
}

const NO_GATE1_WORK = {
  reservedGate1: [],
  screenedGate1: [],
  recoveredGate1Receipts: [],
  interruptedGate1: [],
  ungatedRemaining: [],
  kindExcluded: [],
  stale: [],
} as const

function gate1(overrides: Partial<ProposeGate1Report> = {}): ProposeGate1Report {
  return { ...NO_GATE1_WORK, disposition: 'claimed', ...overrides }
}

describe('the chain terminal line and the third stage (D-13/D-14/D-19)', () => {
  it('says the proposal stage is not recorded rather than staged 0 when the row carries none', () => {
    const line = renderChainTerminalLine(notification())
    expect(line).toContain('proposals: not recorded')
    expect(line).not.toContain('staged 0')
    // The historical population: a v2 row migrated forward names no proposal stage at all, and
    // the migration deliberately synthesises none. The rendered sentence must match that silence.
    const migrated = guardRunNotification({
      schemaVersion: 2,
      runId: 'fixture-run',
      outcome: 'done',
      verdictSummary: { total: 1, byClass: { app_bug: 1 } },
      stages: { analysis: { status: 'done' }, curation: { status: 'done', curated: 2, deprecated: 1 } },
    })
    expect(migrated.stages.proposals).toBeUndefined()
    expect(renderChainTerminalLine(migrated)).toContain('proposals: not recorded')
  })

  it('renders a MEASURED zero as zero, and keeps curation counts untouched beside it', () => {
    const line = renderChainTerminalLine(
      notification({ proposals: { status: 'done', proposed: 0, skipped: 0 } }),
    )
    expect(line).toContain('proposals: done (staged 0, skipped 0')
    expect(line).toContain('curation: done (2 curated, 1 deprecated)')
    expect(line).not.toContain('not recorded')
  })

  it('renders recorded staged and skipped counts exactly as the row carries them', () => {
    expect(
      renderChainTerminalLine(notification({ proposals: { status: 'done', proposed: 3, skipped: 4 } })),
    ).toContain('proposals: done (staged 3, skipped 4')
  })

  it('says staged not recorded for a stage that ran with no staging port bound', () => {
    const line = renderChainTerminalLine(notification({ proposals: { status: 'done' } }))
    expect(line).toContain('proposals: done (staged not recorded')
    expect(line).not.toContain('staged 0')
  })

  it('names a FAILED proposal stage on the line, so a failed chain outcome is attributable', () => {
    const line = renderChainTerminalLine(
      notification({ proposals: { status: 'failed' } }, 'failed'),
    )
    expect(line).toContain('post-processing failed')
    expect(line).toContain('curation: done')
    expect(line).toContain('proposals: failed')
  })

  it('projects the persisted Gate-1 remainder, its interruptions and its screened slots', () => {
    const line = renderChainTerminalLine(
      notification({ proposals: { status: 'done', proposed: 1, skipped: 0 } }),
      {
        proposalGate1: {
          kind: 'recorded',
          report: gate1({
            reservedGate1: ['a', 'b'],
            screenedGate1: [{ candidateId: 'a', verdict: 'pass' }],
            interruptedGate1: ['b'],
            ungatedRemaining: ['c', 'd', 'e'],
          }),
        },
      },
    )
    expect(line).toContain('Gate-1 claimed: ungated remaining 3, screened 1, interrupted 1')
  })

  it('keeps a broken corpus root distinguishable from a zero remainder', () => {
    const unavailable = renderChainTerminalLine(
      notification({ proposals: { status: 'done', proposed: 0, skipped: 0 } }),
      {
        proposalGate1: {
          kind: 'recorded',
          // The reason text is deliberately hostile: it must not reach the line.
          report: gate1({ disposition: 'posture-unavailable', reason: '/Users/secret/agent-qa-eval is unreadable' }),
        },
      },
    )
    expect(unavailable).toContain('Gate-1 posture-unavailable: ungated remaining 0')
    expect(unavailable).not.toContain('secret')
    expect(unavailable).not.toContain('/Users/')
  })

  it('tells not-recorded, unreadable and not-bound Gate-1 legs apart', () => {
    const row = notification({ proposals: { status: 'done', proposed: 0, skipped: 0 } })
    const of = (proposalGate1: ProposalGate1Disclosure): string =>
      renderChainTerminalLine(row, { proposalGate1 })
    expect(of({ kind: 'not-recorded' })).toContain('Gate-1 not recorded')
    expect(of({ kind: 'unreadable' })).toContain('Gate-1 unreadable')
    expect(of({ kind: 'unbound' })).toContain('Gate-1 not bound')
    // Three different sentences, so no two of them can be read as the same fact.
    const rendered = new Set([
      of({ kind: 'not-recorded' }),
      of({ kind: 'unreadable' }),
      of({ kind: 'unbound' }),
    ])
    expect(rendered.size).toBe(3)
  })

  it('never carries a candidate id or a digest onto the line', () => {
    const line = renderChainTerminalLine(notification({ proposals: { status: 'done', proposed: 1 } }), {
      proposalGate1: {
        kind: 'recorded',
        report: gate1({
          reservedGate1: ['bundle-super-secret-id'],
          ungatedRemaining: ['bundle-another-secret'],
          stale: ['bundle-third-secret'],
        }),
      },
    })
    expect(line).not.toContain('bundle-')
    expect(line).toContain('ungated remaining 1')
  })
})

function snapshotChange(recordId: string, change: RecordChange['change'], atOrdinal: number): RecordChange {
  return { schemaVersion: 1, recordId, change, atOrdinal }
}

describe('the chain terminal line and the five-bucket curation breakdown (423 D-15)', () => {
  it('CHAIN-LINE-FIVE-BUCKETS: prints the recorded breakdown instead of the legacy pair', () => {
    const curationSnapshot = CurationSnapshotSchema.parse({
      schemaVersion: 1,
      rows: [
        { recordId: 'added-1', bucket: 'added',
          changes: [{ bucket: 'added', change: snapshotChange('added-1', 'added', 1) }] },
        { recordId: 'confirmed-1', bucket: 'confirmed',
          changes: [{ bucket: 'confirmed', change: snapshotChange('confirmed-1', 'confirmed', 2) }] },
        { recordId: 'deprecated-1', bucket: 'deprecated',
          changes: [{ bucket: 'deprecated', change: snapshotChange('deprecated-1', 'deprecated', 3) }] },
        { recordId: 'proposed-1', bucket: 'proposed',
          changes: [{ bucket: 'proposed', change: snapshotChange('proposed-1', 'added', 4) }] },
        { recordId: 'proposed-2', bucket: 'proposed',
          changes: [{ bucket: 'proposed', change: snapshotChange('proposed-2', 'confirmed', 5) }] },
      ],
      breakdown: { added: 1, confirmed: 1, superseded: 0, deprecated: 1, proposed: 2 },
    })
    const recorded = guardRunNotification(notification({
      curation: { status: 'done', curated: 2, deprecated: 1, curationSnapshot },
    }))
    const line = renderChainTerminalLine(recorded)
    expect(line).toContain(
      'curation: done (added 1, confirmed 1, superseded 0, deprecated 1, proposed 2',
    )
    expect(line).not.toContain('curated,')
    expect(line).not.toContain('1 deprecated')

    expect(renderChainTerminalLine(notification())).toContain('curation: done (2 curated, 1 deprecated)')

    const zero = CurationSnapshotSchema.parse({
      schemaVersion: 1,
      rows: [],
      breakdown: { added: 0, confirmed: 0, superseded: 0, deprecated: 0, proposed: 0 },
    })
    expect(renderChainTerminalLine(notification({
      curation: { status: 'done', curated: 0, deprecated: 0, curationSnapshot: zero },
    }))).toContain('curation: done (added 0, confirmed 0, superseded 0, deprecated 0, proposed 0)')
  })
})

describe('the read projection over a real stored notification (422-17-T2)', () => {
  /** The bytes as a store holds them, walked through the ONE guard every reader calls. */
  const stored = (doc: Record<string, unknown>): RunNotification => guardRunNotification(doc)

  it('reports a HISTORICAL v2 row as not recorded, never as a proposal stage that did nothing', () => {
    const row = stored({
      schemaVersion: 2,
      runId: 'historical-run',
      outcome: 'done',
      verdictSummary: { total: 2, byClass: { app_bug: 2 } },
      stages: { analysis: { status: 'done' }, curation: { status: 'done', curated: 1, deprecated: 0 } },
    })
    const line = renderChainTerminalLine(row, { proposalGate1: { kind: 'not-recorded' } })
    expect(line).toContain('proposals: not recorded')
    // A stage that was never recorded has no Gate-1 leg to report on either, so the clause is
    // ABSENT rather than a second "not recorded" about a leg of a stage that did not happen.
    expect(line).not.toContain('Gate-1')
    for (const zero of ['staged 0', 'skipped 0', 'ungated remaining 0']) {
      expect(line).not.toContain(zero)
    }
  })

  it('reports a CURRENT zero-work stage as a measured zero, from the stored counts', () => {
    const row = stored({
      schemaVersion: 3,
      runId: 'zero-work-run',
      outcome: 'done',
      verdictSummary: { total: 0, byClass: {} },
      stages: {
        analysis: { status: 'done' },
        curation: { status: 'done', curated: 0, deprecated: 0 },
        proposals: { status: 'done', proposed: 0, skipped: 0 },
      },
    })
    const line = renderChainTerminalLine(row, {
      proposalGate1: { kind: 'recorded', report: gate1({ disposition: 'no-candidates' }) },
    })
    expect(line).toContain('proposals: done (staged 0, skipped 0')
    expect(line).toContain('Gate-1 no-candidates: ungated remaining 0')
    expect(line).not.toContain('not recorded')
  })

  it('reports a CURRENT failed stage as failed, and invents no counts for it', () => {
    const row = stored({
      schemaVersion: 3,
      runId: 'failed-stage-run',
      outcome: 'failed',
      verdictSummary: { total: 1, byClass: { app_bug: 1 } },
      stages: {
        analysis: { status: 'done' },
        curation: { status: 'done', curated: 1, deprecated: 0 },
        proposals: { status: 'failed' },
      },
    })
    const line = renderChainTerminalLine(row)
    expect(line).toContain('post-processing failed')
    // The stage that actually failed is named, so `failed` beside a `done` curation is
    // attributable rather than a chain outcome with no owner.
    expect(line).toContain('curation: done (1 curated, 0 deprecated)')
    expect(line).toContain('proposals: failed (staged not recorded)')
  })
})

describe('circularity guard backing on the chain line (D-19; WINDOWS #427)', () => {
  const row = notification({ proposals: { status: 'done', proposed: 0, skipped: 0 } })
  const of = (circularity: CircularityGuardDisclosure): string =>
    renderChainTerminalLine(row, { circularity })

  it('says not recorded when this run recorded no evaluation-root posture at all', () => {
    expect(of({ kind: 'not-recorded' })).toContain('circularity guard: not recorded')
  })

  it('says posture-unavailable for a posture file this build could not read', () => {
    expect(of({ kind: 'unreadable' })).toContain('circularity guard: posture-unavailable')
  })

  it('grants declared-only ONLY when the recorded absent root was actually applied', () => {
    expect(of({ kind: 'recorded', posture: 'no-eval-root', appliedAtHost: true }))
      .toContain('circularity guard: declared-only')
    expect(of({ kind: 'recorded', posture: 'broken-eval-root', appliedAtHost: true }))
      .toContain('circularity guard: posture-unavailable')
    expect(of({ kind: 'recorded', posture: 'eval-root', appliedAtHost: true }))
      .toContain('circularity guard: eval-root')
  })

  it('refuses to claim a backing the run did not get when no host binds the posture', () => {
    const line = of({ kind: 'recorded', posture: 'no-eval-root', appliedAtHost: false })
    // The recorded posture would have earned the BYOM exemption; the analysis never saw it.
    expect(line).not.toContain('circularity guard: declared-only')
    expect(line).toContain('circularity guard: eval-root (fail-closed')
    expect(line).toContain('no-eval-root')
    expect(of({ kind: 'recorded', posture: 'broken-eval-root', appliedAtHost: false }))
      .toContain('circularity guard: eval-root (fail-closed')
  })
})

describe('the tail reads its own persisted proposal record (#424)', () => {
  it('reports the persisted Gate-1 report through the host store and the shared chain derivation', async () => {
    const report = gate1({ disposition: 'claimed', ungatedRemaining: ['x', 'y'] })
    const reads: Array<{ jobId: string; checkpointId: string }> = []
    const host = {
      jobs: async () => ({
        idSource: { jobIdFor: (kind: string, key: string) => `${kind}:${key}` },
        store: {
          readCheckpoint: async (jobId: unknown, checkpointId: string) => {
            reads.push({ jobId: String(jobId), checkpointId })
            return { found: true, payload: { value: { runId: 'r1', candidateIds: [], gate1: report } } }
          },
        },
      }),
    } as never
    const read = defaultPostRunTailOperations().readProposalGate1Report
    expect(read).toBeDefined()
    await expect(read!(host, 'r1')).resolves.toEqual({ kind: 'recorded', report })
    // Addressed through `chainJobIdsForRun`'s own transitive derivation, never a run-keyed guess.
    expect(reads).toEqual([
      {
        jobId: 'propose-improvements:curate-memory:analyze-run:r1->curate-memory->propose-improvements',
        checkpointId: 'proposals-authored',
      },
    ])
  })

  it('answers not-recorded for an absent checkpoint and unbound for one with no gate1 block', async () => {
    const read = defaultPostRunTailOperations().readProposalGate1Report!
    const hostWith = (outcome: unknown) => ({
      jobs: async () => ({
        idSource: { jobIdFor: (kind: string, key: string) => `${kind}:${key}` },
        store: { readCheckpoint: async () => outcome },
      }),
    }) as never
    await expect(read(hostWith({ found: false }), 'r1')).resolves.toEqual({ kind: 'not-recorded' })
    await expect(
      read(hostWith({ found: true, payload: { value: { runId: 'r1', candidateIds: [] } } }), 'r1'),
    ).resolves.toEqual({ kind: 'unbound' })
  })

  it('answers unreadable for a checkpoint whose gate1 block this build cannot read', async () => {
    const read = defaultPostRunTailOperations().readProposalGate1Report!
    const host = {
      jobs: async () => ({
        idSource: { jobIdFor: (kind: string, key: string) => `${kind}:${key}` },
        store: {
          readCheckpoint: async () => ({
            found: true,
            payload: { value: { runId: 'r1', candidateIds: [], gate1: { disposition: 'claimed' } } },
          }),
        },
      }),
    } as never
    await expect(read(host, 'r1')).resolves.toEqual({ kind: 'unreadable' })
  })
})

describe('the doctor Learning-mode row (D-09/D-19)', () => {
  /**
   * A host whose committed eval root RESOLVES, because the adversarial half is appended only
   * where it can say something: a `no-eval-root` host holds no staged batch and no refresh
   * record by construction and already says so one clause to the left. The posture is supplied
   * through the probe seam rather than by seeding a real eval root, so these cells measure the
   * disclosure and not `buildPromotionPostureResolver`.
   */
  function probes(p: ReturnType<typeof project>): KnowledgeCheckProbes {
    return {
      classifyIndexFace: () => ({ source: 'index' }),
      resolveEmbedderCapability: () =>
        Promise.resolve({ kind: 'ready', rung: 'native', profile: { model_id: 'm' }, embedder: {} } as never),
      readWriterLease: () => ({ kind: 'absent' }),
      readEmbedderWorkerRegistration: () => ({ kind: 'absent' }),
      readDaemonEventLedger: () => ({ events: [] }),
      buildPromotionPosture: async () => ({
        kind: 'ready',
        committedRoot: join(p.root, 'agent-qa-eval'),
        host: {
          lowerTrustShares: [], canaryHorizonBuilds: 5, canaryHorizonBuildsSource: 'default',
          maxLowerTrustPerScope: 2, maxLowerTrustPerScopeSource: 'default', notices: [],
          replayGateAvailable: true, judge: { capable: false, reason: 'no-judge-configured' },
          canary: { kind: 'not-provided', rarePathEligible: false },
          corpusDigest: 'a'.repeat(64), minimumGateSet: 3, profileKey: 'test-profile',
        },
        resolve: () => undefined,
      }) as never,
    }
  }

  async function learningRow(p: ReturnType<typeof project>) {
    const checks = createKnowledgeChecks({ config: p.config, configPath: p.configPath, probes: probes(p) })
    return await checks[3].check()
  }

  it('says nothing at all on a host whose eval root is absent, which already says it', async () => {
    const p = project()
    const checks = createKnowledgeChecks({
      config: p.config,
      configPath: p.configPath,
      probes: {
        ...probes(p),
        buildPromotionPosture: async () => ({ kind: 'no-eval-root', committedRoot: join(p.root, 'agent-qa-eval') }),
      },
    })
    const row = await checks[3].check()
    expect(row.message).toContain('no eval root at')
    expect(row.message).not.toContain('adversarial:')
  })

  it('names the probe gap by its pinned reason rather than reporting zero probes', async () => {
    const row = await learningRow(project())
    expect(row.message).toContain('adversarial: no-probe-model: panel-not-configured')
    expect(row.message).not.toContain('probes 0')
  })

  it('says the staged report is not recorded on a host that never staged one', async () => {
    const row = await learningRow(project())
    // Scoped to the adversarial clause: the canary half of this row carries its own `staged 0`,
    // which is a MEASURED zero from the completed-run receipts and is not this clause's subject.
    const adversarial = row.message.slice(row.message.indexOf('; adversarial:'))
    expect(adversarial).toContain('staged not recorded')
    expect(adversarial).not.toContain('staged 0')
  })

  it('discloses the circularity backing an operator is ACTUALLY getting', async () => {
    const row = await learningRow(project())
    expect(row.message).toContain(
      MISDIRECTION_POSTURE_BOUND_AT_HOST
        ? 'circularity backing: recorded posture applied'
        : 'circularity backing: fail-closed eval-root (no host binds the recorded posture)',
    )
  })

  it('reports an unreadable staged batch rather than reporting health it could not establish', async () => {
    const p = project()
    const digest = 'b'.repeat(64)
    const batchDir = join(p.agentQaRoot, ADVERSARIAL_STAGING_SUBDIR, 'demo', digest)
    mkdirSync(batchDir, { recursive: true })
    // A manifest whose batch digest does not recompute from its own case list is a TAMPERED
    // batch; `listStagedAdversarial` throws on it by design, and the row must surface that
    // rather than fall back to the same `not recorded` an empty root produces.
    writeFileSync(join(batchDir, ADVERSARIAL_MANIFEST_FILE), JSON.stringify({
      schemaVersion: 1, product: 'demo', batchDigest: digest, tableVersion: 1,
      tableHash: 'c'.repeat(64), stagedAt: '2026-09-12T00:00:00.000Z', cases: [],
    }))
    const row = await learningRow(p)
    expect(row.message).toContain('staged unreadable')
    expect(row.message).not.toContain('staged not recorded')
    expect(row.status).toBe('fail')
  })
})

describe('WINDOWS #427 closed by 422-27: the honesty constant and the shipped composition agree', () => {
  it('pins that MISDIRECTION_POSTURE_BOUND_AT_HOST equals whether postRunCapabilities forwards readMisdirectionRootPosture', async () => {
    const { readFileSync } = await import('node:fs')
    const composition = readFileSync(
      join(__dirname, '../../../../agent-local/src/composition/compose-local-agent.ts'),
      'utf8',
    )
    // postRunCapabilities is the one builder that populates PostRunJobCapabilities.
    // The member's presence in this module must equal the constant: dropping the forward
    // reds this cell, as does flipping the constant without moving the forward.
    expect(composition).toContain('postRunCapabilities')
    expect(composition.includes('readMisdirectionRootPosture')).toBe(
      MISDIRECTION_POSTURE_BOUND_AT_HOST,
    )
  })
})
