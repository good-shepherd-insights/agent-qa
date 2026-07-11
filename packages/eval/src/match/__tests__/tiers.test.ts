import { asRef } from '@vostride/agent-qa-schema'
import type { Action, ActionAnnotation } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import type { CassetteSidecarLeg } from '../../cassette/sidecar-leg'
import type { DecisionIdentity } from '../../replay/identity'
import { makeSidecar } from '../../replay/__tests__/fixtures'
import { MATCHER_CONFIG } from '../config'
import { runMatchTiers } from '../tiers'

const pointAnnotation: ActionAnnotation = {
  kind: 'point',
  viewport: { width: 100, height: 100 },
  point: {
    x: 50,
    y: 50,
    boundingBox: { x: 40, y: 40, width: 20, height: 20 },
  },
}

function candidate(action: Action, identity: DecisionIdentity) {
  return { action, identity }
}

function omitGoldAnchor(sidecar: CassetteSidecarLeg): CassetteSidecarLeg {
  const { goldAnchor: _goldAnchor, ...withoutGoldAnchor } = sidecar
  return withoutGoldAnchor
}

describe('runMatchTiers tier 1 hard gate', () => {
  it('stops at tier 1 on an operation-class mismatch without evaluating identity', () => {
    const goldAction: Action = {
      type: 'fill',
      ref: asRef('e1'),
      text: 'hello',
      clearMode: 'replace',
      submit: false,
    }
    const sidecar = makeSidecar({
      goldAction,
      opClass: 'fill',
      annotation: pointAnnotation,
    })

    expect(
      runMatchTiers(
        sidecar,
        candidate(
          { type: 'click', ref: asRef('e1') },
          {
            opClass: 'click',
            target: { role: 'button', nameNormalized: 'submit', ordinal: 0 },
          },
        ),
      ),
    ).toEqual({
      tierReached: 1,
      opClass: { kind: 'mismatch', goldClass: 'value-entry', candidateClass: 'activate' },
      elementIdentity: { kind: 'not-evaluated' },
    })
  })

  it('admits coordinate activation through the same class for tier-3 dispatch', () => {
    const result = runMatchTiers(
      makeSidecar({ annotation: pointAnnotation }),
      candidate(
        { type: 'tapCoordinate', x: 50, y: 50, coordSpace: 'viewport' },
        { opClass: 'tapCoordinate' },
      ),
    )

    expect(result.tierReached).toBe(3)
    expect(result.opClass).toEqual({ kind: 'match', opClass: 'activate' })
    expect(result.elementIdentity.kind).not.toBe('not-evaluated')
  })
})

describe('runMatchTiers evidence dispatch', () => {
  it('attaches configured numerics to full and partial tier-2 ladder levels', () => {
    const action: Action = { type: 'click', ref: asRef('candidate') }

    expect(
      runMatchTiers(
        makeSidecar(),
        candidate(action, {
          opClass: 'click',
          target: { role: 'button', nameNormalized: 'submit', ordinal: 0 },
        }),
      ).elementIdentity,
    ).toEqual({
      kind: 'scored',
      level: 'full',
      numeric: MATCHER_CONFIG.identityLadder.full,
      tier: 2,
    })

    expect(
      runMatchTiers(
        makeSidecar(),
        candidate(action, {
          opClass: 'click',
          target: { role: 'button', nameNormalized: 'submit', ordinal: 2 },
        }),
      ).elementIdentity,
    ).toEqual({
      kind: 'scored',
      level: 'ordinal-only-differs',
      numeric: MATCHER_CONFIG.identityLadder['ordinal-only-differs'],
      tier: 2,
    })
  })

  it('returns a typed unscorable identity when no gold evidence was recorded', () => {
    const sidecar = omitGoldAnchor(makeSidecar({ equivalenceSet: [] }))

    expect(
      runMatchTiers(
        sidecar,
        candidate(
          { type: 'click', ref: asRef('candidate') },
          {
            opClass: 'click',
            target: { role: 'button', nameNormalized: 'submit', ordinal: 0 },
          },
        ),
      ),
    ).toEqual({
      tierReached: 1,
      opClass: { kind: 'match', opClass: 'activate' },
      elementIdentity: { kind: 'unscorable', cause: 'no-gold-evidence' },
    })
  })

  it('scores a text-only cassette at tier 2 without attempting geometry', () => {
    const result = runMatchTiers(
      makeSidecar(),
      candidate(
        { type: 'click', ref: asRef('candidate') },
        {
          opClass: 'click',
          target: { role: 'button', nameNormalized: 'submit', ordinal: 0 },
        },
      ),
    )

    expect(result.tierReached).toBe(2)
    expect(result.elementIdentity).toEqual({
      kind: 'scored',
      level: 'full',
      numeric: MATCHER_CONFIG.identityLadder.full,
      tier: 2,
    })
  })

  it('counts a target-absent non-coordinate candidate as a real tier-2 miss', () => {
    expect(
      runMatchTiers(
        makeSidecar(),
        candidate({ type: 'click', ref: asRef('missing') }, { opClass: 'click' }),
      ),
    ).toEqual({
      tierReached: 2,
      opClass: { kind: 'match', opClass: 'activate' },
      elementIdentity: {
        kind: 'scored',
        level: 'miss',
        numeric: MATCHER_CONFIG.identityLadder.miss,
        tier: 2,
      },
    })
  })
})
