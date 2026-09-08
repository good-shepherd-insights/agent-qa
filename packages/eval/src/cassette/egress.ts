import { committedFileText } from '../labels/committed-file'
import type { Cassette } from './cassette'
import type { CassetteInputLeg } from './input-leg'
import { cassetteSchema } from './schema'

/** Scan-only representation of validated machine capture metadata; never persisted or hashed. */
function inputForEgress(input: CassetteInputLeg) {
  const timestamp = input.stateBefore.timestamp
  return {
    ...input,
    stateBefore: {
      ...input.stateBefore,
      // A captured epoch can be Luhn-valid. Scientific notation preserves its value without
      // presenting machine metadata as a payment-card candidate. No content field is rewritten.
      timestamp: Number.isSafeInteger(timestamp) && timestamp >= 0
        ? timestamp.toExponential() : timestamp,
    },
  }
}

/**
 * The committed egress view changes only ScreenState.timestamp at schema-defined decision paths.
 * Validate first; preserve opaque exchanges, extension fields, user strings and all other numbers.
 * The caller still persists committedFileText(cassette), including the original receipt hashes.
 */
export function cassetteEgressText(cassette: Cassette): string {
  cassetteSchema.parse(cassette)
  return committedFileText(cassette.granularity === 'leaf'
    ? { ...cassette, input: inputForEgress(cassette.input) }
    : { ...cassette, steps: cassette.steps.map(step => step.kind === 'decision'
      ? { ...step, record: { ...step.record, input: inputForEgress(step.record.input) } }
      : step) })
}
