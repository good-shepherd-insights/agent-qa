import { describe, expect, it } from 'vitest'

import { sha256hex16, type GuardrailDetectorFamily } from '@vostride/agent-qa-schema'
import { luhnValid } from '../luhn'
import { defaultGuardrailPolicyInput, loadGuardrailPolicy } from '../policy-loader'
import { scan, type FiredDetection } from '../scan'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)

function firedFor(fired: FiredDetection[], detector: GuardrailDetectorFamily): FiredDetection {
  const detection = fired.find((entry) => entry.detector === detector)
  expect(detection).toBeDefined()
  return detection as FiredDetection
}

describe('guardrail scan', () => {
  it('blocks AWS access-key IDs with the awsKey detector', () => {
    const awsKey = 'AKIAIOSFODNN7EXAMPLE'
    const output = scan(`Use ${awsKey} for this call`, policy)

    expect(output.result).toEqual({
      action: 'block',
      detector: 'awsKey',
      redactedFingerprint: sha256hex16(awsKey),
    })
    expect(output.redactedText).toBe(`Use ${awsKey} for this call`)
    expect(output.fired).toEqual([
      { detector: 'awsKey', action: 'block', redactedFingerprint: sha256hex16(awsKey) },
    ])
  })

  it('blocks only Luhn-valid credit-card candidates', () => {
    const card = '4242 4242 4242 4242'
    const valid = scan(`card ${card}`, policy)

    expect(valid.result.action).toBe('block')
    expect(valid.result.detector).toBe('creditCard')
    expect(valid.result.redactedFingerprint).toBe(sha256hex16(card))

    const invalid = '1234-5678-9012-3456'
    const invalidResult = scan(`order ${invalid}`, policy)

    expect(invalidResult.result).toEqual({ action: 'pass' })
    expect(invalidResult.redactedText).toBe(`order ${invalid}`)
    expect(invalidResult.fired).toEqual([])
  })

  // ------------------------------------------------------------------------------------------
  // A FLOAT IS NOT A CARD (measured 2026-08-10, phase 393 live lane).
  //
  // The candidate regex cannot see across the `.` in `0.45833333333333337`, so it offers the
  // 17-digit tail for scoring — and that tail is Luhn-valid. A procedure hint rendering
  // `(confidence 0.45833333333333337, ...)` therefore blocked EVERY outbound planning prompt for
  // one page of the demo target, deterministically, reporting only `creditCard`. Roughly one in ten
  // IEEE-754 decimal expansions of card-candidate length passes Luhn, so this is a standing chance
  // that any given page or brief becomes permanently unplannable.
  // ------------------------------------------------------------------------------------------

  it('does not read the fractional tail of a decimal as a credit-card candidate', () => {
    // The exact value that blocked the lane. Luhn-valid on its own, and not a card.
    expect(luhnValid('45833333333333337')).toBe(true)

    const output = scan('(confidence 0.45833333333333337, authoring tier full)', policy)

    expect(output.result).toEqual({ action: 'pass' })
    expect(output.fired).toEqual([])
  })

  it('still blocks a card that merely follows a dot after a non-digit', () => {
    // The narrowness is the point: only `<digit>.` immediately before a candidate is a decimal
    // tail. An abbreviation's full stop is not, and a PAN written after one is still a PAN.
    const card = '4242424242424242'
    const output = scan(`card no.${card}`, policy)

    expect(output.result.action).toBe('block')
    expect(output.result.detector).toBe('creditCard')
    expect(output.result.redactedFingerprint).toBe(sha256hex16(card))
  })

  it('still blocks a bare card at the very start of the text', () => {
    // The guard reads two characters BEFORE the match; a candidate at index 0 or 1 has no room for
    // a decimal point and must not be excluded by an out-of-range read.
    const card = '4242424242424242'
    const output = scan(card, policy)

    expect(output.result.action).toBe('block')
    expect(output.result.detector).toBe('creditCard')
  })

  it('blocks PEM private-key markers', () => {
    const marker = '-----BEGIN RSA PRIVATE KEY-----'
    const output = scan(`key ${marker}`, policy)

    expect(output.result.action).toBe('block')
    expect(output.result.detector).toBe('pemKey')
    expect(output.result.redactedFingerprint).toBe(sha256hex16(marker))
  })

  it('redacts bearer tokens with an irreversible typed token', () => {
    const bearer = 'Bearer abcdefghijklmno12345'
    const output = scan(`Authorization: ${bearer}`, policy)

    expect(output.result).toEqual({
      action: 'redact',
      detector: 'bearer',
      redactedFingerprint: sha256hex16(bearer),
    })
    expect(output.redactedText).toBe('Authorization: <REDACTED:bearer>')
    expect(output.fired).toEqual([
      { detector: 'bearer', action: 'redact', redactedFingerprint: sha256hex16(bearer) },
    ])
  })

  it('redacts API-key shapes without treating bare base64 as a block detector', () => {
    const keys = [
      'sk-abc123abc123abc123',
      'ghp_abc123abc123abc123',
      'gho_abc123abc123abc123',
      'AIzaSyD1234567890abcdefghijkl',
      'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCD',
    ]

    for (const key of keys) {
      const output = scan(`token ${key}`, policy)

      expect(output.result.action).toBe('redact')
      expect(output.result.detector).toBe('apiKey')
      expect(output.redactedText).toBe('token <REDACTED:apiKey>')
      expect(firedFor(output.fired, 'apiKey').redactedFingerprint).toBe(sha256hex16(key))
    }
  })

  it('redacts email addresses using the email detector', () => {
    const email = 'owner@example.com'
    const output = scan(`contact ${email}`, policy)

    expect(output.result.action).toBe('redact')
    expect(output.result.detector).toBe('email')
    expect(output.redactedText).toBe('contact <REDACTED:email>')
    expect(output.result.redactedFingerprint).toBe(sha256hex16(email))
  })

  it('passes ordinary prose without changing text', () => {
    const input = 'ordinary prose with no secret shape'
    const output = scan(input, policy)

    expect(output.result).toEqual({ action: 'pass' })
    expect(output.redactedText).toBe(input)
    expect(output.fired).toEqual([])
  })

  it('aggregates all fired families while block and precedence win', () => {
    const awsKey = 'ASIAIOSFODNN7EXAMPLE'
    const email = 'owner@example.com'
    const output = scan(`send ${awsKey} to ${email}`, policy)

    expect(output.result).toEqual({
      action: 'block',
      detector: 'awsKey',
      redactedFingerprint: sha256hex16(awsKey),
    })
    expect(output.redactedText).toBe(`send ${awsKey} to <REDACTED:email>`)
    expect(output.fired.map((entry) => entry.detector)).toEqual(['awsKey', 'email'])
    expect(firedFor(output.fired, 'awsKey').action).toBe('block')
    expect(firedFor(output.fired, 'email').action).toBe('redact')
  })

  it('skips allowlisted raw matches', () => {
    const email = 'owner@example.com'
    const output = scan(`contact ${email}`, { ...policy, allowlist: [email] })

    expect(output.result).toEqual({ action: 'pass' })
    expect(output.redactedText).toBe(`contact ${email}`)
    expect(output.fired).toEqual([])
  })

  it('does not fire families whose policy action is off', () => {
    const output = scan('contact owner@example.com', {
      ...policy,
      detectors: { ...policy.detectors, email: 'off' },
    })

    expect(output.result).toEqual({ action: 'pass' })
    expect(output.redactedText).toBe('contact owner@example.com')
    expect(output.fired).toEqual([])
  })
})
