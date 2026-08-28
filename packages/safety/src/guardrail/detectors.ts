import type { GuardrailDetectorFamily } from '@vostride/agent-qa-schema'

import { EMAIL_RE } from '../masking/detectors'
import { luhnValid } from './luhn'

export interface GuardrailMatch {
  detector: GuardrailDetectorFamily
  kind: GuardrailDetectorFamily
  value: string
  start: number
  end: number
}

interface GuardrailDetector {
  detector: GuardrailDetectorFamily
  kind: GuardrailDetectorFamily
  match: (text: string) => GuardrailMatch[]
}

export const DETECTOR_PRECEDENCE: readonly GuardrailDetectorFamily[] = [
  'awsKey',
  'creditCard',
  'pemKey',
  'bearer',
  'apiKey',
  'email',
  'injectionShape',
]

const AWS_ACCESS_KEY_RE = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g
const CREDIT_CARD_CANDIDATE_RE = /\b(?:\d[ -]?){13,19}\b/g
const PEM_PRIVATE_KEY_RE = /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g
const BEARER_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g
const API_KEY_RE_LIST = [
  /\bsk-[A-Za-z0-9_-]{10,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{10,}\b/g,
  /\bAIza[A-Za-z0-9_-]{10,}\b/g,
  /\b[A-Za-z0-9+/]{40}\b/g,
]

// Instruction-override shapes. These are deliberately small, bounded heuristics;
// a match costs Curator review rather than causing a deterministic rejection.
const INSTRUCTION_OVERRIDE_RE_LIST = [
  /\b(?:ignore|disregard|forget)\s+(?:(?:all|any|the)\s+)?(?:previous|prior|above)\s+(?:instructions?|rules?|prompts?)\b/gi,
  /^\s*new\s+instructions?\s*:/gim,
]

// Role or system-prompt impersonation shapes. False positives remain lossless
// because SAFE-03 treats this detector only as a soft routing signal.
const ROLE_IMPERSONATION_RE_LIST = [
  /^\s*(?:system|assistant)\s*:/gim,
  /\b(?:you\s+are\s+now|act\s+as)\b/gi,
]

// Common chat-template and system-fence delimiters. These fixed tokens avoid
// backtracking-prone patterns while covering the governed template families.
const CHAT_TEMPLATE_DELIMITER_RE_LIST = [
  /<\|im_(?:start|end)\|>/gi,
  /\[\/?INST\]/gi,
  /```[ \t]*system(?:[ \t]*\r?\n|$)/gim,
]

function cloneRegex(regex: RegExp): RegExp {
  return new RegExp(regex.source, regex.flags)
}

function matchesFromRegex(
  detector: GuardrailDetectorFamily,
  regex: RegExp,
  text: string,
): GuardrailMatch[] {
  const matcher = cloneRegex(regex)
  const matches: GuardrailMatch[] = []

  for (const match of text.matchAll(matcher)) {
    const value = match[0]
    if (value.length === 0 || match.index === undefined) {
      continue
    }

    matches.push({
      detector,
      kind: detector,
      value,
      start: match.index,
      end: match.index + value.length,
    })
  }

  return matches
}

function normalizeCardCandidate(candidate: string): string {
  let digits = ''

  for (let i = 0; i < candidate.length; i++) {
    const code = candidate.charCodeAt(i)
    if (code >= 48 && code <= 57) {
      digits += candidate[i]
    }
  }

  return digits
}

/**
 * Is this candidate the fraction of a PRINTED DECIMAL NUMBER rather than a digit run in its
 * own right?
 *
 * THE RULE ENFORCED, verbatim — suppress iff all four hold:
 *   1. `text[start - 1] === '.'`  (a decimal point immediately precedes the candidate)
 *   2. at least one digit precedes that `.`; call that maximal digit run the INTEGER PART
 *   3. the integer part STANDS ALONE: it begins the text, or the byte before it is neither a
 *      word character `[A-Za-z0-9_]` nor `'.'` (not glued to a word, not a link in a dotted
 *      chain)
 *   4. the integer part is either a single `0`, OR the whole literal `<integer>.<fraction>` is
 *      the SHORTEST ROUND-TRIP DECIMAL of the IEEE-754 double it denotes
 *      (`String(Number(literal)) === literal`), with the fraction likewise delimited on its
 *      right
 * Everything else — no integer part, a word-glued prefix, a dotted chain, or a nonzero-integer
 * literal that no float formatter would ever have printed — is NOT a fractional tail and falls
 * through to Luhn scoring, i.e. fails toward block.
 *
 * WHY SUPPRESS AT ALL (measured 2026-08-10, demo local-form target). `CREDIT_CARD_CANDIDATE_RE`
 * cannot see across the `.` in `0.45833333333333337`, so what it offers for scoring is the 17-digit
 * tail `45833333333333337` — Luhn-valid, so the entire outbound prompt was blocked. A procedure hint
 * rendering `(confidence 0.45833333333333337, ...)` refused every planning turn for that page,
 * deterministically, with no way for an operator to tell from `Guardrail blocked outbound prompt
 * leaf: creditCard` that the "card" was a float. About one in ten IEEE-754 decimal expansions of
 * candidate length is Luhn-valid, so that is a standing ~10% chance any given page or brief becomes
 * permanently unplannable.
 *
 * WHY THE RULE IS SHAPED THIS WAY (regression, measured 2026-08-10, phase 393 verification). The
 * first cut of this guard tested only the two characters before the candidate — any `<digit>.` at
 * all. Through the real `scan()` + the default policy, `card 1.4111111111111111 end` and
 * `v1.4012888888881881 ok` both returned `{"action":"pass"}` while carrying Luhn-valid PANs, under a
 * policy whose creditCard action is `block`: a false negative in an egress control, i.e. prefixing a
 * PAN with any digit-and-dot let it leave the process to the model provider. Conditions 3 and 4
 * exist to close that while keeping the float fix, and a PRECEDING-BYTES TEST MUST NEVER RETURN —
 * condition 4 reads the LITERAL, never the neighbourhood.
 *
 * WHY CONDITION 4 WAS WIDENED (ANLZ-01, measured 2026-08-29, phase 406). The accepted cost named
 * below was hit by a real page. Three `analyze-run` jobs in the 399 session's job store died
 * `permanent` after three attempts on `handler-threw: Guardrail blocked outbound prompt leaf:
 * creditCard`; rebuilding each failed run's analyze-run prompt from its own persisted handoff and
 * scanning it here reproduced the block on a MEMORY-RETRIEVAL RELEVANCE SCORE every time —
 * `1.1428571428571428` (8/7), `1.4869565217391303` and `1.0285714285714285`, whose 16-digit
 * fractions are all Luhn-valid. No card, no PII: a nonzero-integer float, exactly the shape the
 * accepted cost predicted. The retune route the previous revision prescribed was to admit a
 * delimited multi-digit integer part; taken literally that also readmits `card 1.<PAN> end`, the
 * headline 393 false negative. The round-trip test in condition 4 is the same widening made
 * discriminating: it admits a number a float formatter PRINTED and refuses one somebody assembled,
 * so both the 406 false positive and the 393 false negative stay closed at once.
 *
 * RESIDUAL BYPASS 1, accepted and named (2026-08-10). A Luhn-valid PAN written as the fraction of a
 * standalone zero-integer decimal — `ratio 0.4111111111111111 done` — is still suppressed. It is
 * lexically indistinguishable from the legitimate probability floats above; no purely lexical
 * detector can separate them. Pinned deliberately by the test "leaves the residual bypass open on
 * purpose: a PAN as the fraction of a zero-integer decimal" in `__tests__/detectors.test.ts`.
 *
 * RESIDUAL BYPASS 2, accepted and named (2026-08-29, new with condition 4). A SHORT Luhn-valid PAN
 * behind a nonzero integer part is suppressed when that literal happens to round-trip. Measured over
 * integer prefixes 1..100000: a 16-digit PAN (`4111111111111111`, `4012888888881881`,
 * `5555555555554444`, `5105105105105100`, `6011111111111117`) round-trips for ZERO of them — 17
 * significant digits exceed a double's precision — so the dominant card format is untouched. A
 * 15-digit Amex (`378282246310005`) round-trips for 7 prefixes (0.007%) and a 13-digit PAN
 * (`4222222222222`) for 2047 (2%). The bound is what makes this acceptable: it is strictly narrower
 * than the delimited-integer-part retune, which would have opened all of them including 16 digits.
 * Pinned by the test "leaves the widened residual open on purpose: a short PAN behind a nonzero
 * integer part that round-trips as a float".
 *
 * Adversarial encoding is outside this detector's accidental-egress scope: an adversary can encode a
 * PAN arbitrarily regardless of these rules.
 */
function isDecimalDigit(char: string | undefined): boolean {
  return char !== undefined && char >= '0' && char <= '9'
}

function isDelimiter(char: string | undefined): boolean {
  return char === undefined || (char !== '.' && !/[A-Za-z0-9_]/.test(char))
}

function isFractionalTail(text: string, start: number): boolean {
  if (start < 2 || text[start - 1] !== '.') {
    return false
  }

  let integerStart = start - 1
  while (integerStart > 0 && isDecimalDigit(text[integerStart - 1])) {
    integerStart -= 1
  }
  if (integerStart === start - 1) {
    return false
  }

  if (!isDelimiter(integerStart === 0 ? undefined : text[integerStart - 1])) {
    return false
  }

  // The 2026-08-10 rule, preserved byte-for-byte: a standalone zero-integer decimal is a
  // fractional tail unconditionally, so probability and confidence floats keep passing.
  if (text.slice(integerStart, start - 1) === '0') {
    return true
  }

  let fractionEnd = start
  while (fractionEnd < text.length && isDecimalDigit(text[fractionEnd])) {
    fractionEnd += 1
  }
  if (!isDelimiter(fractionEnd === text.length ? undefined : text[fractionEnd])) {
    return false
  }

  const literal = text.slice(integerStart, fractionEnd)
  const value = Number(literal)
  return Number.isFinite(value) && String(value) === literal
}

function matchCreditCards(text: string): GuardrailMatch[] {
  return matchesFromRegex('creditCard', CREDIT_CARD_CANDIDATE_RE, text).filter((match) => {
    if (isFractionalTail(text, match.start)) return false
    const digits = normalizeCardCandidate(match.value)
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits)
  })
}

function matchApiKeys(text: string): GuardrailMatch[] {
  return API_KEY_RE_LIST.flatMap((regex) => matchesFromRegex('apiKey', regex, text)).sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )
}

function matchInjectionShapes(text: string): GuardrailMatch[] {
  return [
    ...INSTRUCTION_OVERRIDE_RE_LIST,
    ...ROLE_IMPERSONATION_RE_LIST,
    ...CHAT_TEMPLATE_DELIMITER_RE_LIST,
  ]
    .flatMap((regex) => matchesFromRegex('injectionShape', regex, text))
    .sort((left, right) => left.start - right.start || right.end - left.end)
}

const DETECTORS: Record<GuardrailDetectorFamily, GuardrailDetector> = {
  awsKey: {
    detector: 'awsKey',
    kind: 'awsKey',
    match: (text) => matchesFromRegex('awsKey', AWS_ACCESS_KEY_RE, text),
  },
  creditCard: {
    detector: 'creditCard',
    kind: 'creditCard',
    match: matchCreditCards,
  },
  pemKey: {
    detector: 'pemKey',
    kind: 'pemKey',
    match: (text) => matchesFromRegex('pemKey', PEM_PRIVATE_KEY_RE, text),
  },
  bearer: {
    detector: 'bearer',
    kind: 'bearer',
    match: (text) => matchesFromRegex('bearer', BEARER_RE, text),
  },
  apiKey: {
    detector: 'apiKey',
    kind: 'apiKey',
    match: matchApiKeys,
  },
  email: {
    detector: 'email',
    kind: 'email',
    match: (text) => matchesFromRegex('email', EMAIL_RE, text),
  },
  injectionShape: {
    detector: 'injectionShape',
    kind: 'injectionShape',
    match: matchInjectionShapes,
  },
}

export function findDetectorMatches(
  detector: GuardrailDetectorFamily,
  text: string,
): GuardrailMatch[] {
  return DETECTORS[detector].match(text)
}
