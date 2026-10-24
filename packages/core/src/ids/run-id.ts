import { generateRunId as generateSharedRunId, isCanonicalRunId as isSharedCanonicalRunId } from '@vostride/agent-qa-ids'

export function generateRunId(): string {
  return generateSharedRunId()
}

/**
 * Is this an id the run mint above would have produced? (2026-08-23, 401-20 · CR-04)
 *
 * THE MINT'S OWN INVERSE, re-exported one line under it and from the same package, so the two can
 * never answer about different id shapes. The invocation core takes this as a REQUIRED option
 * beside `mintRunId` for the reason the mint is one: `agent-local` may not name the ids package,
 * and a shape check invented there would be a second spelling of a run's identity.
 */
export function isCanonicalRunId(value: string): boolean {
  return isSharedCanonicalRunId(value)
}
