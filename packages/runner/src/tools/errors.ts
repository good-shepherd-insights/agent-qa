import type { z } from 'zod'

export type GroundingErrorCode =
  | 'schema_invalid'
  | 'ref_not_in_snapshot'
  | 'coords_out_of_bounds'
  | 'descriptor_unresolved'
  | 'descriptor_ambiguous'
  | 'descriptor_invalid'

/** The three invalid-descriptor shapes (D-04 exactly-one-of, D-13 name-less, D-06 near). */
export type DescriptorProblem = 'exactly-one' | 'name-missing' | 'near-unsupported'

interface GroundingErrorArgs {
  code: GroundingErrorCode
  toolName: string
  message: string
  hint: string
  zodError?: z.ZodError
}

export class GroundingError extends Error {
  readonly code: GroundingErrorCode
  readonly hint: string
  readonly toolName: string
  readonly zodError?: z.ZodError

  constructor(args: GroundingErrorArgs) {
    super(args.message)
    this.name = 'GroundingError'
    this.code = args.code
    this.hint = args.hint
    this.toolName = args.toolName
    this.zodError = args.zodError
  }
}

export const groundingError = {
  schemaInvalid(toolName: string, zodError: z.ZodError): GroundingError {
    return new GroundingError({
      code: 'schema_invalid',
      toolName,
      zodError,
      message: `Invalid args for tool "${toolName}": ${zodError.message}`,
      hint: 'Fix the named field(s) and re-issue the call with a schema-valid payload.',
    })
  },

  refNotInSnapshot(toolName: string, ref: string): GroundingError {
    return new GroundingError({
      code: 'ref_not_in_snapshot',
      toolName,
      message: `Ref "${ref}" is not in the current screen snapshot for tool "${toolName}".`,
      hint: 'Re-observe the screen and use a ref from the latest observation; do not reuse a stale ref.',
    })
  },

  coordsOutOfBounds(
    toolName: string,
    x: number,
    y: number,
    width: number,
    height: number,
  ): GroundingError {
    return new GroundingError({
      code: 'coords_out_of_bounds',
      toolName,
      message: `Coordinates (${x}, ${y}) for tool "${toolName}" are outside bounds ${width}x${height}.`,
      hint: 'The target may be off-screen; scroll to bring it into view because off-screen elements still have refs. Do not guess coordinates.',
    })
  },

  // §12.17 self-correcting form: a descriptor that resolved to nothing. `descriptorSummary`
  // is a pre-rendered role/name string — callers redact before rendering so the factory
  // never serializes untrusted planner objects itself (T-357-04c).
  descriptorUnresolved(toolName: string, descriptorSummary: string): GroundingError {
    return new GroundingError({
      code: 'descriptor_unresolved',
      toolName,
      message: `no element matching ${descriptorSummary} for tool "${toolName}" — re-observe or refine the descriptor`,
      hint: 'Re-observe the screen, then use a ref from the latest observation or refine the descriptor (role, name, ordinal).',
    })
  },

  // A descriptor that matched more than one element — never a silent best-guess (T-357-04a).
  descriptorAmbiguous(
    toolName: string,
    descriptorSummary: string,
    candidateCount: number,
  ): GroundingError {
    return new GroundingError({
      code: 'descriptor_ambiguous',
      toolName,
      message: `${candidateCount} elements match ${descriptorSummary} for tool "${toolName}"; the descriptor is ambiguous.`,
      hint: 'Add an ordinal, use a more specific name, or use a ref from the latest observation to select exactly one element.',
    })
  },

  // One code covering the three invalid-descriptor shapes (D-04 / D-13 / D-06).
  descriptorInvalid(toolName: string, problem: DescriptorProblem): GroundingError {
    const messages: Record<DescriptorProblem, string> = {
      'exactly-one': 'provide exactly one of ref or target',
      'name-missing': 'the descriptor needs a name — refine the descriptor or use a ref',
      'near-unsupported': 'near is not supported yet — use name, role, or ordinal',
    }
    const hints: Record<DescriptorProblem, string> = {
      'exactly-one':
        'Populate exactly one of ref (a committed ref from the latest observation) or target (a role+name descriptor).',
      'name-missing': 'Add a name to the descriptor, or use a ref from the latest observation.',
      'near-unsupported': 'Remove near and select the element by name, role, or ordinal.',
    }
    return new GroundingError({
      code: 'descriptor_invalid',
      toolName,
      message: `Invalid descriptor for tool "${toolName}": ${messages[problem]}.`,
      hint: hints[problem],
    })
  },
}
