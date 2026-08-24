// The run-service caller-credential vocabulary (Phase 402 plan 01, D-05 / D-06 · INVK-03).
//
// WHY THIS FILE EXISTS AND WHY IT HOLDS NO SECRET. D-05 reuses the Phase 396 MCP token idiom
// wholesale, and 395 D-11's refs-only law decides the only honest shape a credential declaration
// can take in a committed file: config carries the env-var NAME the value lives under, and never
// the value. `agent-qa.config.yaml` is a file people commit, paste into issues, and hand to
// `agent-qa config show`; `.strict()` below is what turns "please don't write the token here" into
// a parse refusal rather than a convention. There is deliberately no `token`, no `value` and no
// `secret` key in this module, and an entry carrying one is REFUSED rather than ignored.
//
// WHAT AN ENTRY GRANTS IS A TRUST SCOPE, NOT A FUNCTION SCOPE — the one place this diverges from
// {@link McpTokenEntrySchema}, and D-06 is the reason. The remote door's FunctionScope set is FIXED
// at composition: exactly what starting a run and streaming its events needs, least privilege by
// construction, with nothing an operator could misdeclare. What varies per entry is WHOSE project
// or org the holder acts for, which is the v48 {@link TrustScope} the policy gate already reads.
// One credential family (ratified 2026-07-03): the access token IS the `TrustCredential`, and this
// file mints no second auth vocabulary.
//
// WHERE THE BLOCK LANDS. `packages/core`'s `services.dashboard` — this project's one existing
// dashboard configuration home — composes this DTO. It is not re-declared there; core imports what
// is minted here, because 384 D-16 mints DTOs in `schema`.

import { z } from 'zod'

import { TrustScopeSchema } from '../safety/grant-ops'

/**
 * One declared run-service credential — a LABEL, an env-var NAME, and the trust it grants.
 *
 * `name` is a label the operator chose (`"ci"`, `"teammate-ana"`), used in diagnostics and as the
 * `clientId` a request is attributed to. It is not a secret and it is not matched against anything
 * a caller sends; a caller presents a token value, never a name.
 *
 * `tokenEnvVar` is the NAME of the environment variable holding the value. The host reads it once
 * at start (`resolveRunServiceTokens`) and refuses to start when a declared variable is unset —
 * naming the variable, never a value. An operator reading a startup refusal learns which variable
 * to set and learns nothing else.
 *
 * `trustScope` is the {@link TrustScopeSchema} projection: `project?` / `org?`, both optional, both
 * opaque. An entry declaring NEITHER is legal and means exactly what it says — a credential that
 * satisfies no scoped standing approval and rides the door's fixed capability alone. That is a
 * coherent posture (a CI token for a project that has issued no scopes yet), unlike the MCP door's
 * zero-scope entry, which was a credential that could call nothing.
 */
export const RunServiceTokenEntrySchema = z.object({
  name: z.string().trim().min(1),
  tokenEnvVar: z.string().trim().min(1),
  trustScope: TrustScopeSchema,
}).strict()

export type RunServiceTokenEntry = z.infer<typeof RunServiceTokenEntrySchema>
