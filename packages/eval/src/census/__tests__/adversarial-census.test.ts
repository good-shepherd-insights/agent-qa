// 422-19-T1: the committed adversarial generation mix, as the census states it (D-05/D-08/D-11).
//
// A census is read by someone deciding whether to trust a number. That makes a PLAUSIBLE census
// worse than a missing one, and it is why the three separations below are cells rather than
// comments:
//
//   1. ABSENT is not ZERO. A product that has never committed an adversarial member carries no
//      mix at all — the same line 422-07 held for `proposals` absent vs `proposed: 0`. A block of
//      zeros would read as "we generated and nothing survived", which is a different fact.
//   2. A DECLARED FAMILY THAT PRODUCED NOTHING is not a FAMILY THAT WAS NEVER ATTEMPTED. The
//      eleven frozen families are a closed set, so each one reads `0` rather than vanishing. The
//      table GENERATIONS are open — nobody can enumerate the generations that do not exist — so a
//      generation with no committed entry is ABSENT from `byTableVersion` rather than zero.
//   3. PROBE-AUTHORED is not TABLE-DERIVED. 422-04 made the two structurally distinguishable on
//      purpose (a probe names `promptVersion` and carries no `mutator`/`tableVersion`/`tableHash`)
//      so a reader can tell a deterministic fuzzer's output from an LLM's. Summing them into one
//      count throws that away, so `byMutator` sums to the TABLE arm and never to the total.
//
// And a legacy entry — one committed before 422, naming a kind and a seed and nothing else — is
// binned into NO family. It is counted as `absent` provenance, which is the honest statement that
// its family is unknown rather than a guess dressed as a count.
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../canonical-json'
import {
  ADVERSARIAL_MUTATORS,
  GENERATOR_KINDS,
  type AdversarialCorpusEntry,
  type CorpusEntry,
  type CorpusGenerator,
} from '../../labels/corpus-entry'
import { deriveCensus, type CommittedCorpusSnapshot, type CorpusCensus } from '../derive-census'
import { renderCensusMarkdown } from '../render-census'

const HASH_1 = '1'.repeat(64)
const HASH_2 = '2'.repeat(64)
const HASH_TAMPERED = '3'.repeat(64)

function tableGenerator(over: Partial<CorpusGenerator> = {}): CorpusGenerator {
  return {
    kind: 'fuzz-label',
    seedCassetteId: 'seed-natural',
    generatorVersion: 2,
    mutator: 'confusable',
    tableVersion: 2,
    tableHash: HASH_2,
    ...over,
  }
}

function probeGenerator(over: Partial<CorpusGenerator> = {}): CorpusGenerator {
  return {
    kind: 'judge-targeted',
    seedCassetteId: 'seed-natural',
    generatorVersion: 2,
    authoringModel: { id: 'anthropic/claude-probe', family: 'anthropic' },
    promptVersion: 1,
    ...over,
  }
}

function adversarial(cassetteId: string, generator: CorpusGenerator): AdversarialCorpusEntry {
  return {
    schemaVersion: 2,
    cassetteId,
    product: 'default',
    split: 'adversarial',
    captured_at_ordinal: 1,
    run_links: { runId: 'run-fixture', runSlug: 'run-fixture' },
    receiptDigest: 'a'.repeat(64),
    generator,
  }
}

function natural(cassetteId: string): CorpusEntry {
  return {
    schemaVersion: 2,
    cassetteId,
    product: 'default',
    split: 'natural',
    captured_at_ordinal: 1,
    run_links: { runId: 'run-fixture', runSlug: 'run-fixture' },
    receiptDigest: 'a'.repeat(64),
  }
}

function census(entries: readonly CorpusEntry[]): CorpusCensus {
  const snapshot: CommittedCorpusSnapshot = {
    entries,
    labelsById: new Map(),
    cassettesById: new Map(),
    blobPresentById: new Map(),
  }
  return deriveCensus({ snapshot })
}

function sum(counts: Readonly<Record<string, number>>): number {
  return Object.values(counts).reduce((total, value) => total + value, 0)
}

describe('422 committed adversarial generation mix', () => {
  it('retains an old table generation beside the new one, summing to the adversarial total', () => {
    const result = census([
      natural('n-1'),
      adversarial('a-old-1', tableGenerator({ tableVersion: 1, tableHash: HASH_1, generatorVersion: 1 })),
      adversarial('a-old-2', tableGenerator({ tableVersion: 1, tableHash: HASH_1, generatorVersion: 1, mutator: 'invisible' })),
      adversarial('a-new-1', tableGenerator()),
    ])
    const block = result.products.default!
    const mix = block.adversarialGenerationMix
    expect(mix).toBeDefined()
    // A bump ADDS a generation; it never retires the previous one (D-08, ROOT-FUT-01).
    expect(mix!.byTableVersion).toEqual({ '1': 2, '2': 1 })
    expect(sum(mix!.byTableVersion)).toBe(block.splits.adversarial)
    expect(mix!.total).toBe(block.splits.adversarial)
    expect(mix!.total).toBe(3)
    // The natural member is not in the adversarial population and does not reach the mix.
    expect(block.total).toBe(4)
    expect(mix!.byProvenance).toEqual({ absent: 0, table: 3, probe: 0, malformed: 0 })
    // Each generation's pinned table hash travels with it, so one generation claiming two
    // different frozen tables is VISIBLE rather than averaged away (T-422-19-01).
    expect(mix!.tableHashesByVersion).toEqual({ '1': [HASH_1], '2': [HASH_2] })
  })

  it('keeps a declared family that produced nothing at zero and a generation nobody committed absent', () => {
    const result = census([
      adversarial('a-1', tableGenerator()),
      adversarial('a-2', tableGenerator({ mutator: 'benign-case' })),
    ])
    const mix = result.products.default!.adversarialGenerationMix
    expect(mix).toBeDefined()
    // CLOSED set: every declared family is present, so "produced nothing" reads as an explicit 0.
    expect(Object.keys(mix!.byMutator).sort()).toEqual([...ADVERSARIAL_MUTATORS].sort())
    expect(mix!.byMutator.confusable).toBe(1)
    expect(mix!.byMutator['benign-case']).toBe(1)
    expect(mix!.byMutator['benign-plural']).toBe(0)
    expect(Object.keys(mix!.byKind).sort()).toEqual([...GENERATOR_KINDS].sort())
    expect(sum(mix!.byKind)).toBe(mix!.total)
    // OPEN set: generation 1 was never committed here, so it is ABSENT rather than a zero that
    // would read as "generation 1 was attempted and produced nothing".
    expect(mix!.byTableVersion).toEqual({ '2': 2 })
    expect(mix!.tableHashesByVersion).toEqual({ '2': [HASH_2] })
  })

  it('bins a pre-422 legacy entry into no family and counts its provenance as absent', () => {
    const result = census([
      adversarial('a-table', tableGenerator()),
      adversarial('a-legacy', { kind: 'fuzz-selector', seedCassetteId: 'seed-natural', generatorVersion: 1 }),
    ])
    const mix = result.products.default!.adversarialGenerationMix
    expect(mix).toBeDefined()
    expect(mix!.total).toBe(2)
    expect(mix!.byProvenance).toEqual({ absent: 1, table: 1, probe: 0, malformed: 0 })
    // The legacy member reaches NO family bucket — its family is unknown, not zero-valued.
    expect(sum(mix!.byMutator)).toBe(mix!.byProvenance.table)
    expect(sum(mix!.byTableVersion)).toBe(mix!.byProvenance.table)
    // Its KIND is recorded, because the entry actually names one.
    expect(mix!.byKind['fuzz-selector']).toBe(1)
    expect(mix!.metadataUnavailable).toBe(0)
  })

  it('reports probe-authored and table-derived populations without summing them', () => {
    const result = census([
      adversarial('a-table', tableGenerator()),
      adversarial('a-probe-1', probeGenerator()),
      adversarial('a-probe-2', probeGenerator({ kind: 'optimized-trigger', authoringModel: { id: 'openai/gpt-probe', family: 'openai' } })),
    ])
    const mix = result.products.default!.adversarialGenerationMix
    expect(mix).toBeDefined()
    expect(mix!.total).toBe(3)
    expect(mix!.byProvenance).toEqual({ absent: 0, table: 1, probe: 2, malformed: 0 })
    // The two derivation paths never collapse into one undifferentiated count (422-04).
    expect(sum(mix!.byMutator)).toBe(1)
    expect(sum(mix!.byTableVersion)).toBe(1)
    expect(sum(mix!.byPromptVersion)).toBe(2)
    expect(mix!.byPromptVersion).toEqual({ '1': 2 })
    expect(mix!.byAuthoringModel).toEqual({ 'anthropic/claude-probe': 1, 'openai/gpt-probe': 1 })
    expect(mix!.byAuthoringFamily).toEqual({ anthropic: 1, openai: 1 })
    // A probe names no table, so no table hash is invented for it.
    expect(mix!.tableHashesByVersion).toEqual({ '2': [HASH_2] })
  })

  it('discloses two frozen tables claiming one generation rather than averaging them away', () => {
    const result = census([
      adversarial('a-1', tableGenerator()),
      adversarial('a-2', tableGenerator({ tableHash: HASH_TAMPERED })),
    ])
    const mix = result.products.default!.adversarialGenerationMix
    expect(mix!.byTableVersion).toEqual({ '2': 2 })
    expect(mix!.tableHashesByVersion).toEqual({ '2': [HASH_2, HASH_TAMPERED] })
    expect(renderCensusMarkdown(result)).toContain(`  - v2: ${HASH_2}, ${HASH_TAMPERED}`)
  })

  it('omits the mix entirely from a product with no committed adversarial member', () => {
    for (const result of [census([]), census([natural('n-1')])]) {
      expect(canonicalJson(result)).not.toContain('adversarialGenerationMix')
      expect(renderCensusMarkdown(result)).not.toContain('Adversarial generation')
    }
  })

  it('renders the mix deterministically and re-derives byte-identically under permuted input', () => {
    const entries = [
      adversarial('a-old', tableGenerator({ tableVersion: 1, tableHash: HASH_1 })),
      adversarial('a-new', tableGenerator({ mutator: 'injection-template' })),
      adversarial('a-probe', probeGenerator()),
    ]
    const first = census(entries)
    const second = census([...entries].reverse())
    expect(canonicalJson(second)).toBe(canonicalJson(first))

    const markdown = renderCensusMarkdown(first)
    expect(renderCensusMarkdown(first)).toBe(markdown)
    expect(markdown).toContain('### Adversarial generation mix')
    expect(markdown).toContain('- total: 3')
    expect(markdown).toContain('- v1: 1')
    expect(markdown).toContain('- v2: 1')
    expect(markdown).toContain('- injection-template: 1')
    expect(markdown).toContain('- benign-plural: 0')
    expect(markdown).toContain('- anthropic/claude-probe: 1')
    // D-16 still stands over the whole document: counts only, never a verdict.
    expect(markdown).not.toContain('%')
    expect(markdown.toLowerCase()).not.toContain('threshold')
  })
})
