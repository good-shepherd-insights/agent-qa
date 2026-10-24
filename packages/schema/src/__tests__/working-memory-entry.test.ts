import { describe, expect, it } from 'vitest'
import { workingMemoryEntrySchema } from '../memory/working-memory-entry'

describe('workingMemoryEntrySchema', () => {
  it('accepts an entry with a ratified kind and provenance', () => {
    const result = workingMemoryEntrySchema.safeParse({
      key: 'otp',
      value: '4821',
      kind: 'extracted-value',
      provenance: 'observation',
    })

    expect(result.success).toBe(true)
  })

  it('accepts optional capture-location provenance context', () => {
    const result = workingMemoryEntrySchema.safeParse({
      key: 'savedFile',
      value: 'invoice-2026.pdf',
      kind: 'filename',
      provenance: 'toolResult',
      testIndex: 2,
      stepIndex: 5,
    })

    expect(result.success).toBe(true)
  })

  it('accepts all four ratified kind values', () => {
    for (const kind of ['code', 'filename', 'extracted-value', 'progress-marker']) {
      const result = workingMemoryEntrySchema.safeParse({
        key: 'k',
        value: 'v',
        kind,
        provenance: 'plannerInference',
      })
      expect(result.success).toBe(true)
    }
  })

  it('rejects an unknown kind', () => {
    const result = workingMemoryEntrySchema.safeParse({
      key: 'k',
      value: 'v',
      kind: 'note',
      provenance: 'observation',
    })

    expect(result.success).toBe(false)
  })

  it('rejects an unknown provenance', () => {
    const result = workingMemoryEntrySchema.safeParse({
      key: 'k',
      value: 'v',
      kind: 'code',
      provenance: 'guess',
    })

    expect(result.success).toBe(false)
  })

  it('rejects unknown top-level keys', () => {
    const result = workingMemoryEntrySchema.safeParse({
      key: 'k',
      value: 'v',
      kind: 'code',
      provenance: 'observation',
      ttl: 30,
    })

    expect(result.success).toBe(false)
  })
})
