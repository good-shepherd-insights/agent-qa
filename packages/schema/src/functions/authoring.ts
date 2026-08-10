// The `authoring.verify_draft` op contract (393, D-01).
//
// The planner binds ALL registry ops 1:1 (392 D-07), so this op is chat-reachable the moment
// it registers — its input is crossing a trust boundary from an arbitrary caller, not being
// handed over between two halves of the same program. `.strict()` plus a non-empty path is
// therefore the refusal surface, not a formality. Path-boundary enforcement (is this draft
// inside the workspace at all?) belongs at the op invoke where the resolved config exists;
// this schema's job is to make sure the invoke is never handed a shape it must guess about.

import { z } from 'zod'

import { DraftReceiptSchema } from '../authoring/draft-receipt'

export const AuthoringVerifyDraftInputSchema = z.object({
  /** Path to the draft test file to evaluate. Resolved and boundary-checked at the invoke. */
  draftPath: z.string().min(1),
  /**
   * Draft mode: run the stability gate ONCE instead of the pinned N.
   *
   * D-18 makes this consequential rather than a speed knob — a draft-mode evaluation's
   * disposition is forced to `unverified` unconditionally, so nothing evaluated this way can
   * be auto-kept no matter how its four booleans read. Only the literal marker is accepted,
   * matching the `gateRun` / `excludedFromOutcomes` carrier idiom: `false` is a refusal, not a
   * synonym for absence, so a caller cannot half-express the intent.
   */
  draftMode: z.literal(true).optional(),
}).strict()

export type AuthoringVerifyDraftInput = z.infer<typeof AuthoringVerifyDraftInputSchema>

/**
 * The op returns the receipt it persisted — the same bytes, not a summary of them (D-19), so a
 * caller never has to re-read the store to learn what was just decided.
 */
export const AuthoringVerifyDraftOutputSchema = DraftReceiptSchema

export type AuthoringVerifyDraftOutput = z.infer<typeof AuthoringVerifyDraftOutputSchema>
