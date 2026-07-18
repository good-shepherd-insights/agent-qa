import { describe, expect, it } from 'vitest'

import {
  COORDINATE_ACTION_KEYS,
  NON_REPLAYABLE_ACTION_TYPES,
  isReplayableActionShape,
} from '../../action/replayability'
import {
  parseProcedureBody,
  procedureStepKeys,
  serializeProcedureBody,
  type ProcedureBodyPayload,
} from '../procedure-steps'

function threeStepPayload(): ProcedureBodyPayload {
  return {
    schemaVersion: 1,
    parameters: [
      { name: 'username', type: 'string', required: true },
      { name: 'password', type: 'secret', required: true },
    ],
    steps: [
      {
        instruction: 'Open the login page',
        action: { type: 'navigate', targets: {}, values: { url: '/login' } },
        guard: {
          target: { role: 'textbox', nameNormalized: 'username' },
          pageAnchor: { t: 'page', route: '/login' },
          landmarks: ['Sign in'],
        },
      },
      {
        instruction: 'Fill the password field',
        action: {
          type: 'fill',
          targets: { ref: { role: 'textbox', nameNormalized: 'password', ordinal: 0 } },
          values: { value: { param: 'password' } },
        },
        guard: {
          target: { role: 'textbox', nameNormalized: 'password', ordinal: 0 },
          pageAnchor: { t: 'page', route: '/login' },
        },
      },
      {
        instruction: 'Submit the form',
        action: { type: 'click', targets: { ref: { role: 'button', nameNormalized: 'sign in' } }, values: {} },
        guard: {
          target: { role: 'button', nameNormalized: 'sign in' },
          pageAnchor: { t: 'page', route: '/login' },
        },
      },
    ],
    successAssertion: 'The account dashboard is visible',
  }
}

describe('procedure body codec (D-04)', () => {
  it('round-trips a payload byte-identically through serialize -> parse', () => {
    const payload = threeStepPayload()
    const first = serializeProcedureBody(payload)
    const second = serializeProcedureBody(payload)
    expect(second).toBe(first)

    const parsed = parseProcedureBody(first)
    expect(parsed).toEqual(payload)
    expect(parsed).not.toBeUndefined()
    expect(serializeProcedureBody(parsed as ProcedureBodyPayload)).toBe(first)
  })

  it('fails closed on any malformation — undefined, never a throw', () => {
    expect(parseProcedureBody('random prose')).toBeUndefined()
    expect(parseProcedureBody('')).toBeUndefined()

    const outsideUnion = threeStepPayload() as unknown as {
      parameters: { name: string; type: string; required: boolean }[]
    }
    outsideUnion.parameters[0].type = 'json'
    expect(parseProcedureBody(serializeProcedureBody(outsideUnion as ProcedureBodyPayload))).toBeUndefined()
  })

  it('derives one ordered step key per step, excluding authored prose', () => {
    const keys = procedureStepKeys(threeStepPayload())
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(3)
    for (const key of keys) {
      expect(key).not.toContain('Open the login page')
      expect(key).not.toContain('Submit the form')
    }
    // deterministic across calls
    expect(procedureStepKeys(threeStepPayload())).toEqual(keys)
  })
})

describe('replayability constants (Pitfall 6 — the one shared list)', () => {
  it('mirrors the runner exclusion lists member-for-member', () => {
    expect([...NON_REPLAYABLE_ACTION_TYPES].sort()).toEqual(
      ['assertAI', 'extractAI', 'setVariable', 'tapCoordinate'].sort(),
    )
    expect([...COORDINATE_ACTION_KEYS].sort()).toEqual(
      ['coordinates', 'coords', 'endX', 'endY', 'startX', 'startY', 'x', 'y'].sort(),
    )
  })

  it('rejects non-replayable types and coordinate-carrying shapes; accepts descriptor-targeted actions', () => {
    expect(isReplayableActionShape('tapCoordinate', [])).toBe(false)
    expect(isReplayableActionShape('setVariable', ['name', 'value'])).toBe(false)
    expect(isReplayableActionShape('assertAI', ['assertion'])).toBe(false)
    expect(isReplayableActionShape('extractAI', ['query'])).toBe(false)
    expect(isReplayableActionShape('click', ['ref', 'x', 'y'])).toBe(false)
    expect(isReplayableActionShape('swipe', ['startX', 'startY'])).toBe(false)

    expect(isReplayableActionShape('click', ['ref'])).toBe(true)
    expect(isReplayableActionShape('fill', ['ref', 'value'])).toBe(true)
  })
})
