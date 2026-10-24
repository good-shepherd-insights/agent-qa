import { tool } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { computeToolSchemaDigest } from '@vostride/agent-qa-schema'
import type { Platform } from '@vostride/agent-qa-schema'
import { describeBoundSurface } from '../builder.js'
import { defaultRegistry } from '../index.js'

const PLATFORMS: Platform[] = ['web', 'android', 'ios']

describe('describeBoundSurface', () => {
  it('produces a stable 64-hex digest for every real platform registry slice', () => {
    for (const platform of PLATFORMS) {
      const first = computeToolSchemaDigest(describeBoundSurface(defaultRegistry, { platform }))
      const second = computeToolSchemaDigest(describeBoundSurface(defaultRegistry, { platform }))

      expect(first).toMatch(/^[0-9a-f]{64}$/)
      expect(second).toBe(first)
    }
  })

  it('keeps the three real platform surfaces distinct', () => {
    const digests = PLATFORMS.map(platform =>
      computeToolSchemaDigest(describeBoundSurface(defaultRegistry, { platform })),
    )

    expect(new Set(digests).size).toBe(PLATFORMS.length)
  })

  it('changes when a model-visible tool description changes', () => {
    const surface = describeBoundSurface(defaultRegistry, { platform: 'web' })
    const changed = surface.map((entry, index) =>
      index === 0 ? { ...entry, description: `${entry.description} changed` } : entry,
    )

    expect(computeToolSchemaDigest(changed)).not.toBe(computeToolSchemaDigest(surface))
  })

  it('includes non-action tools in the full bound surface', () => {
    const base = describeBoundSurface(defaultRegistry, { platform: 'web' })
    const withNonActionTool = describeBoundSurface(defaultRegistry, {
      platform: 'web',
      nonActionTools: {
        inspect_context: tool({
          description: 'Inspect bounded context',
          inputSchema: z.object({ query: z.string() }),
        }),
      },
    })

    expect(computeToolSchemaDigest(withNonActionTool)).not.toBe(computeToolSchemaDigest(base))
  })
})
