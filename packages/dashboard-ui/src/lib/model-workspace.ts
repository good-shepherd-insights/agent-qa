// A SAVED MODEL'S PLACE IN THE FILE (429-24 · D-12, D-24 · Claude's Discretion "Eval judges").
//
// Deleting a model that judges evals must leave eval valid in the same write: the schema allows
// eval.judge or eval.judges (at most three), never both, so one remaining judge is written as judge.

import type { ConfigChange, ConfigPathSegment } from '@vostride/agent-qa-schema'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function judgeList(evalConfig: unknown): string[] | undefined {
  if (!isRecord(evalConfig) || !Array.isArray(evalConfig.judges)) return undefined
  return evalConfig.judges.filter((judge): judge is string => typeof judge === 'string')
}

export function isEvalJudge(evalConfig: unknown, name: string): boolean {
  if (!isRecord(evalConfig)) return false
  return evalConfig.judge === name || (judgeList(evalConfig)?.includes(name) ?? false)
}

// The two expect ops lead, so a delete computed from a list the file no longer holds is refused.
export function judgeChangesAfterDelete(evalConfig: unknown, name: string): ConfigChange[] {
  const block = isRecord(evalConfig) ? evalConfig : {}
  const changes: ConfigChange[] = [
    { op: 'expect', path: ['eval', 'judge'], value: block.judge ?? null },
    { op: 'expect', path: ['eval', 'judges'], value: block.judges ?? null },
  ]
  if (!isRecord(evalConfig)) return changes
  if (evalConfig.judge === name) changes.push({ op: 'unset', path: ['eval', 'judge'] })
  const judges = judgeList(evalConfig)
  if (judges?.includes(name)) {
    const remaining = judges.filter((judge) => judge !== name)
    if (remaining.length > 1) {
      changes.push({ op: 'set', path: ['eval', 'judges'], value: remaining })
    } else {
      changes.push({ op: 'unset', path: ['eval', 'judges'] })
      if (remaining.length === 1 && evalConfig.judge === undefined) {
        changes.push({ op: 'set', path: ['eval', 'judge'], value: remaining[0] })
      }
    }
  }
  return changes
}

export function modelFieldSegments(name: string, key: string): ConfigPathSegment[] {
  return ['registry', 'llms', { name }, key]
}
