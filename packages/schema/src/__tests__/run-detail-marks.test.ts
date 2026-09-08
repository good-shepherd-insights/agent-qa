import { describe, expect, it } from 'vitest'
import { RunDetailMemberSchema } from '../functions/runs'

describe('RunDetailMember optional marks (419 D-15)', () => {
  const member = { testIndex: 0, attempts: 1 }
  const mark = {
    markId: 'mark_0123456789ab', kind: 'false-fail', ordinal: 1,
    disposition: { kind: 'quarantined', class: 'flake' },
  }

  it('preserves the pre-419 member byte-for-byte without materializing marks', () => {
    const parsed = RunDetailMemberSchema.parse(member)
    expect(parsed).toEqual(member)
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(member))
    expect(Object.hasOwn(parsed, 'marks')).toBe(false)
  })

  it('round-trips a member carrying its latest mark', () => {
    const marked = { ...member, marks: [mark] }
    expect(RunDetailMemberSchema.parse(marked)).toEqual(marked)
  })

  it('refuses undeclared mark fields and the fourth mark', () => {
    for (const change of [{ extra: 1 }, { kind: 'confirmed-pass' }]) {
      expect(RunDetailMemberSchema.safeParse({ ...member, marks: [{ ...mark, ...change }] }).success).toBe(false)
    }
  })
})
