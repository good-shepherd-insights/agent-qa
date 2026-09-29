// 2026-09-29, 432-02 D-18: a production target is a config declaration, and the environment a
// corpus entry records is the target's declared class carried as DATA. Eval accepts all three
// declared classes plus absence, and nothing else.
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import type { LeafCassette } from '../../cassette/cassette'
import { extractRunCassettes } from '../../extract/extract-run'
import type { ArtifactSource } from '../../ports'
import { committedFileText } from '../committed-file'
import { projectCorpusEntry, type SplitAssignment, type TargetEnvironment } from '../corpus-entry'
import { parseCorpusEntry } from '../corpus-entry-guard'
import { buildSeedingPlan } from '../seeding-plan'

const RUN_ID = 'run / checkout suite 42'
const RUN_SLUG = 'run---checkout-suite-42'
const LEAF_ID = `${RUN_SLUG}/test-00-step-00-d00-leaf`

const ENVIRONMENT_STATES: readonly (TargetEnvironment | undefined)[] = [
  'local',
  'shared',
  'production',
  undefined,
]

const ASSIGNMENTS: readonly SplitAssignment[] = [
  { split: 'natural' },
  { split: 'held-out', heldOutVisibility: 'shared' },
  { split: 'held-out', heldOutVisibility: 'private' },
]

function fullArtifacts(): ArtifactSource {
  const entries = new Map<string, Uint8Array>([
    [FIXTURE_SCREENSHOT_SHA, new Uint8Array([1, 2, 3])],
    [FIXTURE_ARTIFACT_SHA, new Uint8Array([4, 5])],
  ])
  return { getBlob: (sha) => entries.get(sha) }
}

function fixtureHandoff(): CompletedRunHandoff {
  return makeArtifactRefV2Handoff()
}

function fixtureLeaf(): LeafCassette {
  const found = extractRunCassettes({ handoff: fixtureHandoff(), artifacts: fullArtifacts() })
    .cassettes.map((entry) => entry.cassette)
    .find(
      (cassette): cassette is LeafCassette =>
        cassette.granularity === 'leaf' && cassette.id === LEAF_ID,
    )
  if (found === undefined) throw new Error(`missing leaf cassette ${LEAF_ID}`)
  return found
}

function v2Natural(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2,
    cassetteId: LEAF_ID,
    product: 'demo-app',
    split: 'natural',
    captured_at_ordinal: 37,
    run_links: { runId: RUN_ID, runSlug: RUN_SLUG },
    receiptDigest: 'a'.repeat(64),
    ...overrides,
  }
}

describe('432 production target environment in eval (D-18)', () => {
  it('C432-TARGET-ENVIRONMENT-ROUNDTRIP: local, shared, production and absence survive project → committed bytes → guard', () => {
    expectTypeOf<TargetEnvironment>().toEqualTypeOf<'local' | 'shared' | 'production'>()
    const cassette = fixtureLeaf()
    for (const environment of ENVIRONMENT_STATES) {
      for (const assignment of ASSIGNMENTS) {
        const label = `${environment ?? '<absent>'} / ${JSON.stringify(assignment)}`
        const projected = projectCorpusEntry({
          cassette,
          product: 'demo-app',
          runId: RUN_ID,
          assignment,
          ...(environment === undefined ? {} : { targetEnvironment: environment }),
        })
        const parsed = parseCorpusEntry(JSON.parse(committedFileText(projected)))
        expect(parsed.ok, label).toBe(true)
        if (!parsed.ok) continue
        expect(parsed.schemaVersion, label).toBe(2)
        expect(parsed.entry, label).toEqual(projected)
        if (environment === undefined) {
          // Absence stays absence: no key, never a key holding undefined or a guessed class.
          expect(Object.keys(parsed.entry), label).not.toContain('targetEnvironment')
        } else {
          expect(parsed.entry.targetEnvironment, label).toBe(environment)
        }
      }
    }
  })

  it('C432-TARGET-ENVIRONMENT-ROUNDTRIP: the seeding plan carries a declared production class as data and omits an absent one', () => {
    const handoff = fixtureHandoff()
    const cassettes = extractRunCassettes({ handoff, artifacts: fullArtifacts() }).cassettes
    const partition = { saltHex: '0'.repeat(64), heldOutFraction: 0.9, privateFraction: 0.4 }

    const production = buildSeedingPlan({ handoff, cassettes, partition, targetEnvironment: 'production' })
    expect(production.cases.length).toBeGreaterThan(0)
    for (const planCase of production.cases) {
      expect(planCase.corpusEntry.targetEnvironment).toBe('production')
    }

    const absent = buildSeedingPlan({ handoff, cassettes, partition })
    expect(absent.cases.length).toBe(production.cases.length)
    for (const planCase of absent.cases) {
      expect(Object.keys(planCase.corpusEntry)).not.toContain('targetEnvironment')
    }
  })

  it('C432-TARGET-ENVIRONMENT-ROUNDTRIP: strict malformed environments are refused on the targetEnvironment path', () => {
    for (const malformed of ['Production', 'PRODUCTION', 'prod', 'staging', ' production', 'production ', '', null, 1, true, {}]) {
      const parsed = parseCorpusEntry(v2Natural({ targetEnvironment: malformed }))
      expect(parsed.ok, JSON.stringify(malformed)).toBe(false)
      if (parsed.ok) continue
      expect(parsed.issues, JSON.stringify(malformed)).toContain('targetEnvironment')
    }
  })

  it('keeps the other two declared classes and absence admitted beside production', () => {
    for (const environment of ENVIRONMENT_STATES) {
      const parsed = parseCorpusEntry(
        v2Natural(environment === undefined ? {} : { targetEnvironment: environment }),
      )
      expect(parsed.ok, String(environment)).toBe(true)
    }
  })
})
