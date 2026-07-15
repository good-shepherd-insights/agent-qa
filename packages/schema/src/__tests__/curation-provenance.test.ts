import { describe, expect, expectTypeOf, it } from 'vitest'
import type { Delta } from '../delta/delta'
import type {
  CurationAuthorshipPath,
  DeltaEnvelope,
  OriginStage,
} from '../delta/envelope'

const scope = { tier: 'product', key: 'checkout' } as const

const authorshipPathLabels: Record<CurationAuthorshipPath, string> = {
  llm: 'model-authored',
  'llm-repaired': 'model-authored after repair',
  'deterministic-fallback': 'code-authored fallback',
}

describe('curation provenance contracts (D-04/SAFE-01)', () => {
  it('keeps authorship optional while accepting the closed authorship stamp', () => {
    const unstampedEnvelope: DeltaEnvelope = {
      origin: 'agent',
      scope,
      citedIds: [],
    }

    const stampedDelta: Delta = {
      kind: 'Noop',
      origin: 'agent',
      scope,
      citedIds: [],
      authorship: {
        path: 'deterministic-fallback',
        model: {
          id: 'fallback-author',
          family: 'deterministic',
          fingerprint: 'v1',
        },
        executionContext: 'ci',
      },
    }

    expect(unstampedEnvelope).not.toHaveProperty('authorship')
    expect(stampedDelta.authorship).toEqual({
      path: 'deterministic-fallback',
      model: {
        id: 'fallback-author',
        family: 'deterministic',
        fingerprint: 'v1',
      },
      executionContext: 'ci',
    })
    expect(authorshipPathLabels).toEqual({
      llm: 'model-authored',
      'llm-repaired': 'model-authored after repair',
      'deterministic-fallback': 'code-authored fallback',
    })
    expectTypeOf(stampedDelta.authorship).toMatchTypeOf<DeltaEnvelope['authorship']>()
  })

  it('closes OriginStage around the live drainer producer', () => {
    const stage: OriginStage = 'run-curation'

    expect(stage).toBe('run-curation')

    // @ts-expect-error OriginStage is schema-owned and rejects arbitrary producer labels.
    const unsupportedStage: OriginStage = 'arbitrary-stage'
    void unsupportedStage
  })
})
