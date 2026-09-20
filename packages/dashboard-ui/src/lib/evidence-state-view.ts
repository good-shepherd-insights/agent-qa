import type { EvidenceAbsenceReason } from '@vostride/agent-qa-schema'
import { EVIDENCE_INCOMPLETE_LABEL } from './run-detail-view'

export type EvidenceState = 'empty' | 'not-captured' | 'unsupported' | 'unavailable' | 'failed' | 'no-selection'
export const EVIDENCE_STATES = [
  'empty', 'not-captured', 'unsupported', 'unavailable', 'failed', 'no-selection',
] as const satisfies readonly EvidenceState[]
export type EvidenceTone = 'positive' | 'neutral' | 'alert'
export const EVIDENCE_TONES = ['positive', 'neutral', 'alert'] as const satisfies readonly EvidenceTone[]
export type EvidenceFailure = 'capture' | 'load'
export const EVIDENCE_FAILURES = ['capture', 'load'] as const satisfies readonly EvidenceFailure[]
export type EvidenceKindLabel = 'variables' | 'network' | 'console' | 'aria' | 'a11y' | 'video' | 'frame'
export const EVIDENCE_KIND_LABELS = [
  'variables', 'network', 'console', 'aria', 'a11y', 'video', 'frame',
] as const satisfies readonly EvidenceKindLabel[]

export const EVIDENCE_STATE_OF_REASON = {
  empty: 'empty', 'not-captured': 'not-captured', unsupported: 'unsupported',
  unavailable: 'unavailable', failed: 'failed',
} as const satisfies Record<EvidenceAbsenceReason, EvidenceState>
export const EVIDENCE_TONE_OF_STATE = {
  empty: 'positive', 'not-captured': 'neutral', unsupported: 'neutral',
  unavailable: 'neutral', failed: 'alert', 'no-selection': 'neutral',
} as const satisfies Record<EvidenceState, EvidenceTone>

export const EVIDENCE_LOADING_LABEL = 'Loading records'
export const EVIDENCE_INCOMPLETE_EXPLANATION = `${EVIDENCE_INCOMPLETE_LABEL} — this was recorded, but the saved file is no longer on disk.`
export const RECORDED_ELSEWHERE_LABEL = (step: number) => `Recorded on step ${step}`
export const GO_TO_STEP_LABEL = (step: number) => `Go to step ${step}`
export const EVIDENCE_RETRY_LABELS = {
  variables: 'Retry loading variables',
  network: 'Retry loading network records',
  console: 'Retry loading console records',
  aria: 'Retry loading the ARIA tree',
  a11y: 'Retry loading accessibility results',
  video: 'Retry loading the recording',
  frame: 'Retry loading the screenshot',
} as const satisfies Record<EvidenceKindLabel, string>

type CopyPair = { title: string; explanation: string }
type KindCopy = Record<Exclude<EvidenceState, 'failed'>, CopyPair> & {
  failed: Record<EvidenceFailure, CopyPair>
  retry?: string
}

export const EVIDENCE_COPY = {
  variables: {
    empty: {
      title: 'No variables at this step',
      explanation: 'No variables were set when this step ran.',
    },
    'not-captured': {
      title: 'Variables not recorded for this step',
      explanation: 'No variable snapshot was saved for this step.',
    },
    unsupported: {
      title: "Variables aren't recorded on this platform",
      explanation: "This run's platform does not support saving a variable snapshot.",
    },
    unavailable: {
      title: 'Variables unavailable for this run',
      explanation: 'Variables were not recorded when this run happened, so there is nothing to show.',
    },
    failed: {
      capture: {
        title: 'Variable capture failed',
        explanation: 'Saving the variable snapshot failed while the run was in progress. There is nothing to retry.',
      },
      load: {
        title: "Couldn't load variables",
        explanation: "The variables were recorded but didn't load.",
      },
    },
    'no-selection': {
      title: 'No step selected',
      explanation: 'Variables are shown per step. Pick a step in the tree or on the timeline to see them.',
    },
  },
  network: {
    empty: {
      title: 'No network requests',
      explanation: 'The page made no requests during this step.',
    },
    'not-captured': {
      title: 'Network not recorded for this step',
      explanation: 'No network activity was saved for this step.',
    },
    unsupported: {
      title: "Network isn't recorded on this platform",
      explanation: "This run's platform does not support capturing network requests.",
    },
    unavailable: {
      title: 'Network unavailable for this run',
      explanation: 'Network activity was not recorded when this run happened. This does not mean the run made no requests.',
    },
    failed: {
      capture: {
        title: 'Network capture failed',
        explanation: 'Capturing network activity failed while the run was in progress. There is nothing to retry.',
      },
      load: {
        title: "Couldn't load network records",
        explanation: "The records exist but didn't load.",
      },
    },
    'no-selection': {
      title: 'No step selected',
      explanation: 'Network requests are shown per step. Pick a step in the tree or on the timeline to see them.',
    },
  },
  console: {
    empty: {
      title: 'No console output',
      explanation: 'The page logged nothing during this step.',
    },
    'not-captured': {
      title: 'Console not recorded for this step',
      explanation: 'No console output was saved for this step.',
    },
    unsupported: {
      title: "Console isn't recorded on this platform",
      explanation: "This run's platform does not support capturing console output.",
    },
    unavailable: {
      title: 'Console unavailable for this run',
      explanation: 'Console output was not recorded when this run happened. This does not mean the page logged nothing.',
    },
    failed: {
      capture: {
        title: 'Console capture failed',
        explanation: 'Capturing console output failed while the run was in progress. There is nothing to retry.',
      },
      load: {
        title: "Couldn't load console records",
        explanation: "The records exist but didn't load.",
      },
    },
    'no-selection': {
      title: 'No step selected',
      explanation: 'Console output is shown per step. Pick a step in the tree or on the timeline to see it.',
    },
  },
  aria: {
    empty: {
      title: 'Empty accessibility tree',
      explanation: 'The screen exposed no accessible elements when this action was decided.',
    },
    'not-captured': {
      title: 'ARIA tree not recorded for this action',
      explanation: 'No accessibility tree was saved for this sub-action.',
    },
    unsupported: {
      title: "ARIA tree isn't recorded on this platform",
      explanation: "This run's platform does not support capturing an accessibility tree.",
    },
    unavailable: {
      title: 'ARIA tree unavailable for this run',
      explanation: 'The accessibility tree was not recorded when this run happened.',
    },
    failed: {
      capture: {
        title: 'ARIA tree capture failed',
        explanation: 'Capturing the accessibility tree failed while the run was in progress. There is nothing to retry.',
      },
      load: {
        title: "Couldn't load the ARIA tree",
        explanation: "The tree was recorded but didn't load.",
      },
    },
    'no-selection': {
      title: 'No sub-action selected',
      explanation: 'The accessibility tree is shown per sub-action. Pick a sub-action in the tree or on the timeline to see what the model saw.',
    },
  },
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
    retry: EVIDENCE_RETRY_LABELS.a11y,
  },
  video: {
    empty: {
      title: 'Recording has no video',
      explanation: 'A recording was saved for this test but it contains nothing to play.',
    },
    'not-captured': {
      title: 'No recording for this test',
      explanation: 'No video was saved for this test. Frames still show what the model saw at each decision.',
    },
    unsupported: {
      title: "Recording isn't supported on this platform",
      explanation: "This run's platform does not record video. Frames still show what the model saw at each decision.",
    },
    unavailable: {
      title: 'Recording unavailable for this run',
      explanation: 'Video was not recorded when this run happened. Frames still show what the model saw at each decision.',
    },
    failed: {
      capture: {
        title: 'Recording failed',
        explanation: 'The video could not be saved when this test finished. There is nothing to retry. Frames still show what the model saw at each decision.',
      },
      load: {
        title: "Couldn't load the recording",
        explanation: "The recording exists but didn't load. Retry, or switch to Frames.",
      },
    },
    'no-selection': {
      title: 'No step selected',
      explanation: 'The recording follows the timeline. Pick a step in the tree or on the timeline to position it.',
    },
  },
  frame: {
    'not-captured': {
      'sub-action': {
        title: 'No screenshot for this action',
        explanation: 'No screenshot was saved for this sub-action.',
      },
      step: {
        title: 'No screenshots for this step',
        explanation: "None of this step's sub-actions saved a screenshot.",
      },
    },
    unavailable: {
      title: 'Screenshot unavailable',
      explanation: EVIDENCE_INCOMPLETE_EXPLANATION,
    },
    failed: {
      load: {
        title: "Couldn't load the screenshot",
        explanation: "The screenshot exists but didn't load.",
      },
    },
  },
} satisfies Record<Exclude<EvidenceKindLabel, 'frame'>, KindCopy> & {
  frame: {
    'not-captured': { 'sub-action': CopyPair; step: CopyPair }
    unavailable: CopyPair
    failed: { load: CopyPair }
  }
}
