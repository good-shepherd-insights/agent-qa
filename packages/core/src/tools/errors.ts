import type { z } from 'zod'

export type GroundingErrorCode =
  | 'schema_invalid'
  | 'ref_not_in_snapshot'
  | 'coords_out_of_bounds'

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
}
