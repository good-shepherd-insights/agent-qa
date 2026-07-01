import { sha256hex16 } from '@vostride/agent-qa-schema'

/**
 * One-way 16-hex fingerprint for redactedFingerprint. NOT detection; pure hashing.
 */
export const fingerprint = (raw: string): string => sha256hex16(raw)
