import type {
  RiskActionDescriptor,
  StandingApprovalGrant,
  TrustScope,
} from '@vostride/agent-qa-schema'

export interface StandingApprovalReader {
  grantsFor(
    action: RiskActionDescriptor,
    actionScope: TrustScope,
  ): readonly StandingApprovalGrant[]
}

export const NO_STANDING_APPROVALS: StandingApprovalReader = {
  grantsFor: () => [],
}

/**
 * The surface a person actually answers a confirm on (G-401-17).
 *
 * A SURFACE, NEVER A DOOR AND NEVER A FEATURE. `tty-prompt` is a terminal; `browser-click` is a
 * click in a browser. The dashboard's chat panel and its run-trigger button are ONE value between
 * them, because a person answering either is doing the same thing in the same place — a value per
 * feature would be a vocabulary that grows with the UI instead of with the ways a person can
 * answer, and the audit trail would carry a different word for the same human act.
 *
 * THESE ARE THE VALUES `resolveAsk` RECORDS as the trust source of an approval, which is why
 * `ExecutionPolicyTrustSource` is composed from this union rather than restating it: a surface
 * added here lands in the published audit vocabulary in one edit and cannot land in only one of
 * the two. Both members land in durable `execution_audit` JSONL rows, so adding one is a contract
 * change to a published enumeration, not a per-composition string.
 */
export type ConfirmAnsweringSurface = 'tty-prompt' | 'browser-click'

/** How a confirm binding puts the question. Separate from the binding so a decorator can name it. */
export type ConfirmAsk = (action: RiskActionDescriptor) => boolean | Promise<boolean>

/**
 * A confirm channel PAIRED WITH THE SURFACE IT SPEAKS FOR (G-401-17).
 *
 * WHY A PAIR AND NOT TWO FIELDS. A surface resolved anywhere other than beside the port is two
 * facts free to disagree, and this composition already has a seam where two ports meet and one
 * wins at call time (`chatConfirmPort ?? input.confirm`). Travelling together, the surface is
 * whichever port actually ran, structurally — there is no second resolution to get wrong.
 *
 * WHY `surface` IS REQUIRED. The defect this shape exists to prevent (measured in Chromium, UAT
 * item 15 §4) was a browser click recorded as `tty-prompt`, because the gate hardcoded the
 * mechanism it expected. A default value, an optional field with a fallback, or a property hung on
 * the function object would each let the next confirm port inherit somebody else's provenance in
 * silence; a required property makes the omission a compile error, which is a thing the type
 * system enforces rather than a list of names a reviewer has to remember.
 *
 * `surface: null` IS AN HONEST DECLARATION, not a hole: it says this binding never approves
 * anything, and the gate refuses to mint an approval through it. {@link DENY_CONFIRM} is the one
 * binding in the workspace that says it.
 */
export interface ConfirmPort {
  readonly surface: ConfirmAnsweringSurface | null
  readonly ask: ConfirmAsk
}

export const DENY_CONFIRM: ConfirmPort = { surface: null, ask: () => false }
