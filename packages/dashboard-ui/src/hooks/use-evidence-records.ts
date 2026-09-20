import { useCallback, useEffect, useState } from 'react'
import { asRunId, type EvidenceKind } from '@vostride/agent-qa-schema'
import { fetchRunEvidence, type RunEvidenceRead } from '@/lib/api'

export const EVIDENCE_FETCH_DEBOUNCE_MS = 250

export interface EvidenceRecordsKey {
  runId: string
  testIndex: number
  stepIndex: number
  kind: EvidenceKind
  subActionIndex?: number
}

export function useEvidenceRecords(key: EvidenceRecordsKey | null, enabled: boolean) {
  const runId = key?.runId
  const testIndex = key?.testIndex
  const stepIndex = key?.stepIndex
  const kind = key?.kind
  const subActionIndex = key?.subActionIndex
  const address = JSON.stringify([runId, testIndex, stepIndex, kind, subActionIndex])
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ address: string; attempt: number; read: RunEvidenceRead }>()
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  useEffect(() => {
    if (!enabled || !runId || testIndex === undefined || stepIndex === undefined || !kind) return
    let cancelled = false
    const timer = setTimeout(() => {
      void fetchRunEvidence({ runId: asRunId(runId), testIndex, stepIndex, kind,
        ...(subActionIndex === undefined ? {} : { subActionIndex }) })
        .catch((error: unknown): RunEvidenceRead => ({ kind: 'failed', error: error instanceof Error ? error.message : String(error) }))
        .then(read => { if (!cancelled) setResult({ address, attempt, read }) })
    }, EVIDENCE_FETCH_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [enabled, runId, testIndex, stepIndex, kind, subActionIndex, address, attempt])
  const read: 'idle' | 'loading' | RunEvidenceRead = !enabled || !key ? 'idle'
    : !runId ? { kind: 'failed', error: 'Missing run address' }
      : result?.address === address && result.attempt === attempt ? result.read : 'loading'
  return { read, retry }
}
