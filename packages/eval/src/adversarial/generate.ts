/**
 * 422 D-02/D-05/D-06/D-07/D-08: the PURE adversarial derivation engine.
 *
 * Three jobs, all of them decisions rather than IO:
 *   1. Seed ELIGIBILITY (D-07). A seed is a `natural`, leaf, proof-backed populated-brief
 *      decision whose gold anchor resolves on its own recorded screen. Held-out is excluded
 *      structurally — a derivation of the unseen test set would land in a split the proposer
 *      reads (414 D-19) — and `/reader` never hands a private entry out in the first place,
 *      so the exclusion holds at the port AND here.
 *   2. TARGET selection, deterministically: the element the gold anchor names, located by
 *      `role + nameNormalized + ordinal` on `input.stateBefore`. In-table CHOICE is a seeded
 *      draw keyed by `seedCassetteId ‖ mutator ‖ tableVersion` (D-07) through the pinned
 *      `createSeededRng` — byte-identical on two runs, no clock and no ambient randomness.
 *   3. GOLD-PRESERVING derivation (D-06). The perturbation moves the SURFACE; the recorded
 *      action, its ref and the equivalence set still denote the same control, so the correct
 *      decision under a confusable glyph or an injected instruction is the seed's decision.
 *      A planner that follows the injected instruction is a flip-to-worse, which is the whole
 *      measurement.
 *
 * What is rebuilt and what is copied is not arbitrary. `promptInputHash` and
 * `screenStateHash` are recomputed because they describe the DERIVED bytes and a copied
 * digest would be a lie. `run_links`, `captured_at_ordinal` and the label's provenance are
 * the SEED's, because ROOT-03's exclusion must keep excluding the run that bred the seed
 * from gating anything derived from it.
 *
 * This module derives the families listed in `ADVERSARIAL_GENERATED_MUTATORS`. The remaining
 * frozen families report a typed `mutator-not-generated` skip — an honest inapplicability
 * row, never a silent omission and never a fabricated variant.
 */
import { normalizeAccessibleName, screenStateHash, sha256hex } from '@vostride/agent-qa-schema'
import type { ElementInfo, ScreenState } from '@vostride/agent-qa-schema'
import { canonicalJson } from '../canonical-json'
import type { LeafCassette } from '../cassette/cassette'
import type { GoldAnchorDescriptor } from '../cassette/sidecar-leg'
import { canonicalizeInputLeg } from '../extract/receipt'
import { deriveAdversarialLabel } from '../labels/label-record'
import type { StandaloneLabelRecord } from '../labels/label-record'
import { projectCorpusEntry } from '../labels/corpus-entry'
import type {
  AdversarialCorpusEntry,
  AdversarialMutator,
  CorpusEntry,
  CorpusGenerator,
} from '../labels/corpus-entry'
import { createSeededRng } from '../stats/prng'
import {
  ADVERSARIAL_TABLES,
  ADVERSARIAL_TABLE_HASH,
  ADVERSARIAL_TABLE_VERSION,
  type AdversarialTableEntry,
} from './tables'

/**
 * Version of this derivation RECIPE, distinct from the table generation. A change to how a
 * variant is assembled (which fields are rebuilt, how the target is located) bumps this; a
 * change to WHAT is substituted bumps `ADVERSARIAL_TABLE_VERSION`.
 */
export const ADVERSARIAL_GENERATOR_VERSION = 1

/**
 * Recorded default cap on how many seeds one refresh derives from (D-04). The rationale sits
 * beside `GATE1_DEFAULT_MAX_SCREENS` / `GATE2_DEFAULT_MAX_ABLATIONS`: a refresh over a grown
 * corpus must be bounded work, and the seeds it does not reach are COUNTED and wait for the
 * next one rather than being dropped.
 */
export const ADVERSARIAL_DEFAULT_MAX_SEEDS_PER_REFRESH = 25

/**
 * The families this plan's engine derives. The other frozen families are shipped in
 * `ADVERSARIAL_TABLES` under the D-22 bar and skipped with a typed reason until a later plan
 * adds their transform together with the cells that prove it preserves gold identity.
 */
export const ADVERSARIAL_GENERATED_MUTATORS = [
  'confusable',
  'injection-template',
] as const satisfies readonly AdversarialMutator[]

/** One candidate seed, as read through the proposer-visible corpus port. */
export interface AdversarialSeed {
  cassette: LeafCassette
  entry: CorpusEntry
  /** The seed's effective standalone label — the gold the derived record clones (D-06). */
  label?: StandaloneLabelRecord
}

export type AdversarialSeedSkipReason =
  | 'not-natural'
  | 'brief-not-proof-backed'
  | 'gold-anchor-absent'
  | 'gold-anchor-unresolved'
  | 'seed-label-absent'
  | 'target-name-empty'
  | 'mutator-not-generated'
  | 'no-table-entry-applies'
  | 'already-derived'
  | 'cap-exceeded'

/** An honest row for every seed × mutator pair that produced no variant. */
export interface AdversarialSeedSkip {
  seedCassetteId: string
  mutator?: AdversarialMutator
  reason: AdversarialSeedSkipReason
}

/** One derived case: the three committed documents plus the provenance that explains them. */
export interface AdversarialVariant {
  cassette: LeafCassette
  corpusEntry: AdversarialCorpusEntry
  labelRecord: StandaloneLabelRecord
  generator: CorpusGenerator
  seedCassetteId: string
  mutator: AdversarialMutator
  /** Disclosure of the drawn table entry; never part of the derived identity (D-08). */
  tableEntryId: string
  /** The blob closure the derived cassette inherits, by content address only. */
  blobShas: readonly string[]
}

export interface GenerateAdversarialVariantsInput {
  product: string
  seeds: readonly AdversarialSeed[]
  /** Defaults to `ADVERSARIAL_GENERATED_MUTATORS`. */
  mutators?: readonly AdversarialMutator[]
  /** Derived ids already staged or committed; D-04's idempotence key. */
  existingCassetteIds?: ReadonlySet<string>
  maxSeeds?: number
}

export interface GenerateAdversarialVariantsResult {
  variants: readonly AdversarialVariant[]
  skips: readonly AdversarialSeedSkip[]
  /** Eligible seeds this call actually derived from. */
  seedsConsidered: number
  /** Eligible seeds the cap deferred to the next refresh (D-04). */
  seedsDeferred: number
}

/**
 * The derived cassette identity (D-08). It is a function of the SEED, the kind, the family
 * and the table GENERATION — never of the drawn entry — so re-running a refresh under an
 * unchanged generation re-derives the same id and admits nothing twice, while a
 * `tableVersion` bump addresses a new generation beside the old one.
 */
export function deriveAdversarialCassetteId(input: {
  seedCassetteId: string
  kind: CorpusGenerator['kind']
  mutator: AdversarialMutator
  tableVersion: number
}): string {
  return sha256hex(
    canonicalJson({
      base: input.seedCassetteId,
      kind: input.kind,
      mutator: input.mutator,
      tableVersion: input.tableVersion,
    }),
  )
}

/** Locate the element the gold anchor names; `undefined` when the anchor does not resolve. */
function locateAnchoredElement(
  state: ScreenState,
  anchor: GoldAnchorDescriptor,
): { element: ElementInfo; index: number } | undefined {
  let seen = 0
  for (const [index, element] of state.elements.entries()) {
    if (element.role !== anchor.role) continue
    if (normalizeAccessibleName(element.name) !== anchor.nameNormalized) continue
    if (seen === anchor.ordinal) return { element, index }
    seen += 1
  }
  return undefined
}

/** Apply one drawn table entry to the target text. */
function applyTableEntry(
  mutator: AdversarialMutator,
  entry: AdversarialTableEntry,
  name: string,
): string | undefined {
  const family = ADVERSARIAL_TABLES[mutator]
  if (family.application === 'append') return `${name} ${entry.to}`
  if (family.application === 'substitute') {
    if (entry.from === undefined) return undefined
    const at = name.indexOf(entry.from)
    if (at < 0) return undefined
    return name.slice(0, at) + entry.to + name.slice(at + entry.from.length)
  }
  return undefined
}

/** Entries whose application actually changes this target; an empty list is a typed skip. */
function applicableEntries(
  mutator: AdversarialMutator,
  name: string,
): readonly AdversarialTableEntry[] {
  return ADVERSARIAL_TABLES[mutator].entries.filter(entry => {
    const applied = applyTableEntry(mutator, entry, name)
    return applied !== undefined && applied !== name
  })
}

function isGenerated(mutator: AdversarialMutator): boolean {
  return (ADVERSARIAL_GENERATED_MUTATORS as readonly AdversarialMutator[]).includes(mutator)
}

/** D-07: the seeded stream is keyed by seed, family and table generation — nothing else. */
function drawEntry(
  seedCassetteId: string,
  mutator: AdversarialMutator,
  entries: readonly AdversarialTableEntry[],
): AdversarialTableEntry {
  const rng = createSeededRng(`${seedCassetteId} ${mutator} ${ADVERSARIAL_TABLE_VERSION}`)
  return entries[rng.nextInt(0, entries.length - 1)]!
}

/** Does this cassette carry the proof-backed populated brief D-07 requires of a seed? */
function isProofBacked(cassette: LeafCassette): boolean {
  const brief = cassette.input.servedBrief
  if (brief.proof === undefined) return false
  return brief.channel1.length + brief.channel2.length + brief.channel3.length > 0
}

interface DerivedCassette {
  cassette: LeafCassette
  mutatedName: string
}

function deriveCassette(
  seed: LeafCassette,
  anchor: GoldAnchorDescriptor,
  located: { element: ElementInfo; index: number },
  mutatedName: string,
  cassetteId: string,
): DerivedCassette {
  const mutatedNormalized = normalizeAccessibleName(mutatedName)
  const originalName = located.element.name
  const elements = seed.input.stateBefore.elements.map((element, index) =>
    index === located.index
      ? { ...element, name: mutatedName, nameNormalized: mutatedNormalized }
      : element,
  )
  // The rendered tree is what the planner actually reads. Replacing the exact recorded name
  // keeps the structured elements and the prose surface telling the same story; a tree that
  // still said "Continue" while the element said otherwise would test nothing.
  const tree =
    originalName === '' ? seed.input.stateBefore.tree : seed.input.stateBefore.tree.split(originalName).join(mutatedName)
  const stateBefore: ScreenState = { ...seed.input.stateBefore, elements, tree }
  const input = { ...seed.input, stateBefore }
  const retarget = (descriptor: GoldAnchorDescriptor): GoldAnchorDescriptor =>
    descriptor.role === anchor.role &&
    descriptor.nameNormalized === anchor.nameNormalized &&
    descriptor.ordinal === anchor.ordinal
      ? { ...descriptor, nameNormalized: mutatedNormalized }
      : descriptor
  const sidecar = {
    ...seed.sidecar,
    goldAnchor: retarget(anchor),
    equivalenceSet: seed.sidecar.equivalenceSet.map(retarget),
  }
  return {
    mutatedName,
    cassette: {
      ...seed,
      id: cassetteId,
      input,
      sidecar,
      // The label LEG is the as-extracted snapshot and is copied verbatim (D-01 store law);
      // the authoritative derived label is the standalone record beside it.
      label: { ...seed.label },
      receipt: {
        ...seed.receipt,
        promptInputHash: sha256hex(canonicalizeInputLeg(input)),
        screenStateHash: screenStateHash(stateBefore),
      },
    },
  }
}

/**
 * Derive one variant per eligible `(seed, mutator)` pair (D-07: exactly one, never N).
 *
 * Everything that does not produce a variant produces a SKIP row. That is the contract the
 * staging report and the census read: a refresh that stages nothing must be able to say why,
 * seed by seed, rather than reporting an empty batch.
 */
export function generateAdversarialVariants(
  input: GenerateAdversarialVariantsInput,
): GenerateAdversarialVariantsResult {
  const mutators = input.mutators ?? ADVERSARIAL_GENERATED_MUTATORS
  const existing = input.existingCassetteIds ?? new Set<string>()
  const maxSeeds = input.maxSeeds ?? ADVERSARIAL_DEFAULT_MAX_SEEDS_PER_REFRESH
  const variants: AdversarialVariant[] = []
  const skips: AdversarialSeedSkip[] = []

  // Deterministic seed order: the cap must defer the SAME seeds on two runs over one corpus.
  const ordered = [...input.seeds].sort((left, right) =>
    left.cassette.id < right.cassette.id ? -1 : left.cassette.id > right.cassette.id ? 1 : 0,
  )

  let considered = 0
  let deferred = 0
  for (const seed of ordered) {
    const seedCassetteId = seed.cassette.id
    if (seed.entry.split !== 'natural') {
      skips.push({ seedCassetteId, reason: 'not-natural' })
      continue
    }
    if (!isProofBacked(seed.cassette)) {
      skips.push({ seedCassetteId, reason: 'brief-not-proof-backed' })
      continue
    }
    const anchor = seed.cassette.sidecar.goldAnchor
    if (anchor === undefined) {
      skips.push({ seedCassetteId, reason: 'gold-anchor-absent' })
      continue
    }
    const located = locateAnchoredElement(seed.cassette.input.stateBefore, anchor)
    if (located === undefined) {
      skips.push({ seedCassetteId, reason: 'gold-anchor-unresolved' })
      continue
    }
    if (seed.label === undefined) {
      skips.push({ seedCassetteId, reason: 'seed-label-absent' })
      continue
    }
    if (located.element.name.trim() === '') {
      skips.push({ seedCassetteId, reason: 'target-name-empty' })
      continue
    }
    if (considered >= maxSeeds) {
      deferred += 1
      skips.push({ seedCassetteId, reason: 'cap-exceeded' })
      continue
    }
    considered += 1

    for (const mutator of mutators) {
      if (!isGenerated(mutator)) {
        skips.push({ seedCassetteId, mutator, reason: 'mutator-not-generated' })
        continue
      }
      const kind = ADVERSARIAL_TABLES[mutator].kind
      const cassetteId = deriveAdversarialCassetteId({
        seedCassetteId,
        kind,
        mutator,
        tableVersion: ADVERSARIAL_TABLE_VERSION,
      })
      if (existing.has(cassetteId)) {
        skips.push({ seedCassetteId, mutator, reason: 'already-derived' })
        continue
      }
      const entries = applicableEntries(mutator, located.element.name)
      if (entries.length === 0) {
        skips.push({ seedCassetteId, mutator, reason: 'no-table-entry-applies' })
        continue
      }
      const tableEntry = drawEntry(seedCassetteId, mutator, entries)
      const mutatedName = applyTableEntry(mutator, tableEntry, located.element.name)!
      const derived = deriveCassette(seed.cassette, anchor, located, mutatedName, cassetteId)
      const generator: CorpusGenerator = {
        kind,
        seedCassetteId,
        generatorVersion: ADVERSARIAL_GENERATOR_VERSION,
        mutator,
        tableVersion: ADVERSARIAL_TABLE_VERSION,
        tableHash: ADVERSARIAL_TABLE_HASH,
      }
      const corpusEntry = projectCorpusEntry({
        cassette: derived.cassette,
        product: input.product,
        // D-06: the SEED's run, so ROOT-03 keeps excluding the breeding run from gating.
        runId: seed.entry.run_links.runId,
        assignment: { split: 'adversarial', generator },
        ...(seed.entry.captured_at === undefined ? {} : { capturedAt: seed.entry.captured_at }),
        ...(seed.entry.targetEnvironment === undefined
          ? {}
          : { targetEnvironment: seed.entry.targetEnvironment }),
      }) as AdversarialCorpusEntry
      variants.push({
        cassette: derived.cassette,
        corpusEntry,
        labelRecord: deriveAdversarialLabel({
          cassette: derived.cassette,
          seedLabel: seed.label,
          generator,
        }),
        generator,
        seedCassetteId,
        mutator,
        tableEntryId: tableEntry.id,
        blobShas: [...derived.cassette.blobs],
      })
    }
  }

  return { variants, skips, seedsConsidered: considered, seedsDeferred: deferred }
}
