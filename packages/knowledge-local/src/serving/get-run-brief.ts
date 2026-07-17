import type {
  BriefBlock,
  BriefLine,
  IndexEntry,
  ScopeKey,
} from '@vostride/agent-qa-schema'

import { selectServingRecords } from './brief-selection.js'
import { renderBriefLine } from './brief-render.js'
import type { readPolicyLadder } from './policy-ladder.js'

type OriginStampedEntry = IndexEntry & {
  origin?: 'app-observed' | 'user'
  originClass?: 'agent-observed' | 'agent-verified' | 'import' | 'user'
}

interface AssembleRunBriefInput {
  candidates: IndexEntry[]
  policy: ReturnType<typeof readPolicyLadder>
  scope: ScopeKey
  budget: number
  recordCap: number
  asOfBuild?: number
}

function isUserFact(entry: IndexEntry): boolean {
  const stampedEntry = entry as OriginStampedEntry
  return entry.kind === 'fact'
    && entry.status === 'active'
    && (stampedEntry.origin === 'user' || stampedEntry.originClass === 'user')
}

function compareRecordId(left: IndexEntry, right: IndexEntry): number {
  const leftId = String(left.id)
  const rightId = String(right.id)
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0
}

function renderSovereignLine(entry: IndexEntry): BriefLine {
  return {
    id: entry.id,
    kind: entry.kind,
    summary: entry.summary,
    trust: entry.trust,
    status: entry.status,
    servedAsCanary: entry.servedAsCanary,
    tier: 'L0',
  }
}

function appendVerbatimLines(base: string, lines: readonly string[]): string {
  if (lines.length === 0) return base

  const suffix = lines.join('\n')
  if (base.length === 0 || base.endsWith('\n')) return `${base}${suffix}`
  return `${base}\n${suffix}`
}

function normalizedRecordCap(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function policyWarnings(policy: ReturnType<typeof readPolicyLadder>): string[] {
  return policy.oversized.map(({ file, approxTokens }) => (
    `oversized policy ${file}: approximately ${approxTokens} tokens; served whole`
  ))
}

function truncationSignal(
  served: number,
  eligible: number,
  warnings: readonly string[],
): string {
  const signals = served < eligible ? [`truncated ${served} of ${eligible}`] : []
  signals.push(...warnings)
  return signals.join('\n')
}

/**
 * Assemble the deterministic Channel-1 brief over records already loaded by the reader.
 * L0 is sovereign and whole; the supplied budget applies only to learned L1/L2 records.
 */
export function assembleRunBrief(input: AssembleRunBriefInput): BriefBlock {
  const userFacts = input.candidates.filter(isUserFact).sort(compareRecordId)
  const learnedCandidates = input.candidates.filter((entry) => !isUserFact(entry))
  const recordCap = Math.max(0, normalizedRecordCap(input.recordCap) - userFacts.length)
  const temporalInput = input.asOfBuild === undefined
    ? {}
    : { asOfBuild: input.asOfBuild }

  const eligible = selectServingRecords({
    candidates: learnedCandidates,
    scope: input.scope,
    channelBudget: Number.MAX_SAFE_INTEGER,
    recordCap: learnedCandidates.length,
    ...temporalInput,
  })
  const selected = selectServingRecords({
    candidates: learnedCandidates,
    scope: input.scope,
    channelBudget: input.budget,
    recordCap,
    ...temporalInput,
  })
  const rendered = selected.map(renderBriefLine)
  const cautions = rendered.filter(({ briefLine }) => briefLine.tier === 'L1')
  const learned = rendered.filter(({ briefLine }) => briefLine.tier === 'L2')
  const sovereignLines = userFacts.map(renderSovereignLine)

  return {
    tiers: {
      L0: appendVerbatimLines(input.policy.text, userFacts.map(({ summary }) => summary)),
      L1: cautions.map(({ line }) => line).join('\n'),
      L2: learned.map(({ line }) => line).join('\n'),
    },
    lines: [
      ...sovereignLines,
      ...rendered.map(({ briefLine }) => briefLine),
    ],
    truncation: truncationSignal(
      selected.length,
      eligible.length,
      policyWarnings(input.policy),
    ),
  }
}
