// The never-guess boundary, as a parse (Phase 395, D-13/D-15 · CFGM-05).
//
// A POSITIVE RULE ABOUT WHAT A HOSTNAME IS, NEVER A LIST OF WHAT IT IS NOT. `isLegalConfigReference`
// (395-05) is this file's in-tree precedent and the reason is the same one D-03 gives for refusing a
// settable-field whitelist: a rule that can only refuse what it can NAME cannot be driven to zero by
// naming more things. So there is no deny list of "words that look like domains", no lexicon of
// prepositions to strip, no catalogue of TLDs. There is one predicate — this string IS a hostname —
// and everything that does not satisfy it is refused by the same sentence.
//
// WHY A PARSE AND NOT A PROMPT. The model picks the TOKEN out of the utterance; nothing below asks
// it whether the token is a site (D-13). `booking.com` against `booking.de` is a coin flip a review
// should not have to catch, and the whole point of the split is that the derivation a person
// approves is one deterministic function of bytes they typed.
//
// THE DERIVATION IS PINNED, AND ITS TWO DEFERRED HALVES ARE NAMED. `https://` plus the lowercased
// domain exactly as given: no `www.` prepending, no redirect chasing to a canonical origin, no
// locale inference. D-13 defers redirect-chasing explicitly — "a later enhancement if real use shows
// the bare-domain derivation wrong in practice" — and the reason to keep it deferred is that a
// derivation which reaches the network is one whose answer a hermetic cell cannot pin and a person
// cannot predict from what they typed.
//
// THE HONEST BOUND, STATED ONCE. This predicate accepts strings that are syntactically hostnames and
// are not sites: `readme.md`, `package.json` and `v1.2` all have a dot and legal labels, and the
// last two are refused only because their final label is not alphabetic or is shorter than two
// characters. `readme.md` IS accepted, and would scaffold a target at `https://readme.md`. That is
// the cost of a positive rule with no catalogue, and it is the safe direction: the failure is a
// proposal a person reads and rejects, rather than an origin nobody was shown. The alternative —
// a suffix list — is the door enumeration this file exists not to be.

/** The refusal a token that is not a hostname earns, in one sentence naming both continuations. */
export const HOSTNAME_GATE_REFUSAL_DETAIL
  = 'that is not a URL and not a target this project configures. Give me the site\'s address '
    + '(for example https://example.com) or the name of a target from your agent-qa.config.yaml, '
    + 'and I will use exactly what you give me — I will not guess which site you meant.'

/** DNS label syntax: alphanumeric with internal hyphens, 1–63 characters, no leading/trailing `-`. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** The final label. Alphabetic and at least two characters — what a registry TLD is. */
const TLD = /^[a-z]{2,}$/

/**
 * A token's routing verdict. `hostname` carries the derivation; `not-a-hostname` carries nothing,
 * because there is nothing honest to carry.
 */
export type HostnameGateVerdict =
  | {
    readonly kind: 'hostname'
    /** The lowercased domain, with any scheme, credentials, port, path or query removed. */
    readonly domain: string
    /** `https://` + {@link domain}. The base URL the scaffolded target holds. */
    readonly baseUrl: string
    /** {@link domain} with dots replaced by hyphens. The registry key and a test's `target:`. */
    readonly targetName: string
  }
  | { readonly kind: 'not-a-hostname' }

/**
 * Strip an https/http URL down to its host, or answer the token unchanged.
 *
 * PARSED, NOT PATTERN-MATCHED. `URL` is the one implementation of this question the platform has,
 * and re-deriving "where does the authority end" from a regex is how a token like
 * `https://example.com@evil.example/` gets read as `example.com` by one half of a product and as
 * `evil.example` by the other. `URL.hostname` is the authority's HOST after userinfo and port are
 * removed, which is the value this gate is about.
 *
 * ONLY http/https. A `file:`, `javascript:` or `data:` URL parses perfectly well and is not a site
 * this product can drive, so it falls through to the label check below and is refused there.
 */
function hostOf(token: string): string {
  if (!/^https?:\/\//i.test(token)) return token
  try {
    return new URL(token).hostname
  } catch {
    return token
  }
}

/**
 * Does this token parse as a hostname, and if so what does the scaffold derive from it (D-15)?
 *
 * TRAILING DOT IS NOT STRIPPED, DELIBERATELY. `example.com.` is a legal fully-qualified name in DNS
 * and an empty final label here, so it is refused rather than silently rewritten — the rule is that
 * what a person typed is what gets configured, and a gate that quietly edits the token is a gate
 * that can quietly edit it wrong.
 */
export function parseHostnameToken(token: string): HostnameGateVerdict {
  const trimmed = token.trim()
  if (trimmed.length === 0) return { kind: 'not-a-hostname' }

  const host = hostOf(trimmed).toLowerCase()
  // A dot is necessary and nowhere near sufficient. It is stated first because it is the one
  // syntactic fact that separates "a site" from "a word", and every check below is about labels.
  if (!host.includes('.')) return { kind: 'not-a-hostname' }
  if (host.length > 253) return { kind: 'not-a-hostname' }

  const labels = host.split('.')
  if (labels.length < 2) return { kind: 'not-a-hostname' }
  if (!labels.every((label) => LABEL.test(label))) return { kind: 'not-a-hostname' }
  if (!TLD.test(labels[labels.length - 1] as string)) return { kind: 'not-a-hostname' }

  return {
    kind: 'hostname',
    domain: host,
    baseUrl: `https://${host}`,
    targetName: host.split('.').join('-'),
  }
}
