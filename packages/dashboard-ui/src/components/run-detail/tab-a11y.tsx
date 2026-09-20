import { useEffect, useState } from 'react'
import type { EvidenceDocument } from '@vostride/agent-qa-schema'
import { asRunId } from '@vostride/agent-qa-schema'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchRunEvidence, type RunEvidenceRead } from '@/lib/api'
import type { DisplayStep } from '@/lib/display-step'
import { copyTextOf } from '@/lib/display-text'
import { EVIDENCE_COPY, EVIDENCE_LOADING_LABEL, EVIDENCE_STATE_OF_REASON, type EvidenceFailure, type EvidenceState as State } from '@/lib/evidence-state-view'
import { cn } from '@/lib/utils'
import { EvidenceState } from './evidence-state'
import { MaskedText } from './masked-text'

function impactColor(impact: string): string {
  switch (impact) {
    case 'critical': return 'bg-red-500/15 text-red-500 border-red-500/20'
    case 'serious': return 'bg-orange-500/15 text-orange-500 border-orange-500/20'
    case 'moderate': return 'bg-amber-500/15 text-amber-500 border-amber-500/20'
    case 'minor': return 'bg-blue-500/15 text-blue-500 border-blue-500/20'
    default: return 'bg-muted text-muted-foreground'
  }
}

function Absence({ state, failure = 'capture', incomplete, onRetry }: { state: State; failure?: EvidenceFailure; incomplete?: boolean; onRetry?: () => void }) {
  const copy = EVIDENCE_COPY.a11y
  return <EvidenceState kind="a11y" state={state} failure={failure} incomplete={incomplete}
    {...(state === 'failed' ? copy.failed[failure] : copy[state])}
    actionLabel={onRetry ? copy.retry : undefined} onAction={onRetry} />
}

function Violations({ records }: { records: Extract<EvidenceDocument, { kind: 'a11y' }>['records'] }) {
  return (
    <div className="p-3">
      {(['critical', 'serious', 'moderate', 'minor'] as const).map(impact => {
        const group = records.filter(record => record.impact === impact)
        if (group.length === 0) return null
        return <section key={impact} data-a11y-impact={impact} className="space-y-3 [&+section]:pt-6">
          <h3 className="text-[10px] font-medium uppercase tracking-wider">{impact} · {group.length}</h3>
          {group.map((v, i) => <div key={i} className="border border-border/50 rounded-sm p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge className={cn('text-[10px] px-1.5 py-0', impactColor(v.impact))}>{v.impact}</Badge>
              <span className="text-sm font-medium"><MaskedText text={v.help} /></span>
            </div>
            <div className="text-[10px] font-mono text-muted-foreground"><MaskedText text={v.ruleId} /></div>
            <p className="text-xs text-muted-foreground"><MaskedText text={v.description} /></p>
            {v.nodes.length > 0 && <div className="space-y-1 mt-1">
              {v.nodes.map((node, j) => <pre key={j} className="text-[10px] font-mono bg-muted/30 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-words"><MaskedText text={node.html} /></pre>)}
            </div>}
            <a href={copyTextOf(v.helpUrl)} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline">Learn more</a>
          </div>)}
        </section>
      })}
    </div>
  )
}

export function TabA11y({ step, runId }: { step: DisplayStep | null; runId: string | null }) {
  const entry = step?.evidence?.a11y
  const testIndex = step?.testIndex
  const stepIndex = step?.stepIndex
  const key = JSON.stringify([runId, testIndex, stepIndex, 'a11y'])
  const [attempt, setAttempt] = useState(0)
  const [read, setRead] = useState<{ key: string; attempt: number; result: RunEvidenceRead }>()
  useEffect(() => {
    if (entry?.state !== 'present' || !runId || testIndex === undefined || stepIndex === undefined) return
    let cancelled = false
    void fetchRunEvidence({ runId: asRunId(runId), testIndex, stepIndex, kind: 'a11y' }).then(result => {
      if (!cancelled) setRead({ key, attempt, result })
    })
    return () => { cancelled = true }
  }, [runId, testIndex, stepIndex, key, entry, attempt])

  if (!step) return <Absence state="no-selection" />
  if (!entry) return <Absence state="unavailable" />
  if (entry.state === 'absent') return <Absence state={EVIDENCE_STATE_OF_REASON[entry.reason]} incomplete={entry.evidenceIncomplete} />
  const retry = () => setAttempt(value => value + 1)
  if (!runId || testIndex === undefined || stepIndex === undefined) return <Absence state="failed" failure="load" />
  if (!read || read.key !== key || read.attempt !== attempt) return (
    <div data-evidence-loading data-evidence-kind="a11y" aria-busy="true" className="space-y-2 p-3">
      <span role="status" className="sr-only">{EVIDENCE_LOADING_LABEL}</span>
      <Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" />
    </div>
  )
  if (read.result.kind === 'failed' || read.result.result.outcome === 'read-error') return <Absence state="failed" failure="load" onRetry={retry} />
  const result = read.result.result
  if (result.outcome === 'absent') return <Absence state={EVIDENCE_STATE_OF_REASON[result.evidence.reason]} incomplete={result.evidence.evidenceIncomplete} />
  if (result.document.kind !== 'a11y') return <Absence state="failed" failure="load" onRetry={retry} />
  return result.document.records.length === 0 ? <Absence state="empty" /> : <Violations records={result.document.records} />
}
