// 2026-09-08, 419 D-04/D-09/D-10: append evidence under the caller's authority.
import { basename } from 'node:path'
import { asEvidenceToken, asRecordId, deriveEvidenceToken, exercisedAnchors, isPromotionReceipt, type BundleOutcomeEvent,
  type CompletedRunHandoff, type ExecutionContext, type MarkReceipt } from '@vostride/agent-qa-schema'
import { appendOutcomeEvent } from '../bundle-append.js'
import type { BundleStoreConfig } from '../bundle-publish.js'
import { loadBundle, readGateReceipts, verifyBundleIntegrity } from '../bundle-read.js'
import { BundleTargetResolutionError, enumerateBundleDirs, resolveProductQualifiedBundleDir } from '../bundle-scan.js'
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
  /** Resuming one mark reports its complete logical effect, including already durable events. */
  includeAlreadyAppended?: boolean
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
    const served = new Set(input.servedRecordIds)
    const targets = new Set([...served, ...(input.mark.kind === 'false-pass'
      ? enumerateBundleDirs(input.knowledgeRoot).map(entry => basename(entry.dir)) : [])])
    for (const recordId of targets) {
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
      const evidenceTokens = new Set<string>()
      const bundleAnchors = bundle.frontmatter.anchors.map(({ raw }) => raw)
      for (const member of input.handoff?.tests ?? []) {
        for (const step of member.steps) {
          const canaryId = canaryOutcomeObservationId({ candidateId: asRecordId(recordId),
            runId: input.mark.runId, testId: member.testId, testIndex: member.testIndex,
            stepIndex: step.stepIndex })
          observations.add(canaryId)
          // The deterministic emitter's persisted observation address (emit-candidates.ts).
          observations.add(`${input.mark.runId}:test-${member.testIndex}:step-${step.stepIndex}`)
          // Positive canary Confirm goes through the knowledge-port bridge, which changes
          // observationId but preserves this canonical run/anchor/build evidence token.
          for (const anchor of [...bundleAnchors, ...exercisedAnchors(step)]) {
            evidenceTokens.add(deriveEvidenceToken({ attributingObservationId: canaryId,
              anchor, buildOrdinal: input.handoff!.buildOrdinal }))
          }
        }
      }
      // Gate-2 receipts preserve run + observation identity even when the handoff is gone.
      for (const receipt of readGateReceipts(entry.dir, asRecordId(recordId)) ?? []) {
        if (!isPromotionReceipt(receipt) && receipt.gate === 2 && receipt.runId === input.mark.runId) {
          observations.add(receipt.attributedObservationId)
          for (const anchor of bundleAnchors) {
            evidenceTokens.add(deriveEvidenceToken({ attributingObservationId: receipt.attributedObservationId,
              anchor, buildOrdinal: receipt.producedAtOrdinal }))
          }
        }
      }
      const jobs = new Set(input.curationJobIds ?? [])
      const provenance = bundle.provenance
      if (provenance.mode === 'run-linked' && provenance.runId === input.mark.runId
        && provenance.curationJobId !== undefined) jobs.add(provenance.curationJobId)
      const hits = bundle.events.filter((event) => (event.type === 'helpful' || event.type === 'confirmed')
        && ((event.observationId !== undefined && observations.has(event.observationId))
          || evidenceTokens.has(event.evidenceToken) || jobs.has(event.curationJobId)))
      if (!served.has(recordId) && hits.length === 0) continue
      const buildOrdinal = Math.max(bundle.manifest.createdAtOrdinal,
        ...bundle.events.map((event) => event.buildOrdinal)) + 1
      const config: BundleStoreConfig = { knowledgeRoot: input.knowledgeRoot, productKey: entry.product,
        auditBaseDir: input.auditBaseDir, commitArtifacts: 'none', writerLeaseId: input.lease.leaseId,
        writerEpoch: input.lease.epoch }
      function append(event: BundleOutcomeEvent): boolean {
        const outcome = appendOutcomeEvent(config, asRecordId(recordId), event)
        if (outcome.kind === 'appended') return true
        if (outcome.kind === 'duplicate') return input.includeAlreadyAppended === true
        // Do not misreport safety refusal or a lost target as a successful mark.
        throw new Error(`mark evidence append refused: ${outcome.kind}`)
      }
      let changed = served.has(recordId) && append({ type: 'confirmed', evidenceToken: asEvidenceToken(token),
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
