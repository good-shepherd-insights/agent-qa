// v54 runtime deletion bar; Plan 12 F-12 measures removal from both type and array.
// Keep the hand-spelled expected vocabulary in declaration order on ONE line.
import { describe, expect, it } from 'vitest'
import { GENERALIZATION_VERDICTS } from '../generalization'

describe('415 stats closed sets (v54 runtime wall)', () => {
  it('declares exactly the three generalization verdicts, in declaration order', () => {
    // prettier-ignore
    expect([...GENERALIZATION_VERDICTS]).toEqual(['in-floor', 'generalizes', 'overfit'])
  })
})
