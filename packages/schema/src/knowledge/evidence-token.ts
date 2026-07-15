import { canonicalJson } from '../determinism/canonical-json'
import { sha256hex } from '../determinism/sha256'
import { asEvidenceToken, type EvidenceToken } from '../ids/record-id'
import type { Anchor } from '../identity/anchor'
import { normalizeAnchor } from '../identity/normalize-anchor'

/**
 * Pitfall 11: Confirm without a fresh token is a no-op. Tokens are derived by code at
 * emit-projection time, never accepted from model output, and downstream idempotency is keyed by
 * (recordId, evidenceToken, curationJobId).
 */
export function deriveEvidenceToken(input: {
  attributingObservationId: string
  anchor: Anchor
  buildOrdinal: number
}): EvidenceToken {
  return asEvidenceToken(
    sha256hex(
      canonicalJson([
        input.attributingObservationId,
        normalizeAnchor(input.anchor),
        input.buildOrdinal,
      ]),
    ),
  )
}
