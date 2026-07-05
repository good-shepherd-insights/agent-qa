import { tool } from 'ai'
import { z } from 'zod'
import type { Platform } from '@vostride/agent-qa-schema'
import { workingMemoryEntrySchema } from '@vostride/agent-qa-schema'
import { groundingError } from './errors.js'
import type { ToolRegistry } from './registry.js'
import type { ToolCategory } from './types.js'

// WM-01 write channel (D-09): remember[] rides every action tool's envelope (spec §12.15,
// ratified 2026-07-05 — NOT a tool, no ≤K interaction, catalog counts frozen). Validated with
// the closed-enum workingMemoryEntrySchema so unknown kind/provenance are rejected at parse time.
const rememberFieldSchema = z.array(workingMemoryEntrySchema).optional()

const PLAN_FIELDS = {
  reasoning: z.string().describe('Brief explanation of why this action was chosen'),
  confidence: z.number().describe('Confidence level from 0 to 1'),
  stepComplete: z.boolean().describe('Whether this action completes the step goal'),
  stepFailed: z.boolean().optional().describe('Set true when the step goal cannot be achieved'),
  doesActionAdvanceUsTowardsGoal: z.boolean().describe('True if this action moves the test toward its goal; a cheap hallucination-gate (§9.7).'),
  remember: rememberFieldSchema.describe('Record verbatim facts you will need later in the run — codes, filenames, extracted values, progress markers — BEFORE navigating away from the screen that shows them. Each item is { key, value, kind, provenance }. Omit when the current screen holds nothing you will need later.'),
  bulkCompletionPredicate: z.string().optional().describe('On entering a bulk "do X to all" step, declare the positive completion predicate (e.g. "no rows with a delete button remain") and re-state it each turn while the bulk loop runs. Omit for non-bulk steps.'),
}

function withPlanFields(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const options = schema.options.map(option => (option as z.ZodObject<any>).extend(PLAN_FIELDS))
    return z.discriminatedUnion(
      schema.def.discriminator,
      options as [z.ZodObject<any>, ...z.ZodObject<any>[]],
    )
  }

  if (schema instanceof z.ZodUnion) {
    const options = schema.options.map(option => (option as z.ZodObject<any>).extend(PLAN_FIELDS))
    return z.union(options as [z.ZodObject<any>, z.ZodObject<any>, ...z.ZodObject<any>[]])
  }

  return (schema as z.ZodObject<any>).extend(PLAN_FIELDS)
}

export { GroundingError as ToolValidationError } from './errors.js'

export function buildTools(
  registry: ToolRegistry,
  options: { platform: Platform, categories?: ToolCategory[] },
) {
  const tools: Record<string, ReturnType<typeof tool<any, any>>> = {}
  const definitions = registry.getForPlatform(options.platform)
  const filtered = options.categories
    ? definitions.filter(def => options.categories?.includes(def.category))
    : definitions

  for (const def of filtered) {
    tools[def.id] = tool({
      description: def.description,
      inputSchema: withPlanFields(def.schema),
    })
  }

  return tools
}

export function toolCallToActionPlan(
  toolId: string,
  args: Record<string, unknown>,
  registry: ToolRegistry,
) {
  // Pitfall 2: every plan-field must be destructured out of args here — anything left in
  // actionFields is fed to the strict action schema and silently stripped (or rejected), never
  // reaching the loop. remember/bulkCompletionPredicate ride the envelope alongside reasoning.
  const { reasoning, confidence, stepComplete, stepFailed, doesActionAdvanceUsTowardsGoal, remember, bulkCompletionPredicate, ...actionFields } = args
  const def = registry.get(toolId)

  if (!def) {
    throw new Error(`Unknown tool: ${toolId}`)
  }

  // Closed-enum rejection of the untrusted remember[] payload at parse time (V5); throws on an
  // unknown kind/provenance, same fail-loud contract as a bad action.
  const rememberEntries = rememberFieldSchema.parse(remember)

  const parsed = def.schema.safeParse(actionFields)

  if (!parsed.success) {
    throw groundingError.schemaInvalid(toolId, parsed.error)
  }

  return {
    reasoning: reasoning as string,
    confidence: confidence as number,
    stepComplete: stepComplete as boolean,
    stepFailed: (stepFailed as boolean | undefined) ?? false,
    doesActionAdvanceUsTowardsGoal: (doesActionAdvanceUsTowardsGoal as boolean | undefined) ?? false,
    ...(rememberEntries !== undefined ? { remember: rememberEntries } : {}),
    ...(bulkCompletionPredicate !== undefined ? { bulkCompletionPredicate: bulkCompletionPredicate as string } : {}),
    action: { type: def.type, ...(parsed.data as Record<string, unknown>) },
  }
}
