// D-07 read-only census: reconstruction only, with no planner or provider invocation.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconstructDecisionContext } from '@vostride/agent-qa-eval'
import { sha256hex } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { absentArtifactSource } from '../artifact-source.js'
import { loadCassetteBundle } from '../cassette-loader.js'
import { listCassetteBundleDirs } from '../replay-read.js'

const demoRoot = fileURLToPath(new URL('../../../../../demo/', import.meta.url))

describe('415 D-07 — committed populated-brief reconstruction', () => {
  if (!existsSync(demoRoot)) {
    it.skip('demo root absent: committed 63-cassette proof sweep requires the super-repo demo', () => {})
    return
  }

  it('reconstructs all 79 populated briefs as proof/exact with matching policyDigest', () => {
    const cassettesRoot = join(demoRoot, 'init', 'agent-qa-eval', 'cassettes')
    expect(existsSync(cassettesRoot)).toBe(true)
    const totals = { populated: 0, L0: 0, L1: 0, L2: 0 }
    for (const dir of listCassetteBundleDirs(cassettesRoot)) {
      const load = loadCassetteBundle(dir)
      expect(load.kind, dir).toBe('loaded')
      if (load.kind !== 'loaded') throw new Error(load.refusal.detail)
      const cassette = load.cassette
      if (cassette.granularity !== 'leaf') continue
      const brief = cassette.input.servedBrief
      if (brief.channel1.length + brief.channel2.length + brief.channel3.length === 0) continue
      const matchedTurn = brief.proof?.promptTurns.find(
        turn => turn.turnOrdinal === cassette.input.decisionOrdinal,
      )
      expect(matchedTurn, cassette.id).toBeDefined()
      const reconstruct = () => reconstructDecisionContext({
        leg: cassette.input,
        captureMode: 'textOnly',
        artifacts: absentArtifactSource,
        model: 'sweep',
      })
      expect(reconstruct, cassette.id).not.toThrow()
      const { stepContext, briefSource, turnMatch } = reconstruct()
      expect(briefSource, cassette.id).toBe('proof')
      expect(turnMatch, cassette.id).toBe('exact')
      expect(sha256hex(stepContext.knowledgePolicyL0 ?? ''), cassette.id).toBe(matchedTurn!.policyDigest)
      totals.populated++
      if ('knowledgePolicyL0' in stepContext) totals.L0++
      if ('knowledgeBriefL1' in stepContext) totals.L1++
      if ('knowledgeBriefL2' in stepContext) totals.L2++
    }
    // 2026-09-12 (422-25): the operator admitted a 16-case adversarial batch into the committed
    // demo root. `populated`, `L0` and `L2` each move by exactly 16 (63->79, 63->79, 49->65);
    // `L1` does not move, because a derived case clones exactly the briefs its seed carried and
    // neither of the two admitted seeds carried an L1.
    expect(totals).toEqual({ populated: 79, L0: 79, L1: 28, L2: 65 })
  })
})
