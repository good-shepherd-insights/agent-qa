import { screenStateHash, sha256hex } from '@vostride/agent-qa-schema'
import type {
  ArtifactRef,
  CompletedRunHandoff,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import type { CassetteInputLeg } from '../../cassette/input-leg'
import {
  makeArtifactRefV2Handoff,
  makeV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import { projectInputLeg } from '../input-leg'
import { assembleReceipt, canonicalizeInputLeg } from '../receipt'

function fixtureDecision(handoff: CompletedRunHandoff = makeV2Handoff()) {
  const handoffTest = handoff.tests[0]!
  const step = handoffTest.steps[0]!
  const subAction = step.subActions[0]!
  const inputLeg = projectInputLeg({
    handoffTest,
    step,
    subAction,
    testIndex: handoffTest.testIndex,
    stepIndex: step.stepIndex,
    decisionOrdinal: 0,
  })

  return { handoff, step, subAction, inputLeg }
}

function reverseObjectKeys<T>(input: T): T {
  if (Array.isArray(input)) {
    return input.map((entry) => reverseObjectKeys(entry)) as T
  }
  if (input === null || typeof input !== 'object') return input

  const source = input as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(source)
      .reverse()
      .map((key) => [key, reverseObjectKeys(source[key])]),
  ) as T
}

describe('assembleReceipt', () => {
  it('assembles all eight receipt components from their recorded sources', () => {
    const { handoff, step, subAction, inputLeg } = fixtureDecision()
    const receipt = assembleReceipt({ inputLeg, step, subAction, handoff })

    expect(Object.keys(receipt).sort()).toEqual([
      'buildOrdinal',
      'judge',
      'memoryBriefDigest',
      'model',
      'promptInputHash',
      'sampling',
      'screenStateHash',
      'toolSchemaDigest',
    ])
    expect(receipt).toEqual({
      promptInputHash: sha256hex(canonicalizeInputLeg(inputLeg)),
      model: {
        declared: {
          provider: step.modelProfile!.provider,
          modelId: step.modelProfile!.modelId,
        },
        resolvedModelId: subAction.callRecord!.resolvedModelId,
        fingerprint: subAction.callRecord!.fingerprint,
      },
      sampling: {
        declared: step.modelProfile!.sampling,
        effective: subAction.callRecord!.effectiveSampling,
      },
      toolSchemaDigest: step.toolSchemaDigest,
      screenStateHash: screenStateHash(subAction.stateBefore),
      memoryBriefDigest: step.servedBrief.briefDigest,
      judge: { recordedVerifier: step.verifierIdentity },
      buildOrdinal: handoff.buildOrdinal,
    })
    expect(receipt.promptInputHash).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.toolSchemaDigest).toBe(step.toolSchemaDigest)
    expect(receipt.screenStateHash).toBe(screenStateHash(subAction.stateBefore))
    expect(receipt.memoryBriefDigest).toBe(step.servedBrief.briefDigest)
    expect(receipt.judge.recordedVerifier).toBe(step.verifierIdentity)
    expect(Object.hasOwn(receipt.judge, 'tier4JudgeId')).toBe(false)
  })

  it('keeps unobserved fingerprint and effective sampling structurally absent', () => {
    const { handoff, step, subAction, inputLeg } = fixtureDecision()
    const degradedSubAction: SubActionEvidence = {
      ...subAction,
      callRecord: { resolvedModelId: subAction.callRecord!.resolvedModelId },
    }

    const receipt = assembleReceipt({
      inputLeg,
      step,
      subAction: degradedSubAction,
      handoff,
    })

    expect(receipt.model.declared).toEqual({
      provider: step.modelProfile!.provider,
      modelId: step.modelProfile!.modelId,
    })
    expect(receipt.sampling.declared).toBe(step.modelProfile!.sampling)
    expect(receipt.model.resolvedModelId).toBe(subAction.callRecord!.resolvedModelId)
    expect(Object.hasOwn(receipt.model, 'fingerprint')).toBe(false)
    expect(Object.hasOwn(receipt.sampling, 'effective')).toBe(false)
  })

  it('canonicalizes structurally equal input legs independently of key insertion order', () => {
    const { inputLeg } = fixtureDecision()
    const reordered = reverseObjectKeys(inputLeg) as CassetteInputLeg

    expect(reordered).toEqual(inputLeg)
    expect(canonicalizeInputLeg(reordered)).toBe(canonicalizeInputLeg(inputLeg))
    expect(sha256hex(canonicalizeInputLeg(reordered))).toBe(
      sha256hex(canonicalizeInputLeg(inputLeg)),
    )
  })

  it('is deterministic for repeated assembly over the same evidence', () => {
    const input = fixtureDecision()

    expect(assembleReceipt(input)).toEqual(assembleReceipt(input))
  })
})

describe('assembleReceipt artifact-role binding', () => {
  const screenshot: ArtifactRef = { id: 'decision-shot', sha: 'a'.repeat(64) }
  const auxA: ArtifactRef = { id: 'aux-a', sha: 'b'.repeat(64) }
  const auxB: ArtifactRef = { id: 'aux-b', sha: 'c'.repeat(64) }

  function artifactDecision() {
    const { handoff, step, subAction, inputLeg } = fixtureDecision(makeArtifactRefV2Handoff())
    const baseLeg: CassetteInputLeg = {
      ...inputLeg,
      decisionScreenshotRef: screenshot,
      auxiliaryArtifactRefs: [auxA, auxB],
    }
    return { handoff, step, subAction, baseLeg }
  }

  function hashFor(inputLeg: CassetteInputLeg) {
    const { handoff, step, subAction } = artifactDecision()
    return assembleReceipt({ inputLeg, step, subAction, handoff }).promptInputHash
  }

  const mutations: Array<{ name: string; mutate: (leg: CassetteInputLeg) => CassetteInputLeg }> = [
    {
      name: 'a changed screenshot id',
      mutate: leg => ({ ...leg, decisionScreenshotRef: { ...screenshot, id: 'other-shot' } }),
    },
    {
      name: 'a changed screenshot sha',
      mutate: leg => ({ ...leg, decisionScreenshotRef: { ...screenshot, sha: 'f'.repeat(64) } }),
    },
    {
      name: 'a screenshot evidenceIncomplete marker',
      mutate: leg => ({
        ...leg,
        decisionScreenshotRef: { ...screenshot, evidenceIncomplete: true },
      }),
    },
    {
      name: 'a changed auxiliary id',
      mutate: leg => ({ ...leg, auxiliaryArtifactRefs: [{ ...auxA, id: 'aux-x' }, auxB] }),
    },
    {
      name: 'a changed auxiliary sha',
      mutate: leg => ({ ...leg, auxiliaryArtifactRefs: [{ ...auxA, sha: 'd'.repeat(64) }, auxB] }),
    },
    {
      name: 'a reordered auxiliary array',
      mutate: leg => ({ ...leg, auxiliaryArtifactRefs: [auxB, auxA] }),
    },
    {
      name: 'a ref moved from screenshot into auxiliary role',
      mutate: leg => ({
        ...leg,
        decisionScreenshotRef: auxA,
        auxiliaryArtifactRefs: [screenshot, auxB],
      }),
    },
  ]

  it('produces a stable promptInputHash for identical artifact bindings', () => {
    const { baseLeg } = artifactDecision()

    expect(hashFor(baseLeg)).toBe(hashFor(baseLeg))
    expect(hashFor(baseLeg)).toMatch(/^[0-9a-f]{64}$/)
  })

  for (const { name, mutate } of mutations) {
    it(`changes promptInputHash under ${name}`, () => {
      const { baseLeg } = artifactDecision()

      expect(hashFor(mutate(baseLeg))).not.toBe(hashFor(baseLeg))
    })
  }

  it('keeps the typed screenshot binding as hash material regardless of blob bytes', () => {
    const { baseLeg } = artifactDecision()
    const { decisionScreenshotRef: _dropped, ...withoutScreenshot } = baseLeg
    void _dropped

    expect(hashFor(withoutScreenshot as CassetteInputLeg)).not.toBe(hashFor(baseLeg))
  })
})
