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
 *
 * Dated counter-note (2026-08-02, Phase 387 / KREV-01): 387 extended it early, with
 * `knowledge-write`, and the reservation above stands for everything else. The alternative
 * was to spend `config-write` on the knowledge review verbs, and that is not a smaller
 * change — it is a PRIVILEGE CONFLATION. A caller granted the power to edit this project's
 * configuration would thereby have been granted the power to forget what the system learned,
 * and those are not the same power: one is recoverable by editing a file back, the other is
 * the §7.7 tombstone. 384's CR-04 is the same shape of defect (one handle reaching a power it
 * was never granted), and the scope union exists precisely so a capability's cost is stated
 * where it is enforced. 397 inherits this member rather than re-minting it.
 *
 * Dated counter-note (2026-08-07, Phase 391 / PROP-01): extended once more, with
 * `approval-write`, and on exactly the reasoning above rather than by appeal to it. The
 * alternative was to spend `knowledge-write` on the approval-policy verbs, and that is the same
 * privilege conflation one rung up: a caller granted the power to change what the system learned
 * would thereby have been granted the power to change what it may do WITHOUT ASKING — to accept
 * proposals and revoke the standing grants that constrain it. One of those is a decision about
 * content and the other is a decision about consent, and the whole sovereignty argument of this
 * phase is that they are not the same power. 397 inherits this member rather than re-minting it.
 *
 * Dated counter-note (2026-08-11, Phase 394 / WTST-01): extended a third time, with `test-write`,
 * and on exactly the reasoning above rather than by appeal to it. The alternative was to spend
 * `run` on the authoring loop, and that is the same privilege conflation on a different axis: a
 * caller granted the power to EXECUTE this project's tests would thereby have been granted the
 * power to AUTHOR new ones into the repository and commit them, and those are not the same power —
 * one consumes the suite, the other writes it. `config-write` is no better; it is the reuse the
 * 387 note already refused, one directory over. The ask-tier gate is a different axis again and
 * closes neither. 397 inherits this member rather than re-minting it.
 */
export const FunctionScopeSchema = z.enum([
  'read',
  'run',
  'config-write',
  'knowledge-write',
  'approval-write',
  'test-write',
])

export type FunctionScope = z.infer<typeof FunctionScopeSchema>
