/**
 * The ONE corpus-entry guard (414 D-03/D-13).
 *
 * Before 414 the only zod shape for a committed corpus entry lived in
 * eval-local's read leg. 414 moves it into eval core so that the read leg,
 * the census, the `/reader` port and the migration script all admit bytes
 * through the same schema — one spelling of "is this a corpus entry".
 *
 * Two arms, one output type:
 *  - v1 (`schemaVersion: 1`) is the committed shape verbatim, including the
 *    `run_links.handoffPath` that D-13 drops. It is ACCEPTED and then
 *    DISCARDED: the parse result is a v2 `natural` entry in memory, so a v1
 *    and a v2 entry for one cassetteId are ONE shape and merge rather than
 *    collide. v1 never persists as a second live shape (D-03) — Plan 09's
 *    `--check` exits non-zero while any v1 file remains in the root.
 *  - v2 is a strict discriminated union on `split` whose `run_links` carries
 *    exactly `runId` and `runSlug`. Any path field — absolute or relative —
 *    is refused structurally (ROOT-08 SC3, T-414-01), and D-21's presence
 *    rules for `heldOutVisibility` / `generator` fall out of the arms in
 *    both directions.
 *
 * `parseCorpusEntry` dispatches on the document's own `schemaVersion` rather
 * than handing the value to `corpusEntrySchema` (the v1|v2 union) first.
 * That is deliberate: zod collapses a union failure into a single
 * `invalid_union` issue at `<root>`, which would tell a refusal row nothing
 * about WHICH field offended. Dispatching first keeps the issue path — so a
 * v2 entry smuggling a handoff path is refused with an issue naming
 * `run_links`, which is the whole point of making the ban structural.
 */
import { z } from 'zod'
import { BENEFITS } from '@vostride/agent-qa-schema'
import type {
  CorpusEntry,
  CorpusGenerator,
  HeldOutVisibility,
  NaturalCorpusEntry,
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

/**
 * The v1 committed shape, copied verbatim from the pre-414 read leg
 * (`eval-local/src/committed-corpus-source.ts`). `handoffPath` is LISTED so
 * the committed bytes parse; the normaliser then drops it (D-13).
 */
export const corpusEntryV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    cassetteId: z.string(),
    product: z.string(),
    split: z.literal('natural'),
    captured_at_ordinal: z.number(),
    run_links: z
      .object({ runId: z.string(), runSlug: z.string(), handoffPath: z.string() })
      .strict(),
    receiptDigest: z.string(),
  })
  .strict()

/**
 * D-13's structural ban: two fields, strict. Nothing shaped like a path can
 * pass, which is what makes ROOT-08 SC3 a schema property and not a regex.
 */
const runLinksV2Schema = z.object({ runId: z.string(), runSlug: z.string() }).strict()

const v2BaseShape = {
  source: z.literal('canary-feedback').optional(),
  attributedObservationId: z.string().min(1).optional(),
  benefit: z.enum(BENEFITS).optional(),
  schemaVersion: z.literal(2),
  cassetteId: z.string(),
  product: z.string(),
  captured_at_ordinal: z.number().int().nonnegative(),
  run_links: runLinksV2Schema,
  receiptDigest: digestSchema,
  captured_at: z.iso.datetime().optional(),
  targetEnvironment: z.enum(['shared', 'local']).optional(),
}

const naturalArmSchema = z
  .object({ ...v2BaseShape, split: z.literal('natural') })
  .strict()

const heldOutArmSchema = z
  .object({
    ...v2BaseShape,
    split: z.literal('held-out'),
    heldOutVisibility: z.enum(HELD_OUT_VISIBILITIES),
  })
  .strict()

const adversarialArmSchema = z
  .object({
    ...v2BaseShape,
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

export const corpusEntryV2Schema = z.discriminatedUnion('split', [
  naturalArmSchema,
  heldOutArmSchema,
  adversarialArmSchema,
])

/** Both live shapes, for callers that only need "is this any corpus entry". */
export const corpusEntrySchema = z.union([corpusEntryV1Schema, corpusEntryV2Schema])

/**
 * Parse outcome. `schemaVersion` reports the version of the BYTES, not of
 * `entry` — `entry` is always v2 (Plan 05 counts the byte versions as
 * `schemaVersionsSeen`).
 */
export type CorpusEntryParse =
  | { ok: true; schemaVersion: 1 | 2; entry: CorpusEntry }
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

/** v1 bytes become a v2 natural entry in memory; `handoffPath` is discarded (D-13). */
function normaliseV1(data: z.infer<typeof corpusEntryV1Schema>): NaturalCorpusEntry {
  return {
    schemaVersion: 2,
    cassetteId: data.cassetteId,
    product: data.product,
    split: 'natural',
    captured_at_ordinal: data.captured_at_ordinal,
    run_links: { runId: data.run_links.runId, runSlug: data.run_links.runSlug },
    receiptDigest: data.receiptDigest,
  }
}

/** Widen a parsed v2 arm to the declared entry union. */
function asV2Entry(data: z.infer<typeof corpusEntryV2Schema>): CorpusEntry {
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
 * Admit a value as a corpus entry, normalising v1 bytes to the v2 shape.
 * Never throws — a malformed document is DATA, and the read leg turns the
 * refusal into a row rather than an exception.
 */
export function parseCorpusEntry(value: unknown): CorpusEntryParse {
  const version = declaredSchemaVersion(value)

  if (version === 1) {
    const parsed = corpusEntryV1Schema.safeParse(value)
    if (!parsed.success) return { ok: false, issues: issueText(parsed.error) }
    return { ok: true, schemaVersion: 1, entry: normaliseV1(parsed.data) }
  }

  if (version === 2) {
    const parsed = corpusEntryV2Schema.safeParse(value)
    if (!parsed.success) return { ok: false, issues: issueText(parsed.error) }
    return { ok: true, schemaVersion: 2, entry: asV2Entry(parsed.data) }
  }

  // Neither literal version matched. `corpusEntrySchema` cannot admit such a
  // document, so this is always a refusal; the union is asked only so the
  // message comes from the same schema the arms do.
  const parsed = corpusEntrySchema.safeParse(value)
  const issues = parsed.success ? '' : issueText(parsed.error)
  return {
    ok: false,
    issues: issues === '' ? '<root>: not a corpus entry (schemaVersion must be 1 or 2)' : issues,
  }
}

/** Throwing form for call sites where a malformed entry is a caller bug. */
export function guardCorpusEntry(value: unknown): CorpusEntry {
  const parsed = parseCorpusEntry(value)
  if (!parsed.ok) throw new TypeError(`corpus entry rejected: ${parsed.issues}`)
  return parsed.entry
}
