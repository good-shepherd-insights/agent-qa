// 2026-10-01 (432-19, D-15): the standing-approval grant DTO is deleted with the safety ports that
// read it (C432-NO-GRANT-CONTRACTS).
// 2026-10-02 (432-39, D-02/D-10/D-12): the credential and scope DTOs are deleted too, with the
// caller's `credential` member, their last consumer (C432-NO-PERMISSION-TYPES). Each line below fails
// `pnpm typecheck` the moment its type returns to the barrel.
// 2026-10-03 (quick-261003-tsr, IN-22): the always-green 'exports the trust DTOs' cell is deleted;
// the three expected errors below are the whole file.

// @ts-expect-error C432-NO-GRANT-CONTRACTS: the standing-approval grant is deleted
export type RetiredStandingApprovalGrant = import('@vostride/agent-qa-schema').StandingApprovalGrant
// @ts-expect-error C432-NO-PERMISSION-TYPES: the trust credential is deleted
export type RetiredTrustCredential = import('@vostride/agent-qa-schema').TrustCredential
// @ts-expect-error C432-NO-PERMISSION-TYPES: the trust scope is deleted
export type RetiredTrustScope = import('@vostride/agent-qa-schema').TrustScope
