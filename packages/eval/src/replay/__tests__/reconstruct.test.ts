import { makeScreenState } from '@vostride/agent-qa-runner'
import { asRecordId, sha256hex } from '@vostride/agent-qa-schema'
import type {
  ArtifactRef,
  ServedBrief,
  ServedPromptTurn,
  WorkingMemoryEntry,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import type { ArtifactSource } from '../../ports'
import type { CassetteInputLeg } from '../../cassette/input-leg'
import { UnrenderableBriefError } from '../brief-tiers'
import {
  MissingDecisionBlobError,
  reconstructDecisionContext,
} from '../reconstruct'

function emptyBrief(): ServedBrief {
  return {
    scope: { tier: 'test', key: 'k' },
    asOfBuild: 1,
    budget: 100,
    truncation: 'none',
    channel1: [],
    channel2: [],
    channel3: [],
    briefDigest: 'digest',
  } as ServedBrief
}

function makeLeg(overrides: Partial<CassetteInputLeg> = {}): CassetteInputLeg {
  return {
    testId: 'test-login',
    testIndex: 0,
    stepIndex: 0,
    decisionOrdinal: 0,
    stepText: 'Click the login button',
    stateBefore: makeScreenState(),
    servedBrief: emptyBrief(),
    exchanges: [],
    ...overrides,
  }
}

function artifactSource(blobs: Record<string, Uint8Array>): ArtifactSource {
  return { getBlob: (sha: string) => blobs[sha] }
}

const screenshotRef: ArtifactRef = { id: 'decision-shot', sha: 'a'.repeat(64) }

function proofTurn(overrides: Partial<ServedPromptTurn> = {}): ServedPromptTurn {
  const policyL0 = overrides.policyL0 ?? '  sovereign policy\n'
  const contextTier = overrides.contextTier ?? 'recorded context'
  const volatileTier = overrides.volatileTier ?? 'recorded volatile'
  return {
    ordinal: 0,
    turnOrdinal: 0,
    runDate: '2026-09-05',
    policyL0,
    learnedL1: '  caution\n',
    learnedL2: '\nlearned observation  ',
    contextTier,
    volatileTier,
    policyDigest: sha256hex(policyL0),
    contextTierDigest: sha256hex(contextTier),
    volatileTierDigest: sha256hex(volatileTier),
    ...overrides,
  }
}

function proofBrief(promptTurns: ServedPromptTurn[]): ServedBrief {
  return {
    ...emptyBrief(),
    channel3: [{ id: asRecordId('proof-caution'), anchors: [], summary: 'a caution' }],
    proof: {
      schemaVersion: 1,
      completeness: 'lossless',
      recordCap: 10,
      combinedBudget: 100,
      admissionEvents: [],
      promptTurns,
    },
  }
}

const proofFixtures = JSON.parse(
  readFileSync(new URL('./fixtures/proof-briefs.json', import.meta.url), 'utf8'),
) as { id: string; decisionOrdinal: number; servedBrief: ServedBrief }[]

describe('reconstructDecisionContext', () => {
  it('omits the screenshot key entirely for a textOnly capture', () => {
    const { stepContext } = reconstructDecisionContext({
      leg: makeLeg(),
      captureMode: 'textOnly',
      artifacts: artifactSource({}),
      model: 'planner-model',
    })
    expect('screenshot' in stepContext).toBe(false)
  })

  it('resolves the exact recorded blob bytes for a full capture', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const { stepContext } = reconstructDecisionContext({
      leg: makeLeg(),
      captureMode: 'full',
      screenshotRef,
      artifacts: artifactSource({ [screenshotRef.sha]: bytes }),
      model: 'planner-model',
    })
    expect('screenshot' in stepContext).toBe(true)
    expect(Uint8Array.from(stepContext.screenshot as Uint8Array)).toEqual(bytes)
  })

  it('throws MissingDecisionBlobError for a full capture whose blob is absent', () => {
    expect(() =>
      reconstructDecisionContext({
        leg: makeLeg(),
        captureMode: 'full',
        screenshotRef,
        artifacts: artifactSource({}),
        model: 'planner-model',
      }),
    ).toThrow(MissingDecisionBlobError)
  })

  it('derives the StepContext strictly from the input leg', () => {
    const leg = makeLeg()
    const { screenState, stepContext } = reconstructDecisionContext({
      leg,
      captureMode: 'textOnly',
      artifacts: artifactSource({}),
      model: 'planner-model',
    })
    expect(stepContext.stepInstruction).toBe(leg.stepText)
    expect(stepContext.testName).toBe(leg.testId)
    expect(stepContext.previousSteps).toEqual([])
    expect(screenState).toBe(leg.stateBefore)
    expect('workingMemory' in stepContext).toBe(false)
  })

  it('spreads workingMemory only when the leg recorded some', () => {
    const workingMemory = [{ scope: 'run', text: 'remembered' }] as unknown as WorkingMemoryEntry[]
    const { stepContext } = reconstructDecisionContext({
      leg: makeLeg({ workingMemory }),
      captureMode: 'textOnly',
      artifacts: artifactSource({}),
      model: 'planner-model',
    })
    expect(stepContext.workingMemory).toEqual(workingMemory)
  })

  it('stamps an empty brief and omits all knowledge tier keys', () => {
    const reconstructed = reconstructDecisionContext({
      leg: makeLeg(),
      captureMode: 'textOnly',
      artifacts: artifactSource({}),
      model: 'planner-model',
    })
    expect(reconstructed).toMatchObject({ briefSource: 'empty' })
    expect(reconstructed).not.toHaveProperty('turnMatch')
    for (const field of ['knowledgeBrief', 'knowledgePolicyL0', 'knowledgeBriefL1', 'knowledgeBriefL2']) {
      expect(reconstructed.stepContext).not.toHaveProperty(field)
    }
  })

  it('copies the matching proof turn verbatim and stamps exact, independent of prompt ordinal', () => {
    const selected = proofTurn({ ordinal: 7, turnOrdinal: 1, learnedL2: '\nselected L2  ' })
    const reconstructed = reconstructDecisionContext({
      leg: makeLeg({ decisionOrdinal: 1, servedBrief: proofBrief([proofTurn(), selected]) }),
      captureMode: 'textOnly',
      artifacts: artifactSource({}),
      model: 'planner-model',
    })
    expect(reconstructed).toMatchObject({ briefSource: 'proof', turnMatch: 'exact' })
    expect(reconstructed.stepContext.knowledgePolicyL0).toBe(selected.policyL0)
    expect(reconstructed.stepContext.knowledgeBriefL1).toBe(selected.learnedL1)
    expect(reconstructed.stepContext.knowledgeBriefL2).toBe(selected.learnedL2)
  })

  it('omits a whitespace-only learnedL1 from StepContext', () => {
    const reconstructed = reconstructDecisionContext({
      leg: makeLeg({ servedBrief: proofBrief([proofTurn({ learnedL1: ' \n\t' })]) }),
      captureMode: 'textOnly',
      artifacts: artifactSource({}),
      model: 'planner-model',
    })
    expect(reconstructed.stepContext).not.toHaveProperty('knowledgeBriefL1')
    expect(reconstructed.stepContext.knowledgeBriefL2).toBe('\nlearned observation  ')
  })

  it.each(['recorded clipping\n', ''])('copies only a non-empty truncation string: %j', truncation => {
    const reconstructed = reconstructDecisionContext({
      leg: makeLeg({ servedBrief: { ...emptyBrief(), truncation } }),
      captureMode: 'textOnly',
      artifacts: artifactSource({}),
      model: 'planner-model',
    })
    if (truncation.length > 0) {
      expect(reconstructed.stepContext.knowledgeBriefTruncation).toBe(truncation)
    } else {
      expect(reconstructed.stepContext).not.toHaveProperty('knowledgeBriefTruncation')
    }
  })

  it('a channel3-only brief with no proof throws UnrenderableBriefError', () => {
    const brief = emptyBrief()
    brief.channel3 = [
      { id: 'c1', anchors: [], summary: 'a caution' },
    ] as unknown as ServedBrief['channel3']
    let thrown: unknown
    try {
      reconstructDecisionContext({
        leg: makeLeg({ servedBrief: brief }),
        captureMode: 'textOnly',
        artifacts: artifactSource({}),
        model: 'planner-model',
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(UnrenderableBriefError)
    expect(thrown).toMatchObject({ name: 'UnrenderableBriefError' })
  })

  it.each(proofFixtures)('reconstructs the committed proof verbatim: $id', fixture => {
    const turns = fixture.servedBrief.proof!.promptTurns
    const matchedTurn = turns.find(turn => turn.turnOrdinal === fixture.decisionOrdinal)!
    expect(matchedTurn).toBeDefined()
    const reconstructed = reconstructDecisionContext({
      leg: makeLeg({ decisionOrdinal: fixture.decisionOrdinal, servedBrief: fixture.servedBrief }),
      captureMode: 'textOnly',
      artifacts: artifactSource({}),
      model: 'planner-model',
    })
    expect(reconstructed).toMatchObject({ briefSource: 'proof', turnMatch: 'exact' })
    const { stepContext } = reconstructed
    expect(sha256hex(stepContext.knowledgePolicyL0 ?? '')).toBe(matchedTurn.policyDigest)
    expect(stepContext.knowledgePolicyL0).toBe(matchedTurn.policyL0)
    expect('knowledgeBriefL1' in stepContext).toBe(matchedTurn.learnedL1.trim().length > 0)
    expect('knowledgeBriefL2' in stepContext).toBe(matchedTurn.learnedL2.trim().length > 0)
    expect(stepContext.knowledgeBriefL1 ?? '').toBe(matchedTurn.learnedL1)
    expect(stepContext.knowledgeBriefL2 ?? '').toBe(matchedTurn.learnedL2)
  })

  it('pins the four fixture tier combinations and the multi-turn decision', () => {
    expect(proofFixtures).toHaveLength(4)
    expect(proofFixtures[0].decisionOrdinal).toBe(1)
    expect(proofFixtures[0].servedBrief.proof!.promptTurns).toHaveLength(3)
    expect(proofFixtures.slice(1).map(fixture => {
      const turn = fixture.servedBrief.proof!.promptTurns[0]
      return [turn.learnedL1.length > 0, turn.learnedL2.length > 0]
    })).toEqual([[true, false], [false, true], [true, true]])
  })

  it('refuses a non-uniform proof with no matching decision and names the available turn ordinals', () => {
    const servedBrief = proofBrief([proofTurn(), proofTurn({ ordinal: 1, turnOrdinal: 1, learnedL2: 'different' })])
    let thrown: unknown
    try {
      reconstructDecisionContext({
        leg: makeLeg({ decisionOrdinal: 5, servedBrief }),
        captureMode: 'textOnly',
        artifacts: artifactSource({}),
        model: 'planner-model',
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(UnrenderableBriefError)
    expect((thrown as UnrenderableBriefError).detail).toContain('decisionOrdinal 5')
    expect((thrown as UnrenderableBriefError).detail).toContain('turnOrdinals 0,1')
  })

  it('uses a uniform proof fallback only when all three tier strings agree', () => {
    const first = proofTurn()
    const servedBrief = proofBrief([first, proofTurn({ ordinal: 1, turnOrdinal: 1, contextTier: 'different context' })])
    const reconstructed = reconstructDecisionContext({
      leg: makeLeg({ decisionOrdinal: 5, servedBrief }),
      captureMode: 'textOnly',
      artifacts: artifactSource({}),
      model: 'planner-model',
    })
    expect(reconstructed).toMatchObject({ briefSource: 'proof', turnMatch: 'uniform' })
    expect(reconstructed.stepContext).toMatchObject({
      knowledgePolicyL0: first.policyL0,
      knowledgeBriefL1: first.learnedL1,
      knowledgeBriefL2: first.learnedL2,
    })
  })

  it('renders a channel1 L2 line without a proof and stamps rendered with no turnMatch', () => {
    const summary = 'recorded observation'
    const servedBrief: ServedBrief = {
      ...emptyBrief(),
      channel1: [{
        id: asRecordId('rendered-observation'), kind: 'fact', summary,
        trust: 1, status: 'active', servedAsCanary: false, tier: 'L2',
      }],
    }
    const reconstructed = reconstructDecisionContext({
      leg: makeLeg({ servedBrief }),
      captureMode: 'textOnly',
      artifacts: artifactSource({}),
      model: 'planner-model',
    })
    expect(reconstructed).toMatchObject({ briefSource: 'rendered' })
    expect(reconstructed).not.toHaveProperty('turnMatch')
    expect(reconstructed.stepContext.knowledgeBriefL2).toBe('Observation: ' + summary)
    expect(reconstructed.stepContext).not.toHaveProperty('knowledgePolicyL0')
    expect(reconstructed.stepContext).not.toHaveProperty('knowledgeBriefL1')
  })
})
/*
 * Regenerate the four proof fixtures from agent-qa/ (read-only corpus projection):
 * node -e '
 * const fs = require("node:fs"), path = require("node:path");
 * const dirs = [
 *   "example-web/r_ingle-mixed-unlink-reb-bod-gross-foot-sic-bum-virus/test-00-step-03-d01-leaf",
 *   "automation-exercise/r_loa-spy-anana-psi-swiper-punt-dao-kol-orgia-leo/test-00-step-00-d00-leaf",
 *   "example-web/r_all-urent-opera-split-cal-arrow-shield-bert-idol-oxygen/test-00-step-00-d00-leaf",
 *   "automation-exercise/r_atria-patch-ounds-soap-hay-coli-thouse-ens-abele-rust/test-00-step-00-d00-leaf"
 * ];
 * const fixtures = dirs.map(dir => {
 *   const c = JSON.parse(fs.readFileSync(path.join("../demo/init/agent-qa-eval/cassettes", dir, "cassette.json"), "utf8"));
 *   return { id: c.id, decisionOrdinal: c.input.decisionOrdinal, servedBrief: c.input.servedBrief };
 * });
 * fs.writeFileSync("packages/eval/src/replay/__tests__/fixtures/proof-briefs.json", JSON.stringify(fixtures, null, 2) + "\n");
 * '
 */
import { readFileSync } from 'node:fs'
