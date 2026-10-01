import { z } from 'zod'

/**
 * Capability-scope union for the function layer (Phase 384, D-13) — RETIRED (2026-10-01, 432-20,
 * D-12: "every door can call every operation").
 *
 * THE UNION GATES NOTHING. `invokeFunction` no longer checks a caller's grants against an op's
 * scopes, the registry no longer filters a listing by them, and no declaration carries them. The
 * type survives only for the optional, unread `FunctionMetadata.requiredScopes` and
 * `FunctionCaller.grantedScopes` fields that op specs and fixtures still spell while later 432 plans
 * remove them; 432-39 deletes this union, its six members and every import of it. A future
 * permission model is a new design, not a restore.
 *
 * THE GROWTH RULE IS DELETED with the union's purpose (D-12). It required a dated
 * privilege-conflation note here and a conformance row before a seventh member could join, and the
 * census cell that ranged every declaration's scopes against this union is retired with it. The
 * closure note it carried (2026-08-16 · Phase 397 · D-16, which replaced the 2026-07-28
 * reservation) is history now; the three dated counter-notes below are kept as the record of why
 * each member existed, not as precedent for adding a fourth.
 *
 * 2026-09-02 (Phase 412): the anticipated first extension left with the Issue-slot cleanup — see
 * `DELETION-INVENTORY.md`. Nothing is anticipated now; the growth rule above is the whole door.
 *
 * LINEAGE (the three inherit-notes below, folded). The reservation this note replaces is dated
 * 2026-07-28 and rests on spec/v2/qa-agent-and-surfaces.md §6 Q5, which leaves the full scope
 * lattice open. While it stood, three phases extended the union, each with its own dated
 * privilege-conflation argument and each ending "397 inherits this member rather than re-minting
 * it": 2026-08-02 (Phase 387 / KREV-01, `knowledge-write`), 2026-08-07 (Phase 391 / PROP-01,
 * `approval-write`), 2026-08-11 (Phase 394 / WTST-01, `test-write`). Those three notes are kept
 * below in full rather than summarised away — they are the precedent clause (a) points at — and
 * this note is the inheritance they each promised, discharged.
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
