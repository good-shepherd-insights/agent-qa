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
 * Is this candidate the fraction of a STANDALONE ZERO-INTEGER DECIMAL rather than a number in its
 * own right?
 *
 * THE RULE ENFORCED, verbatim — suppress iff all three hold:
 *   1. `text[start - 1] === '.'`  (a decimal point immediately precedes the candidate)
 *   2. `text[start - 2] === '0'`  (the integer part is a single zero)
 *   3. `start === 2`, or `text[start - 3]` is neither a word character `[A-Za-z0-9_]` nor `'.'`
 *      (that zero stands alone: not glued to a word, not a link in a dotted chain)
 * Everything else — a nonzero integer part, a word-glued prefix, a dotted chain — is NOT a
 * fractional tail and falls through to Luhn scoring, i.e. fails toward block.
 *
 * WHY SUPPRESS AT ALL (measured 2026-08-10, demo local-form target). `CREDIT_CARD_CANDIDATE_RE`
 * cannot see across the `.` in `0.45833333333333337`, so what it offers for scoring is the 17-digit
 * tail `45833333333333337` — Luhn-valid, so the entire outbound prompt was blocked. A procedure hint
 * rendering `(confidence 0.45833333333333337, ...)` refused every planning turn for that page,
 * deterministically, with no way for an operator to tell from `Guardrail blocked outbound prompt
 * leaf: creditCard` that the "card" was a float. About one in ten IEEE-754 decimal expansions of
 * candidate length is Luhn-valid, so that is a standing ~10% chance any given page or brief becomes
 * permanently unplannable. That fix is preserved exactly: probability and confidence floats print as
 * `0.<fraction>`, which is precisely the shape this rule — and only this rule — suppresses.
 *
 * WHY THE RULE IS SHAPED THIS WAY (regression, measured 2026-08-10, phase 393 verification). The
 * first cut of this guard tested only the two characters before the candidate — any `<digit>.` at
 * all. Through the real `scan()` + the default policy, `card 1.4111111111111111 end` and
 * `v1.4012888888881881 ok` both returned `{"action":"pass"}` while carrying Luhn-valid PANs, under a
 * policy whose creditCard action is `block`: a false negative in an egress control, i.e. prefixing a
 * PAN with any digit-and-dot let it leave the process to the model provider. The three conditions
 * above exist to close that while keeping the float fix.
 *
 * RESIDUAL BYPASS, accepted and named. A Luhn-valid PAN written as the fraction of a standalone
 * zero-integer decimal — `ratio 0.4111111111111111 done` — is still suppressed. It is lexically
 * indistinguishable from the legitimate probability floats above; no purely lexical detector can
 * separate them. Pinned deliberately by the test "leaves the residual bypass open on purpose: a PAN
 * as the fraction of a zero-integer decimal" in `__tests__/detectors.test.ts`, so closing it is a
 * conscious retune rather than an accident. Adversarial encoding is outside this detector's
 * accidental-egress scope: an adversary can encode a PAN arbitrarily regardless of this rule.
 *
 * ACCEPTED COST, and the retune route. A genuine NONZERO-integer float whose fraction is a Luhn-valid
 * 13–19 digit run now blocks (~10% of IEEE-754 expansions of that length). The measured
 * false-positive source never produced one — it emitted probabilities, always `0.<fraction>`. If a
 * real page ever hits this, the retune is to WIDEN the standalone-decimal test (e.g. admit a
 * multi-digit integer part that is itself delimited), never to revert to a preceding-bytes test:
 * that is the shape that shipped the regression above.
 */
function isFractionalTail(text: string, start: number): boolean {
  if (start < 2 || text[start - 1] !== '.' || text[start - 2] !== '0') {
    return false
  }

  if (start === 2) {
    return true
  }

  const preceding = text[start - 3] as string
  return preceding !== '.' && !/[A-Za-z0-9_]/.test(preceding)
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
