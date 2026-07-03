import { describe, expect, it } from 'vitest'
import { asRef, screenStateHash } from '@vostride/agent-qa-schema'
import {
  buildScreenState,
  renderScreenTree,
  stampCaptureMode,
  type BuildScreenStateInput,
  type InterimNode,
} from '../screen-builder.js'

function makeInput(nodes: InterimNode[], overrides: Partial<BuildScreenStateInput> = {}): BuildScreenStateInput {
  return {
    platform: 'web',
    nodes,
    viewport: { width: 390, height: 100 },
    scroll: { offsetX: 0, offsetY: 0, contentWidth: 390, contentHeight: 320 },
    coordSpace: 'viewport',
    timestamp: 1700000000000,
    url: 'https://example.test/checkout',
    domContext: 'checkout',
    ...overrides,
  }
}

describe('buildScreenState — ref minting & binding', () => {
  it('mints sequential branded refs e1..eN in document order with binding indices', () => {
    const { state, binding } = buildScreenState(
      makeInput([
        { role: 'button', name: 'A' },
        { role: 'button', name: 'B' },
        { role: 'link', name: 'C' },
      ]),
    )

    expect(state.elements.map(e => e.ref)).toEqual([asRef('e1'), asRef('e2'), asRef('e3')])
    expect(binding[asRef('e1')]).toEqual({ index: 0, nth: 0 })
    expect(binding[asRef('e2')]).toEqual({ index: 1, nth: 0 })
    expect(binding[asRef('e3')]).toEqual({ index: 2, nth: 0 })
  })

  it('assigns same-screen ordinals on role+nameNormalized (binding only; not on ElementInfo)', () => {
    const { state, binding } = buildScreenState(
      makeInput([
        { role: 'button', name: 'Save' },
        { role: 'button', name: 'Save ' }, // trailing space normalizes to same key
      ]),
    )

    expect(state.elements[0].nameNormalized).toBe('save')
    expect(state.elements[1].nameNormalized).toBe('save')
    expect(binding[asRef('e1')].nth).toBe(0)
    expect(binding[asRef('e2')].nth).toBe(1)
    // ElementInfo carries no ordinal field
    expect(state.elements[0]).not.toHaveProperty('nth')
    expect(state.elements[0]).not.toHaveProperty('ordinal')
  })
})

describe('buildScreenState — geometry rule (Pitfall #3)', () => {
  it('derives center from bounds and adds a refMap entry; boundsless nodes get none', () => {
    const { state } = buildScreenState(
      makeInput([
        { role: 'button', name: 'Save', bounds: { x: 10, y: 20, width: 30, height: 40 } },
        { role: 'generic' }, // no bounds
      ]),
    )

    expect(state.refMap[asRef('e1')]).toEqual({
      bounds: { x: 10, y: 20, width: 30, height: 40 },
      center: { x: 25, y: 40 },
    })
    // boundsless element present in elements[] but not in refMap, no fabricated geometry
    expect(state.elements[1].ref).toBe(asRef('e2'))
    expect(state.elements[1].bounds).toBeUndefined()
    expect(state.elements[1].center).toBeUndefined()
    expect(state.refMap[asRef('e2')]).toBeUndefined()

    expect(Object.keys(state.refMap).length).toBe(1)
    expect(Object.keys(state.refMap).length).toBeLessThan(state.elements.length)
  })

  it('maps scrollContext.containerIndex to the minted container Ref', () => {
    const { state } = buildScreenState(
      makeInput([
        { role: 'scrollview', name: 'List', bounds: { x: 0, y: 0, width: 100, height: 200 } },
        {
          role: 'button',
          name: 'Row',
          bounds: { x: 0, y: 40, width: 100, height: 20 },
          scrollContext: { containerIndex: 0, offsetX: 0, offsetY: 40 },
        },
      ]),
    )

    expect(state.refMap[asRef('e2')].scrollContext).toEqual({
      container: asRef('e1'),
      offsetX: 0,
      offsetY: 40,
    })
  })
})

describe('buildScreenState — hierarchy (Pitfall #7)', () => {
  it('translates parentIndex to parentRef and inverts into childRefs', () => {
    const { state } = buildScreenState(
      makeInput([
        { role: 'group', name: 'Panel', bounds: { x: 0, y: 0, width: 200, height: 100 } },
        { role: 'button', name: 'Save', bounds: { x: 10, y: 20, width: 30, height: 40 }, parentIndex: 0 },
      ]),
    )

    expect(state.elements[1].hierarchy?.parentRef).toBe(state.elements[0].ref)
    expect(state.elements[0].hierarchy?.childRefs).toContain(state.elements[1].ref)
    // leaf-with-parent has no childRefs; root-with-no-parent has no parentRef
    expect(state.elements[1].hierarchy?.childRefs).toBeUndefined()
    expect(state.elements[0].hierarchy?.parentRef).toBeUndefined()
  })

  it('omits hierarchy entirely for elements with no links', () => {
    const { state } = buildScreenState(makeInput([{ role: 'button', name: 'Solo' }]))
    expect(state.elements[0].hierarchy).toBeUndefined()
  })
})

describe('buildScreenState — state derivations (D-08)', () => {
  it('applies documented defaults and omits optional bits when no signal supplied', () => {
    const { state } = buildScreenState(makeInput([{ role: 'button', name: 'Save' }]))
    expect(state.elements[0].state).toEqual({ enabled: true, focused: false, visible: true })
    expect(Object.keys(state.elements[0].state).sort()).toEqual(['enabled', 'focused', 'visible'])
  })

  it('passes real optional signals through without fabrication', () => {
    const { state } = buildScreenState(
      makeInput([{ role: 'checkbox', name: 'Agree', state: { checked: true } }]),
    )
    expect(state.elements[0].state.checked).toBe(true)
    expect(state.elements[0].state).toEqual({ enabled: true, focused: false, visible: true, checked: true })
  })
})

describe('buildScreenState — metadata', () => {
  it('stamps textOnly modality and copies scroll/viewport/coordSpace/domContext', () => {
    const { state } = buildScreenState(makeInput([{ role: 'button', name: 'Save' }]))
    expect(state.platform).toBe('web')
    expect(state.url).toBe('https://example.test/checkout')
    expect(state.timestamp).toBe(1700000000000)
    expect(state.metadata).toEqual({
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 390,
      viewportHeight: 100,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 390, contentHeight: 320 },
      domContext: 'checkout',
    })
  })
})

describe('renderScreenTree — pinned grammar (D-02)', () => {
  it('renders the header, indented children, and all annotations exactly', () => {
    const { state } = buildScreenState(
      makeInput(
        [
          { role: 'group', name: 'Panel', bounds: { x: 0, y: 0, width: 200, height: 100 } },
          {
            role: 'button',
            name: 'Save',
            bounds: { x: 10, y: 20, width: 30, height: 40 },
            parentIndex: 0,
            state: { checked: true },
          },
          { role: 'generic' }, // unnamed + boundsless
          {
            role: 'link',
            name: 'Off',
            bounds: { x: 5, y: 5, width: 10, height: 10 },
            state: { enabled: false, visible: false, selected: true },
          },
        ],
        { viewport: { width: 200, height: 100 } },
      ),
    )

    expect(state.tree).toBe(
      [
        '[Viewport: 200x100] [4 elements]',
        '- group "Panel" [ref=e1] @(0,0 200x100)',
        '  - button "Save" [ref=e2] @(10,20 30x40) [checked]',
        '- generic [ref=e3]',
        '- link "Off" [ref=e4] @(5,5 10x10) [disabled] [offscreen] [selected]',
      ].join('\n'),
    )
  })

  it('is invoked directly on structured elements + metadata (renderer-only swap point)', () => {
    const { state } = buildScreenState(makeInput([{ role: 'button', name: 'Save' }]))
    expect(renderScreenTree(state.elements, state.metadata)).toBe(state.tree)
  })
})

describe('stampCaptureMode — purity (D-11)', () => {
  it('returns a NEW full-mode state without mutating its input', () => {
    const { state } = buildScreenState(makeInput([{ role: 'button', name: 'Save' }]))
    const before = screenStateHash(state)
    Object.freeze(state)
    Object.freeze(state.metadata)

    const full = stampCaptureMode(state, { mode: 'full', imageWidth: 800, imageHeight: 600 })
    expect(full).not.toBe(state)
    expect(full.metadata.captureMode).toBe('full')
    if (full.metadata.captureMode === 'full') {
      expect(full.metadata.imageWidth).toBe(800)
      expect(full.metadata.imageHeight).toBe(600)
    }
    // input untouched
    expect(screenStateHash(state)).toBe(before)
  })

  it('round-trips textOnly back to a hash-equal state', () => {
    const { state } = buildScreenState(makeInput([{ role: 'button', name: 'Save' }]))
    const roundTripped = stampCaptureMode(
      stampCaptureMode(state, { mode: 'full', imageWidth: 800, imageHeight: 600 }),
      { mode: 'textOnly' },
    )
    expect(screenStateHash(roundTripped)).toBe(screenStateHash(state))
  })
})

describe('buildScreenState — determinism (byte-equality oracle)', () => {
  const nodes: InterimNode[] = [
    { role: 'group', name: 'Panel', bounds: { x: 0, y: 0, width: 200, height: 100 } },
    { role: 'button', name: 'Save', bounds: { x: 10, y: 20, width: 30, height: 40 }, parentIndex: 0 },
  ]

  it('produces screenStateHash-equal output for identical input', () => {
    const a = buildScreenState(makeInput(nodes)).state
    const b = buildScreenState(makeInput(nodes)).state
    expect(screenStateHash(a)).toBe(screenStateHash(b))
  })

  it('produces a different hash when a name changes', () => {
    const a = buildScreenState(makeInput(nodes)).state
    const changed: InterimNode[] = [nodes[0], { ...nodes[1], name: 'Submit' }]
    const b = buildScreenState(makeInput(changed)).state
    expect(screenStateHash(a)).not.toBe(screenStateHash(b))
  })
})
