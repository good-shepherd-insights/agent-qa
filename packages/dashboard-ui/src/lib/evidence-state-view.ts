import type { EvidenceAbsenceReason } from '@vostride/agent-qa-schema'

export type EvidenceState = 'empty' | 'not-captured' | 'unsupported' | 'unavailable' | 'failed' | 'no-selection'
export const EVIDENCE_STATES = [
  'empty', 'not-captured', 'unsupported', 'unavailable', 'failed', 'no-selection',
] as const satisfies readonly EvidenceState[]
export type EvidenceTone = 'positive' | 'neutral' | 'alert'
export const EVIDENCE_TONES = ['positive', 'neutral', 'alert'] as const satisfies readonly EvidenceTone[]
export type EvidenceFailure = 'capture' | 'load'
export const EVIDENCE_FAILURES = ['capture', 'load'] as const satisfies readonly EvidenceFailure[]

export const EVIDENCE_STATE_OF_REASON = {
  empty: 'empty', 'not-captured': 'not-captured', unsupported: 'unsupported',
  unavailable: 'unavailable', failed: 'failed',
} as const satisfies Record<EvidenceAbsenceReason, EvidenceState>
export const EVIDENCE_TONE_OF_STATE = {
  empty: 'positive', 'not-captured': 'neutral', unsupported: 'neutral',
  unavailable: 'neutral', failed: 'alert', 'no-selection': 'neutral',
} as const satisfies Record<EvidenceState, EvidenceTone>

export const EVIDENCE_LOADING_LABEL = 'Loading records'
export const EVIDENCE_COPY = {
  a11y: {
    empty: { title: 'No accessibility violations found', explanation: 'The checks ran on this step and found nothing to fix.' },
    'not-captured': { title: 'Accessibility checks not recorded for this step', explanation: 'No accessibility results were saved for this step.' },
    unsupported: { title: "Accessibility checks aren't supported on this platform", explanation: "This run's platform cannot run accessibility checks." },
    unavailable: { title: 'Accessibility results unavailable for this run', explanation: 'Accessibility checks were not recorded when this run happened. This does not mean the run had no violations.' },
    failed: {
      capture: { title: 'Accessibility checks failed to run', explanation: 'The checks hit an error while the run was in progress, so there are no results. There is nothing to retry.' },
      load: { title: "Couldn't load accessibility results", explanation: "The results exist but didn't load." },
    },
    'no-selection': { title: 'No step selected', explanation: 'Accessibility results are shown per step. Pick a step in the tree or on the timeline to see them.' },
    retry: 'Retry loading accessibility results',
  },
}
