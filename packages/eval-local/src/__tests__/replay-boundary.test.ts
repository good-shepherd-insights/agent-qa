// RPLY-02 captured-provider-boundary proof (Phase 368, Plan 07 — D-05/D-06).
//
// This suite copies the Phase 345/362 captured-provider-boundary pattern
// (cli/__tests__/masking-provider-boundary.test.ts): a capturing stub injected through
// runCassetteReplay's `modelOverrides` records the doGenerate params POST the pinned-last
// mask/guardrail middleware — the exact provider boundary. Every proof drives the ONE sanctioned
// helper (runCassetteReplay) over a bundle produced by the REAL extract → store → load round trip
// into temp dirs; the helper is itself under proof. No environment-keyed skips — the suite is
// unconditional and runs offline on a CPU-only host (the caller profile points at an unreachable
// baseURL; the stub serves every call).
//
// Proven: temperature 0 on every replayed request; masked observation content (raw sentinel absent,
// placeholder present); the guardrail backstop firing on a reconstructed raw secret inside
// runSafetyScope; an empty-but-structured ServedBrief replaying legally with no knowledge-brief
// section; an evidence-incomplete bundle refused before any planner invocation (doGenerate count 0);
// and the production system tier + action tool slice present at the boundary.

import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { LeafReplayResult } from '@vostride/agent-qa-eval'
import { afterEach, describe, expect, it } from 'vitest'

import { runCassetteReplay } from '../replay-composition.js'
import { FsReplayRecordStore } from '../replay-record-store.js'
import {
  actionGenerateResult,
  capturingStub,
  emptyArtifacts,
  extractStoreLoad,
  findReplayRecords,
  makeReplayHandoff,
  memArtifacts,
  noneAuth,
  stubProfile,
  throwingStub,
} from './fixtures/replay-fixtures.js'

// An obviously-synthetic email: the empty-seeded MaskingContext auto-masks emails, so this reaches
// the boundary as an <EMAIL_n> placeholder (D-06). Never a live secret (T-368-15).
const EMAIL_SENTINEL = 'replay-sentinel-user@masked.example'
// A reconstructed raw bearer secret: masking auto-detects only emails, so this reaches the guardrail
// detectors, fires 'bearer', and lands an audit row — the D-06 raw-leak backstop.
const BEARER_SENTINEL = 'Bearer sk-replay-abcdefgh12345'

describe('RPLY-02 captured provider-boundary proof (runCassetteReplay, D-05/D-06)', () => {
  const tempRoots: string[] = []

  async function tempRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix))
    tempRoots.push(root)
    return root
  }

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('pins temperature 0 and carries the production system tier + web action tool slice at the boundary', async () => {
    const bundle = extractStoreLoad(makeReplayHandoff(), memArtifacts(), await tempRoot('replay-b-temp0-'))
    const stub = capturingStub(() => actionGenerateResult('web'))

    const outcome = await runCassetteReplay({
      cassette: bundle.cassette,
      artifacts: bundle.artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      replayOutputBaseDir: await tempRoot('replay-b-temp0-audit-'),
    })

    if (!('granularity' in outcome)) throw new Error('expected a replay result, got a refusal')
    expect((outcome as LeafReplayResult).samples[0]!.outcome.kind).toBe('decision')

    // The 366 sampling seam applied on every replayed request.
    expect(stub.captured).toHaveLength(1)
    for (const request of stub.captured) expect(request.temperature).toBe(0)

    // Production prompt assembly demonstrably ran: the system tier + the web action-tool slice are
    // present at the boundary (stable markers, not full prompt bytes).
    const serialized = JSON.stringify(stub.captured[0])
    expect(serialized).toContain('You are the agent-qa test automation agent')
    expect(serialized).toContain('web_click')
    expect(serialized).toContain('Current screen state:')
  })

  it('masks the recorded observation: the raw sentinel is absent and a placeholder is present at the boundary', async () => {
    const handoff = makeReplayHandoff({ stepText: `Confirm the email ${EMAIL_SENTINEL} then click Continue` })
    const bundle = extractStoreLoad(handoff, memArtifacts(), await tempRoot('replay-b-mask-'))
    const stub = capturingStub(() => actionGenerateResult('web'))

    await runCassetteReplay({
      cassette: bundle.cassette,
      artifacts: bundle.artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      replayOutputBaseDir: await tempRoot('replay-b-mask-audit-'),
    })

    // Over the FULL serialized captured params, not just the observation text (acceptance).
    const serialized = JSON.stringify(stub.captured[0])
    expect(serialized).toContain('<EMAIL_')
    expect(serialized).not.toContain(EMAIL_SENTINEL)
  })

  it('fires the guardrail backstop on a reconstructed raw secret inside runSafetyScope', async () => {
    // A raw bearer token in the recorded step text is scanned by the guardrail on every replayed
    // prompt; it fires 'bearer' and the replay-scoped JsonlAuditSink records the row under the
    // replay output dir (T-368-12) — the D-06 raw-leak backstop.
    const handoff = makeReplayHandoff({ stepText: `Authenticate with ${BEARER_SENTINEL} then click Continue` })
    const bundle = extractStoreLoad(handoff, memArtifacts(), await tempRoot('replay-b-guard-'))
    const stub = capturingStub(() => actionGenerateResult('web'))
    const replayDir = await tempRoot('replay-b-guard-audit-')

    await runCassetteReplay({
      cassette: bundle.cassette,
      artifacts: bundle.artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      replayOutputBaseDir: replayDir,
    })

    const auditPath = join(replayDir, 'guardrail_audit.jsonl')
    expect(existsSync(auditPath)).toBe(true)
    expect(readFileSync(auditPath, 'utf8')).toContain('bearer')
  })

  it('replays an empty-but-structured ServedBrief legally to a decision with no knowledge-brief section', async () => {
    // The fixture's ServedBrief is empty-but-structured (all channels []). Replay supports exactly
    // the empty brief today; the captured prompt therefore omits the knowledge-brief section.
    const bundle = extractStoreLoad(makeReplayHandoff(), memArtifacts(), await tempRoot('replay-b-brief-'))
    const stub = capturingStub(() => actionGenerateResult('web'))

    const outcome = await runCassetteReplay({
      cassette: bundle.cassette,
      artifacts: bundle.artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      replayOutputBaseDir: await tempRoot('replay-b-brief-audit-'),
    })

    if (!('granularity' in outcome)) throw new Error('expected a replay result, got a refusal')
    expect((outcome as LeafReplayResult).samples[0]!.outcome.kind).toBe('decision')
    expect(JSON.stringify(stub.captured[0])).not.toContain('Knowledge brief')
  })

  it('refuses an evidence-incomplete bundle before any planner invocation (doGenerate never called)', async () => {
    // No blob bytes at extraction ⇒ the full-capture (vision) leaf is evidence-incomplete. The
    // completeness refusal is filtered before any sample — a throwing stub is never reached.
    const bundle = extractStoreLoad(makeReplayHandoff(), emptyArtifacts, await tempRoot('replay-b-incomplete-'))
    const stub = throwingStub()
    const storeRoot = await tempRoot('replay-b-incomplete-store-')

    const outcome = await runCassetteReplay({
      cassette: bundle.cassette,
      artifacts: bundle.artifacts,
      profile: stubProfile(),
      auth: noneAuth,
      modelOverrides: { languageModels: stub.languageModels },
      replayOutputBaseDir: await tempRoot('replay-b-incomplete-audit-'),
      recordStore: new FsReplayRecordStore({ root: storeRoot }),
    })

    expect('kind' in outcome && outcome.kind === 'integrity-refusal').toBe(true)
    if (!('kind' in outcome)) throw new Error('expected a refusal')
    expect(outcome.reason).toBe('completeness')
    expect(stub.calls()).toBe(0)

    // Refusals are never silent — the record is persisted (D-08/D-12).
    const records = findReplayRecords(join(storeRoot, 'eval', 'replays'))
    expect(records).toHaveLength(1)
    expect(JSON.parse(readFileSync(records[0]!, 'utf8'))).toEqual(JSON.parse(JSON.stringify(outcome)))
  })
})
