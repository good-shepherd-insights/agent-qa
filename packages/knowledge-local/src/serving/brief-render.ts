import { wrapAppObservedData } from '@vostride/agent-qa-safety'
import type { BriefLine, IndexEntry } from '@vostride/agent-qa-schema'

const MAX_LEARNED_SUMMARY_CODE_UNITS = 140
export const CHARS_PER_TOKEN_ESTIMATE = 4

type OriginStampedEntry = IndexEntry & {
  origin?: 'app-observed' | 'user'
  originClass?: 'agent-observed' | 'agent-verified' | 'import' | 'user'
}

/**
 * Cap learned summaries using JavaScript String.length (UTF-16 code units), the
 * BRIF-01 length contract. The ellipsis is part of the 140-code-unit maximum.
 */
export function renderCautionSummary(summary: string): string {
  if (summary.length <= MAX_LEARNED_SUMMARY_CODE_UNITS) return summary

  return `${summary.slice(0, MAX_LEARNED_SUMMARY_CODE_UNITS - 1)}…`
}

function renderAnnotations(entry: IndexEntry): string[] {
  const annotations: string[] = []

  if (entry.unconfirmedSinceOrdinal !== undefined) {
    annotations.push(`unconfirmed since build ${entry.unconfirmedSinceOrdinal}`)
  }
  if (entry.unverified === true) annotations.push('UNVERIFIED')
  if (entry.servedAs === 'prior-build-hypothesis') {
    annotations.push('prior-build hypothesis')
  }
  if (entry.conflict !== undefined) {
    annotations.push(
      `CONFLICT peer ${entry.conflict.peerRecordId}; unknown ${entry.conflict.unknownRecordId}`,
    )
  }
  if (entry.servedAsCanary) annotations.push('CANARY')

  return annotations
}

function tierForEntry(entry: OriginStampedEntry): string {
  if (entry.origin === 'user' || entry.originClass === 'user') return 'L0'
  if (entry.kind === 'caution') return 'L1'
  return 'L2'
}

function isAppObserved(entry: OriginStampedEntry): boolean {
  return entry.origin === 'app-observed' || entry.originClass === 'agent-observed'
}

/** Deterministic provisional cost of the exact text handed to the planner. */
export function estimateRenderedServingCost(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE))
}

export interface RenderedCautionLine {
  summary: string
  cost: number
}

/** Render and cost Channel 3 through one projection so framing can never be undercharged. */
export function renderCautionLine(entry: IndexEntry): RenderedCautionLine {
  const rendered = renderCautionSummary(entry.summary)
  const summary = isAppObserved(entry as OriginStampedEntry)
    ? wrapAppObservedData(rendered)
    : rendered
  return { summary, cost: estimateRenderedServingCost(summary) }
}

export function renderBriefLine(
  entry: IndexEntry,
): { line: string; briefLine: BriefLine; cost: number } {
  const stampedEntry = entry as OriginStampedEntry
  const summary = renderCautionSummary(entry.summary)
  const annotations = renderAnnotations(entry)
  const markerSuffix = annotations.length === 0 ? '' : ` [${annotations.join('] [')}]`
  const observation = `Observation: ${summary}${markerSuffix}`
  const line = isAppObserved(stampedEntry)
    ? wrapAppObservedData(observation)
    : observation

  return {
    line,
    cost: estimateRenderedServingCost(line),
    briefLine: {
      id: entry.id,
      kind: entry.kind,
      summary,
      trust: entry.trust,
      status: entry.status,
      servedAsCanary: entry.servedAsCanary,
      tier: tierForEntry(stampedEntry),
    },
  }
}
