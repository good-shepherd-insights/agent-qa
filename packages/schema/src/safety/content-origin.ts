/**
 * Provenance marker for content entering safety gates.
 *
 * Omitted origin is treated as non-user and never enables user-authored overrides.
 */
export type ContentOrigin = 'user' | 'agent' | 'app'
