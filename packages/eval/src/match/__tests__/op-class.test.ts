import { describe, expect, it } from 'vitest'

import { OP_CLASS_MAP, classifyOpClass, opClassEquivalent } from '../op-class'

describe('operation classes', () => {
  it('collapses click, tap, and coordinate tap into the activation class', () => {
    expect(classifyOpClass('click')).toBe('activate')
    expect(classifyOpClass('tap')).toBe(classifyOpClass('click'))
    expect(classifyOpClass('tapCoordinate')).toBe(classifyOpClass('click'))
  })

  it('keeps value entry distinct from activation', () => {
    expect(opClassEquivalent('fill', 'fill')).toBe(true)
    expect(opClassEquivalent('fill', 'click')).toBe(false)
  })

  it('keeps double activations as conservative singletons', () => {
    expect(opClassEquivalent('doubleClick', 'click')).toBe(false)
    expect(opClassEquivalent('doubleTap', 'tap')).toBe(false)
  })

  it('treats every unknown verb as its own singleton class', () => {
    expect(classifyOpClass('unknownVerb')).toBe('unknownVerb')
    expect(opClassEquivalent('unknownVerb', 'click')).toBe(false)
    expect(opClassEquivalent('unknownVerb', 'anotherUnknownVerb')).toBe(false)
  })

  it('covers the complete frozen action catalog', () => {
    expect(Object.keys(OP_CLASS_MAP)).toHaveLength(57)
  })
})
