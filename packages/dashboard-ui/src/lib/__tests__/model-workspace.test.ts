// A SAVED MODEL'S PLACE IN THE FILE (429-24 Task 1 · D-24 · Claude's Discretion "Eval judges").
//
// Deleting a model that is an eval judge must leave eval valid in the same write: judge and
// judges are never both set, judges holds at most three names, and one remaining judge is
// written as judge.

import { describe, expect, it } from 'vitest'

import { isEvalJudge, judgeChangesAfterDelete, modelFieldSegments } from '../model-workspace'

// A delete states the judge list it read, so the server refuses it when the file moved (429-47).
function expectsRead(judge: unknown, judges: unknown) {
  return [
    { op: 'expect', path: ['eval', 'judge'], value: judge },
    { op: 'expect', path: ['eval', 'judges'], value: judges },
  ]
}

describe('judgeChangesAfterDelete (429-24 Task 1)', () => {
  it('JUDGE-CHANGES-AFTER-DELETE: every eval shape keeps the schema refinement once the model is gone', () => {
    expect(judgeChangesAfterDelete({ judge: 'gpt' }, 'gpt')).toEqual([
      ...expectsRead('gpt', null),
      { op: 'unset', path: ['eval', 'judge'] },
    ])
    expect(judgeChangesAfterDelete({ judges: ['gpt', 'b', 'c'] }, 'gpt')).toEqual([
      ...expectsRead(null, ['gpt', 'b', 'c']),
      { op: 'set', path: ['eval', 'judges'], value: ['b', 'c'] },
    ])
    expect(judgeChangesAfterDelete({ judges: ['gpt', 'b'] }, 'gpt')).toEqual([
      ...expectsRead(null, ['gpt', 'b']),
      { op: 'unset', path: ['eval', 'judges'] },
      { op: 'set', path: ['eval', 'judge'], value: 'b' },
    ])
    expect(judgeChangesAfterDelete({ judges: ['gpt'] }, 'gpt')).toEqual([
      ...expectsRead(null, ['gpt']),
      { op: 'unset', path: ['eval', 'judges'] },
    ])

    expect(judgeChangesAfterDelete({ judge: 'b' }, 'gpt')).toEqual(expectsRead('b', null))
    expect(judgeChangesAfterDelete({ judges: ['b', 'c'] }, 'gpt')).toEqual(expectsRead(null, ['b', 'c']))
    expect(judgeChangesAfterDelete({ k: 3 }, 'gpt')).toEqual(expectsRead(null, null))
    expect(judgeChangesAfterDelete(undefined, 'gpt')).toEqual(expectsRead(null, null))
  })

  it('DELETE-JUDGE-EXPECTS-LIST: a delete always leads with expect eval.judge and eval.judges as read', () => {
    expect(judgeChangesAfterDelete({ judges: ['a', 'b', 'c'] }, 'b')).toEqual([
      { op: 'expect', path: ['eval', 'judge'], value: null },
      { op: 'expect', path: ['eval', 'judges'], value: ['a', 'b', 'c'] },
      { op: 'set', path: ['eval', 'judges'], value: ['a', 'c'] },
    ])
    expect(judgeChangesAfterDelete({ judges: ['a', 'c'], k: 3 }, 'b')).toEqual([
      { op: 'expect', path: ['eval', 'judge'], value: null },
      { op: 'expect', path: ['eval', 'judges'], value: ['a', 'c'] },
    ])
    expect(judgeChangesAfterDelete(undefined, 'b')).toEqual([
      { op: 'expect', path: ['eval', 'judge'], value: null },
      { op: 'expect', path: ['eval', 'judges'], value: null },
    ])
  })

  it('isEvalJudge reads eval.judge and eval.judges, and anything else is not a judge', () => {
    expect(isEvalJudge({ judge: 'gpt' }, 'gpt')).toBe(true)
    expect(isEvalJudge({ judges: ['b', 'gpt'] }, 'gpt')).toBe(true)
    expect(isEvalJudge({ judge: 'b', judges: 'gpt' }, 'gpt')).toBe(false)
    expect(isEvalJudge(undefined, 'gpt')).toBe(false)
    expect(isEvalJudge(['gpt'], 'gpt')).toBe(false)
  })

  it('modelFieldSegments names one leaf of one saved model by its name', () => {
    expect(modelFieldSegments('gpt', 'model')).toEqual(['registry', 'llms', { name: 'gpt' }, 'model'])
  })
})
