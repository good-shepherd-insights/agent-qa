import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import { isReadableStamp, PRE_V2_STAMP, readableStamp, type ReadableStamp } from '../readable-stamp'

describe('readableStamp (449.1 D-04)', () => {
  it('parses the pre-V2 stamp and the current stamp', () => {
    expect(readableStamp(2).parse(1)).toBe(1)
    expect(readableStamp(2).parse(2)).toBe(2)
  })

  it('refuses any other stamp and a string stamp', () => {
    expect(readableStamp(2).safeParse(3).success).toBe(false)
    expect(readableStamp(2).safeParse('2').success).toBe(false)
  })

  it('names 1 as the pre-V2 stamp', () => {
    expect(PRE_V2_STAMP).toBe(1)
  })
})

describe('isReadableStamp (449.1 D-04)', () => {
  it('admits the pre-V2 stamp and the current stamp', () => {
    expect(isReadableStamp(1, 2)).toBe(true)
    expect(isReadableStamp(2, 2)).toBe(true)
  })

  it.each([3, 0, '1', undefined])('refuses %s', (value) => {
    expect(isReadableStamp(value, 2)).toBe(false)
  })
})

describe('ReadableStamp types (449.1 D-04)', () => {
  it('infers 1 | 2 for a schema that reads readableStamp(2)', () => {
    const Doc = z.object({ schemaVersion: readableStamp(2) })
    expectTypeOf<z.infer<typeof Doc>['schemaVersion']>().toEqualTypeOf<1 | 2>()
    expect(Doc.parse({ schemaVersion: 1 }).schemaVersion).toBe(1)
  })

  it('spells ReadableStamp<2> as 1 | 2', () => {
    expectTypeOf<ReadableStamp<2>>().toEqualTypeOf<1 | 2>()
    const value: unknown = 2
    if (isReadableStamp(value, 2)) {
      expectTypeOf(value).toEqualTypeOf<1 | 2>()
    }
    expect(isReadableStamp(value, 2)).toBe(true)
  })
})
