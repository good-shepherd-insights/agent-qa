import { z } from 'zod'

/**
 * Closed capability-scope union for the function layer (Phase 384, D-13).
 *
 * This is a CAPABILITY scope — what a caller is allowed to do. It is deliberately
 * distinct from `TrustScope` (`{project?, org?}`), which is a tenancy scope carried
 * by credentials and standing approvals; the two axes never merge.
 *
 * SCOPE UNION CLOSED (2026-08-16 · Phase 397 · D-16). The union below is ratified COMPLETE at its
 * six members for v2 — `read`, `run`, `config-write`, `knowledge-write`, `approval-write`,
 * `test-write` — and this note replaces the open reservation dated 2026-07-28, which reserved the
 * union's extension to this phase. That reservation was true of its moment and is exactly what let
 * three later phases each add a member while pointing here to finish the argument. 397 finishes it
 * by closing the door rather than by walking through it: two real surfaces now resolve through the
 * registry and one conformance suite ranges the whole of it, so a scope no declaration can name is
 * a scope no surface can be checked against.
 *
 * GROWTH RULE. A seventh member requires BOTH of the following, and neither substitutes for the
 * other:
 *   (a) a dated note IN THIS FILE arguing the PRIVILEGE CONFLATION that spending an existing member
 *       would commit — the exact shape of the three notes below, made where the cost is enforced;
 *   (b) a scenario-table row and a golden-registry update in 397's conformance suite
 *       (`packages/cli/src/__tests__/conformance/`), so a new power is measured on every rostered
 *       surface before it is granted on any.
 * Clause (b) cannot be skipped silently: the census cell reds on an op whose `requiredScopes` names
 * a scope this union does not hold, so the ledger enforces itself in that direction. Clause (a) is
 * a discipline a reviewer enforces, and this sentence is where the reviewer is told so.
 *
 * THE ANTICIPATED FIRST EXTENSION IS `issues-write`, minted by the Issue lifecycle engine's own
 * milestone under the rule above — named here so its arrival is an expected door rather than an
 * exception someone must argue is not a precedent. Spending `test-write` on the issue lifecycle
 * would be the same conflation one axis over: a caller granted the power to author tests into this
 * repository would thereby have been granted the power to open, triage and close the defect records
 * those tests produce, and a record of what is broken is not the artifact that broke.
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
