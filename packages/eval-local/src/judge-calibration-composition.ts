import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  adjudicatePanelComparison, assessPanelEligibility, createPanelIdentity,
  prepareJudgeCalibrationProbe, resolveJudgeCalibrationMinimum,
  summarizeJudgeCalibration,
  type BaselineProfileKeyInput, type JudgeCalibrationProbeObservation,
  type JudgeCalibrationMinimum, type UsageAggregator,
} from '@vostride/agent-qa-eval'
import type { ModelProfile } from '@vostride/agent-qa-model'
import { createMaskingContext } from '@vostride/agent-qa-safety'
import { JsonlAuditSink, runSafetyScope } from '@vostride/agent-qa-safety-local'
import { bindJudgePanel, type JudgeBindingInput } from './judge-binding.js'
import { loadJudgeCalibrationEvidence } from './judge-calibration-evidence-source.js'
import { assertCalibrationPath } from './calibration-source.js'

export interface RunJudgePanelCalibrationInput {
  committedRoot: string
  agentQaRoot: string
  profile: BaselineProfileKeyInput
  replayProfile: ModelProfile
  members: readonly JudgeBindingInput[]
  minN?: JudgeCalibrationMinimum
  replayRunRoots?: readonly string[]
  maskingContextFactory?: () => ReturnType<typeof createMaskingContext>
}

/** Operator-only forced probe. Credentials and source action content never enter its DTO. */
export async function runJudgePanelCalibration(input: RunJudgePanelCalibrationInput) {
  const disclosure = (input.maskingContextFactory ?? createMaskingContext)()
  try {
    for (const member of input.members) {
      if (member.auth.kind === 'api-key') disclosure.register(member.auth.apiKey)
      if (member.auth.kind === 'bearer-token') disclosure.register(member.auth.token)
    }
    if (input.members.length < 2) throw new Error('Explicit panel required')
    // Never manufacture a replacement canonical identity from a credential-bearing ID.
    if ([input.replayProfile.model, ...input.members.map(member => member.profile.model)]
      .some(id => disclosure.mask(id) !== id)) throw new Error('Unsafe model identity')
    const preview = await executeJudgePanelCalibration(input)
    return JSON.parse(disclosure.mask(JSON.stringify(preview))) as typeof preview
  } catch {
    throw new Error('Judge calibration probe failed; inspect the local audit and retry.')
  } finally { disclosure.dispose() }
}

async function executeJudgePanelCalibration(input: RunJudgePanelCalibrationInput) {
  const minN = input.minN ?? resolveJudgeCalibrationMinimum()
  resolveJudgeCalibrationMinimum(minN.value)
  if (input.profile.plannerModelId !== input.replayProfile.model) throw new Error('Calibration replay profile mismatch.')
  const identity = createPanelIdentity(input.members.map(member => member.profile.model))
  if (input.profile.judgeModelId !== identity.judgeModelId || input.profile.judgeVersion !== identity.judgeVersion) {
    throw new Error('Calibration panel profile mismatch.')
  }
  const read = loadJudgeCalibrationEvidence(input)
  const observations: JudgeCalibrationProbeObservation[] = []
  const auditDirectory = join(input.agentQaRoot, 'eval', 'calibrate', randomUUID())
  assertCalibrationPath(input.agentQaRoot, auditDirectory)
  const memberModelIds = input.members.map(member => member.profile.model)
  for (const row of read.evidence) {
    // Re-read the admitted receipt, preserving genuine absence and unknown supplied IDs.
    const recordedModelId = row.recordedReceipt.receipt.model.declared?.modelId
      ?? row.recordedReceipt.receipt.model.resolvedModelId
    const eligibility = assessPanelEligibility({ memberModelIds,
      replayedModelId: input.replayProfile.model,
      ...(recordedModelId === undefined ? {} : { recordedModelId }) })
    const common = { decisionId: row.decisionId, replayedModelId: input.replayProfile.model,
      ...(recordedModelId === undefined ? {} : { recordedModelId }), truth: row.truth, eligibility }
    if (!eligibility.eligible) {
      observations.push({ ...common, kind: 'not-invoked', reason: 'no-eligible-judge' })
      continue
    }
    const probe = prepareJudgeCalibrationProbe(row)
    if (!probe) { observations.push({ ...common, kind: 'skipped', reason: 'missing-evidence' }); continue }
    const masker = (input.maskingContextFactory ?? createMaskingContext)()
    try {
      // Explicit member credentials join the fresh session seed before any egress.
      for (const member of input.members) {
        if (member.auth.kind === 'api-key') masker.register(member.auth.apiKey)
        if (member.auth.kind === 'bearer-token') masker.register(member.auth.token)
      }
      const usage: UsageAggregator = { calls: 0 }
      const outcome = await runSafetyScope({ maskingContext: masker,
        auditSink: new JsonlAuditSink(auditDirectory) }, () => {
        const port = bindJudgePanel(input.members)
        return adjudicatePanelComparison(port, probe.evidence, usage)
      })
      observations.push({ ...common, kind: 'attempted', probe, outcome, usage })
    } catch {
      throw new Error('Judge calibration probe failed; inspect the local audit and retry.')
    } finally { masker.dispose() }
  }
  const summary = summarizeJudgeCalibration({ observations, memberModelIds, minN, selected: read.selected })
  return { kind: 'dry-run' as const, ...summary,
    identity, profileKey: read.profileKey,
    corpusDigest: read.corpusDigest, goldSetDigest: read.goldSetDigest,
    replayEvidenceDigest: read.replayEvidenceDigest, evidenceDigest: read.evidenceDigest,
    skippedCounts: read.skippedCounts,
    auditDirectory,
    // Explicit safe projection: no source actions, prompts, auth, or arbitrary provider detail.
    rows: observations.map(row => ({ decisionId: row.decisionId, replayedModelId: row.replayedModelId,
      ...(row.recordedModelId === undefined ? {} : { recordedModelId: row.recordedModelId }),
      kind: row.kind, eligibility: row.eligibility, truth: row.truth,
      ...(row.kind === 'attempted' ? { axis: row.probe.axis, outcome: row.outcome,
        members: row.usage.members, usage: { calls: row.usage.calls,
          ...(row.usage.inputTokens === undefined ? {} : { inputTokens: row.usage.inputTokens }),
          ...(row.usage.outputTokens === undefined ? {} : { outputTokens: row.usage.outputTokens }) } } : { reason: row.reason }) })) }
}
