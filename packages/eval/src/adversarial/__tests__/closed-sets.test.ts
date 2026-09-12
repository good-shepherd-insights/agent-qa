/**
 * 422-22-T1 — the RUNTIME half of the adversarial closed-set oracle.
 *
 * WHY THIS FILE EXISTS AT ALL. Phase 422 introduced or widened a handful of persisted
 * vocabularies across the adversarial split, and a vocabulary that is only pinned by the
 * `satisfies` clause beside it is pinned in ONE direction: `satisfies` refuses a list member the
 * union lacks, and says nothing at all about a union member the list lacks, or about a union that
 * GREW. The reverse direction has to come from somewhere that does not read the union.
 *
 * EVERY EXPECTATION BELOW IS HAND-SPELLED. Not one cell builds its expected set by iterating,
 * mapping or spreading the production constant it is checking. A cell that did would agree with
 * the constant however both of them change — the classic tautology this phase has already tripped
 * over once — so the words are typed out as literals, in the order the production list declares
 * them, and a second cell sorts both sides so a re-ordering cannot masquerade as a match.
 *
 * THE TYPE HALF IS A SEPARATE ORACLE, NOT A SECOND VIEW OF THIS ONE. `closed-sets.test-d.ts`
 * states the same sets AGAIN, as unions, with `Exclude<...>` never-bars in both directions. The
 * two files share no fixture and no helper deliberately: two oracles reading one fixture are one
 * oracle, and the point is that they can disagree with the source AND with each other.
 *
 * NOTHING HERE CALLS A PROVIDER, READS A FILE OR TOUCHES A CLOCK.
 */
import { describe, expect, it } from 'vitest'

import { CASSETTE_SCHEMA_VERSION } from '../../cassette/cassette'
import { LABEL_SOURCE_CHANNELS, LABEL_TIERS } from '../../cassette/label-leg'
import { guardCorpusEntry, parseCorpusEntry } from '../../labels/corpus-entry-guard'
import {
  ADVERSARIAL_MUTATORS,
  CORPUS_ENTRY_SCHEMA_VERSION,
  GENERATOR_KINDS,
  GENERATOR_PROVENANCES,
  PROBE_GENERATOR_KINDS,
} from '../../labels/corpus-entry'
import { LABEL_RECORD_SCHEMA_VERSION } from '../../labels/label-record'
import {
  ADVERSARIAL_CAP_SOURCES,
  ADVERSARIAL_GENERATED_MUTATORS,
  ADVERSARIAL_GENERATOR_VERSION,
  ADVERSARIAL_INAPPLICABILITIES,
  ADVERSARIAL_PUBLICATIONS,
  ADVERSARIAL_ROW_STATUSES,
  adversarialRowStatus,
  GENERATION_OUTCOMES,
} from '../generate'
import type { AdversarialGenerationOutcome, AdversarialInapplicability } from '../generate'
import { ADVERSARIAL_PROMPT_VERSION } from '../probe-prompt'
import {
  NO_PROBE_MODEL_REASONS,
  PROBE_INAPPLICABILITIES,
  PROBE_REFUSALS,
  PROBE_RESERVATION_STATUSES,
  probeReservationStatus,
} from '../probes'
import {
  ADVERSARIAL_TABLE_HASH,
  ADVERSARIAL_TABLE_HASHES,
  ADVERSARIAL_TABLE_VERSION,
  computeAdversarialTableHash,
} from '../tables'

// ---------------------------------------------------------------------------------------
// The independent spellings. Every literal below was typed out by hand from the D-05/D-09/
// D-11/D-13/D-17 decisions, NOT copied from the production constant it measures. They are
// `readonly string[]` rather than `as const` on purpose: a literal-typed expectation would let
// TypeScript relate it to the production union, and the whole value of this file is that the
// comparison happens at run time between two independently authored lists of plain strings.
// ---------------------------------------------------------------------------------------

const EXPECTED_GENERATION_OUTCOMES: readonly string[] = ['derived', 'inapplicable']

const EXPECTED_ROW_STATUSES: readonly string[] = [
  'staged',
  'unchanged',
  'refusal',
  'inapplicable',
  'interrupted',
  'failed',
]

const EXPECTED_PUBLICATIONS: readonly string[] = [
  'published',
  'refused',
  'interrupted',
  'failed',
]

const EXPECTED_CAP_SOURCES: readonly string[] = ['default', 'config', 'flag']

const EXPECTED_RESERVATION_STATUSES: readonly string[] = [
  'unattempted',
  'interrupted',
  'completed',
]

const EXPECTED_MUTATORS: readonly string[] = [
  'confusable',
  'invisible',
  'tag-block',
  'injection-template',
  'benign-case',
  'benign-whitespace',
  'benign-punctuation',
  'benign-digit',
  'benign-truncate',
  'benign-plural',
  'benign-synonym',
]

const EXPECTED_INAPPLICABILITIES: readonly string[] = [
  'seed-malformed',
  'not-natural',
  'brief-not-proof-backed',
  'gold-anchor-absent',
  'gold-anchor-unresolved',
  'seed-label-absent',
  'target-name-empty',
  'cap-exceeded',
  'mutator-not-generated',
  'no-table-entry-applies',
  'benign-surface-absent',
  'hostile-identity-unchanged',
  'already-derived',
]

const EXPECTED_GENERATOR_KINDS: readonly string[] = [
  'fuzz-selector',
  'fuzz-label',
  'fuzz-error',
  'injection-name',
  'optimized-trigger',
  'judge-targeted',
]

const EXPECTED_LABEL_CHANNELS: readonly string[] = [
  'recorded-verdict',
  'user-mark',
  'overturned-verdict',
  'self-heal-pair',
]

/** A pure helper for the closed-set shape assertion. Takes plain strings on both sides. */
function pinsExactly(actual: readonly string[], expected: readonly string[]): void {
  // Declaration order first: for several of these sets the order IS the contract (the gap
  // reasons are a precedence chain, the mutators are the emission order of a refresh report).
  expect([...actual]).toEqual([...expected])
  // Then membership independent of order, so a re-ordering above cannot be the only difference
  // a future edit has to survive.
  expect([...actual].sort()).toEqual([...expected].sort())
  // And the count, stated as a number a human reads in the plan: "eleven families", "six kinds".
  expect(actual.length).toBe(expected.length)
}

describe('422-22 the derivation-outcome vocabulary', () => {
  it('is exactly the two words one (seed, mutator) pair can answer', () => {
    pinsExactly(GENERATION_OUTCOMES, EXPECTED_GENERATION_OUTCOMES)
  })

  it('is the discriminant the engine actually emits, not a parallel spelling', () => {
    // The list is only worth anything if it names what `generateAdversarialVariants` produces.
    // Both arms are constructed here as values and their discriminants read back, so a rename
    // on either side REDs — which a list compared against another list could not catch.
    const derived = { kind: 'derived' } as Pick<AdversarialGenerationOutcome, 'kind'>
    const inapplicable = { kind: 'inapplicable' } as Pick<AdversarialGenerationOutcome, 'kind'>
    expect([derived.kind, inapplicable.kind].sort()).toEqual(
      [...EXPECTED_GENERATION_OUTCOMES].sort(),
    )
  })
})

describe('422-22 the staging-report row vocabulary', () => {
  it('is exactly the six terminal words a report row can carry', () => {
    pinsExactly(ADVERSARIAL_ROW_STATUSES, EXPECTED_ROW_STATUSES)
  })

  it('is exactly the four publication answers a derived row can meet', () => {
    pinsExactly(ADVERSARIAL_PUBLICATIONS, EXPECTED_PUBLICATIONS)
  })

  it('reads a derived row through its publication and nothing else', () => {
    const outcome = { kind: 'derived' } as AdversarialGenerationOutcome
    expect(adversarialRowStatus({ outcome })).toBe('staged')
    expect(adversarialRowStatus({ outcome, publication: 'published' })).toBe('staged')
    expect(adversarialRowStatus({ outcome, publication: 'refused' })).toBe('refusal')
    expect(adversarialRowStatus({ outcome, publication: 'interrupted' })).toBe('interrupted')
    expect(adversarialRowStatus({ outcome, publication: 'failed' })).toBe('failed')
  })

  it('reads an ALREADY-DERIVED row as unchanged and every other one as inapplicable', () => {
    // The one rule in this mapping that is content rather than a rename: a tuple this
    // generation already addresses is not a case the refresh could not handle, it is a case
    // the corpus already has. Reporting it as `inapplicable` beside a malformed seed would put
    // an idempotent no-op and a broken document in one bucket.
    const unchanged: AdversarialGenerationOutcome = {
      kind: 'inapplicable',
      seedCassetteId: 'seed-1',
      reason: 'already-derived',
    }
    expect(adversarialRowStatus({ outcome: unchanged })).toBe('unchanged')

    for (const reason of EXPECTED_INAPPLICABILITIES) {
      if (reason === 'already-derived') continue
      const outcome: AdversarialGenerationOutcome = {
        kind: 'inapplicable',
        seedCassetteId: 'seed-1',
        reason: reason as AdversarialInapplicability,
      }
      expect(adversarialRowStatus({ outcome })).toBe('inapplicable')
    }
  })

  it('never answers outside the six words, whatever it is handed', () => {
    // A total function over the cross product: every outcome arm against every publication
    // answer, asserted to land inside the hand-spelled set. An answer the vocabulary does not
    // name would be a report row no reader can render.
    const outcomes: AdversarialGenerationOutcome[] = [
      { kind: 'derived' } as AdversarialGenerationOutcome,
      ...EXPECTED_INAPPLICABILITIES.map(reason => ({
        kind: 'inapplicable' as const,
        seedCassetteId: 'seed-1',
        reason: reason as AdversarialInapplicability,
      })),
    ]
    for (const outcome of outcomes) {
      for (const publication of [undefined, ...EXPECTED_PUBLICATIONS]) {
        const status = adversarialRowStatus({
          outcome,
          ...(publication === undefined
            ? {}
            : { publication: publication as 'published' | 'refused' | 'interrupted' | 'failed' }),
        })
        expect(EXPECTED_ROW_STATUSES).toContain(status)
      }
    }
  })
})

describe('422-22 the cap-source vocabulary', () => {
  it('is exactly the three places a resolved cap can come from', () => {
    pinsExactly(ADVERSARIAL_CAP_SOURCES, EXPECTED_CAP_SOURCES)
  })

  it('leads with the source an operator did NOT choose', () => {
    // Declaration order is the precedence a host resolves in, read backwards: a flag beats a
    // config value, which beats the recorded default. Stating `default` first keeps the list
    // readable as "what you get if you say nothing, then what overrides it".
    expect(ADVERSARIAL_CAP_SOURCES[0]).toBe('default')
  })
})

describe('422-22 the probe-reservation vocabulary', () => {
  it('is exactly the three durable states one tuple can be in', () => {
    pinsExactly(PROBE_RESERVATION_STATUSES, EXPECTED_RESERVATION_STATUSES)
  })

  it('derives the status from the two files on disk, never from a written status field', () => {
    // THE DERIVATION IS THE POINT. The one thing a dying process cannot do is record that it
    // died, so a status field would have to be updated by the code that failed. Presence of a
    // completion beside a charge is what separates "asked and answered" from "asked and lost".
    expect(probeReservationStatus({ reservationRecorded: false, completionRecorded: false })).toBe(
      'unattempted',
    )
    expect(probeReservationStatus({ reservationRecorded: true, completionRecorded: false })).toBe(
      'interrupted',
    )
    expect(probeReservationStatus({ reservationRecorded: true, completionRecorded: true })).toBe(
      'completed',
    )
  })

  it('never reads a completion without a charge as an answer', () => {
    // A completion whose charge is missing is not a call anybody may assume was free. With no
    // reservation there is no tuple to be completed, so the honest answer is the absence one.
    expect(probeReservationStatus({ reservationRecorded: false, completionRecorded: true })).toBe(
      'unattempted',
    )
  })
})

describe('422-22 the vocabularies 422 did NOT move', () => {
  it('keeps the eleven frozen mutation families, and generates all of them', () => {
    pinsExactly(ADVERSARIAL_MUTATORS, EXPECTED_MUTATORS)
    pinsExactly(ADVERSARIAL_GENERATED_MUTATORS, EXPECTED_MUTATORS)
  })

  it('keeps the thirteen inapplicability rows a refresh can report', () => {
    pinsExactly(ADVERSARIAL_INAPPLICABILITIES, EXPECTED_INAPPLICABILITIES)
  })

  it('keeps the six generator kinds, two of them authored', () => {
    pinsExactly(GENERATOR_KINDS, EXPECTED_GENERATOR_KINDS)
    pinsExactly(PROBE_GENERATOR_KINDS, ['judge-targeted', 'optimized-trigger'])
    // The probe subset is a subset: every authored kind is one of the six, and the six did not
    // grow to accommodate them (D-05).
    for (const kind of PROBE_GENERATOR_KINDS) {
      expect(EXPECTED_GENERATOR_KINDS).toContain(kind)
    }
  })

  it('keeps the four label channels and three tiers', () => {
    pinsExactly(LABEL_SOURCE_CHANNELS, EXPECTED_LABEL_CHANNELS)
    pinsExactly(LABEL_TIERS, ['gold', 'near-gold', 'silver'])
  })

  it('keeps the four provenance dispositions and the three gap reasons', () => {
    pinsExactly(GENERATOR_PROVENANCES, ['absent', 'table', 'probe', 'malformed'])
    pinsExactly(NO_PROBE_MODEL_REASONS, [
      'panel-not-configured',
      'no-credential',
      'single-family-host',
    ])
  })

  it('keeps the seven probe inapplicabilities and seven refusals', () => {
    pinsExactly(PROBE_INAPPLICABILITIES, [
      'not-natural',
      'brief-not-proof-backed',
      'gold-anchor-absent',
      'gold-anchor-unresolved',
      'seed-label-absent',
      'target-name-empty',
      'authoring-model-unidentified',
    ])
    pinsExactly(PROBE_REFUSALS, [
      'seed-request-mismatch',
      'request-prompt-stale',
      'probe-text-empty',
      'probe-text-too-long',
      'probe-text-not-a-name',
      'probe-usage-invalid',
      'probe-identity-unchanged',
    ])
  })

  /**
   * 2026-09-12, 422-23: the bump guard `tables.ts` DOCUMENTS, finally asked.
   *
   * The file's own header states that `ADVERSARIAL_TABLE_HASHES` pins the hash of every shipped
   * generation and that "a table edit without an `ADVERSARIAL_TABLE_VERSION` bump makes the two
   * disagree and REDs the pinned-hash cell by name". No cell was asking. The prompt half of the
   * same idiom has had one since 422-04 (`probe-contract.test.ts`), and the asymmetry was invisible
   * because both halves of an unasked guard agree with themselves: `ADVERSARIAL_TABLE_HASH` is
   * `computeAdversarialTableHash()` by construction, so comparing THOSE two proves nothing.
   *
   * The literal is what makes this bite. Generation 2's digest is spelled out here, so a silent
   * edit to any family — including a change to an entry `id`, which is DISCLOSURE only and alters
   * no derivation — reds this cell rather than re-addressing committed variants in silence.
   */
  it('pins every shipped table generation by hash, so a table edit without a bump reds here', () => {
    expect(ADVERSARIAL_TABLE_HASHES[1]).toBe(
      '1e7d73bd713c068050c9a94b06dd30e3569970043a97604368a16a1fe1e0d178',
    )
    expect(ADVERSARIAL_TABLE_HASHES[2]).toBe(
      'e98c576592b28ed06ab528f6fe40bac8a311cf49473e0fbb3fd2ac76395020a8',
    )
    // History is ADDED to and never replaced: every shipped generation keeps a pin, and the
    // CURRENT one must still be the hash this build actually computes.
    for (let version = 1; version <= ADVERSARIAL_TABLE_VERSION; version += 1) {
      expect(ADVERSARIAL_TABLE_HASHES[version], `generation ${version}`).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(computeAdversarialTableHash()).toBe(ADVERSARIAL_TABLE_HASHES[ADVERSARIAL_TABLE_VERSION])
    expect(ADVERSARIAL_TABLE_HASH).toBe(computeAdversarialTableHash())
  })

  it('bumps no persisted document version', () => {
    // Every one of these is a number a committed file carries. 422-22 declares vocabulary and
    // must move none of them: a bump owes every historical row a migration, and nothing here
    // changes what a historical row means.
    expect(CORPUS_ENTRY_SCHEMA_VERSION).toBe(2)
    expect(LABEL_RECORD_SCHEMA_VERSION).toBe(1)
    expect(CASSETTE_SCHEMA_VERSION).toBe(2)
    expect(ADVERSARIAL_TABLE_VERSION).toBe(2)
    expect(ADVERSARIAL_GENERATOR_VERSION).toBe(2)
    expect(ADVERSARIAL_PROMPT_VERSION).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------
// The refusal half. A vocabulary is only closed if the PUBLIC PARSER refuses a word outside
// it — a pinned list beside a parser that accepts anything is decoration.
// ---------------------------------------------------------------------------------------

const DIGEST = 'a'.repeat(64)

/** A minimal committed adversarial entry, assembled field-by-field rather than projected. */
function adversarialEntry(generator: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 2,
    cassetteId: 'cas-derived',
    product: 'demo',
    split: 'adversarial',
    captured_at_ordinal: 3,
    run_links: { runId: 'run-1', runSlug: 'run-1' },
    receiptDigest: DIGEST,
    generator,
  }
}

describe('422-22 the public parsers refuse a word outside the vocabulary', () => {
  it('admits an entry whose family is one of the eleven', () => {
    for (const mutator of EXPECTED_MUTATORS) {
      const entry = guardCorpusEntry(
        adversarialEntry({
          kind: 'fuzz-label',
          seedCassetteId: 'cas-seed',
          generatorVersion: 2,
          mutator,
          tableVersion: 2,
          tableHash: DIGEST,
        }),
      )
      expect(entry.split).toBe('adversarial')
    }
  })

  it('refuses an entry naming a twelfth family, with an issue naming the field', () => {
    const parsed = parseCorpusEntry(
      adversarialEntry({
        kind: 'fuzz-label',
        seedCassetteId: 'cas-seed',
        generatorVersion: 2,
        mutator: 'benign-homoglyph',
        tableVersion: 2,
        tableHash: DIGEST,
      }),
    )
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues).toContain('mutator')
  })

  it('refuses a seventh generator kind', () => {
    const parsed = parseCorpusEntry(
      adversarialEntry({
        kind: 'probe-authored',
        seedCassetteId: 'cas-seed',
        generatorVersion: 2,
      }),
    )
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.issues).toContain('kind')
  })

  it('refuses malformed optional provenance rather than fabricating the absent field', () => {
    // Two directions, both of which parse field-by-field and both of which are false: a table
    // stamp missing a member, and a stamp complete for the OTHER derivation path.
    const partial = parseCorpusEntry(
      adversarialEntry({
        kind: 'fuzz-label',
        seedCassetteId: 'cas-seed',
        generatorVersion: 2,
        mutator: 'confusable',
        tableVersion: 2,
      }),
    )
    expect(partial.ok).toBe(false)

    const crossPath = parseCorpusEntry(
      adversarialEntry({
        kind: 'judge-targeted',
        seedCassetteId: 'cas-seed',
        generatorVersion: 2,
        mutator: 'confusable',
        tableVersion: 2,
        tableHash: DIGEST,
      }),
    )
    expect(crossPath.ok).toBe(false)
  })

  it('still admits the pre-422 stamp that names none of the optional fields', () => {
    const entry = guardCorpusEntry(
      adversarialEntry({ kind: 'fuzz-label', seedCassetteId: 'cas-seed', generatorVersion: 1 }),
    )
    expect(entry.split).toBe('adversarial')
    if (entry.split === 'adversarial') {
      expect(entry.generator.mutator).toBeUndefined()
      expect(entry.generator.authoringModel).toBeUndefined()
    }
  })
})
