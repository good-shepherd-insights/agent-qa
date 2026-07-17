import { wrapAppObservedData } from '@vostride/agent-qa-safety'
import {
  canonicalJson,
  normalizeAnchor,
  type Anchor,
  type CautionBlock,
  type IndexEntry,
} from '@vostride/agent-qa-schema'

import {
  compareServingTrustThenId,
  createServingAdmissionState,
  estimateServingSummaryCost,
  tryAdmitServingRecord,
} from './brief-selection.js'
import { renderCautionSummary } from './brief-render.js'

type OriginStampedEntry = IndexEntry & {
  origin?: 'app-observed' | 'user'
  originClass?: 'agent-observed' | 'agent-verified' | 'import' | 'user'
}

export interface CautionSelectionOverflow {
  served: number
  eligible: number
}

export interface CautionSelectionResult {
  block: CautionBlock
  overflow?: CautionSelectionOverflow
}

export interface SelectCautionsInput {
  readonly candidates: readonly IndexEntry[]
  readonly anchors: readonly Anchor[]
  readonly budget: number
  readonly recordCap?: number
}

interface RankedCaution {
  readonly record: IndexEntry
  readonly matchPriority: number
  readonly summary: string
  readonly cost: number
}

const MATCH_PRIORITY: Readonly<Partial<Record<Anchor['t'], number>>> = {
  el: 0,
  page: 1,
  flow: 2,
}

function normalizedAnchorKey(anchor: Anchor): string {
  return canonicalJson(normalizeAnchor(anchor))
}

function queryPriorities(anchors: readonly Anchor[]): Map<string, number> {
  const priorities = new Map<string, number>()

  for (const anchor of anchors) {
    const priority = MATCH_PRIORITY[anchor.t]
    if (priority === undefined) continue
    const key = normalizedAnchorKey(anchor)
    priorities.set(key, Math.min(priority, priorities.get(key) ?? priority))
  }

  return priorities
}

function bestMatchPriority(
  anchors: readonly Anchor[],
  priorities: ReadonlyMap<string, number>,
): number | undefined {
  let best: number | undefined

  for (const anchor of anchors) {
    const priority = priorities.get(normalizedAnchorKey(anchor))
    if (priority !== undefined) best = Math.min(best ?? priority, priority)
  }

  return best
}

function isEligibleCaution(record: IndexEntry): boolean {
  if (record.kind !== 'caution') return false
  if (record.status === 'active') return true
  return record.status === 'candidate' && record.unverified === true
}

function isAppObserved(record: OriginStampedEntry): boolean {
  return record.origin === 'app-observed' || record.originClass === 'agent-observed'
}

function renderedSummary(record: IndexEntry): string {
  const summary = renderCautionSummary(record.summary)
  return isAppObserved(record as OriginStampedEntry)
    ? wrapAppObservedData(summary)
    : summary
}

function rankedCautions(input: SelectCautionsInput): RankedCaution[] {
  const priorities = queryPriorities(input.anchors)

  return input.candidates
    .flatMap((record): RankedCaution[] => {
      if (!isEligibleCaution(record)) return []
      const matchPriority = bestMatchPriority(record.anchors, priorities)
      if (matchPriority === undefined) return []
      const summary = renderedSummary(record)
      return [{
        record,
        matchPriority,
        summary,
        cost: estimateServingSummaryCost(renderCautionSummary(record.summary)),
      }]
    })
    .sort((left, right) => (
      left.matchPriority - right.matchPriority
      || compareServingTrustThenId(left.record, right.record)
    ))
}

/**
 * Select automatic Channel-3 cautions without consulting Channel-1 membership. D-16 deliberately
 * re-surfaces an L1 caution at the failure moment; dedup against the frozen brief does not belong
 * at this selection site.
 */
export function selectCautions(input: SelectCautionsInput): CautionSelectionResult {
  const ranked = rankedCautions(input)
  const recordCap = input.recordCap ?? ranked.length
  const admission = createServingAdmissionState()
  const cautions: CautionBlock['cautions'] = []

  for (const candidate of ranked) {
    if (!tryAdmitServingRecord({
      record: candidate.record,
      cost: candidate.cost,
      channelBudget: input.budget,
      recordCap,
    }, admission)) continue

    cautions.push({
      id: candidate.record.id,
      anchors: candidate.record.anchors,
      summary: candidate.summary,
    })
  }

  const block: CautionBlock = { cautions, budgetUsed: admission.usedBudget }
  return cautions.length < ranked.length
    ? { block, overflow: { served: cautions.length, eligible: ranked.length } }
    : { block }
}
