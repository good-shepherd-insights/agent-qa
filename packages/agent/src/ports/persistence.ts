// The v47 persistence scaffold, carved up (Phase 385 plan 02, D-06). 2026-07-29.
//
// What LEFT this port, and why each departure is a deletion rather than a move:
//
// The two conversation methods are gone outright. Chat's state of record is the session log,
// so they never had an implementation to lose — but an unimplemented method is not harmless.
// A port that can store a transcript beside a job is an open invitation to make chat a job
// with a transcript attached, which is precisely the unification JOBQ-04 forbids. The
// cheapest way to keep that refactor from looking reasonable is for there to be no surface it
// could be written against.
//
// The job and checkpoint CRUD methods are gone too, and this is the deletion D-05 is really
// about. Generic CRUD lets a caller express any interleaving it likes and leaves atomicity to
// review; the queue's own store port replaced them with compound transactional verbs, where a
// wrong interleaving is not a bug a reviewer has to catch but a sentence the type surface
// cannot form. Keeping both would leave the unsafe spelling available beside the safe one.
//
// What STAYS is approvals and patches. Neither has an implementation yet either, but they
// differ from the departed methods in the way that matters: they name a real surface with a
// phase of its own to derive it, and nothing about their presence suggests a design that has
// already been ruled out. They are a placeholder for that phase, not a scaffold for this one.
//
// The departed methods are described by role rather than by name on purpose. A token scan is
// one of the ways this deletion gets checked, and prose quoting the identifiers it removed is
// indistinguishable, to such a scan, from prose that brought them back. The assertion that
// actually holds the line is the exact `keyof PersistencePort` pin in the port type tests.

import type { Approval, ApprovalId, Patch, PatchId } from '@vostride/agent-qa-schema'

export interface PersistencePort {
  saveApproval(approval: Approval): Promise<void>
  getApproval(id: ApprovalId): Promise<Approval | undefined>

  savePatch(patch: Patch): Promise<void>
  getPatch(id: PatchId): Promise<Patch | undefined>
}
