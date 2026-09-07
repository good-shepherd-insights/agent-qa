import { sha256hex } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import { assignSplit, bucketOf, PARTITION_VERSION } from '../split-assignment'

/**
 * Known-answer vectors (414 RESEARCH Code Example D, ROOT-07). Both digests
 * and both 13-hex prefixes are hand-spelled, computed independently with
 * node's crypto and cross-checked against the pure-JS `sha256hex` this
 * module uses. They pin the RECIPE — salt-prefixed sha256, a 13-hex (52-bit)
 * prefix read as an integer — so a change of recipe REDs by name rather than
 * silently re-partitioning a committed corpus.
 */
const ZERO_SALT = '0'.repeat(64)
const F_SALT = 'f'.repeat(64)

const VECTOR_A_ID =
  'r_swiper-tele-modern-modal-orias-ope-junto-spot-loir-rist/test-00-step-05-d03-leaf'
const VECTOR_A_DIGEST = '203dd7161ce0b7de6123ae9ff0d65ea52983cf20c3a2e6fb9175c3af93bd257a'
const VECTOR_A_PREFIX = '203dd7161ce0b'

const VECTOR_B_ID = 'run---checkout-suite-42/test-00-step-00-d00-leaf'
const VECTOR_B_DIGEST = 'd386f3949d0da917eedc86e9dc40a6b5e784c2c63fbc3c74f5d296223ad5ede8'
const VECTOR_B_PREFIX = 'd386f3949d0da'

/** Every fraction below is a TEST VECTOR input. No default fraction exists (D-07). */

describe('bucketOf — the pinned hash recipe (ROOT-07/D-07)', () => {
  it('reproduces known-answer vector A exactly', () => {
    expect(sha256hex(ZERO_SALT + VECTOR_A_ID)).toBe(VECTOR_A_DIGEST)
    expect(VECTOR_A_DIGEST.slice(0, 13)).toBe(VECTOR_A_PREFIX)
    expect(bucketOf(ZERO_SALT, VECTOR_A_ID)).toBe(Number.parseInt(VECTOR_A_PREFIX, 16))
    expect(bucketOf(ZERO_SALT, VECTOR_A_ID) / 2 ** 52).toBe(0.12594360627997747)
  })

  it('reproduces known-answer vector B exactly', () => {
    expect(sha256hex(ZERO_SALT + VECTOR_B_ID)).toBe(VECTOR_B_DIGEST)
    expect(VECTOR_B_DIGEST.slice(0, 13)).toBe(VECTOR_B_PREFIX)
    expect(bucketOf(ZERO_SALT, VECTOR_B_ID)).toBe(Number.parseInt(VECTOR_B_PREFIX, 16))
    expect(bucketOf(ZERO_SALT, VECTOR_B_ID) / 2 ** 52).toBe(0.8262779462648298)
  })
})

describe('assignSplit — integer threshold boundaries (ROOT-07)', () => {
  it('places a bucket AT the held-out threshold in natural and one below it in held-out', () => {
    const bucket = bucketOf(ZERO_SALT, VECTOR_A_ID)

    // threshold === bucket: `bucket >= threshold` holds, so the entry stays natural.
    expect(
      assignSplit({
        saltHex: ZERO_SALT,
        heldOutFraction: bucket / 2 ** 52,
        privateFraction: 0.5,
        cassetteId: VECTOR_A_ID,
        isPairMember: false,
      }),
    ).toEqual({ split: 'natural' })

    // threshold === bucket + 1: the same bucket now falls inside held-out.
    expect(
      assignSplit({
        saltHex: ZERO_SALT,
        heldOutFraction: (bucket + 1) / 2 ** 52,
        privateFraction: 0.5,
        cassetteId: VECTOR_A_ID,
        isPairMember: false,
      }).split,
    ).toBe('held-out')
  })

  it('splits held-out into private and shared on the integer private threshold', () => {
    const bucket = bucketOf(ZERO_SALT, VECTOR_A_ID)
    const heldOutFraction = 0.5

    // Math.round(0.5 * privateFraction * 2**52) === bucket + 1 ⇒ private.
    expect(
      assignSplit({
        saltHex: ZERO_SALT,
        heldOutFraction,
        privateFraction: (bucket + 1) / 2 ** 51,
        cassetteId: VECTOR_A_ID,
        isPairMember: false,
      }),
    ).toEqual({ split: 'held-out', heldOutVisibility: 'private' })

    // One integer lower ⇒ the same bucket is shared.
    expect(
      assignSplit({
        saltHex: ZERO_SALT,
        heldOutFraction,
        privateFraction: bucket / 2 ** 51,
        cassetteId: VECTOR_A_ID,
        isPairMember: false,
      }),
    ).toEqual({ split: 'held-out', heldOutVisibility: 'shared' })
  })
})

describe('assignSplit — determinism and salt sensitivity (D-05/D-06)', () => {
  it('is pure, and a different salt re-buckets at least one vector', () => {
    const params = {
      heldOutFraction: 0.5,
      privateFraction: 0.5,
      isPairMember: false,
    } as const

    const first = assignSplit({ ...params, saltHex: ZERO_SALT, cassetteId: VECTOR_A_ID })
    const second = assignSplit({ ...params, saltHex: ZERO_SALT, cassetteId: VECTOR_A_ID })
    expect(second).toEqual(first)

    const rebucketed = [VECTOR_A_ID, VECTOR_B_ID].filter(
      (id) => bucketOf(ZERO_SALT, id) !== bucketOf(F_SALT, id),
    )
    expect(rebucketed.length).toBeGreaterThan(0)
  })
})

describe('assignSplit — the D-08 pair exemption', () => {
  it('forces feedback natural even when the same input would be private held-out', () => {
    const partition = { saltHex: ZERO_SALT, heldOutFraction: 0.9, privateFraction: 0.9, cassetteId: VECTOR_A_ID, isPairMember: false }
    expect(assignSplit({ ...partition, isFeedbackEntry: false })).toEqual({ split: 'held-out', heldOutVisibility: 'private' })
    expect(assignSplit({ ...partition, isFeedbackEntry: true })).toEqual({ split: 'natural' })
    expect(assignSplit({ cassetteId: VECTOR_A_ID, isFeedbackEntry: true })).toEqual({ split: 'natural' })
  })
  it('keeps a self-heal pair member natural even when its bucket falls in held-out', () => {
    const bucket = bucketOf(ZERO_SALT, VECTOR_B_ID)
    const partition = {
      saltHex: ZERO_SALT,
      heldOutFraction: (bucket + 1) / 2 ** 52,
      privateFraction: 0.5,
      cassetteId: VECTOR_B_ID,
    }

    // Without the exemption this exact input buckets held-out …
    expect(assignSplit({ ...partition, isPairMember: false }).split).toBe('held-out')
    // … and with it the pair member stays in the optimise set.
    expect(assignSplit({ ...partition, isPairMember: true })).toEqual({ split: 'natural' })
  })
})

describe('assignSplit — the closed return set and caller-bug refusals', () => {
  it('never returns adversarial', () => {
    for (const id of [VECTOR_A_ID, VECTOR_B_ID]) {
      for (const heldOutFraction of [0.1, 0.5, 0.9]) {
        const assignment = assignSplit({
          saltHex: ZERO_SALT,
          heldOutFraction,
          privateFraction: 0.5,
          cassetteId: id,
          isPairMember: false,
        })
        expect(assignment.split).not.toBe('adversarial')
        expect(['natural', 'held-out']).toContain(assignment.split)
      }
    }
  })

  it('throws a TypeError on a malformed salt or an out-of-range fraction', () => {
    const good = {
      saltHex: ZERO_SALT,
      heldOutFraction: 0.5,
      privateFraction: 0.5,
      cassetteId: VECTOR_A_ID,
      isPairMember: false,
    }

    for (const saltHex of ['0'.repeat(63), 'F'.repeat(64), 'z'.repeat(64), '']) {
      expect(() => assignSplit({ ...good, saltHex })).toThrow(TypeError)
    }

    for (const fraction of [0, 1, -0.1, Number.NaN]) {
      expect(() => assignSplit({ ...good, heldOutFraction: fraction })).toThrow(TypeError)
      expect(() => assignSplit({ ...good, privateFraction: fraction })).toThrow(TypeError)
    }
  })

  it('declares the partition recipe version so a recipe change is a named migration', () => {
    expect(PARTITION_VERSION).toBe(1)
  })
})
