// 2026-10-08 (437-03, D-05): the one reader of a skipped tap's no-input block, shared by the
// runner and the dashboard.
import { describe, expect, it } from 'vitest'

import { readIdempotentNoopMeta } from '../../index'

const withNoop = (idempotentNoop: unknown) => ({ metadata: { idempotentNoop } })

describe('C437-NO-INPUT-READER', () => {
  it('reads the 437 block that marks no input sent', () => {
    expect(readIdempotentNoopMeta(withNoop({ currentState: 'checked', inputSent: false }))).toEqual({
      currentState: 'checked',
      inputSent: false,
    })
  })

  it('reads a pre-437 block that carries only the current state', () => {
    expect(readIdempotentNoopMeta(withNoop({ currentState: 'checked' }))).toEqual({
      currentState: 'checked',
    })
  })

  it('returns undefined for a missing block', () => {
    expect(readIdempotentNoopMeta(undefined)).toBeUndefined()
    expect(readIdempotentNoopMeta({})).toBeUndefined()
    expect(readIdempotentNoopMeta({ metadata: {} })).toBeUndefined()
    expect(readIdempotentNoopMeta(withNoop(null))).toBeUndefined()
    expect(readIdempotentNoopMeta(withNoop('checked'))).toBeUndefined()
  })

  it('returns undefined for a current state that is not a string', () => {
    expect(readIdempotentNoopMeta(withNoop({ currentState: true, inputSent: false }))).toBeUndefined()
    expect(readIdempotentNoopMeta(withNoop({ currentState: 1 }))).toBeUndefined()
  })

  it('returns undefined when the block says input was sent', () => {
    expect(readIdempotentNoopMeta(withNoop({ currentState: 'checked', inputSent: true }))).toBeUndefined()
    expect(readIdempotentNoopMeta(withNoop({ currentState: 'checked', inputSent: 'no' }))).toBeUndefined()
  })
})
