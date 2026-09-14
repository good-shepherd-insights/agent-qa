// Member-only terminal boundary. The standalone loop keeps its synchronous callback contract;
// only this injected proxy holds its terminal until the member finishes capture/enrichment.
import { ConsoleEvidenceDocumentSchema, EvidenceArtifactRefSchema } from '@vostride/agent-qa-schema'
import type { StepEvidence, StepEvidenceEntries } from '@vostride/agent-qa-schema'
import type { LoopEventEmitPort } from '../loop/ports.js'
import type { StepResult } from '../result.js'
import type { MemberRunConfig } from './member-runner.js'
import { synthesizeStepEvidence } from './handoff-assembly.js'

export function createStepReadFinalizer(
  config: MemberRunConfig,
  stepIndex: number,
  testName: string,
  toolSchemaDigest: string,
) {
  const downstream = config.sink.loopEmitFor(stepIndex)
  let pending: { evidence: StepEvidence; extra: Parameters<LoopEventEmitPort['stepFinalized']>[1] } | undefined
  let finalized = false
  let consoleCaptureFailed = false
  let consoleEvidence: StepEvidenceEntries['console'] = {
    kind: 'console', state: 'absent',
    reason: config.adapter.platform === 'web' ? 'not-captured' : 'unsupported',
  }
  const events: LoopEventEmitPort = {
    stepFinalized(evidence, extra) {
      if (!finalized && pending === undefined) pending = { evidence, extra }
    },
    subActionRecorded(evidence, index) {
      if (!finalized) downstream.subActionRecorded(evidence, index)
    },
  }

  function captureConsole(result: StepResult, signal: AbortSignal): void {
    if (consoleCaptureFailed || signal.aborted || config.logCapture?.console === false) return
    if (config.adapter.drainConsoleLogs === undefined) {
      consoleEvidence = { kind: 'console', state: 'absent', reason: 'unsupported' }
      return
    }
    try {
      const records = config.adapter.drainConsoleLogs()
      // Preserve device-log capture; the new browser evidence policy does not expand it.
      result.consoleLogs = records
      if (config.adapter.platform !== 'web') return
      if (records.length === 0) {
        consoleEvidence = { kind: 'console', state: 'absent', reason: 'empty' }
        return
      }
      const masking = config.masking
      const store = config.evidenceArtifacts
      if (!masking || !store?.persistEvidenceDocument) {
        consoleFailed()
        return
      }
      const mask = (text: string) => masking.mask(text)
      const document = ConsoleEvidenceDocumentSchema.parse({
        schemaVersion: 1, kind: 'console',
        records: records.map(record => ({
          level: mask(record.level), text: mask(record.text), timestamp: record.timestamp,
          ...(record.location === undefined ? {} : { location: {
            url: mask(record.location.url), lineNumber: record.location.lineNumber,
            columnNumber: record.location.columnNumber,
          } }),
        })),
      })
      const ref = EvidenceArtifactRefSchema.parse(store.persistEvidenceDocument(document))
      if (!ref.id.startsWith('console-evidence:')) throw new Error('Invalid console evidence ref')
      consoleEvidence = { kind: 'console', state: 'present', ref, counts: {
        total: document.records.length,
        errors: document.records.filter(record => record.level === 'error').length,
        warnings: document.records.filter(record => record.level === 'warn' || record.level === 'warning').length,
      } }
    } catch {
      consoleFailed()
    }
  }

  function consoleFailed(): void {
    if (config.adapter.platform === 'web' && config.logCapture?.console !== false) {
      consoleCaptureFailed = true
      consoleEvidence = { kind: 'console', state: 'absent', reason: 'failed' }
    }
  }

  function finish(result: StepResult): void {
    if (finalized) return
    finalized = true
    const evidence = result.evidence ?? pending?.evidence ?? synthesizeStepEvidence(result, stepIndex, {
      scope: { tier: 'test', key: testName }, buildOrdinal: config.knowledgeAsOfBuild ?? 0,
      mask: text => {
        try { return config.masking?.mask(text) ?? text } catch { return '[secret]' }
      },
      modelProfile: config.modelProfiles?.planner,
      verifierIdentity: config.modelProfiles?.verifier,
      toolSchemaDigest,
    })
    // Preserve the recorded loop evidence for handoff assembly even when enrichment replaced
    // the StepResult with an abort result. Bypasses use the very same synthesis as handoffs.
    result.evidence ??= evidence
    // Later kind producers extend this same boundary. No variable/a11y/network persistence
    // has been attempted here; their absent states make that explicit until they are bound.
    const entries: StepEvidenceEntries = {
      console: consoleEvidence,
      network: { kind: 'network', state: 'absent', reason: 'not-captured' },
      a11y: { kind: 'a11y', state: 'absent', reason: 'not-captured' },
      variables: { kind: 'variables', state: 'absent', reason: 'not-captured' },
    }
    const { status: _status, durationMs: _duration, error: _error, ...extra } = pending?.extra ?? {}
    downstream.stepFinalized(evidence, {
      ...extra, status: result.status, durationMs: result.duration,
      ...(result.error === undefined ? {} : { error: result.error }), evidence: entries,
    })
  }

  return { events, captureConsole, consoleFailed, finish }
}
