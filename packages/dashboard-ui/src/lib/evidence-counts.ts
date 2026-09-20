import type { AriaEvidenceEntry, EvidenceKind, StepEvidenceEntries } from '@vostride/agent-qa-schema'
import { EVIDENCE_COPY, resolveEvidenceView } from './evidence-state-view'

export type StepSignal = 'console' | 'network' | 'a11y'
export const STEP_SIGNALS = ['console', 'network', 'a11y'] as const satisfies readonly StepSignal[]

export type TabCount =
  | { kind: 'problem'; count: number; severity: 'high' | 'moderate' }
  | { kind: 'total'; count: number }
  | { kind: 'absent'; title: string; count?: never }

const TAB_NAMES = {
  variables: 'Variables', network: 'Network', console: 'Console', aria: 'ARIA Tree', a11y: 'A11y',
} satisfies Record<EvidenceKind, string>

export function stepSignals(entries: StepEvidenceEntries | undefined): Record<StepSignal, number | undefined> {
  const consoleEntry = entries?.console
  const network = entries?.network
  const a11y = entries?.a11y
  const positive = (count: number) => count > 0 ? count : undefined
  return {
    console: consoleEntry?.state === 'present' && !consoleEntry.ref.evidenceIncomplete
      ? positive(consoleEntry.counts.errors) : undefined,
    network: network?.state === 'present' && !network.ref.evidenceIncomplete
      ? positive(network.counts.failed + network.counts.errored) : undefined,
    a11y: a11y?.state === 'present' && !a11y.ref.evidenceIncomplete
      ? positive(a11y.counts.minor + a11y.counts.moderate + a11y.counts.serious + a11y.counts.critical)
      : undefined,
  }
}

export function tabCounts(
  entries: StepEvidenceEntries | undefined,
  aria?: AriaEvidenceEntry,
  selection: Parameters<typeof resolveEvidenceView>[0]['selection'] = 'sub-action',
): Record<EvidenceKind, TabCount | undefined> {
  const signals = stepSignals(entries)
  const countFor = (kind: EvidenceKind): TabCount | undefined => {
    const entry = kind === 'aria' ? aria : entries?.[kind]
    const view = resolveEvidenceView({ kind, entry, selection, read: 'idle' })
    if (view.kind === 'state') return { kind: 'absent', title: view.title }
    if (!entry || entry.state !== 'present' || entry.kind === 'aria') return undefined
    if (entry.kind !== 'variables') {
      const count = signals[entry.kind]
      if (count !== undefined) {
        const severity = entry.kind === 'a11y' && entry.counts.critical === 0 && entry.counts.serious === 0
          ? 'moderate' : 'high'
        return { kind: 'problem', count, severity }
      }
    }
    const total = entry.kind === 'variables' ? entry.counts.count
      : entry.kind === 'a11y' ? 0 : entry.counts.total
    return total > 0 ? { kind: 'total', count: total }
      : { kind: 'absent', title: EVIDENCE_COPY[kind].empty.title }
  }
  return {
    variables: countFor('variables'), network: countFor('network'), console: countFor('console'),
    aria: countFor('aria'), a11y: countFor('a11y'),
  }
}

export function countedTriggerName(kind: EvidenceKind, value: Exclude<TabCount, { kind: 'absent' }>): string {
  const { count } = value
  const nouns = value.kind === 'problem'
    ? { console: ['error', 'errors'], network: ['failed request', 'failed requests'], a11y: ['violation', 'violations'] }
    : { console: ['message', 'messages'], network: ['request', 'requests'], a11y: ['violation', 'violations'] }
  const noun = kind === 'variables' || kind === 'aria' ? '' : ` ${nouns[kind][count === 1 ? 0 : 1]}`
  return `${TAB_NAMES[kind]}, ${count}${noun}`
}

export function absentTriggerName(kind: EvidenceKind, title: string): string {
  return `${TAB_NAMES[kind]} — ${title}`
}

export function signalBadgeName(kind: StepSignal, count: number, step: number): string {
  const nouns = {
    console: ['console error', 'console errors'],
    network: ['failed request', 'failed requests'],
    a11y: ['accessibility violation', 'accessibility violations'],
  }
  return `${count} ${nouns[kind][count === 1 ? 0 : 1]} on step ${step} — open ${TAB_NAMES[kind]}`
}
