import { sha256hex16 } from '../determinism/sha256'
import type { EvidenceToken } from './record-id'

export interface EvidenceTokenInput {
  attributingObservationId: string
  anchor: string
  buildOrdinal: number
}

function text(input: string): string {
  return `${input.length}:${input}`
}

export function computeEvidenceToken(input: EvidenceTokenInput): EvidenceToken {
  const preimage = [
    input.attributingObservationId,
    input.anchor,
    String(input.buildOrdinal),
  ].map(text).join('')

  return sha256hex16(preimage) as EvidenceToken
}
