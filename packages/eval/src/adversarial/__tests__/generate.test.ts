/**
 * 422-02-T1 — every frozen hostile and benign family, derived from REAL leaf fixtures.
 *
 * 422-01 shipped eleven frozen families and derived two of them; the other nine answered with
 * a typed `mutator-not-generated` skip. This file is the bar the expansion has to clear, and
 * it is deliberately written against BEHAVIOUR rather than against the presence of source
 * strings:
 *
 *   - the seeded draw is pinned at four independent points (the UTF-8 key serialization, the
 *     drawn table member, the rebuilt receipt hashes, and the derived cassette id), so a
 *     change to any one of them REDs by name rather than silently re-addressing variants;
 *   - every HOSTILE family must move the target's normalized identity while leaving the
 *     recorded decision, its ref and the equivalence set untouched (D-06);
 *   - every BENIGN family must leave the gold's `role + nameNormalized + ordinal` EQUAL under
 *     the real `normalizeAccessibleName` — on the target when the perturbation folds away,
 *     on a distractor when it does not, and as an explicit inapplicability row when neither
 *     surface exists (D-06/D-07);
 *   - two runs, and two permutations of the same input, must serialise identically (D-07).
 */
import { describe, expect, it } from 'vitest'
import { asRef, normalizeAccessibleName, screenStateHash, sha256hex } from '@vostride/agent-qa-schema'
import { canonicalJson } from '../../canonical-json'
import { canonicalizeInputLeg } from '../../extract/receipt'
import { ADVERSARIAL_MUTATORS } from '../../labels/corpus-entry'
import type { AdversarialMutator } from '../../labels/corpus-entry'
import { createSeededRng } from '../../stats/prng'
import { ADVERSARIAL_TABLES, ADVERSARIAL_TABLE_VERSION } from '../tables'
import type { AdversarialTableEntry } from '../tables'
import * as engine from '../generate'
import { deriveAdversarialCassetteId, generateAdversarialVariants, rewriteElementNameInTree } from '../generate'
import type { AdversarialSeed, AdversarialVariant } from '../generate'
import { FIXTURE_GOLD, FIXTURE_REFS, makeAdversarialSeedFixture } from './fixtures'

const UNIT_SEPARATOR = String.fromCharCode(31)

const treeElements = (names: string[]) => names.map((name, index) => ({
  role: 'button', name, ref: asRef(`e-${index}`),
}))

/** A fixture whose four recorded surfaces let every one of the eleven families apply. */
function richSeed(): AdversarialSeed {
  return makeAdversarialSeedFixture({ names: { [FIXTURE_REFS.status]: 'Saved item' } })
}

function variantsByMutator(
  result: engine.GenerateAdversarialVariantsResult,
): Map<AdversarialMutator, AdversarialVariant> {
  return new Map(result.variants.map(variant => [variant.mutator, variant]))
}

function locate(
  elements: readonly { role: string; name: string }[],
  anchor: { role: string; nameNormalized: string; ordinal: number },
): number {
  let seen = 0
  for (const [index, element] of elements.entries()) {
    if (element.role !== anchor.role) continue
    if (normalizeAccessibleName(element.name) !== anchor.nameNormalized) continue
    if (seen === anchor.ordinal) return index
    seen += 1
  }
  return -1
}

describe('422-02 adversarial generation — known-answer vectors', () => {
  it('pins the draw-key serialization, the drawn member, the rebuilt hashes and the derived id independently', () => {
    // 1. Seed SERIALIZATION. The exact UTF-8 key, pinned as a literal: a separator change
    //    would silently re-draw every family without changing a single derived id.
    expect(typeof engine.adversarialDrawKey).toBe('function')
    expect(engine.adversarialDrawKey('fixture/seed-00', 'confusable', 2)).toBe(
      `fixture/seed-00${UNIT_SEPARATOR}confusable${UNIT_SEPARATOR}2`,
    )
    expect(sha256hex(engine.adversarialDrawKey('fixture/seed-00', 'confusable', 2))).toBe(
      '75c6cb795a8455e1212a97ffaf5546ebaa4eb9e360fa87d3c0978c1dddb95372',
    )

    // 2. Chosen table MEMBER, against an independently driven copy of the shipped PRNG.
    expect(typeof engine.drawAdversarialTableEntry).toBe('function')
    const entries: readonly AdversarialTableEntry[] = [
      { id: 'first', from: 'a', to: 'x' },
      { id: 'second', from: 'b', to: 'y' },
      { id: 'third', from: 'c', to: 'z' },
    ]
    const expectedIndex = createSeededRng(
      engine.adversarialDrawKey('fixture/seed-00', 'confusable', 2),
    ).nextInt(0, entries.length - 1)
    expect(
      engine.drawAdversarialTableEntry({
        seedCassetteId: 'fixture/seed-00',
        mutator: 'confusable',
        tableVersion: 2,
        entries,
      }),
    ).toEqual(entries[expectedIndex])

    // 3. Derived ID, as a literal per generation — and a bumped generation addresses a NEW id.
    expect(
      deriveAdversarialCassetteId({
        seedCassetteId: 'fixture/seed-00',
        kind: 'fuzz-label',
        mutator: 'confusable',
        tableVersion: 2,
      }),
    ).toBe('2f0ea09265af71895d62762dd1c7b9e87da3aca783fc94aada7875339e6ce68d')
    expect(
      deriveAdversarialCassetteId({
        seedCassetteId: 'fixture/seed-00',
        kind: 'fuzz-label',
        mutator: 'confusable',
        tableVersion: 1,
      }),
    ).toBe('af042eb951c89937c69e20d67cbb57ad4383950a0b9c64c9193a0e3338bc59e2')

    // 4. Output HASHES: rebuilt from the derived bytes, never copied off the seed.
    const seed = richSeed()
    const variant = variantsByMutator(
      generateAdversarialVariants({ product: 'fixture', seeds: [seed], mutators: ['confusable'] }),
    ).get('confusable')!
    expect(variant.cassette.receipt.screenStateHash).toBe(
      screenStateHash(variant.cassette.input.stateBefore),
    )
    expect(variant.cassette.receipt.promptInputHash).toBe(
      sha256hex(canonicalizeInputLeg(variant.cassette.input)),
    )
    expect(variant.cassette.receipt.screenStateHash).not.toBe(seed.cassette.receipt.screenStateHash)
    expect(variant.cassette.receipt.promptInputHash).not.toBe(seed.cassette.receipt.promptInputHash)
    expect(variant.cassette.receipt.buildOrdinal).toBe(seed.cassette.receipt.buildOrdinal)
  })
})

describe('422-02 adversarial generation — eleven families', () => {
  it('derives exactly one variant per applicable family, in declared-mutator order', () => {
    const seed = richSeed()
    const result = generateAdversarialVariants({ product: 'fixture', seeds: [seed] })

    expect(result.variants.map(variant => variant.mutator)).toEqual([...ADVERSARIAL_MUTATORS])
    expect(result.skips).toEqual([])
    expect(result.seedsConsidered).toBe(1)
    expect(result.seedsDeferred).toBe(0)

    // One typed outcome per (seed, mutator) — never a silent omission, never two.
    expect(typeof engine.generateAdversarialVariants).toBe('function')
    expect(result.outcomes.map(outcome => outcome.mutator)).toEqual([...ADVERSARIAL_MUTATORS])
    expect(result.outcomes.every(outcome => outcome.kind === 'derived')).toBe(true)

    // Distinct ids: the family rides in the id, so no two families collide on one seed.
    expect(new Set(result.variants.map(variant => variant.cassette.id)).size).toBe(
      ADVERSARIAL_MUTATORS.length,
    )
    for (const variant of result.variants) {
      expect(variant.cassette.id).toBe(
        deriveAdversarialCassetteId({
          seedCassetteId: seed.cassette.id,
          kind: ADVERSARIAL_TABLES[variant.mutator].kind,
          mutator: variant.mutator,
          tableVersion: ADVERSARIAL_TABLE_VERSION,
        }),
      )
      expect(variant.generator.tableVersion).toBe(ADVERSARIAL_TABLE_VERSION)
      expect(variant.tableEntryId).not.toBe('')
    }
  })

  it('moves the target identity for every hostile family and never the recorded decision', () => {
    const seed = richSeed()
    const hostile = ADVERSARIAL_MUTATORS.filter(mutator => ADVERSARIAL_TABLES[mutator].hostile)
    const found = variantsByMutator(
      generateAdversarialVariants({ product: 'fixture', seeds: [seed], mutators: hostile }),
    )
    expect([...found.keys()].sort()).toEqual([...hostile].sort())

    for (const mutator of hostile) {
      const variant = found.get(mutator)!
      const elements = variant.cassette.input.stateBefore.elements
      const goldIndex = locate(seed.cassette.input.stateBefore.elements, FIXTURE_GOLD)
      expect(goldIndex).toBeGreaterThanOrEqual(0)

      // The perturbed surface IS the gold target, and its normalized identity moved.
      expect(variant.perturbedGoldTarget).toBe(true)
      expect(normalizeAccessibleName(elements[goldIndex]!.name)).not.toBe(
        FIXTURE_GOLD.nameNormalized,
      )
      expect(elements[goldIndex]!.nameNormalized).toBe(
        normalizeAccessibleName(elements[goldIndex]!.name),
      )
      expect(variant.cassette.sidecar.goldAnchor?.nameNormalized).toBe(
        elements[goldIndex]!.nameNormalized,
      )
      // …while the recorded decision, its ref and the equivalence arity are untouched (D-06).
      expect(variant.cassette.sidecar.goldAction).toEqual(seed.cassette.sidecar.goldAction)
      expect(variant.cassette.sidecar.goldAnchor?.role).toBe(FIXTURE_GOLD.role)
      expect(variant.cassette.sidecar.goldAnchor?.ordinal).toBe(FIXTURE_GOLD.ordinal)
      expect(variant.cassette.sidecar.equivalenceSet).toHaveLength(
        seed.cassette.sidecar.equivalenceSet.length,
      )
      expect(variant.labelRecord.label).toEqual(seed.label!.label)
    }
  })

  it('keeps the gold role, normalized name and sibling ordinal equal for every benign family', () => {
    const seed = richSeed()
    const benign = ADVERSARIAL_MUTATORS.filter(mutator => !ADVERSARIAL_TABLES[mutator].hostile)
    const found = variantsByMutator(
      generateAdversarialVariants({ product: 'fixture', seeds: [seed], mutators: benign }),
    )
    expect([...found.keys()].sort()).toEqual([...benign].sort())

    for (const mutator of benign) {
      const variant = found.get(mutator)!
      const elements = variant.cassette.input.stateBefore.elements
      // The perturbation actually happened somewhere on the observation…
      expect(canonicalJson(elements)).not.toBe(
        canonicalJson(seed.cassette.input.stateBefore.elements),
      )
      // …and the gold anchor still names the same control at the same sibling ordinal.
      expect(variant.cassette.sidecar).toEqual(seed.cassette.sidecar)
      expect(locate(elements, FIXTURE_GOLD)).toBe(
        locate(seed.cassette.input.stateBefore.elements, FIXTURE_GOLD),
      )
      for (const descriptor of variant.cassette.sidecar.equivalenceSet) {
        expect(locate(elements, descriptor)).toBe(
          locate(seed.cassette.input.stateBefore.elements, descriptor),
        )
      }
    }
  })

  it('discloses benign inapplicability on a sparse surface rather than altering gold', () => {
    // One recorded control and nothing else: the four benign families whose perturbation
    // changes the normalized name have no distractor to land on.
    const sparse = makeAdversarialSeedFixture({ keepRefs: [FIXTURE_REFS.goldButton] })
    const result = generateAdversarialVariants({ product: 'fixture', seeds: [sparse] })
    const derived = new Set(result.variants.map(variant => variant.mutator))
    const inapplicable = new Map(
      result.outcomes
        .filter(outcome => outcome.kind === 'inapplicable')
        .map(outcome => [outcome.mutator, outcome.reason]),
    )

    for (const mutator of ['benign-punctuation', 'benign-truncate', 'benign-synonym'] as const) {
      expect(derived.has(mutator)).toBe(false)
      expect(inapplicable.get(mutator)).toBe('benign-surface-absent')
    }
    // Identity-folding benign families still land on the target itself.
    for (const mutator of ['benign-case', 'benign-whitespace', 'benign-digit'] as const) {
      expect(derived.has(mutator)).toBe(true)
    }
    // Gold is untouched by every benign variant this sparse seed produced.
    for (const variant of result.variants.filter(row => !ADVERSARIAL_TABLES[row.mutator].hostile)) {
      expect(variant.cassette.sidecar).toEqual(sparse.cassette.sidecar)
    }
    expect(result.variants.every(variant => variant.cassette.id !== sparse.cassette.id)).toBe(true)
  })
})

describe('422-02 adversarial generation — explicit outcomes for everything else', () => {
  it('reports an empty input as an empty successful report', () => {
    expect(generateAdversarialVariants({ product: 'fixture', seeds: [] })).toEqual({
      variants: [],
      skips: [],
      outcomes: [],
      seedsConsidered: 0,
      seedsDeferred: 0,
    })
  })

  it('names every ineligible, malformed or null seed explicitly and derives nothing from it', () => {
    const cases: readonly [AdversarialSeed, string][] = [
      [
        makeAdversarialSeedFixture({
          assignment: { split: 'held-out', heldOutVisibility: 'shared' },
        }),
        'not-natural',
      ],
      [makeAdversarialSeedFixture({ proofBacked: false }), 'brief-not-proof-backed'],
      [makeAdversarialSeedFixture({ anchorAbsent: true }), 'gold-anchor-absent'],
      [makeAdversarialSeedFixture({ anchorUnresolvable: true }), 'gold-anchor-unresolved'],
      [makeAdversarialSeedFixture({ labelled: false }), 'seed-label-absent'],
      [makeAdversarialSeedFixture({ targetNameBlank: true }), 'target-name-empty'],
    ]
    for (const [seed, reason] of cases) {
      const result = generateAdversarialVariants({ product: 'fixture', seeds: [seed] })
      expect(result.variants).toEqual([])
      expect(result.outcomes).toEqual([
        { kind: 'inapplicable', seedCassetteId: seed.cassette.id, reason },
      ])
      expect(result.seedsConsidered).toBe(0)
    }

    // A null entry in the array is DATA, not a crash: it is reported like any other refusal.
    const nulled = generateAdversarialVariants({
      product: 'fixture',
      seeds: [undefined as unknown as AdversarialSeed],
    })
    expect(nulled.variants).toEqual([])
    expect(nulled.outcomes).toEqual([
      { kind: 'inapplicable', seedCassetteId: '', reason: 'seed-malformed' },
    ])
  })

  it('collapses a duplicate seed and an already-derived id to an explicit unchanged row', () => {
    const seed = richSeed()
    const first = generateAdversarialVariants({
      product: 'fixture',
      seeds: [seed, seed],
      mutators: ['confusable'],
    })
    expect(first.variants).toHaveLength(1)
    expect(
      first.outcomes.filter(
        outcome => outcome.kind === 'inapplicable' && outcome.reason === 'already-derived',
      ),
    ).toHaveLength(1)

    const again = generateAdversarialVariants({
      product: 'fixture',
      seeds: [seed],
      mutators: ['confusable'],
      existingCassetteIds: new Set(first.variants.map(variant => variant.cassette.id)),
    })
    expect(again.variants).toEqual([])
    expect(again.outcomes).toEqual([
      {
        kind: 'inapplicable',
        seedCassetteId: seed.cassette.id,
        mutator: 'confusable',
        reason: 'already-derived',
      },
    ])
  })

  it('serialises identically across two runs and across permuted input', () => {
    const alpha = richSeed()
    const beta = makeAdversarialSeedFixture({
      runId: 'run / adversarial permutation 7',
      names: { [FIXTURE_REFS.status]: 'Saved item', [FIXTURE_REFS.root]: 'Basket' },
    })
    const ordered = generateAdversarialVariants({ product: 'fixture', seeds: [alpha, beta] })
    const repeated = generateAdversarialVariants({ product: 'fixture', seeds: [alpha, beta] })
    const permuted = generateAdversarialVariants({
      product: 'fixture',
      seeds: [beta, alpha],
      mutators: [...ADVERSARIAL_MUTATORS].reverse(),
    })

    expect(canonicalJson(repeated)).toBe(canonicalJson(ordered))
    expect(canonicalJson(permuted)).toBe(canonicalJson(ordered))

    // Seed-id ascending, then DECLARED mutator order inside each seed.
    const seedIds = [alpha.cassette.id, beta.cassette.id].sort()
    expect(ordered.outcomes.map(outcome => outcome.seedCassetteId)).toEqual([
      ...Array.from({ length: ADVERSARIAL_MUTATORS.length }, () => seedIds[0]!),
      ...Array.from({ length: ADVERSARIAL_MUTATORS.length }, () => seedIds[1]!),
    ])
  })

  it('bounds a refresh by the seed cap and defers the rest as counted rows', () => {
    const alpha = richSeed()
    const beta = makeAdversarialSeedFixture({
      runId: 'run / adversarial permutation 7',
      names: { [FIXTURE_REFS.status]: 'Saved item', [FIXTURE_REFS.root]: 'Basket' },
    })
    const capped = generateAdversarialVariants({
      product: 'fixture',
      seeds: [alpha, beta],
      mutators: ['confusable'],
      maxSeeds: 1,
    })
    expect(capped.seedsConsidered).toBe(1)
    expect(capped.seedsDeferred).toBe(1)
    expect(capped.variants).toHaveLength(1)
    expect(
      capped.outcomes.filter(
        outcome => outcome.kind === 'inapplicable' && outcome.reason === 'cap-exceeded',
      ),
    ).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------
// CR-06 — the rendered tree and `elements` must describe ONE screen
// ---------------------------------------------------------------------------------------

// The occurrence index used to rewrite the tree was counted over ELEMENTS by exact name
// equality, then spent as a raw SUBSTRING ordinal in the tree prose. Those are not the same
// number, and the mismatch renamed a different control in the tree than in `elements` -- after
// which `promptInputHash`/`screenStateHash` were recomputed over the inconsistent document, so
// nothing downstream could notice. The second half was worse for the measurement: a needle the
// tree did not carry rewrote nothing and said nothing, staging an adversarial case whose
// rendered tree still showed the UNPERTURBED label.
describe('CR-06: rewriteElementNameInTree', () => {
  // Captured trees appear both quoted and bare, so the rule may not lean on either syntax.
  const QUOTED = '- button "Save changes"\n- button "Save"'
  const BARE = 'button Save changes\n  button Save'

  it('does not let a longer sibling name absorb the rewrite (quoted tree)', () => {
    expect(
      rewriteElementNameInTree({
        tree: QUOTED,
        elements: treeElements(['Save changes', 'Save']),
        index: 1,
        replacement: 'Sqve',
      }),
    ).toBe('- button "Save changes"\n- button "Sqve"')
  })

  it('does not let a longer sibling name absorb the rewrite (bare tree)', () => {
    expect(
      rewriteElementNameInTree({
        tree: BARE,
        elements: treeElements(['Save changes', 'Save']),
        index: 1,
        replacement: 'Sqve',
      }),
    ).toBe('button Save changes\n  button Sqve')
  })

  it('still renames the longer sibling itself when IT is the target', () => {
    expect(
      rewriteElementNameInTree({
        tree: QUOTED,
        elements: treeElements(['Save changes', 'Save']),
        index: 0,
        replacement: 'Sqve changes',
      }),
    ).toBe('- button "Sqve changes"\n- button "Save"')
  })

  it('keeps the positional rule for genuinely identical siblings', () => {
    const tree = '- button "Continue"\n- button "Continue"'
    expect(
      rewriteElementNameInTree({
        tree,
        elements: treeElements(['Continue', 'Continue']),
        index: 1,
        replacement: 'Contimue',
      }),
    ).toBe('- button "Continue"\n- button "Contimue"')
    expect(
      rewriteElementNameInTree({
        tree,
        elements: treeElements(['Continue', 'Continue']),
        index: 0,
        replacement: 'Contimue',
      }),
    ).toBe('- button "Contimue"\n- button "Continue"')
  })

  it('refuses instead of silently returning the unperturbed tree', () => {
    expect(
      rewriteElementNameInTree({
        tree: '- button "Continue"',
        elements: treeElements(['Submit']),
        index: 0,
        replacement: 'Sudmit',
      }),
    ).toBeUndefined()
    // An empty needle can match anywhere and so identifies nothing.
    expect(
      rewriteElementNameInTree({
        tree: '- button "Continue"',
        elements: treeElements(['']),
        index: 0,
        replacement: 'x',
      }),
    ).toBeUndefined()
  })
})

describe('CR-06: a tree that cannot carry the perturbation reports rather than stages', () => {
  it('emits tree-target-unresolved instead of an unperturbed adversarial case', () => {
    const seed = richSeed()
    // A capture whose rendered tree does not mention the control `elements` names. The old
    // code staged this: the tree came back byte-identical and nothing said so.
    seed.cassette.input.stateBefore.tree = 'button Something Else Entirely'

    const result = generateAdversarialVariants({
      product: 'fixture',
      seeds: [seed],
      mutators: ['confusable'],
    })

    expect(result.variants).toEqual([])
    expect(result.outcomes).toEqual([
      {
        kind: 'inapplicable',
        seedCassetteId: seed.cassette.id,
        mutator: 'confusable',
        reason: 'tree-target-unresolved',
      },
    ])
  })
})

describe('WR-06: drawAdversarialTableEntry over an empty family', () => {
  it('throws rather than returning undefined typed as an entry', () => {
    // NOT a regression cell -- a pin on behaviour that is already correct, added because it
    // was untested and a review read it as broken. The claim was that `entries: []` makes the
    // non-null assertion yield `undefined` TYPED as an AdversarialTableEntry. It does not:
    // `nextInt(0, -1)` computes `range = 0`, fails its own `range < 1` guard and throws a
    // TypeError before any indexing happens, so the assertion is never reached. Pinned here
    // so a future change to `nextInt`'s range guard cannot quietly make the claim true.
    expect(() =>
      engine.drawAdversarialTableEntry({
        seedCassetteId: 'seed',
        mutator: 'confusable',
        tableVersion: ADVERSARIAL_TABLE_VERSION,
        entries: [],
      }),
    ).toThrow(TypeError)
  })
})
