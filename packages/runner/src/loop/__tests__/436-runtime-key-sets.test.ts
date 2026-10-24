// 2026-10-08, 436-13 (D-18, D-24): the runtime key sets beside the scroll outcome vocabulary. They
// govern the persisted sub-action metadata scrollUntilVisible.outcome: new runs write found,
// not-found or unresolved; no-change and cap are reader-only literals from runs before 436-02.
// Every expected set is spelled by hand, never derived from the module under test.
import { describe, expect, it } from 'vitest'

import { SCROLL_OUTCOMES_READ_ONLY, SCROLL_OUTCOMES_WRITTEN } from '../../compound/metadata.js'

describe('C436-KEY-SETS', () => {
  it('the scroll outcomes new runs write', () => {
    expect([...SCROLL_OUTCOMES_WRITTEN]).toEqual(['found', 'not-found', 'unresolved'])
  })

  it('the scroll outcomes only historical runs carry', () => {
    expect([...SCROLL_OUTCOMES_READ_ONLY]).toEqual(['no-change', 'cap'])
  })
})
