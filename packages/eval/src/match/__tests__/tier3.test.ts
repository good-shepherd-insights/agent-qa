import { asRef } from '@vostride/agent-qa-schema'
import type {
  Action,
  ActionAnnotation,
  ScreenStateMetadata,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import type { CassetteSidecarLeg } from '../../cassette/sidecar-leg'
import type { DecisionIdentity } from '../../replay/identity'
import { makeSidecar } from '../../replay/__tests__/fixtures'
import { MATCHER_CONFIG } from '../config'
import { runMatchTiers } from '../tiers'

const boundingBox = { x: 45, y: 45, width: 10, height: 10 }

function pointAnnotation(options: { withBoundingBox?: boolean } = {}): ActionAnnotation {
  return {
    kind: 'point',
    viewport: { width: 100, height: 100 },
    point: {
      x: 50,
      y: 50,
      ...(options.withBoundingBox === false ? {} : { boundingBox }),
    },
  }
}

function stateMetadata(
  overrides: Partial<ScreenStateMetadata> = {},
): ScreenStateMetadata {
  return {
    coordSpace: 'viewport',
    viewportWidth: 100,
    viewportHeight: 100,
    scroll: { offsetX: 0, offsetY: 0, contentWidth: 100, contentHeight: 100 },
    captureMode: 'textOnly',
    ...overrides,
  }
}

function coordinateCandidate(
  x: number,
  y: number,
  coordSpace: 'viewport' | 'content' | 'screen' = 'viewport',
) {
  const action: Action = { type: 'tapCoordinate', x, y, coordSpace }
  const identity: DecisionIdentity = { opClass: 'tapCoordinate' }
  return { action, identity }
}

function annotationOnly(annotation: ActionAnnotation): CassetteSidecarLeg {
  const { goldAnchor: _goldAnchor, ...sidecar } = makeSidecar({
    annotation,
    equivalenceSet: [],
  })
  return sidecar
}

describe('runMatchTiers tier 3 geometry', () => {
  it('scores a candidate point inside the gold bounding box as full', () => {
    const result = runMatchTiers(
      makeSidecar({ annotation: pointAnnotation() }),
      coordinateCandidate(49, 52),
      stateMetadata(),
    )

    expect(result.tierReached).toBe(3)
    expect(result.elementIdentity).toEqual({
      kind: 'scored',
      level: 'full',
      numeric: MATCHER_CONFIG.identityLadder.full,
      tier: 3,
    })
  })

  it('scores an outside point within the viewport-relative tolerance as partial', () => {
    const result = runMatchTiers(
      makeSidecar({ annotation: pointAnnotation() }),
      coordinateCandidate(56, 50),
      stateMetadata(),
    )

    expect(result.elementIdentity).toEqual({
      kind: 'scored',
      level: 'within-tolerance',
      numeric: MATCHER_CONFIG.identityLadder['within-tolerance'],
      tier: 3,
    })
  })

  it('scores a point beyond the viewport-relative tolerance as a miss', () => {
    const result = runMatchTiers(
      makeSidecar({ annotation: pointAnnotation() }),
      coordinateCandidate(80, 80),
      stateMetadata(),
    )

    expect(result.elementIdentity).toEqual({
      kind: 'scored',
      level: 'miss',
      numeric: MATCHER_CONFIG.identityLadder.miss,
      tier: 3,
    })
  })

  it('runs the distance fallback directly when the annotation has no bounding box', () => {
    const result = runMatchTiers(
      makeSidecar({ annotation: pointAnnotation({ withBoundingBox: false }) }),
      coordinateCandidate(54, 53),
      stateMetadata(),
    )

    expect(result.elementIdentity).toEqual({
      kind: 'scored',
      level: 'within-tolerance',
      numeric: MATCHER_CONFIG.identityLadder['within-tolerance'],
      tier: 3,
    })
  })

  it('returns a counted coordspace mismatch before comparing scrolled raw coordinates', () => {
    const result = runMatchTiers(
      makeSidecar({ annotation: pointAnnotation() }),
      coordinateCandidate(49, 52, 'content'),
      stateMetadata({
        coordSpace: 'viewport',
        scroll: {
          offsetX: 0,
          offsetY: 120,
          contentWidth: 100,
          contentHeight: 400,
        },
      }),
    )

    expect(result.elementIdentity).toEqual({
      kind: 'unscorable',
      cause: 'coordspace-mismatch',
    })
  })

  it('scores an annotation-only sidecar at tier 3', () => {
    const sidecar = annotationOnly(pointAnnotation())
    expect(Object.hasOwn(sidecar, 'goldAnchor')).toBe(false)

    const result = runMatchTiers(
      sidecar,
      coordinateCandidate(50, 50),
      stateMetadata(),
    )

    expect(result.tierReached).toBe(3)
    expect(result.elementIdentity).toEqual({
      kind: 'scored',
      level: 'full',
      numeric: MATCHER_CONFIG.identityLadder.full,
      tier: 3,
    })
  })

  it('returns typed no-candidate geometry for a ref-mode annotation-only candidate', () => {
    const action: Action = { type: 'click', ref: asRef('candidate') }
    const identity: DecisionIdentity = {
      opClass: 'click',
      target: { role: 'button', nameNormalized: 'submit', ordinal: 0 },
    }

    const result = runMatchTiers(
      annotationOnly(pointAnnotation()),
      { action, identity },
      stateMetadata(),
    )

    expect(result.elementIdentity).toEqual({
      kind: 'unscorable',
      cause: 'no-candidate-geometry',
    })
  })
})
