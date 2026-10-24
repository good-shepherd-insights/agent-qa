import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalJson, deriveLeafCassetteId, deriveRunSlug } from '@vostride/agent-qa-eval'
import { readActiveCommittedCorpus, readCommittedCorpus } from '@vostride/agent-qa-eval-local'
import type { Action } from '@vostride/agent-qa-schema'
import { createFeedbackPortForHost } from '../feedback-host.js'
import { files, markFixture } from './feedback-fixture.js'
import { resolveEvalSession, runCensusVerb } from '../../eval-session-composition.js'

describe('420 gold tracer', () => {
  let root: string | undefined
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  const bytes = (dir: string) => files(dir).map(path => [path, readFileSync(path).toString('hex')])
  const correctedAction: Action = { type: 'delay', ms: 137 }
  const correctedExpectation = '  Cafe\u0301 ≠ Café\nKeep "quoted" \\ bytes.  '

  it('420 gold tracer preserves both authored corrections and original observations', async () => {
    const f = markFixture()
    root = f.root
    const step = f.handoff.tests[0]!.steps[0]!
    step.verifierVerdict = { pass: true, reasoning: 'Recorded PASS, before the operator correction' }
    f.save()
    const originalAction = structuredClone(step.subActions[0]!.plannedAction)
    const originalHandoff = readFileSync(join(f.runDir, 'handoff.json'))
    const sourceCassetteId = deriveLeafCassetteId({
      runSlug: deriveRunSlug(f.handoff.runId), testIndex: 0, stepIndex: 0, decisionOrdinal: 0,
    })
    const input = { runId: f.handoff.runId, stepIndex: 0, kind: 'false-pass' as const,
      correctedAction, correctedExpectation }
    const port = createFeedbackPortForHost(f.deps)
    const result = await port.mark(input)
    expect(result.kind).toBe('marked')
    if (result.kind !== 'marked') throw new Error('expected marked receipt')
    expect(result.receipt.gold).toHaveLength(2)
    expect(new Set(result.receipt.gold.map(item => item.cassetteId)).size).toBe(2)
    expect(result.receipt.gold.map(item => item.channel).sort()).toEqual(['overturned-verdict', 'user-mark'])

    const evalRoot = join(root, 'agent-qa-eval')
    const read = readCommittedCorpus(evalRoot)
    expect(read.refusals).toEqual([])
    expect(read.snapshot.entries).toHaveLength(2)
    expect(read.snapshot.labelsById.size).toBe(2)
    expect(read.snapshot.cassettesById.size).toBe(2)
    for (const gold of result.receipt.gold) {
      expect(gold.sourceCassetteId).toBe(sourceCassetteId)
      const record = read.snapshot.labelsById.get(gold.cassetteId)!
      expect(record).toMatchObject({ cassetteId: gold.cassetteId,
        provenance: { sourceCassetteId, runId: f.handoff.runId },
        label: { sourceChannel: gold.channel, tier: 'gold', verdict: step.verifierVerdict },
        correction: { verdict: 'fail', overturnedVerdict: step.verifierVerdict,
          correctedAction, correctedExpectation, markId: result.receipt.markId } })
      expect(canonicalJson(record.correction?.correctedAction)).toBe(canonicalJson(correctedAction))
      expect(Buffer.from(record.correction!.correctedExpectation!)).toEqual(Buffer.from(correctedExpectation))
      expect(read.snapshot.entries.find(entry => entry.cassetteId === gold.cassetteId))
        .toMatchObject({ split: 'held-out', heldOutVisibility: 'private' })
      const cassette = read.snapshot.cassettesById.get(gold.cassetteId)!
      expect(cassette).toMatchObject({ id: gold.cassetteId, runId: f.handoff.runId,
        testIndex: 0, stepIndex: 0, label: { verdict: step.verifierVerdict },
        sidecar: { goldAction: originalAction } })
    }
    expect(readFileSync(join(f.runDir, 'handoff.json'))).toEqual(originalHandoff)
    const beforeRepeat = bytes(root)
    expect(await port.mark(input)).toEqual({ kind: 'already-marked', receipt: result.receipt })
    expect(bytes(root)).toEqual(beforeRepeat)
    const active = readActiveCommittedCorpus(evalRoot, f.agentQaRoot)
    expect(active.refusals).toEqual([])
    expect(active.snapshot.entries.map(entry => entry.cassetteId).sort())
      .toEqual(result.receipt.gold.map(item => item.cassetteId).sort())
  })

  it('420 empty mark corpus admits no active gold and writes no bytes', () => {
    const f = markFixture()
    root = f.root
    const before = bytes(root)
    const read = readActiveCommittedCorpus(join(root, 'agent-qa-eval'), f.agentQaRoot)
    expect(read.refusals).toEqual([])
    expect(read.snapshot.entries).toEqual([])
    expect(read.snapshot.labelsById.size).toBe(0)
    expect(bytes(root)).toEqual(before)
  })

  it('420 ambiguous correction refuses before any destination write', async () => {
    const f = markFixture()
    root = f.root
    const step = f.handoff.tests[0]!.steps[0]!
    step.verifierVerdict.pass = true
    step.subActions.push(structuredClone(step.subActions[0]!))
    f.save()
    const before = bytes(root)
    expect(await createFeedbackPortForHost(f.deps).mark({ runId: f.handoff.runId,
      stepIndex: 0, kind: 'false-pass', correctedAction, correctedExpectation }))
      .toEqual({ kind: 'ambiguous-correction', runId: f.handoff.runId, testIndex: 0, decisionCount: 2 })
    expect(bytes(root)).toEqual(before)
  })

  it.each(['flake', 'environment', 'timeout'] as const)(
    '420 newest quarantined %s receipt retires both gold clones without rewriting history', async klass => {
      const f = markFixture()
      root = f.root
      const member = f.handoff.tests[0]!
      member.steps[0]!.verifierVerdict.pass = true
      f.save()
      const port = createFeedbackPortForHost(f.deps)
      const first = await port.mark({ runId: f.handoff.runId, stepIndex: 0,
        kind: 'false-pass', correctedAction, correctedExpectation })
      expect(first.kind).toBe('marked')
      if (first.kind !== 'marked') throw new Error('expected original mark')
      expect(first.receipt.gold).toHaveLength(2)
      const evalRoot = join(root, 'agent-qa-eval')
      const before = bytes(evalRoot)
      member.rootCause = { class: klass, producer: 'deterministic-classifier', confidence: 1,
        evidence: { citedSteps: [0], citedAnchors: [], citedArtifacts: [], rationale: 'Recorded classification' },
        memoryMisdirectionRuledOut: true, perTest: 0 }
      f.save()
      const latest = await port.mark({ runId: f.handoff.runId, stepIndex: 0, kind: 'false-fail' })
      expect(latest).toMatchObject({ kind: 'marked', receipt: { ordinal: 2,
        supersedes: first.receipt.markId, disposition: { kind: 'quarantined', class: klass }, gold: [] } })
      expect(bytes(evalRoot)).toEqual(before)
      expect(readCommittedCorpus(evalRoot).snapshot.entries).toHaveLength(2)
      const active = readActiveCommittedCorpus(evalRoot, f.agentQaRoot)
      expect(active.refusals).toEqual([])
      expect(active.snapshot.entries).toEqual([])
      expect([...active.retiredMarkedCassetteIds!].sort())
        .toEqual(first.receipt.gold.map(item => item.cassetteId).sort())
      writeFileSync(join(root, '.env.secrets.local'), '')
      const census = (await runCensusVerb(await resolveEvalSession({ configPath: f.configPath }))).census
      expect(census.entryCount).toBe(0)
      expect(census.products.default).toMatchObject({ total: 0, labelAudit: {
        committedMembers: 2, scorableMembers: 0, retiredMarkedLabels: 2,
        rerunPairs: 0, rerunOverturnedOriginals: 0, refusedHistories: 0 } })
      expect(bytes(evalRoot)).toEqual(before)
    },
  )
})
