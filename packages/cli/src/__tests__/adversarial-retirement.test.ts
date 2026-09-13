// 422-01-T1 — the adversarial tracer: one confusable-derived natural seed travelling from the
// public `eval adversarial` verb, through local staging, to explicit operator admission.
//
// What this file is FOR: proving the authority split (D-01) end to end on real bytes. Staging
// must leave every committed byte and the corpus digest untouched; admission must be an
// explicit act naming ONE reviewed batch; and a FRESH reader — the proposer's own door — must
// then resolve the derived cassette with the seed's gold cloned onto it and its blob closure
// readable. Anything less and "propose, never commit" is a comment rather than a property.
import { Command } from 'commander'
import { createEvalCommand } from '../commands/eval.js'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as model from '@vostride/agent-qa-model'
import { computeBriefDigest, type LosslessServedBriefProofV1 } from '@vostride/agent-qa-schema'
import {
  ADVERSARIAL_MUTATORS,
  ADVERSARIAL_TABLE_HASH,
  ADVERSARIAL_TABLE_VERSION,
  deriveAdversarialCassetteId,
  effectiveGold,
  extractRunCassettes,
  projectCorpusEntry,
  projectSilverLabelRecord,
  type LeafCassette,
  type SeedingPlan,
} from '@vostride/agent-qa-eval'
import {
  FsRunArtifactSource,
  committedBlobPath,
  seedCommittedCorpus,
} from '@vostride/agent-qa-eval-local'
import { openCorpusReader } from '@vostride/agent-qa-eval-local/reader'
import { markFixture } from '../gates/__tests__/feedback-fixture.js'
import {
  adversarialHostOptions,
  resolveEvalSession,
  runAdversarialVerb,
} from '../eval-session-composition.js'

/**
 * The families this fixture's single recorded control can carry (422-02). Four benign
 * families need a distractor surface to land on without moving the gold's normalized
 * identity, and this observation has none — so they are reported, not derived.
 */
const DERIVED_ON_THIS_SEED = [
  'benign-case',
  'benign-digit',
  'benign-whitespace',
  'confusable',
  'injection-template',
  'invisible',
  'tag-block',
]

const INAPPLICABLE_ON_THIS_SEED = [
  { mutator: 'benign-plural', reason: 'no-table-entry-applies' },
  { mutator: 'benign-punctuation', reason: 'benign-surface-absent' },
  { mutator: 'benign-synonym', reason: 'benign-surface-absent' },
  { mutator: 'benign-truncate', reason: 'benign-surface-absent' },
]

function byMutator(left: { mutator?: string }, right: { mutator?: string }): number {
  return String(left.mutator).localeCompare(String(right.mutator))
}

const roots: string[] = []

beforeEach(() => {
  // The whole adversarial path is offline: generation is pure, staging and admission are file
  // IO. A provider call here would be a defect, not a cost.
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('provider access forbidden')
  })
  vi.spyOn(model, 'createModel').mockImplementation(() => {
    throw new Error('model creation forbidden')
  })
})

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(model.createModel).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function proof(): LosslessServedBriefProofV1 {
  return {
    schemaVersion: 1,
    completeness: 'lossless',
    recordCap: 8,
    combinedBudget: 2048,
    admissionEvents: [
      {
        ordinal: 0,
        turnOrdinal: 0,
        surface: 'caution',
        id: 'adversarial-tracer-record' as never,
        sourceId: 'adversarial-tracer-record',
        clusterKey: '{"role":"button","name":"continue"}',
        renderedCost: 24,
        chargeRepeated: false,
      },
    ],
    promptTurns: [
      {
        ordinal: 0,
        turnOrdinal: 0,
        runDate: '2026-09-11',
        policyL0: 'policy',
        learnedL1: 'learned one',
        learnedL2: 'learned two',
        contextTier: 'context',
        volatileTier: 'volatile',
        policyDigest: '1'.repeat(64),
        contextTierDigest: '2'.repeat(64),
        volatileTierDigest: '3'.repeat(64),
      },
    ],
  }
}

/** Every regular file under `root`, content-addressed — the "did anything move" oracle. */
function tree(root: string): Record<string, string> {
  if (!existsSync(root)) return {}
  return Object.fromEntries(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => {
        const path = join(entry.parentPath, entry.name)
        return [relative(root, path), readFileSync(path).toString('base64')]
      }),
  )
}

function guardrailRows(agentQaRoot: string, product = 'default'): { channel: string; action: string; detector: string }[] {
  const file = join(agentQaRoot, 'eval/audit/adversarial', product, 'guardrail_audit.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as { channel: string; action: string; detector: string })
}

/**
 * A committed root holding exactly ONE proof-backed natural leaf with a resolvable gold
 * anchor and a real blob in its closure — the D-07 seed population, minimal.
 */
function fixture() {
  const f = markFixture()
  roots.push(f.root)
  writeFileSync(join(f.root, '.env.secrets.local'), '')
  const member = f.handoff.tests[0]!
  const brief = member.steps[0]!.servedBrief
  brief.proof = proof()
  brief.briefDigest = computeBriefDigest(brief)
  f.save()

  const committedRoot = join(f.root, 'agent-qa-eval')
  const artifacts = new FsRunArtifactSource({ root: f.agentQaRoot, runId: f.handoff.runId })
  const extraction = extractRunCassettes({ handoff: f.handoff, artifacts })
  const extracted = extraction.cassettes.find(row => row.cassette.granularity === 'leaf')!
  const seed = extracted.cassette as LeafCassette
  const plan: SeedingPlan = {
    product: 'default',
    runId: f.handoff.runId,
    runSlug: member.testId,
    cases: [
      {
        cassetteId: seed.id,
        labelRecord: projectSilverLabelRecord({ cassette: seed, runId: f.handoff.runId }),
        corpusEntry: projectCorpusEntry({
          cassette: seed,
          product: 'default',
          runId: f.handoff.runId,
          assignment: { split: 'natural' },
        }),
      },
    ],
    pairSkips: [],
    silverExclusions: [],
    pairCounts: { total: 0, sameState: 0, differingState: 0 },
    proceduresExcludedCount: 0,
  }
  const seeded = seedCommittedCorpus({
    plan,
    cassettes: [{ cassette: seed, blobs: extracted.blobs }],
    committedRoot,
    seedingOutputBaseDir: join(f.agentQaRoot, 'eval', 'audit', 'tracer-seed'),
  })
  expect(seeded.refusals).toEqual([])
  expect(seeded.seededCount).toBe(1)
  return { ...f, committedRoot, seed, extracted }
}

async function session(f: ReturnType<typeof fixture>) {
  return resolveEvalSession({ configPath: f.configPath, keyOnly: true })
}

async function command(f: ReturnType<typeof fixture>, flags: string[]) {
  process.exitCode = 0
  const out = vi.spyOn(console, 'log').mockImplementation(() => {})
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  const cli = new Command().option('--config <path>').exitOverride()
  cli.configureOutput({ writeErr: () => {} })
  cli.addCommand(createEvalCommand())
  let failure: unknown
  try {
    await cli.parseAsync(['--config', f.configPath, 'eval', 'adversarial', ...flags], { from: 'user' })
  } catch (error) { failure = error }
  const result = { exit: failure === undefined ? Number(process.exitCode) : 1,
    output: out.mock.calls.map(row => String(row[0])).join('\n'),
    error: err.mock.calls.map(row => String(row[0])).join('\n') }
  out.mockRestore()
  err.mockRestore()
  process.exitCode = 0
  return result
}

describe('422 public adversarial retirement', () => {
  it('retires the exact reviewed batch through the public command and refuses later admission', async () => {
    const f = fixture()
    const s = await session(f)
    const staged = await runAdversarialVerb(s, { ...adversarialHostOptions(s), product: 'default' })
    expect(staged.kind).toBe('staged')
    const batch = staged.batchDigest!
    const dir = join(f.agentQaRoot, 'eval/adversarial/default', batch)
    const reviewed = tree(dir)
    const committed = tree(f.committedRoot)
    const knowledge = tree(f.knowledgeRoot)
    const settled = tree(join(f.agentQaRoot, 'eval/adversarial-state'))
    const probes = tree(join(f.agentQaRoot, 'eval/adversarial-probes'))
    const flags = ['--product', 'default', '--retire', '--batch', batch, '--json']
    expect(createEvalCommand().commands.find(row => row.name() === 'adversarial')!.options.map(row => row.long))
      .toContain('--retire')
    const first = await command(f, flags)
    expect(first.exit, first.error).toBe(0)
    const result = JSON.parse(first.output)
    expect(result).toMatchObject({ retired: true, alreadyRetired: false, product: 'default', batchDigest: batch,
      retainedBatchDir: dir, alreadyCommittedCaseIds: [], reviewedCaseIds: staged.staged.map(row => row.cassetteId) })
    expect(result.manifestSha256).toMatch(/^[0-9a-f]{64}$/)
    const marker = readFileSync(result.retirementRecordPath, 'utf8')
    const again = await command(f, flags)
    expect(again.exit, again.error).toBe(0)
    expect(JSON.parse(again.output)).toMatchObject({ retired: true, alreadyRetired: true })
    expect(readFileSync(result.retirementRecordPath, 'utf8')).toBe(marker)
    const { ['retirement.json']: decision, ...original } = tree(dir)
    expect(decision).toBeDefined()
    expect(original).toEqual(reviewed)
    const refused = await command(f, ['--product', 'default', '--admit', '--batch', batch, '--json'])
    expect(refused.exit, refused.error).toBe(2)
    expect(JSON.parse(refused.output)).toMatchObject({ kind: 'refused', reason: 'admission-refused',
      writesStarted: false, admitted: [], retirement: { retired: true, retirementRecordPath: result.retirementRecordPath } })
    expect(tree(f.committedRoot)).toEqual(committed)
    expect(tree(f.knowledgeRoot)).toEqual(knowledge)
    expect(tree(join(f.agentQaRoot, 'eval/adversarial-state'))).toEqual(settled)
    expect(tree(join(f.agentQaRoot, 'eval/adversarial-probes'))).toEqual(probes)
  })
})
