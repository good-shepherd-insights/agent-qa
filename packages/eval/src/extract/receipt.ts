import { screenStateHash, sha256hex } from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  StepEvidence,
  SubActionEvidence,
} from '@vostride/agent-qa-schema'
import type { CassetteInputLeg } from '../cassette/input-leg'
import type {
  CassetteJudgeReceipt,
  CassetteModelReceipt,
  CassetteReceipt,
  CassetteSamplingReceipt,
} from '../cassette/receipt-leg'
import { canonicalValue } from '../canonical-json'

export interface AssembleReceiptInput {
  inputLeg: CassetteInputLeg
  step: StepEvidence
  subAction: SubActionEvidence
  handoff: CompletedRunHandoff
}

/**
 * Canonical input-leg serialization shared with replay. Phase 368 must import this function
 * when reproducing `promptInputHash`; object keys sort recursively and array order is retained.
 */
export function canonicalizeInputLeg(leg: CassetteInputLeg): string {
  const serialized = JSON.stringify(canonicalValue(leg))
  if (serialized === undefined) {
    throw new TypeError('Cassette input leg did not produce canonical JSON')
  }
  return serialized
}

export function assembleReceipt({
  inputLeg,
  step,
  subAction,
  handoff,
}: AssembleReceiptInput): CassetteReceipt {
  const model: CassetteModelReceipt = {
    ...(step.modelProfile === undefined
      ? {}
      : {
          declared: {
            provider: step.modelProfile.provider,
            modelId: step.modelProfile.modelId,
          },
        }),
    ...(subAction.callRecord?.resolvedModelId === undefined
      ? {}
      : { resolvedModelId: subAction.callRecord.resolvedModelId }),
    ...(subAction.callRecord?.fingerprint === undefined
      ? {}
      : { fingerprint: subAction.callRecord.fingerprint }),
  }
  const sampling: CassetteSamplingReceipt = {
    ...(step.modelProfile?.sampling === undefined
      ? {}
      : { declared: step.modelProfile.sampling }),
    ...(subAction.callRecord?.effectiveSampling === undefined
      ? {}
      : { effective: subAction.callRecord.effectiveSampling }),
  }
  const judge: CassetteJudgeReceipt = {
    ...(step.verifierIdentity === undefined
      ? {}
      : { recordedVerifier: step.verifierIdentity }),
  }

  return {
    promptInputHash: sha256hex(canonicalizeInputLeg(inputLeg)),
    model,
    sampling,
    ...(step.toolSchemaDigest === undefined
      ? {}
      : { toolSchemaDigest: step.toolSchemaDigest }),
    screenStateHash: screenStateHash(subAction.stateBefore),
    memoryBriefDigest: step.servedBrief.briefDigest,
    judge,
    buildOrdinal: handoff.buildOrdinal,
  }
}
