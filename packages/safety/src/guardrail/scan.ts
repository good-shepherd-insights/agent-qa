import {
  sha256hex16,
  type GuardrailDetectorFamily,
  type GuardrailPolicy,
  type ScanAction,
  type ScanResult,
} from '@vostride/agent-qa-schema'

import { DETECTOR_PRECEDENCE, findDetectorMatches, type GuardrailMatch } from './detectors'

type FiringAction = Exclude<ScanAction, 'pass'>
type GuardrailDetectorAction = GuardrailPolicy['detectors'][GuardrailDetectorFamily]

export interface FiredDetection {
  detector: GuardrailDetectorFamily
  action: FiringAction
  redactedFingerprint: string
}

export interface ScanOutput {
  result: ScanResult
  redactedText: string
  fired: FiredDetection[]
}

interface ActiveMatch extends GuardrailMatch {
  action: FiringAction
  redactedFingerprint: string
}

function isFiringAction(action: GuardrailDetectorAction): action is FiringAction {
  return action === 'block' || action === 'redact'
}

function isAllowlisted(match: GuardrailMatch, policy: GuardrailPolicy): boolean {
  return policy.allowlist.includes(match.value)
}

function redactionToken(detector: GuardrailDetectorFamily): string {
  return `<REDACTED:${detector}>`
}

function redactMatches(text: string, matches: ActiveMatch[]): string {
  const redactions = matches
    .filter((match) => match.action === 'redact')
    .sort((left, right) => left.start - right.start || right.end - left.end)

  if (redactions.length === 0) {
    return text
  }

  let output = ''
  let cursor = 0

  for (const match of redactions) {
    if (match.start < cursor) {
      continue
    }

    output += text.slice(cursor, match.start)
    output += redactionToken(match.kind)
    cursor = match.end
  }

  output += text.slice(cursor)
  return output
}

function aggregateAction(matches: ActiveMatch[]): ScanAction {
  if (matches.some((match) => match.action === 'block')) {
    return 'block'
  }

  if (matches.some((match) => match.action === 'redact')) {
    return 'redact'
  }

  return 'pass'
}

export function scan(text: string, policy: GuardrailPolicy): ScanOutput {
  const activeMatches: ActiveMatch[] = []
  const fired: FiredDetection[] = []

  for (const detector of DETECTOR_PRECEDENCE) {
    const action = policy.detectors[detector]
    if (!isFiringAction(action)) {
      continue
    }

    const matches = findDetectorMatches(detector, text)
      .filter((match) => !isAllowlisted(match, policy))
      .map((match): ActiveMatch => {
        return {
          ...match,
          action,
          redactedFingerprint: sha256hex16(match.value),
        }
      })

    if (matches.length === 0) {
      continue
    }

    activeMatches.push(...matches)
    fired.push({
      detector,
      action,
      redactedFingerprint: matches[0].redactedFingerprint,
    })
  }

  if (activeMatches.length === 0) {
    return { result: { action: 'pass' }, redactedText: text, fired }
  }

  const topMatch = activeMatches[0]
  const result: ScanResult = {
    action: aggregateAction(activeMatches),
    detector: topMatch.detector,
    redactedFingerprint: topMatch.redactedFingerprint,
  }

  return {
    result,
    redactedText: redactMatches(text, activeMatches),
    fired,
  }
}
