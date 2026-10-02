import { describe, it, expect } from 'vitest'
import { readFillRefusalMeta, readFillSubmitMeta } from '../metadata.js'

const carrier = (metadata: Record<string, unknown>) => ({ metadata })

describe('readFillRefusalMeta', () => {
  it('returns the typed block for well-formed input', () => {
    expect(
      readFillRefusalMeta(carrier({ fillRefusal: { verb: 'fill', cause: 'not-editable', evidence: 'no-editable-signal' } })),
    ).toEqual({ verb: 'fill', cause: 'not-editable', evidence: 'no-editable-signal' })
    expect(
      readFillRefusalMeta(carrier({ fillRefusal: { verb: 'clearText', cause: 'target-not-found', evidence: 'stale-target' } })),
    ).toEqual({ verb: 'clearText', cause: 'target-not-found', evidence: 'stale-target' })
    for (const evidence of ['no-keyboard-focus', 'focus-elsewhere']) {
      expect(readFillRefusalMeta(carrier({ fillRefusal: { verb: 'fill', cause: 'not-editable', evidence } }))?.evidence).toBe(evidence)
    }
  })

  it('returns undefined on any shape miss', () => {
    expect(readFillRefusalMeta(undefined)).toBeUndefined()
    expect(readFillRefusalMeta({})).toBeUndefined()
    expect(readFillRefusalMeta(carrier({}))).toBeUndefined()
    expect(readFillRefusalMeta(carrier({ fillRefusal: 'not-editable' }))).toBeUndefined()
    expect(readFillRefusalMeta(carrier({ fillRefusal: { verb: 'tap', cause: 'not-editable', evidence: 'stale-target' } }))).toBeUndefined()
    expect(readFillRefusalMeta(carrier({ fillRefusal: { verb: 'fill', cause: 'busy', evidence: 'stale-target' } }))).toBeUndefined()
    expect(readFillRefusalMeta(carrier({ fillRefusal: { verb: 'fill', cause: 'not-editable', evidence: 'other' } }))).toBeUndefined()
    expect(readFillRefusalMeta(carrier({ fillRefusal: { verb: 'fill', cause: 'not-editable', evidence: 1 } }))).toBeUndefined()
    expect(readFillRefusalMeta(carrier({ fillRefusal: { cause: 'not-editable', evidence: 'stale-target' } }))).toBeUndefined()
  })
})

describe('readFillSubmitMeta', () => {
  it('returns the typed block for well-formed input', () => {
    expect(readFillSubmitMeta(carrier({ fillSubmit: { sent: true } }))).toEqual({ sent: true })
    expect(readFillSubmitMeta(carrier({ fillSubmit: { sent: false } }))).toEqual({ sent: false })
    expect(readFillSubmitMeta(carrier({ fillSubmit: { sent: false, reason: 'multi-line-field' } }))).toEqual({
      sent: false,
      reason: 'multi-line-field',
    })
  })

  it('returns undefined on any shape miss', () => {
    expect(readFillSubmitMeta(undefined)).toBeUndefined()
    expect(readFillSubmitMeta(carrier({}))).toBeUndefined()
    expect(readFillSubmitMeta(carrier({ fillSubmit: true }))).toBeUndefined()
    expect(readFillSubmitMeta(carrier({ fillSubmit: { sent: 'yes' } }))).toBeUndefined()
    expect(readFillSubmitMeta(carrier({ fillSubmit: { sent: false, reason: 'other' } }))).toBeUndefined()
    expect(readFillSubmitMeta(carrier({ fillSubmit: { sent: false, reason: 3 } }))).toBeUndefined()
  })
})
