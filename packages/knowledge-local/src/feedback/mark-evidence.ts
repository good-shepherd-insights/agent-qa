// 2026-09-08, 419 D-04/D-09/D-10: append evidence under the caller's authority.
import { asEvidenceToken, asRecordId, isPromotionReceipt, type BundleOutcomeEvent,
  type CompletedRunHandoff, type ExecutionContext, type MarkReceipt } from '@vostride/agent-qa-schema'
import { appendOutcomeEvent } from '../bundle-append.js'
import type { BundleStoreConfig } from '../bundle-publish.js'
import { loadBundle, readGateReceipts, verifyBundleIntegrity } from '../bundle-read.js'
import { BundleTargetResolutionError, resolveProductQualifiedBundleDir } from '../bundle-scan.js'
import { withCurrentWriterAuthority } from '../lease/writer-lease.js'
import { canaryOutcomeObservationId } from '../serving/canary-observation-id.js'

export const MARK_EVIDENCE_TOKEN_PREFIX = 'mark:'

export interface AppendMarkEvidenceInput {
  knowledgeRoot: string
  auditBaseDir: string
  executionContext: ExecutionContext
  lease: { leaseId: string; epoch: number }
  mark: Pick<MarkReceipt, 'markId' | 'runId' | 'kind'>
  servedRecordIds: readonly string[]
  /** Historical observation hashes require the original member/step coordinates. */
  handoff?: CompletedRunHandoff
  /** Host-derived chainJobIdsForRun(runId, idSource).curateMemory; never guessed here. */
  curationJobIds?: readonly string[]
}

export type AppendMarkEvidenceOutcome = {
  confirmed: number
  overturned: number
  skipped: { recordId: string; reason: 'bundle-unreadable' | 'already-appended' }[]
  /** Without the handoff, opaque historical canary hashes cannot all be correlated. */
  correlationIncomplete?: true
}

export async function appendMarkEvidence(input: AppendMarkEvidenceInput): Promise<AppendMarkEvidenceOutcome> {
  if (input.handoff !== undefined && input.handoff.runId !== input.mark.runId) {
    throw new TypeError('mark evidence handoff belongs to another run')
  }
  return withCurrentWriterAuthority(input.knowledgeRoot, input.lease, () => {
    const result: AppendMarkEvidenceOutcome = { confirmed: 0, overturned: 0, skipped: [],
      ...(input.mark.kind === 'false-pass' && input.handoff === undefined
        ? { correlationIncomplete: true as const } : {}) }
    const token = `${MARK_EVIDENCE_TOKEN_PREFIX}${input.mark.markId}`
    for (const recordId of new Set(input.servedRecordIds)) {
      let entry
      try {
        entry = resolveProductQualifiedBundleDir({ knowledgeRoot: input.knowledgeRoot, recordId })
      } catch (error) {
        if (!(error instanceof BundleTargetResolutionError)) throw error
        result.skipped.push({ recordId, reason: 'bundle-unreadable' })
        continue
      }
      const loaded = loadBundle(entry.dir)
      if (loaded.kind !== 'loaded' || !verifyBundleIntegrity(entry.dir).ok) {
        result.skipped.push({ recordId, reason: 'bundle-unreadable' })
        continue
      }
      const bundle = loaded.bundle
      const observations = new Set<string>()
      for (const member of input.handoff?.tests ?? []) {
        for (const step of member.steps) {
          observations.add(canaryOutcomeObservationId({ candidateId: asRecordId(recordId),
            runId: input.mark.runId, testId: member.testId, testIndex: member.testIndex,
            stepIndex: step.stepIndex }))
        }
      }
      // Gate-2 receipts preserve run + observation identity even when the handoff is gone.
      for (const receipt of readGateReceipts(entry.dir, asRecordId(recordId)) ?? []) {
        if (!isPromotionReceipt(receipt) && receipt.gate === 2 && receipt.runId === input.mark.runId) {
          observations.add(receipt.attributedObservationId)
        }
      }
      const jobs = new Set(input.curationJobIds ?? [])
      const provenance = bundle.provenance
      if (provenance.mode === 'run-linked' && provenance.runId === input.mark.runId
        && provenance.curationJobId !== undefined) jobs.add(provenance.curationJobId)
      const hits = bundle.events.filter((event) => (event.type === 'helpful' || event.type === 'confirmed')
        && ((event.observationId !== undefined && observations.has(event.observationId))
          || jobs.has(event.curationJobId)))
      const buildOrdinal = Math.max(bundle.manifest.createdAtOrdinal,
        ...bundle.events.map((event) => event.buildOrdinal)) + 1
      const config: BundleStoreConfig = { knowledgeRoot: input.knowledgeRoot, productKey: entry.product,
        auditBaseDir: input.auditBaseDir, commitArtifacts: 'none', writerLeaseId: input.lease.leaseId,
        writerEpoch: input.lease.epoch }
      function append(event: BundleOutcomeEvent): boolean {
        const outcome = appendOutcomeEvent(config, asRecordId(recordId), event)
        if (outcome.kind === 'appended') return true
        if (outcome.kind === 'duplicate') return false
        // Do not misreport safety refusal or a lost target as a successful mark.
        throw new Error(`mark evidence append refused: ${outcome.kind}`)
      }
      let changed = append({ type: 'confirmed', evidenceToken: asEvidenceToken(token),
        curationJobId: token, buildOrdinal, origin: 'user' })
      if (changed) result.confirmed += 1
      if (input.mark.kind === 'false-pass') {
        for (const hit of hits) {
          // Include BOTH target identity fields: the same token may name two distinct jobs.
          const appended = append({ type: 'overturned', markId: input.mark.markId,
            evidenceToken: asEvidenceToken(`${token}:${hit.evidenceToken}:${hit.curationJobId}`),
            curationJobId: token, buildOrdinal, overturnsEvidenceToken: hit.evidenceToken,
            overturnsCurationJobId: hit.curationJobId })
          if (appended) { result.overturned += 1; changed = true }
        }
      }
      if (!changed) result.skipped.push({ recordId, reason: 'already-appended' })
    }
    return result
  })
}
