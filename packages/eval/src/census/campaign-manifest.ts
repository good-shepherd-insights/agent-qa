/**
 * 413 D-16 campaign manifest — the run-level tallies the static census cannot derive from the
 * committed root (ROOT-05).
 *
 * WHY A SEPARATE DOCUMENT. `deriveCensus` folds what the committed root already states: how many
 * entries exist, which carry gold evidence, which carry a proof. It cannot state what never
 * reached the root — a run excluded under D-04 because `analyze-run` called it `flake`,
 * `environment` or `timeout`, leaves no committed entry to count. Nor can it state the campaign's
 * price: the model-call count and the token line are observed while the growth campaign runs
 * (`AGENT_QA_DEBUG_LLM=1`, the folded model-call-count todo) and are gone by the time anything
 * reads the root. The runbook therefore emits this manifest per campaign and the census folds it.
 *
 * The three folded 399 friction todos land here as fields, not prose: `modelCalls` /
 * `promptTokens` / `completionTokens` (model-call count unrecorded), `wallClockMs` per leg (the
 * ad-overlay run variance — a vignette ad turned the same assertion from 54s into 7m29s, and only
 * a per-leg wall clock makes that visible in the cost line), and `rung` (the embedder rung the run
 * was served on, recorded not re-derived).
 *
 * STRICT BY CONSTRUCTION (T-413-16). The manifest is hand-editable committed JSON that is folded
 * into committed census bytes, so every object is `.strict()` and the two vocabularies it names —
 * the verdict class and the verdict producer (D-04) — are bound to the schema package's own
 * exports rather than re-spelled here. A widened or misspelt field is a `TypeError`, never a
 * silently dropped tally.
 *
 * Pure: no IO, no clock. `CampaignManifest['legs']` is structurally assignable to
 * `CensusCampaignInput['legs']` (derive-census.ts) — the census stays independent of this module.
 */
import { RecordedRetrievalRungSchema, VERDICT_CLASSES } from '@vostride/agent-qa-schema'
import { z } from 'zod'

/** Single version gate for the campaign manifest document (D-16). */
export const CAMPAIGN_MANIFEST_SCHEMA_VERSION = 1 as const

/** The two producers that can author a run verdict (D-04, mirrors `Verdict['producer']`). */
const CAMPAIGN_VERDICT_PRODUCERS = ['deterministic-classifier', 'analyze-run'] as const

const campaignVerdictSchema = z
  .object({
    class: z.enum(VERDICT_CLASSES),
    producer: z.enum(CAMPAIGN_VERDICT_PRODUCERS),
  })
  .strict()

/**
 * One live run of the growth campaign. `excluded` and `seeded` are the runbook's recorded
 * decision, not a re-derivation from `verdicts` — D-04's filter runs before the commit and the
 * manifest states what it did, so the census counts the campaign that happened.
 */
export const campaignLegSchema = z
  .object({
    testId: z.string(),
    testFile: z.string(),
    product: z.string(),
    runSlug: z.string(),
    repeat: z.number().int().nonnegative(),
    exitCode: z.number().int(),
    aggregateVerdict: z.string(),
    verdicts: z.array(campaignVerdictSchema),
    excluded: z.boolean(),
    seeded: z.boolean(),
    wallClockMs: z.number().nonnegative(),
    modelCalls: z.number().int().nonnegative(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    steps: z.number().int().nonnegative(),
    proofSteps: z.number().int().nonnegative(),
    rung: RecordedRetrievalRungSchema.optional(),
  })
  .strict()

/** The whole campaign as one committed document; `legs: []` is a real campaign that ran nothing. */
export const campaignManifestSchema = z
  .object({
    schemaVersion: z.literal(CAMPAIGN_MANIFEST_SCHEMA_VERSION),
    phase: z.string(),
    submoduleHead: z.string(),
    legs: z.array(campaignLegSchema),
  })
  .strict()

export type CampaignLeg = z.infer<typeof campaignLegSchema>
export type CampaignManifest = z.infer<typeof campaignManifestSchema>

function issuePath(path: PropertyKey[]): string {
  return path.length === 0 ? '<root>' : path.map(String).join('.')
}

/** Parse committed manifest bytes into the closed shape, or throw with every issue named. */
export function guardCampaignManifest(value: unknown): CampaignManifest {
  const parsed = campaignManifestSchema.safeParse(value)

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issuePath(issue.path)}: ${issue.message}`)
      .join('; ')
    throw new TypeError(`campaign manifest rejected: ${issues}`)
  }

  return parsed.data
}
