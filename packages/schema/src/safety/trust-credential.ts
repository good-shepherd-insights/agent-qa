// 2026-10-02 (432-39, D-02/D-10/D-12): the `TrustScope` and `TrustCredential` caller types are
// deleted with `FunctionCaller.credential`, their last consumer. No caller presents a credential and
// nothing reads one; an old record that still carries one is not migrated.

/**
 * The scope key set, spelled ONCE (388 C13), and the only member left in this module.
 *
 * 2026-10-02 (432-39): it no longer ranges a DTO here. The strict wire projection that built its
 * shape from this constant (`TrustScopeSchema`, 391-11) was deleted by 432-22, and the caller types
 * it was pinned against by 432-39, so the key-union pin went with them. The constant stays only
 * because four retained cells outside 432-39's closure still assert it is published; its removal is
 * routed to the 432-42 census.
 */
export const TRUST_SCOPE_KEYS = ['project', 'org'] as const

export type TrustScopeKey = (typeof TRUST_SCOPE_KEYS)[number]
