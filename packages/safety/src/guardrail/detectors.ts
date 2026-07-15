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

function matchCreditCards(text: string): GuardrailMatch[] {
  return matchesFromRegex('creditCard', CREDIT_CARD_CANDIDATE_RE, text).filter((match) => {
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
