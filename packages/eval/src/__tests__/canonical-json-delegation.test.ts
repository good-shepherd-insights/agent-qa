import {
  canonicalJson as schemaCanonicalJson,
  canonicalValue as schemaCanonicalValue,
  committedFileText as schemaCommittedFileText,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import {
  canonicalJson as evalCanonicalJson,
  canonicalValue as evalCanonicalValue,
} from '../canonical-json'
import { committedFileText as evalCommittedFileText } from '../labels/committed-file'

describe('schema-owned canonical JSON delegation', () => {
  it('exposes the same functions and committed bytes through eval', () => {
    const value = { z: [{ b: 2, a: 1 }], a: { d: 4, c: 3 } }

    expect(evalCanonicalValue).toBe(schemaCanonicalValue)
    expect(evalCanonicalJson).toBe(schemaCanonicalJson)
    expect(evalCommittedFileText).toBe(schemaCommittedFileText)
    expect(evalCanonicalJson(value)).toBe(schemaCanonicalJson(value))
    expect(evalCommittedFileText(value)).toBe(schemaCommittedFileText(value))
  })
})
