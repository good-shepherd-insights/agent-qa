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
})
