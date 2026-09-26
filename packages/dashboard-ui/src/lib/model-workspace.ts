// A SAVED MODEL'S PLACE IN THE FILE (429-24 · D-12, D-24 · Claude's Discretion "Eval judges").

import type { ConfigChange, ConfigPathSegment } from '@vostride/agent-qa-schema'

export function isEvalJudge(_evalConfig: unknown, _name: string): boolean {
  return false
}

export function judgeChangesAfterDelete(_evalConfig: unknown, _name: string): ConfigChange[] {
  return []
}

export function modelFieldSegments(name: string, key: string): ConfigPathSegment[] {
  return ['registry', 'llms', { name }, key]
}
