// `snapshotRegistered()` on the masking context (Phase 405 plan 02, D-08).
//
// The D-08 value-identity substrate needs to know WHICH values this run's `<SECRET_n>` placeholders
// stood for, so a run-scoped sidecar can record a keyed digest of each one. The masking map is
// private by design and stays that way — this is the ONE enumeration, and these cells pin its
// three load-bearing properties:
//
//   (a) registration ORDER is the placeholder order, because the index in `<SECRET_n>` is the
//       registration index and a snapshot that reordered would mislabel every entry;
//   (b) EMAIL placeholders are NEVER enumerated (D-10) — they are minted lazily inside `mask()` by
//       `detectEmails` from text the host never declared, so no host source can re-derive them and
//       a digest of one would be an entry nothing could ever match;
//   (c) the `minRegisteredLength` guard decides membership, so a 3-char declared secret mints no
//       placeholder and therefore has no snapshot row while a 4-char one does (the DETL-02
//       boundary, measured one step either side).

import { describe, expect, it } from 'vitest'

import { createMaskingContext } from '../masking/context.js'
import type { RegisteredMaskingEntry } from '../masking/context.js'

describe('createMaskingContext().snapshotRegistered() (405-02, D-08)', () => {
  it('enumerates SECRET registrations in registration order with their placeholders and values', () => {
    const ctx = createMaskingContext()
    ctx.register('hunter22', 'SECRET')
    ctx.register('p@ss', 'SECRET')

    expect(ctx.snapshotRegistered()).toEqual([
      { placeholder: '<SECRET_0>', category: 'SECRET', value: 'hunter22' },
      { placeholder: '<SECRET_1>', category: 'SECRET', value: 'p@ss' },
    ])
  })

  it('excludes EMAIL placeholders minted lazily by mask() (D-10)', () => {
    const ctx = createMaskingContext()
    ctx.register('hunter22', 'SECRET')

    const masked = ctx.mask('mail qa@example.com now')
    // The EMAIL placeholder really was minted — otherwise the exclusion below is vacuous.
    expect(masked).toContain('<EMAIL_0>')

    expect(ctx.snapshotRegistered()).toEqual([
      { placeholder: '<SECRET_0>', category: 'SECRET', value: 'hunter22' },
    ])
  })

  it('honours minRegisteredLength: 3 chars mints nothing, 4 chars mints one (DETL-02 boundary)', () => {
    const belowGuard = createMaskingContext()
    belowGuard.register('abc')
    expect(belowGuard.snapshotRegistered()).toEqual([])

    const atGuard = createMaskingContext()
    atGuard.register('abcd')
    expect(atGuard.snapshotRegistered()).toEqual([
      { placeholder: '<SECRET_0>', category: 'SECRET', value: 'abcd' },
    ])
  })

  it('returns an empty snapshot after dispose()', () => {
    const ctx = createMaskingContext()
    ctx.register('hunter22', 'SECRET')
    expect(ctx.snapshotRegistered()).toHaveLength(1)

    ctx.dispose()

    expect(ctx.snapshotRegistered()).toEqual([])
  })

  it('returns a fresh array each call — mutating one snapshot cannot corrupt the next', () => {
    const ctx = createMaskingContext()
    ctx.register('hunter22', 'SECRET')

    // The declared return is ReadonlyArray, so the mutation a caller could still attempt at
    // runtime is reached through `unknown` — the cell measures the runtime freshness, not the type.
    const first = ctx.snapshotRegistered() as unknown as RegisteredMaskingEntry[]
    first.push({ placeholder: '<SECRET_99>', category: 'SECRET', value: 'not-a-registration' })

    expect(ctx.snapshotRegistered()).toEqual([
      { placeholder: '<SECRET_0>', category: 'SECRET', value: 'hunter22' },
    ])
  })
})
