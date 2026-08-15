// ONE ANSWER TO "IS THIS CONFIG ENTRY A CREDENTIAL", AND IT LIVES HERE (395-20 · F-03).
//
// WHY THIS PACKAGE AND NOT THE CLI. The predicate has two callers, both on the CLI surface:
// `formatConfigDebug`'s row loop redacts through it and `setAction` refuses through it. Writing it
// in `cli/src/config.ts` was the obvious placement and it FAILED an existing architectural gate —
// the FUNC-02 surface firewall (LINT-01..05) forbids a firewalled surface naming an internal
// package outside `{agent, agent-local, schema}`, and the value arm needs the guardrail detectors
// out of `@vostride/agent-qa-safety`. The waiver ledger exists for exactly that edge, and its own
// first rule is that it only ever SHRINKS: "New surface code can never join it; a leak in a file
// written after 2026-07-28 is fixed, not waived." So it is fixed. The function layer already
// depends on safety, already re-exports safety primitives to its consumers
// (`createMaskingContext`, `unmaskForHumanOutput`), and already owns the config-mutation class
// whose construction scan asks this same question at proposal time — which makes this module's
// neighbours the right ones rather than merely the permitted ones.

import { findDetectorMatches } from '@vostride/agent-qa-safety'
import type { GuardrailDetectorFamily } from '@vostride/agent-qa-schema'

/**
 * THE KEY-NAME ARM's set — normalized last segments (395-20 · F-03).
 *
 * RETUNE NOTE. This set was private to `commands/config.ts` and answered ONE caller, the `config
 * set` refusal. It held `apikey`, `authtoken`, `token`, `key`, `accesskey`, `secret`, `password`,
 * `bearertoken`, `accesstoken`, `refreshtoken` — and NOT `apitoken`, which is why the verifier's
 * `agent-qa config set apiToken sk-…` was accepted and written into the committed yaml, and why
 * applying the old predicate at the render would still have printed the review's own fixture key.
 * The widening below adds that hole's key and the adjacent forms that are obvious misses of the
 * same enumeration: the `*secret` and `*key` credential compounds, the remaining token families,
 * and the plain credential words.
 *
 * WHAT IS DELIBERATELY NOT HERE. `auth` alone: `plugins.auth` is a configuration block this
 * product's own refusal message tells people to use, and a name arm that swallows it would refuse
 * the guidance it prints. `url`, `endpoint`, `user`: identifiers, not credentials — (K4) pins them
 * rendering and writing verbatim.
 *
 * AND THE SET IS NOT THE POINT. A name list can only refuse what it can NAME (393's
 * door-enumeration finding), so every member added here closes exactly one door and no class. The
 * class is closed by the value arm below; this set exists so that a credential whose VALUE has no
 * recognisable shape (an opaque internal token, a password) is still caught under a name that says
 * what it is.
 */
const CREDENTIAL_KEY_NAMES = new Set([
  'accesskey',
  'accesstoken',
  'apikey',
  'apisecret',
  'apitoken',
  'authorization',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'credential',
  'credentials',
  'idtoken',
  'key',
  'passwd',
  'password',
  'privatekey',
  'refreshtoken',
  'secret',
  'secretkey',
  'sessiontoken',
  'token',
])

/**
 * THE VALUE-SHAPE ARM's families — the SC-2 vocabulary, a named subset (395-20 · F-03).
 *
 * These four are the CREDENTIAL-shaped families of the guardrail detector set: `apiKey` (the
 * `sk-`/`gh?_`/`AIza` provider prefixes and the 40-char opaque token shape), `bearer`, `awsKey` and
 * `pemKey`. Reusing them rather than writing new regexes here is deliberate — a second answer to
 * "what does a credential look like" is a second thing that drifts, and drift between two answers
 * to one question is the defect this plan closes.
 *
 * THE THREE EXCLUDED, and why: `email` and `creditCard` are PII, not credentials — redacting a
 * `notify.email` out of `config show` would break the command for a value the person put there to
 * read back, and this predicate also gates a WRITE refusal, where refusing to set an email address
 * would be a plain regression. `injectionShape` is a prompt-routing heuristic whose own source
 * calls it a soft signal costing review rather than rejection; wiring it to a hard refusal would
 * mean `config set` rejecting ordinary prose.
 *
 * KNOWN OVER-REACH, accepted (T-395-56): the `apiKey` family carries a generic 40-character
 * alphanumeric shape, so a 40-char hex digest set as a config value is treated as credential-shaped.
 * That is the arm doing its job on an ambiguous input, and the failure direction is the safe one.
 */
const CREDENTIAL_VALUE_DETECTORS: readonly GuardrailDetectorFamily[] = [
  'apiKey',
  'awsKey',
  'bearer',
  'pemKey',
]

/**
 * THE ONE ANSWER to "is this config entry credential-bearing" (395-20 · F-03).
 *
 * TWO CALLERS, ONE EXPORT, ON PURPOSE. `formatConfigDebug`'s row loop redacts through it and
 * `setAction` refuses through it. Before this, the render had no predicate at all and the write had
 * a private one with a hole — the read and write sides of a single contract answering the question
 * differently is exactly the shape 388/390/392 keep filing, and it is why `config set apiToken`
 * could write a value `config show` would then print back.
 *
 * The arms are an OR: a credential is either something the key says is one, or something the value
 * looks like.
 *
 * AND THE THIRD ARM EXISTS SO A CONTAINER IS NEVER A HIDING PLACE FROM THE PREDICATE (395-23 ·
 * F-03-R4a). Before it, this function returned `false` for every non-string, so a caller handed a
 * whole `registry.llms[]` — the array where all of this product's provider credentials live — got
 * the same answer as for an empty config, and `config show` printed every byte of it. A caller that
 * decomposes first (the render road now does) never reaches this arm; a caller that does not (the
 * MCP masker is one) gets the answer its leaves would have given, through the SAME detector
 * families, because two answers to one question is the drift this module exists to end.
 */
export function isCredentialEntry(key: string, value: unknown): boolean {
  // AN INDEX IS NOT PART OF THE NAME (395-23 · F-03-R4a). The render road now flattens arrays to
  // indexed rows, so a `credentials: [...]` that used to arrive as ONE row named `credentials` —
  // and was redacted by the arm below — now arrives as `credentials[0]`, whose raw normalization is
  // `credentials0`, a member of no set. Decomposing a container must not cost the container's own
  // name, or the fix that closed the leak would have opened a smaller one beside it.
  const lastSegment = (key.split('.').pop() ?? '').replace(/\[\d+\]$/, '')
  if (CREDENTIAL_KEY_NAMES.has(lastSegment.toLowerCase().replace(/[^a-z0-9]/g, ''))) return true
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return valueLooksLikeCredential(value)
  // ANYTHING ELSE IS SCANNED THROUGH ITS JSON SERIALIZATION — every byte a render or a tool
  // response could put in front of a person or a model, read by the SAME families.
  let serialized: string | undefined
  try {
    serialized = JSON.stringify(value)
  } catch {
    // A value this predicate cannot read is a value it cannot clear. `JSON.stringify` throws on a
    // circular structure and on a BigInt; answering `false` there would mean "not a credential"
    // for the one input class we know nothing about, on a function that gates a redaction and a
    // write refusal. Fail toward redacting and refusing — the same direction T-395-56 accepts for
    // the 40-character over-reach above.
    return true
  }
  // `undefined` back from `stringify` is a function or a symbol: nothing renderable, nothing to
  // hide.
  if (serialized === undefined || serialized === '') return false
  return valueLooksLikeCredential(serialized)
}

function valueLooksLikeCredential(text: string): boolean {
  if (text === '') return false
  return CREDENTIAL_VALUE_DETECTORS.some(
    (family) => findDetectorMatches(family, text).length > 0,
  )
}
