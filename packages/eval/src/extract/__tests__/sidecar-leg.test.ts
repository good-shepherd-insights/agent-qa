import { asRef } from '@vostride/agent-qa-schema'
import type { Action, ElementInfo, SubActionEvidence } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { makeV2Handoff } from '../../__tests__/fixtures/handoff-fixtures'
import { projectSidecarLeg } from '../sidecar-leg'

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

  it.each<{ action: Action; expected: string }>([
    {
      action: {
        type: 'fill',
        ref: asRef('e-continue-2'),
        text: '<EMAIL_0>',
        clearMode: 'replace',
        submit: false,
      },
      expected: '<EMAIL_0>',
    },
    {
      action: { type: 'select', ref: asRef('e-continue-2'), value: 'express' },
      expected: 'express',
    },
    {
      action: { type: 'nativeSelect', ref: asRef('e-continue-2'), value: 'express' },
      expected: 'express',
    },
    {
      action: { type: 'pickerSelect', ref: asRef('e-continue-2'), value: 'express' },
      expected: 'express',
    },
  ])('projects the recorded value for $action.type actions', ({ action, expected }) => {
    const subAction = { ...duplicateTargetSubAction(), plannedAction: action }

    expect(projectSidecarLeg({ subAction }).leg.goldValue).toBe(expected)
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
