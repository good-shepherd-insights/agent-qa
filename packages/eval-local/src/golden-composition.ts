// Gate-side composition only: extraction, selection and census projection stay in eval core.
// The shipped writers own every committed byte.
import {
  assertBaselineComparator,
  buildGoldenTrajectoryPlan,
  deriveCensus,
  extractRunCassettes,
  markedDecisionCount,
  maskCorpusText,
  renderCensusMarkdown,
  resolveMarkedDecisions,
} from '@vostride/agent-qa-eval'
import type { CompletedRunHandoff, MarkReceipt, MaskFn } from '@vostride/agent-qa-schema'

import { FsRunArtifactSource } from './artifact-source.js'
import { commitCensus } from './census-committing.js'
import {
  listBaselinePointers,
  listCommittedReports,
  readCommittedCorpus,
  readPartitionManifests,
  readRunExclusions,
} from './committed-corpus-source.js'
import { requireCorpusMask, seedCommittedCorpus, type SeedingRefusal } from './seeding-composition.js'

export interface FreezeGoldenTrajectoryInput {
  agentQaRoot: string
  committedRoot: string
  product: string
  mark: MarkReceipt
  handoff: CompletedRunHandoff
  supersedes?: string
  priorGold?: MarkReceipt['gold']
  /** 441 GAP3-D1: the declared mask the run and the mark's correction are frozen under. */
  mask: MaskFn
}

export type FreezeOutcome =
  | { kind: 'ambiguous-correction'; decisionCount: number }
  | { kind: 'frozen'; cases: MarkReceipt['gold']; census: 'committed' | 'unchanged' | 'write-conflict' }
  | { kind: 'refused'; refusals: SeedingRefusal[] }
  | { kind: 'step-not-found'; stepCount: number }
  | { kind: 'no-leaf-cassette' }

export function freezeGoldenTrajectory(input: FreezeGoldenTrajectoryInput): FreezeOutcome {
  requireCorpusMask(input.mask, 'freezeGoldenTrajectory')
  // 441 GAP3-D1: the whole freeze reads the masked run and the masked correction. No later read
  // compares the frozen correction with the stored mark, so masking it moves no identity.
  const handoff = maskCorpusText(input.handoff, input.mask)
  const mark = maskCorpusText(input.mark, input.mask)
  const targets = resolveMarkedDecisions(handoff, mark, mark.kind)
  if ('refusal' in targets) return { kind: 'step-not-found', stepCount: targets.stepCount }
  const decisionCount = markedDecisionCount(handoff, targets)
  if (mark.correctedAction !== undefined && decisionCount !== 1) return { kind: 'ambiguous-correction', decisionCount }

  const extracted = extractRunCassettes({
    handoff,
    artifacts: new FsRunArtifactSource({ root: input.agentQaRoot, runId: handoff.runId }),
  })
  const plan = buildGoldenTrajectoryPlan({ ...input, handoff, mark, cassettes: extracted.cassettes })
  if (plan.cases.length === 0) return { kind: 'no-leaf-cassette' }
  if (plan.skipped.length > 0) {
    return { kind: 'refused', refusals: plan.skipped.map(({ cassetteId }) => ({ cassetteId, kind: 'missing-cassette' })) }
  }
  const seeded = seedCommittedCorpus({
    plan: {
      product: plan.product,
      runId: plan.runId,
      runSlug: plan.runSlug,
      cases: plan.cases,
      pairSkips: [],
      silverExclusions: [],
      pairCounts: { total: 0, sameState: 0, differingState: 0 },
      proceduresExcludedCount: 0,
    },
    cassettes: plan.goldCassettes,
    committedRoot: input.committedRoot,
    mask: input.mask,
  })
  if (seeded.refusals.length > 0) return { kind: 'refused', refusals: seeded.refusals }

  const read = readCommittedCorpus(input.committedRoot)
  const manifests = readPartitionManifests(input.committedRoot)
  const exclusions = readRunExclusions(input.committedRoot)
  const reports = listCommittedReports(input.committedRoot)
  const pointers = listBaselinePointers(input.committedRoot)
  // Never publish a partial census as the permanent view of a refused committed root.
  if ([read, manifests, exclusions, reports, pointers].some(result => result.refusals.length > 0)) {
    throw new Error('gold census refused: committed root contains unreadable evidence')
  }
  const census = deriveCensus({
    snapshot: read.snapshot,
    schemaVersionsSeen: read.schemaVersionsSeen,
    manifests: manifests.manifests,
    exclusions: exclusions.exclusions,
    reports: reports.reports.map(entry => ({
      report: entry.report,
      comparator: assertBaselineComparator(entry.report),
      designatedBy: pointers.pointers.filter(pointer => pointer.batchKey === entry.batchKey)
        .map(pointer => pointer.profileKey).sort(),
    })),
  })
  const committed = commitCensus({
    census,
    markdown: renderCensusMarkdown(census),
    committedRoot: input.committedRoot,
  })
  return {
    kind: 'frozen',
    cases: plan.cases.map(({ cassetteId, labelRecord }) => {
      const channel = labelRecord.label.sourceChannel
      const sourceCassetteId = labelRecord.provenance.sourceCassetteId
      if ((channel !== 'user-mark' && channel !== 'overturned-verdict') || sourceCassetteId === undefined) {
        throw new Error('gold plan must carry marked source provenance')
      }
      return { cassetteId, sourceCassetteId, channel }
    }),
    census: committed.kind === 'write-conflict' ? 'write-conflict'
      : committed.json === 'unchanged' && committed.markdown === 'unchanged' ? 'unchanged' : 'committed',
  }
}
