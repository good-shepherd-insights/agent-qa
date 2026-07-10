import { makeScreenState } from '@vostride/agent-qa-runner'
import type {
  ArtifactRef,
  ServedBrief,
  WorkingMemoryEntry,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import type { ArtifactSource } from '../../ports'
import type { CassetteInputLeg } from '../../cassette/input-leg'
import {
  MissingDecisionBlobError,
  UnsupportedBriefError,
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

  it('omits knowledgeBrief for an empty-but-structured brief', () => {
    const { stepContext } = reconstructDecisionContext({
      leg: makeLeg(),
      captureMode: 'textOnly',
      artifacts: artifactSource({}),
      model: 'planner-model',
    })
    expect('knowledgeBrief' in stepContext).toBe(false)
  })

  it('throws UnsupportedBriefError naming the channel for a non-empty brief', () => {
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
    expect(thrown).toBeInstanceOf(UnsupportedBriefError)
    expect((thrown as Error).message).toContain('channel3')
  })
})
