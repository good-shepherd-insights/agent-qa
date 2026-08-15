// The MCP caller-credential vocabulary (Phase 396 plan 05, D-06 / D-07 · MCPS-04).
//
// WHY THIS FILE EXISTS, AND WHY IT HOLDS NO SECRET. D-06 declares per-caller bearer tokens for the
// local MCP server, and 395 D-11's refs-only law decides the only honest shape a declaration like
// that can take in a committed file: config carries the env-var NAME the credential lives under,
// and never the credential. The distinction is not stylistic. `agent-qa.config.yaml` is a file
// people commit, paste into issues, and hand to `agent-qa config show`; a schema with a field a
// token VALUE could occupy is a schema that invites the leak, and `.strict()` below is what turns
// "please don't" into a parse refusal. There is deliberately no `token`, no `value`, no `secret`
// key anywhere in this module, and an entry carrying one is REFUSED rather than ignored.
//
// THE SCOPE SET IS THE REAL PAYLOAD. Each entry says what its holder may do, in the function
// layer's OWN closed vocabulary (`FunctionScopeSchema`) rather than in a second spelling this file
// would then own forever. That is what makes D-05's visibility law computable from a credential:
// the host resolves the header to one of these entries, the entry names scopes, and the scopes are
// the whole input to what a caller can see and do. A scope minted tomorrow is writable here the day
// it exists, with no edit to this file — and a scope RETIRED stops parsing here on the same day,
// which is the direction that matters.
//
// WHERE THE BLOCK LANDS. `packages/core`'s `services.mcp` — this project's one existing MCP
// configuration home — composes these DTOs. It is not re-declared there; core imports what is
// minted here, because 384 D-16 mints DTOs in `schema` and `packages/core` may not become a second
// place a reader looks for the shape of an MCP token entry.

import { z } from 'zod'

import { FunctionScopeSchema } from '../functions/function-scope'

/**
 * One declared caller credential — a LABEL, an env-var NAME, and a scope set.
 *
 * `name` is a label the operator chose (`"ci"`, `"claude-desktop"`), used in diagnostics and in the
 * `clientId` the server attributes a request to. It is not a secret and it is not matched against
 * anything a caller sends; a caller presents a token value, never a name.
 *
 * `tokenEnvVar` is the NAME of the environment variable holding the value. The host reads it once at
 * start (`resolveMcpTokens`) and refuses to start when a declared variable is unset — naming the
 * variable, never a value. An operator reading a startup refusal learns which variable to set and
 * learns nothing else.
 *
 * `scopes` must be non-empty. A zero-scope entry is a credential that can see no tool and call no
 * op, which is indistinguishable from a typo and strictly worse than not declaring the entry: the
 * operator would believe a caller was authorised and the caller would meet an empty server. The
 * EMPTY GRANT is still a reachable state and still has its own differential cell — it is what a
 * host resolves for a caller it refuses to hand the default set — but it is not something a person
 * can write down here by accident.
 *
 * `.strict()` is load-bearing rather than conventional: it is the mechanism that refuses
 * `token: "sk-live-…"` written beside `tokenEnvVar` by somebody who found the indirection
 * inconvenient. A cell drives exactly that input and asserts the refusal.
 */
export const McpTokenEntrySchema = z.object({
  name: z.string().trim().min(1),
  tokenEnvVar: z.string().trim().min(1),
  scopes: z.array(FunctionScopeSchema).min(1),
}).strict()

export type McpTokenEntry = z.infer<typeof McpTokenEntrySchema>

/**
 * The stdio transport's config opt-in (D-07).
 *
 * D-07's default is that an unauthenticated local caller gets every scope EXCEPT `config-write`,
 * and stdio has no `Authorization` header to carry an exception — a spawning editor hands the
 * process nothing. So the exception is declared here, in the file the operator already owns, and
 * the flag defaults to `false` so the safe answer is the one nobody has to write.
 *
 * It is a separate block from `tokens` rather than a synthetic entry in that list because the two
 * mechanisms answer different questions: a token is presented, and this is not. Folding stdio into
 * the token list would have meant an entry no header can ever match sitting in the set that
 * `matchBearer` compares against, which is a value in the comparison path with no business there.
 */
export const McpStdioGrantSchema = z.object({
  grantConfigWrite: z.boolean().default(false),
}).strict()

export type McpStdioGrant = z.infer<typeof McpStdioGrantSchema>
