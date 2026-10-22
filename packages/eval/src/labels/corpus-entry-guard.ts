/**
 * The one corpus-entry guard: the read leg, the census and the `/reader` port
 * all admit bytes through this schema. A corpus entry is read only at
 * schemaVersion 2.
 *
 * The schema is a strict discriminated union on `split` whose `run_links`
 * carries exactly `runId` and `runSlug`, so any path field is refused
 * structurally, and the presence rules for `heldOutVisibility` and
 * `generator` fall out of the arms in both directions.
 */
import { z } from 'zod'
import { BENEFITS } from '@vostride/agent-qa-schema'
import type {
  CorpusEntry,
  CorpusGenerator,
  HeldOutVisibility,
  TargetEnvironment,
} from './corpus-entry'
import {
  ADVERSARIAL_MUTATORS,
  GENERATOR_KINDS,
  generatorProvenance,
  HELD_OUT_VISIBILITIES,
} from './corpus-entry'

const LOWER_HEX_64 = /^[0-9a-f]{64}$/
const digestSchema = z
  .string()
  .regex(LOWER_HEX_64, 'must be a 64-character lowercase hexadecimal digest')

/** Two fields, strict: nothing shaped like a path can pass. */
const runLinksSchema = z.object({ runId: z.string(), runSlug: z.string() }).strict()

const baseShape = {
  source: z.literal('canary-feedback').optional(),
  attributedObservationId: z.string().min(1).optional(),
  benefit: z.enum(BENEFITS).optional(),
  schemaVersion: z.literal(2),
  cassetteId: z.string(),
  product: z.string(),
  captured_at_ordinal: z.number().int().nonnegative(),
  run_links: runLinksSchema,
  receiptDigest: digestSchema,
  captured_at: z.iso.datetime().optional(),
  targetEnvironment: z.enum(['shared', 'local', 'production']).optional(),
}

const naturalArmSchema = z
  .object({ ...baseShape, split: z.literal('natural') })
  .strict()

const heldOutArmSchema = z
  .object({
    ...baseShape,
    split: z.literal('held-out'),
    heldOutVisibility: z.enum(HELD_OUT_VISIBILITIES),
  })
  .strict()

const adversarialArmSchema = z
  .object({
    ...baseShape,
    split: z.literal('adversarial'),
    // 2026-09-11, 422 D-05/D-08: three ADDITIVE-OPTIONAL generator fields. Strict keeps
    // the admission narrow in BOTH directions — a pre-422 entry naming none of them still
    // parses (old bytes stay readable), and an entry naming an unknown mutator or a
    // non-digest table hash is refused with an issue path naming the offending field
    // rather than collapsing into an `invalid_union` at <root>.
    generator: z
      .object({
        kind: z.enum(GENERATOR_KINDS),
        seedCassetteId: z.string(),
        generatorVersion: z.number().int().nonnegative(),
        mutator: z.enum(ADVERSARIAL_MUTATORS).optional(),
        tableVersion: z.number().int().nonnegative().optional(),
        tableHash: digestSchema.optional(),
        // 2026-09-11, 422-04 D-11/D-12: the probe half's provenance. Both fields are
        // ADDITIVE-OPTIONAL for the same reason the table triple is — zero committed entries
        // carry them before 422, so no CORPUS_ENTRY_SCHEMA_VERSION bump is owed. `min(1)` on
        // each string is what stops an unidentified author being recorded as an identified
        // one: D-11 requires every LLM-derived entry to NAME its author, and an empty string
        // is a name-shaped absence.
        authoringModel: z
          .object({ id: z.string().min(1), family: z.string().min(1) })
          .strict()
          .optional(),
        promptVersion: z.number().int().positive().optional(),
      })
      .strict()
      // 2026-09-11, 422-04: the admission is COMPLETE-FOR-YOUR-KIND, delegated to the one
      // completeness rule in `corpus-entry.ts` rather than re-spelled here.
      //
      // 422-02 required all three table fields or none. That rule was right while one engine
      // minted every adversarial entry; two now do, and they stamp different provenance. The
      // rule therefore generalised rather than relaxed: `absent` is still the pre-422 shape and
      // still admissible, a partial stamp is still refused, and the widening ADDED a direction
      // the old refine could not express — a stamp that is complete but belongs to the OTHER
      // path. A `judge-targeted` entry naming a mutator claims a frozen table drew text no
      // table contains; a `confusable` entry naming an authoring model credits a model for a
      // pure substitution. Both parse field-by-field and both are false.
      .refine(
        generator => {
          const provenance = generatorProvenance(generator as CorpusGenerator)
          return provenance !== 'malformed'
        },
        {
          message:
            'generator must name provenance complete for its kind: mutator, tableVersion and ' +
            'tableHash for a table family; authoringModel and promptVersion for a probe kind; ' +
            'or none of them for a pre-422 entry',
        },
      ),
  })
  .strict()

export const corpusEntrySchema = z.discriminatedUnion('split', [
  naturalArmSchema,
  heldOutArmSchema,
  adversarialArmSchema,
])

export type CorpusEntryParse =
  | { ok: true; schemaVersion: 2; entry: CorpusEntry }
  | { ok: false; issues: string }

/** Same refusal-row shape the read leg has always used: `path: message; …`. */
function issueText(error: z.ZodError): string {
  return error.issues
    .map(
      (issue) => `${issue.path.length === 0 ? '<root>' : issue.path.join('.')}: ${issue.message}`,
    )
    .join('; ')
}

/** Read the document's declared version without trusting its shape. */
function declaredSchemaVersion(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return (value as Record<string, unknown>).schemaVersion
}

/** Widen a parsed arm to the declared entry union. */
function asEntry(data: z.infer<typeof corpusEntrySchema>): CorpusEntry {
  const base = {
    ...(data.source === undefined ? {} : { source: data.source }),
    ...(data.attributedObservationId === undefined ? {} : { attributedObservationId: data.attributedObservationId }),
    ...(data.benefit === undefined ? {} : { benefit: data.benefit }),
    schemaVersion: 2 as const,
    cassetteId: data.cassetteId,
    product: data.product,
    captured_at_ordinal: data.captured_at_ordinal,
    run_links: { runId: data.run_links.runId, runSlug: data.run_links.runSlug },
    receiptDigest: data.receiptDigest,
    ...(data.captured_at === undefined ? {} : { captured_at: data.captured_at }),
    ...(data.targetEnvironment === undefined
      ? {}
      : { targetEnvironment: data.targetEnvironment as TargetEnvironment }),
  }
  if (data.split === 'held-out') {
    return { ...base, split: 'held-out', heldOutVisibility: data.heldOutVisibility as HeldOutVisibility }
  }
  if (data.split === 'adversarial') {
    return { ...base, split: 'adversarial', generator: data.generator }
  }
  return { ...base, split: 'natural' }
}

/**
 * Admit a value as a corpus entry. Never throws: a malformed document is
 * data, and the read leg turns the refusal into a row.
 */
export function parseCorpusEntry(value: unknown): CorpusEntryParse {
  if (declaredSchemaVersion(value) !== 2) {
    return { ok: false, issues: '<root>: not a corpus entry (schemaVersion must be 2)' }
  }
  const parsed = corpusEntrySchema.safeParse(value)
  if (!parsed.success) return { ok: false, issues: issueText(parsed.error) }
  return { ok: true, schemaVersion: 2, entry: asEntry(parsed.data) }
}

/** Throwing form for call sites where a malformed entry is a caller bug. */
export function guardCorpusEntry(value: unknown): CorpusEntry {
  const parsed = parseCorpusEntry(value)
  if (!parsed.ok) throw new TypeError(`corpus entry rejected: ${parsed.issues}`)
  return parsed.entry
}
