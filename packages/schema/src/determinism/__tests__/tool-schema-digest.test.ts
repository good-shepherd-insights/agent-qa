import { describe, expect, it } from 'vitest'
import { computeToolSchemaDigest } from '../tool-schema-digest'
import type { ToolSurfaceEntry } from '../tool-schema-digest'

function makeSurface(): ToolSurfaceEntry[] {
  return [
    {
      name: 'submit_form',
      description: 'Submit the completed form',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          profile: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              age: { type: 'integer', minimum: 0 },
            },
            required: ['name', 'age'],
          },
        },
        required: ['email', 'profile'],
      },
    },
    {
      name: 'read_page',
      description: 'Read the current page',
      parameters: {
        type: 'object',
        properties: {
          includeHidden: { type: 'boolean', default: false },
        },
      },
    },
  ]
}

function makeSingleTool(parameters: unknown): ToolSurfaceEntry[] {
  return [{ name: 'inspect', description: 'Inspect one element', parameters }]
}

describe('computeToolSchemaDigest', () => {
  it('is deterministic for structurally identical tool surfaces', () => {
    expect(computeToolSchemaDigest(makeSurface())).toBe(computeToolSchemaDigest(makeSurface()))
  })

  it('returns a full lowercase SHA-256 hex digest', () => {
    expect(computeToolSchemaDigest(makeSurface())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is insensitive to tool array order', () => {
    const surface = makeSurface()

    expect(computeToolSchemaDigest(surface)).toBe(computeToolSchemaDigest([...surface].reverse()))
  })

  it('is insensitive to object-key insertion order at every depth', () => {
    const first = makeSingleTool({
      type: 'object',
      properties: {
        label: { type: 'string', minLength: 1 },
        count: { type: 'integer', minimum: 0 },
      },
    })
    const second = makeSingleTool({
      properties: {
        count: { minimum: 0, type: 'integer' },
        label: { minLength: 1, type: 'string' },
      },
      type: 'object',
    })

    expect(computeToolSchemaDigest(first)).toBe(computeToolSchemaDigest(second))
  })

  it('preserves semantic array order when canonicalizing', () => {
    const first = makeSingleTool({ type: 'object', required: ['label', 'count'] })
    const second = makeSingleTool({ type: 'object', required: ['count', 'label'] })

    expect(computeToolSchemaDigest(first)).not.toBe(computeToolSchemaDigest(second))
  })

  it('changes when a model-visible description changes', () => {
    const surface = makeSurface()
    const changed = surface.map((entry) =>
      entry.name === 'read_page' ? { ...entry, description: `${entry.description}.` } : entry,
    )

    expect(computeToolSchemaDigest(changed)).not.toBe(computeToolSchemaDigest(surface))
  })

  it('changes when a parameters leaf value changes', () => {
    const first = makeSingleTool({ type: 'string', minLength: 1 })
    const second = makeSingleTool({ type: 'string', minLength: 2 })

    expect(computeToolSchemaDigest(first)).not.toBe(computeToolSchemaDigest(second))
  })

  it('returns a stable full digest for an empty tool surface', () => {
    const digest = computeToolSchemaDigest([])

    expect(digest).toBe(computeToolSchemaDigest([]))
    expect(digest).toMatch(/^[0-9a-f]{64}$/)
  })
})
