import { asRef } from '@vostride/agent-qa-schema'
import type { Action, ElementInfo, SubActionEvidence } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { makeV2Handoff } from '../../__tests__/fixtures/handoff-fixtures'
import type { ScoringValueActionType } from '../sidecar-leg'
import { projectSidecarLeg } from '../sidecar-leg'

// Exact per-discriminant coverage: a new ScoringValueActionType member without a fixture is a
// compile failure, so the gold-value contract cannot silently omit a future value operation.
const VALUE_CASES: {
  [T in ScoringValueActionType]: { action: Extract<Action, { type: T }>; expected: string }
} = {
  fill: {
    action: {
      type: 'fill',
      ref: asRef('e-continue-2'),
      text: '<EMAIL_0>',
      clearMode: 'replace',
      submit: false,
    },
    expected: '<EMAIL_0>',
  },
  select: {
    action: { type: 'select', ref: asRef('e-continue-2'), value: 'express' },
    expected: 'express',
  },
  paste: {
    action: { type: 'paste', ref: asRef('e-continue-2'), value: '[secret]' },
    expected: '[secret]',
  },
  nativeSelect: {
    action: { type: 'nativeSelect', ref: asRef('e-continue-2'), value: 'express' },
    expected: 'express',
  },
  pickerSelect: {
    action: { type: 'pickerSelect', ref: asRef('e-continue-2'), value: 'express' },
    expected: 'express',
  },
}

function duplicateTargetSubAction(): SubActionEvidence {
  return makeV2Handoff().tests[0]!.steps[1]!.subActions[1]!
}

function withoutHierarchy(element: ElementInfo): ElementInfo {
  const { hierarchy: _hierarchy, ...rest } = element
  void _hierarchy
  return rest
}

describe('projectSidecarLeg', () => {
  it('derives the second duplicate ordinal and hierarchy-linked equivalence descriptors', () => {
    const subAction = duplicateTargetSubAction()
    const projected = projectSidecarLeg({ subAction })

    expect(projected.anchorUnresolved).toBe(false)
    expect(projected.leg.goldAction).toBe(subAction.plannedAction)
    expect(projected.leg.opClass).toBe('click')
    expect(projected.leg.goldAnchor).toEqual({
      role: 'button',
      nameNormalized: 'continue',
      ordinal: 1,
      ref: 'e-continue-2',
    })
    expect(projected.leg.equivalenceSet).toEqual([
      {
        role: 'button',
        nameNormalized: 'continue',
        ordinal: 1,
        ref: 'e-continue-2',
      },
      {
        role: 'main',
        nameNormalized: 'checkout',
        ordinal: 0,
        ref: 'e-root',
      },
    ])
    expect(projected.leg.annotation).toBe(subAction.result.annotation)
    expect(Object.hasOwn(projected.leg, 'goldValue')).toBe(false)
  })

  it.each(
    (Object.keys(VALUE_CASES) as ScoringValueActionType[]).map((type) => ({
      type,
      ...VALUE_CASES[type],
    })),
  )('projects the recorded value for $type actions', ({ action, expected }) => {
    const subAction = { ...duplicateTargetSubAction(), plannedAction: action }

    expect(projectSidecarLeg({ subAction }).leg.goldValue).toBe(expected)
  })

  it('preserves a recorded empty string as a value rather than absence', () => {
    const subAction: SubActionEvidence = {
      ...duplicateTargetSubAction(),
      plannedAction: {
        type: 'fill',
        ref: asRef('e-continue-2'),
        text: '',
        clearMode: 'replace',
        submit: false,
      },
    }

    const { leg } = projectSidecarLeg({ subAction })

    expect(leg.goldValue).toBe('')
    expect(Object.hasOwn(leg, 'goldValue')).toBe(true)
  })

  it.each<{ label: string; action: Action }>([
    { label: 'pickerSelect order arm', action: { type: 'pickerSelect', ref: asRef('e-continue-2'), order: 2 } },
    { label: 'click', action: { type: 'click', ref: asRef('e-continue-2') } },
    { label: 'tapCoordinate', action: { type: 'tapCoordinate', x: 84, y: 44, coordSpace: 'viewport' } },
  ])('omits goldValue for the valueless $label action', ({ action }) => {
    const subAction = { ...duplicateTargetSubAction(), plannedAction: action }

    expect(Object.hasOwn(projectSidecarLeg({ subAction }).leg, 'goldValue')).toBe(false)
  })

  it('copies a pre-masked value-bearing action into the sidecar without restoring raw content', () => {
    const marker = '[secret]'
    const subAction: SubActionEvidence = {
      ...duplicateTargetSubAction(),
      plannedAction: { type: 'paste', ref: asRef('e-continue-2'), value: marker },
    }

    const { leg } = projectSidecarLeg({ subAction })

    expect(leg.goldValue).toBe(marker)
    expect(leg.goldAction).toMatchObject({ type: 'paste', value: marker })
    expect(JSON.stringify(leg)).not.toContain('sk-live')
  })

  it('emits unresolved refs with every derivable field retained', () => {
    const source = duplicateTargetSubAction()
    const subAction: SubActionEvidence = {
      ...source,
      plannedAction: { type: 'click', ref: asRef('e-missing') },
    }

    const projected = projectSidecarLeg({ subAction })

    expect(projected.anchorUnresolved).toBe(true)
    expect(projected.leg.opClass).toBe('click')
    expect(projected.leg.annotation).toBe(source.result.annotation)
    expect(projected.leg.equivalenceSet).toEqual([])
    expect(Object.hasOwn(projected.leg, 'goldAnchor')).toBe(false)
  })

  it('treats a coordinate-only action as a legitimate resolved shape', () => {
    const source = duplicateTargetSubAction()
    const subAction: SubActionEvidence = {
      ...source,
      plannedAction: {
        type: 'tapCoordinate',
        x: 84,
        y: 44,
        coordSpace: 'viewport',
      },
    }

    const projected = projectSidecarLeg({ subAction })

    expect(projected.anchorUnresolved).toBe(false)
    expect(projected.leg.opClass).toBe('tapCoordinate')
    expect(projected.leg.annotation).toBe(source.result.annotation)
    expect(projected.leg.equivalenceSet).toEqual([])
    expect(Object.hasOwn(projected.leg, 'goldAnchor')).toBe(false)
  })

  it('uses a singleton equivalence set when the gold element has no hierarchy', () => {
    const source = duplicateTargetSubAction()
    const targetRef = asRef('e-continue-2')
    const subAction: SubActionEvidence = {
      ...source,
      stateBefore: {
        ...source.stateBefore,
        elements: source.stateBefore.elements.map((element) =>
          element.ref === targetRef ? withoutHierarchy(element) : element,
        ),
      },
    }

    expect(projectSidecarLeg({ subAction }).leg.equivalenceSet).toEqual([
      {
        role: 'button',
        nameNormalized: 'continue',
        ordinal: 1,
        ref: 'e-continue-2',
      },
    ])
  })

  it('is deterministic for repeated projection of the same evidence', () => {
    const subAction = duplicateTargetSubAction()

    expect(projectSidecarLeg({ subAction })).toEqual(projectSidecarLeg({ subAction }))
  })
})
