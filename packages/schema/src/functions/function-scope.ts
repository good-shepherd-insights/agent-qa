import { z } from 'zod'

/**
 * Closed capability-scope union for the function layer (Phase 384, D-13).
 *
 * This is a CAPABILITY scope — what a caller is allowed to do. It is deliberately
 * distinct from `TrustScope` (`{project?, org?}`), which is a tenancy scope carried
 * by credentials and standing approvals; the two axes never merge.
 *
 * Dated note (2026-07-28): spec/v2/qa-agent-and-surfaces.md §6 Q5 leaves the full
 * scope lattice open. Phase 397 extends this closed union; until then `read`, `run`,
 * and `config-write` are the only capability scopes the registry recognises.
 */
export const FunctionScopeSchema = z.enum(['read', 'run', 'config-write'])

export type FunctionScope = z.infer<typeof FunctionScopeSchema>
