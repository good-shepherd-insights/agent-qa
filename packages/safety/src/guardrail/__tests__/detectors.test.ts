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
    // The narrowness is the point: an abbreviation's full stop does not make a decimal, and a PAN
    // written after one is still a PAN.
    const card = '4242424242424242'
    const output = scan(`card no.${card}`, policy)

    expect(output.result.action).toBe('block')
    expect(output.result.detector).toBe('creditCard')
    expect(output.result.redactedFingerprint).toBe(sha256hex16(card))
  })

  it('still blocks a bare card at the very start of the text', () => {
    // The guard reads characters BEFORE the match; a candidate at index 0 or 1 has no room for a
    // decimal point and must not be excluded by an out-of-range read.
    const card = '4242424242424242'
    const output = scan(card, policy)

    expect(output.result.action).toBe('block')
    expect(output.result.detector).toBe('creditCard')
  })

  // ------------------------------------------------------------------------------------------
  // ...BUT A CARD BEHIND A `<digit>.` IS STILL A CARD (measured 2026-08-10, phase 393 verification,
  // REVIEW WR-05).
  //
  // The first cut of the suppression above tested only the two characters preceding the candidate,
  // so ANY `<digit>.` prefix suppressed it. Measured through this same real `scan()` + default
  // policy: `card 1.4111111111111111 end` and `v1.4012888888881881 ok` both returned
  // `{"action":"pass"}` while carrying Luhn-valid PANs, under a policy whose creditCard action is
  // `block` — a false negative in an egress control, i.e. a PAN leaving the process.
  //
  // The rule enforced now is narrower in the safe direction: a candidate is a fractional tail ONLY
  // when it is the fraction of a STANDALONE ZERO-INTEGER decimal — `.` immediately before it, `0`
  // before that, and no word character and no further `.` before the `0`. That is the shape every
  // measured false positive has (probability/confidence floats print as `0.<fraction>`); every
  // other `<digit>.` context fails toward block.
  //
  // Both directions are pinned in this same group on purpose (390/392 two-sided-pin history): the
  // reject direction below, and the accept direction in the confidence-float case above.
  // ------------------------------------------------------------------------------------------

  it('blocks a Luhn-valid PAN written behind a nonzero integer part', () => {
    // THE headline measured false negative. `1.` is a decimal point, but not a zero-integer one.
    const card = '4111111111111111'
    expect(luhnValid(card)).toBe(true)

    const output = scan(`card 1.${card} end`, policy)

    expect(output.result).toEqual({
      action: 'block',
      detector: 'creditCard',
      redactedFingerprint: sha256hex16(card),
    })
  })

  it('blocks a Luhn-valid PAN behind a word-glued version-style prefix', () => {
    // `v1.` — no decimal literal here at all; the digit is glued to a word character.
    const card = '4012888888881881'
    expect(luhnValid(card)).toBe(true)

    const output = scan(`v1.${card} ok`, policy)

    expect(output.result.action).toBe('block')
    expect(output.result.detector).toBe('creditCard')
    expect(output.result.redactedFingerprint).toBe(sha256hex16(card))
  })

  it('blocks a Luhn-valid PAN inside a dotted version-style chain', () => {
    // `1.0.` ends in `0.`, but that `0` is itself preceded by a `.`: a dotted digit chain, not a
    // standalone zero-integer decimal. The zero-integer test is anchored, not a suffix match.
    const card = '4111111111111111'
    const output = scan(`build 1.0.${card} done`, policy)

    expect(output.result.action).toBe('block')
    expect(output.result.detector).toBe('creditCard')
    expect(output.result.redactedFingerprint).toBe(sha256hex16(card))
  })

  it('leaves the residual bypass open on purpose: a PAN as the fraction of a zero-integer decimal', () => {
    // PINNED RESIDUAL, not an oversight. `0.4111111111111111` is lexically indistinguishable from
    // the probability floats the suppression exists for, so the guardrail suppresses it too. It is
    // named in the `isFractionalTail` doc block as the accepted residual, with the accepted cost.
    // If a future change closes this, that is a deliberate retune: this test failing is the signal
    // to update the doc alongside it, never to delete the case quietly.
    const output = scan('ratio 0.4111111111111111 done', policy)

    expect(output.result).toEqual({ action: 'pass' })
    expect(output.fired).toEqual([])
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
