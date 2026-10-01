// RE-SPELLED 2026-10-01 (432-19, D-14/D-15). This file pinned at the TYPE level that a confirm
// binding could not exist without the answering surface it spoke for (G-401-17). The confirm port,
// its `ConfirmAsk`, its `ConfirmAnsweringSurface` vocabulary and the standing-approval reader are
// deleted with the gate, so the type-level claim is now that none of them can be named from the
// safety barrel at all. `@ts-expect-error` is two-way: each line fails `tsc --noEmit` the moment the
// name it reaches for comes back.
//
// It lives under `__tests__/` because the arch dependency extractor treats any file outside such a
// directory as production source and would report `vitest` as an unexpected external dep.

import { expectTypeOf } from 'vitest'

import type * as Safety from '../../index.js'

// @ts-expect-error C432-NO-ASK-PORTS: the confirm port is deleted
export type RetiredConfirmPort = Safety.ConfirmPort
// @ts-expect-error C432-NO-ASK-PORTS: the confirm ask signature is deleted
export type RetiredConfirmAsk = Safety.ConfirmAsk
// @ts-expect-error C432-NO-ASK-PORTS: the answering-surface vocabulary is deleted
export type RetiredSurface = Safety.ConfirmAnsweringSurface
// @ts-expect-error C432-NO-ASK-PORTS: the standing-approval reader is deleted
export type RetiredReader = Safety.StandingApprovalReader
// @ts-expect-error C432-NO-ASK-PORTS: the session deny overlay is deleted
export type RetiredOverlay = Safety.SessionDenyOverlay
// @ts-expect-error C432-NO-ASK-PORTS: the gate's trust input is deleted
export type RetiredTrust = Safety.GateTrust
// @ts-expect-error C432-NO-EVALUATE: the gate's dependency bag is deleted
export type RetiredDeps = Safety.GateDeps
// @ts-expect-error C432-AUDIT-UNREAD: the execution-audit row is deleted
export type RetiredRow = Safety.ExecutionAuditRow

// What remains: the registrar's deps are the audit sink and the guardrail policy, nothing else, and
// the audit port has one method.
expectTypeOf<keyof Safety.FirstPartySafetyDeps>().toEqualTypeOf<'auditSink' | 'guardrailPolicyInput'>()
expectTypeOf<keyof Safety.AuditSink>().toEqualTypeOf<'appendGuardrailAudit'>()
