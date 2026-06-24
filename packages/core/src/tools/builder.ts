import { tool } from 'ai'
import { z } from 'zod'
import type { Platform } from '@vostride/agent-qa-schema'
import type { ToolRegistry } from './registry.js'
import type { ToolCategory } from './types.js'

const PLAN_FIELDS = {
  reasoning: z.string().describe('Brief explanation of why this action was chosen'),
  confidence: z.number().describe('Confidence level from 0 to 1'),
  stepComplete: z.boolean().describe('Whether this action completes the step goal'),
  stepFailed: z.boolean().optional().describe('Set true when the step goal cannot be achieved'),
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

export class ToolValidationError extends Error {
  toolName: string
  zodError: z.ZodError

  constructor(toolName: string, zodError: z.ZodError) {
    super(`Invalid args for tool "${toolName}": ${zodError.message}`)
    this.name = 'ToolValidationError'
    this.toolName = toolName
    this.zodError = zodError
  }
}

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
  const { reasoning, confidence, stepComplete, stepFailed, ...actionFields } = args
  const def = registry.get(toolId)

  if (!def) {
    throw new Error(`Unknown tool: ${toolId}`)
  }

  const parsed = def.schema.safeParse(actionFields)

  if (!parsed.success) {
    throw new ToolValidationError(toolId, parsed.error)
  }

  return {
    reasoning: reasoning as string,
    confidence: confidence as number,
    stepComplete: stepComplete as boolean,
    stepFailed: (stepFailed as boolean | undefined) ?? false,
    action: { type: def.type, ...(parsed.data as Record<string, unknown>) },
  }
}
