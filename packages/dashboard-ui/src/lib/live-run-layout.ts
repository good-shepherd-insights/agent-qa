export type LiveRunLayout = 'docked' | 'stacked'

export const LIVE_RUN_LAYOUTS: readonly LiveRunLayout[] = []

export const LIVE_RUN_STACK_BELOW_PX = 0

export function liveRunLayoutOf(_width: number): LiveRunLayout {
  return 'docked'
}

export interface LiveRunPanelIds {
  preview: string
  steps: string
}

export function liveRunPanelIds(_layout: LiveRunLayout): LiveRunPanelIds {
  return { preview: 'live-preview', steps: 'live-steps' }
}
