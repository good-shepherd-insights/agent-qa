import { dirname, join } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { createLabelRevision, projectSilverLabelRecord } from '@vostride/agent-qa-eval'
import { committedLabelPath, runReplayGate } from '@vostride/agent-qa-eval-local'
import { GateReceiptSchema } from '@vostride/agent-qa-schema'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { gateReceiptsFor } from '@vostride/agent-qa-knowledge-local/reader'
import { resolveEvalSession } from '../../eval-session-composition.js'
import { createReplayGateHost } from '../replay-gate-host.js'

// Runtime fixture imports keep sibling test source outside this package's rootDir.
const { writeGate1Fixture, warmGateRoot, gate1Responder } = await import(
  new URL('../../../../eval-local/src/__tests__/fixtures/gate1-fixtures.js', import.meta.url).href)
const { respondingStub, actionGenerateResult, noneAuth, stubProfile } = await import(
  new URL('../../../../eval-local/src/__tests__/fixtures/replay-fixtures.js', import.meta.url).href)
const { createPromotionFloorFixture } = await import(
  new URL('../../../../knowledge-local/src/curator/__tests__/fixtures/promotion-floor-fixture.js', import.meta.url).href)
const { weight } = await import(
  new URL('../../../../eval/src/match/__tests__/fixtures/label-metric-fixtures.js', import.meta.url).href)

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it.each(['gold', 'near-gold', 'silver'] as const)(
  'real %s harmed receipts persist through the leased host with unchanged exit 1', async tier => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected provider call'))
    const root = mkdtempSync(join(tmpdir(), 'agent-qa-soft-persistence-'))
    roots.push(root)
    const f = writeGate1Fixture(root)
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const published = createPromotionFloorFixture({ knowledgeRoot, auditBaseDir: f.agentQaRoot })
      .publishHeldCandidate('soft').published
    f.injection.candidateId = published.id
    await warmGateRoot(f, respondingStub(gate1Responder(f)))
    const broken = f.selected.find((row: any) => row.cassette.input.stepText === 'gate1-collateral-0')!.cassette
    let record = projectSilverLabelRecord({ cassette: broken, runId: broken.runId })
    record.label = { ...record.label, tier }
    const save = () => {
      const path = join(f.committedRoot, committedLabelPath('alpha', record.cassetteId))
        .replace(/\.json$/, record.revision ? `--revision-${record.revision.id}.json` : '.json')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(record))
    }
    save()
    const configPath = join(root, 'agent-qa.config.yaml')
    writeFileSync(configPath, 'workspace:\n  testMatch: [tests/**/*.yaml]\n  suiteMatch: [suites/**/*.suite.yaml]\n  hooksFile: hooks.yaml\n  envFile: .env\n  secretsFile: .env.secrets.local\nuse:\n  mobile:\n    appState: preserve\n')
    const session = await resolveEvalSession({ configPath, keyOnly: true })
    const stub = respondingStub((call: any) => JSON.stringify(call.prompt).includes('gate1-collateral-0')
      ? actionGenerateResult('web', 'e-other') : gate1Responder(f)(call))
    const host = createReplayGateHost({ configPath, agentQaRoot: f.agentQaRoot, record: true, session,
      reader: { candidateInjection: async () => ({ kind: 'found', injection: f.injection }) } as any,
      composition: { identity: f.identity, planner: { profile: stubProfile(),
        modelOverrides: { languageModels: stub.languageModels }, resolveAuth: async () => noneAuth },
        k: 3, kSource: 'default', maxScreens: 64, judgeOverrideConfigured: false,
        baselineSeed: { floorSeeds: [11] } },
      runReplayGate: input => runReplayGate({ ...input, committedRoot: f.committedRoot,
        maskingContextFactory: createMaskingContext }),
    })
    let firstHarm: unknown
    for (const value of [undefined, 0, 0.25, 1]) {
      if (value !== undefined) { record = createLabelRevision(record, { weight: weight(value) }); save() }
      const got = await host.run(published.id)
      expect(got).toMatchObject({ kind: 'receipt', exit: 1, recorded: 'appended' })
      if (got.kind !== 'receipt' || got.receipt.gate !== 1) throw new Error('expected Gate 1')
      expect(got.receipt).toMatchObject({ verdict: 'fail', reasons: ['collateral-harm'] })
      const harm = got.receipt.harmed![0]!
      if (value === undefined) { firstHarm = harm; expect(Object.hasOwn(harm, 'softWeight')).toBe(false) }
      else expect(harm).toEqual({ ...firstHarm as object, softWeight: value })
      const read = gateReceiptsFor({ knowledgeRoot, candidateId: published.id })
      if (read.kind !== 'found') throw new Error('missing persisted receipt')
      const saved = read.lines.find(line => line.receiptDigest === got.receipt.receiptDigest)
      expect(GateReceiptSchema.parse(saved)).toEqual(got.receipt)
      expect(network).not.toHaveBeenCalled()
    }
  },
)
