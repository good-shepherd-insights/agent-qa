import type { RunDetailProjection } from '@vostride/agent-qa-schema'

export const RUN_NOTICE_COPY = {
  message: 'This run was recorded before evidence was saved. Variables, network, console, ARIA, accessibility and video were not recorded.',
  dismiss: 'Dismiss notice',
} as const

export function runNoticeDismissKey(runId: string): string {
  return `agent-qa.run-detail.notice-dismissed:${runId}`
}

function unavailable(entry: { state: string; reason?: string; evidenceIncomplete?: boolean } | undefined): boolean {
  return entry?.state === 'absent' && entry.reason === 'unavailable' && entry.evidenceIncomplete !== true
}

export function isPreMilestoneRun(detail: RunDetailProjection): boolean {
  return detail.steps.length > 0
    && detail.steps.every(step => unavailable(step.evidence?.variables)
      && unavailable(step.evidence?.network) && unavailable(step.evidence?.console)
      && unavailable(step.evidence?.a11y))
    && detail.subActions.every(subAction => unavailable(subAction.ariaEvidence))
    && detail.members.every(member => unavailable(member.recording))
}
