import { sha256hex } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, ScopeKey } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'
import {
  FIXTURE_ARTIFACT_SHA,
  FIXTURE_SCREENSHOT_SHA,
  makeArtifactRefV2Handoff,
} from '../../__tests__/fixtures/handoff-fixtures'
import { canonicalJson } from '../../canonical-json'
import type { LeafCassette } from '../../cassette/cassette'
import { extractRunCassettes } from '../../extract/extract-run'
import type { ArtifactSource } from '../../ports'
import { committedFileText } from '../committed-file'
import {
  CORPUS_ENTRY_SCHEMA_VERSION,
  projectCorpusEntry,
  resolveProductPartition,
} from '../corpus-entry'

const RUN_ID = 'run / checkout suite 42'
const RUN_SLUG = 'run---checkout-suite-42'
const LEAF_ID = `${RUN_SLUG}/test-00-step-00-d00-leaf`
const HANDOFF_PATH = `.agent-qa/runs/${RUN_SLUG}/handoff.json`

function fullArtifacts(): ArtifactSource {
  const entries = new Map<string, Uint8Array>([
    [FIXTURE_SCREENSHOT_SHA, new Uint8Array([1, 2, 3])],
    [FIXTURE_ARTIFACT_SHA, new Uint8Array([4, 5])],
  ])
  return { getBlob: (sha) => entries.get(sha) }
}

function fixtureLeaf(): LeafCassette {
  const handoff: CompletedRunHandoff = makeArtifactRefV2Handoff()
  const found = extractRunCassettes({ handoff, artifacts: fullArtifacts() })
    .cassettes.map((entry) => entry.cassette)
    .find(
      (cassette): cassette is LeafCassette =>
        cassette.granularity === 'leaf' && cassette.id === LEAF_ID,
    )
  if (found === undefined) throw new Error(`missing leaf cassette ${LEAF_ID}`)
  return found
}

describe('projectCorpusEntry (D-02/ROOT-03)', () => {
  it('projects the full membership shape with requirement-verbatim provenance keys', () => {
    const cassette = fixtureLeaf()

    const entry = projectCorpusEntry({
      cassette,
      product: 'demo-app',
      runId: RUN_ID,
      handoffPath: HANDOFF_PATH,
    })

    expect(entry).toEqual({
      schemaVersion: CORPUS_ENTRY_SCHEMA_VERSION,
      cassetteId: LEAF_ID,
      product: 'demo-app',
      split: 'natural',
      captured_at_ordinal: cassette.receipt.buildOrdinal,
      run_links: { runId: RUN_ID, runSlug: RUN_SLUG, handoffPath: HANDOFF_PATH },
      receiptDigest: sha256hex(canonicalJson(cassette.receipt)),
    })
    expect(entry.captured_at_ordinal).toBe(37)

    const serialized = committedFileText(entry)
    expect(serialized).toContain('"captured_at_ordinal"')
    expect(serialized).toContain('"run_links"')
  })

  it('recomputes to the same receiptDigest independently', () => {
    const cassette = fixtureLeaf()

    const entry = projectCorpusEntry({
      cassette,
      product: 'demo-app',
      runId: RUN_ID,
      handoffPath: HANDOFF_PATH,
    })

    const independent = sha256hex(JSON.stringify(sortKeysDeep(cassette.receipt)))
    expect(entry.receiptDigest).toBe(independent)
  })
})

describe('resolveProductPartition (D-03/A1)', () => {
  it('passes a real product name through', () => {
    const scope: ScopeKey = { tier: 'product', key: 'demo-app' }
    expect(resolveProductPartition(scope)).toBe('demo-app')
  })

  it("maps the 'unknown' fallback and an empty name to the typed default partition", () => {
    expect(resolveProductPartition({ tier: 'product', key: 'unknown' })).toBe('default')
    expect(resolveProductPartition({ tier: 'product', key: '' })).toBe('default')
  })

  it('maps non-product tiers to the typed default partition', () => {
    expect(resolveProductPartition({ tier: 'global', key: 'demo-app' })).toBe('default')
    expect(resolveProductPartition({ tier: 'suite', key: 'checkout' })).toBe('default')
    expect(resolveProductPartition({ tier: 'test', key: 'checkout::happy-path' })).toBe(
      'default',
    )
  })
})

/** Key-order-independent recursive sort mirroring canonical serialization. */
function sortKeysDeep(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(sortKeysDeep)
  if (input === null || typeof input !== 'object') return input
  const source = input as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    sorted[key] = sortKeysDeep(source[key])
  }
  return sorted
}
