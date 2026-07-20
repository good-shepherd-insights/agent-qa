import { describe, expect, it } from 'vitest'
import {
  SecretStore,
  SecretRedactor,
  MissingSecretError,
  findSecretTemplates,
  redactSecretValue,
  resolveSecretTemplatesInValue,
  containsRedactedSecretMarker,
} from '../secrets.js'

describe('findSecretTemplates', () => {
  it('extracts {{secret:*}} templates from text', () => {
    expect(findSecretTemplates('login with {{secret:password}} and {{secret:token}}')).toEqual([
      { pattern: '{{secret:password}}', name: 'password' },
      { pattern: '{{secret:token}}', name: 'token' },
    ])
  })
})

describe('redactSecretValue', () => {
  it('replaces secret values with the redaction marker in plans/results/error strings', () => {
    const store = new SecretStore({ password: 'hunter2' })
    const redactor = new SecretRedactor(store)
    const redacted = redactSecretValue(
      { note: 'entered hunter2', nested: ['hunter2'] },
      redactor,
    )
    expect(redacted).toEqual({ note: 'entered [secret]', nested: ['[secret]'] })
  })

  it('rewrites {{secret:name}} templates to [secret:name] markers', () => {
    const store = new SecretStore({ password: 'hunter2' })
    const redactor = new SecretRedactor(store)
    expect(redactSecretValue('fill {{secret:password}}', redactor)).toBe('fill [secret:password]')
  })

  it('returns the value unchanged when no redactor is given', () => {
    expect(redactSecretValue('hunter2', undefined)).toBe('hunter2')
  })
})

describe('resolveSecretTemplatesInValue', () => {
  it('substitutes secret templates only when given a store', () => {
    const store = new SecretStore({ password: 'hunter2' })
    expect(resolveSecretTemplatesInValue({ value: 'fill {{secret:password}}' }, store)).toEqual({
      value: 'fill hunter2',
    })
    // Without a store, templates are left intact (resolved only at the execute boundary).
    expect(resolveSecretTemplatesInValue('fill {{secret:password}}', undefined)).toBe(
      'fill {{secret:password}}',
    )
  })
})

describe('containsRedactedSecretMarker', () => {
  it('returns true for a plan containing a redacted marker (cache-poisoning guard)', () => {
    expect(containsRedactedSecretMarker({ action: { type: 'fill', value: '[secret:password]' } })).toBe(true)
  })

  it('returns false for a plan with no redacted marker', () => {
    expect(containsRedactedSecretMarker({ action: { type: 'fill', value: 'plaintext' } })).toBe(false)
  })
})

// G-381-5 drift guard (Phase 381, Plan 44). The planner system prompt's Rule 23
// SECRET PLACEHOLDERS makes a two-part promise to the model:
//   (a) what you see is `[secret:NAME]` — the value exists but is masked;
//   (b) emit `{{secret:NAME}}` verbatim as the action value and the harness
//       substitutes the real value at dispatch (loop/index.ts executeResolvedAction).
// Both halves are pinned here on one fixture so the prompt can never overpromise:
// if a future change breaks either half, this fails loudly instead of the rule
// silently becoming a lie and the planner regressing to infeasible declarations.
describe('prompt/mechanism round trip (G-381-5 contract)', () => {
  const SECRET_NAME = 'loginPassword'
  const BOUND_VALUE = 'hunter2-correct-horse'
  const TEMPLATE = `{{secret:${SECRET_NAME}}}`
  const DISPLAY_MARKER = `[secret:${SECRET_NAME}]`

  const store = new SecretStore({ [SECRET_NAME]: BOUND_VALUE })
  const redactor = new SecretRedactor(store)

  const stepText = `Type ${TEMPLATE} into the password field`
  const plannedAction = { type: 'fill', ref: 'e12', value: TEMPLATE }

  it('half A — model-bound step text displays the template as the named marker', () => {
    // This is exactly what the planner sees, and what Rule 23 tells it to expect.
    expect(redactor.redactString(stepText)).toBe(
      `Type ${DISPLAY_MARKER} into the password field`,
    )
    expect(containsRedactedSecretMarker(redactor.redactString(stepText))).toBe(true)
  })

  it('half B — a planned action carrying the template form resolves at dispatch', () => {
    // Rule 23 instructs the model to emit the TEMPLATE form verbatim as the value.
    // The dispatch seam resolves it, so following the rule succeeds by construction.
    expect(resolveSecretTemplatesInValue(plannedAction, store)).toEqual({
      type: 'fill',
      ref: 'e12',
      value: BOUND_VALUE,
    })
  })

  it('negative — the bound value never appears in redacted model-bound text', () => {
    // Value-pattern masking re-pinned on this fixture (T-381-106): teaching the
    // mechanism must not widen disclosure. Even if the raw value leaks into a
    // result or error string, model-bound text shows the generic marker.
    const leaked = `the field now contains ${BOUND_VALUE}`
    const redacted = redactor.redactString(leaked)
    expect(redacted).not.toContain(BOUND_VALUE)
    expect(redacted).toBe('the field now contains [secret]')

    // ...and the redacted step text never carries the value either.
    expect(redactor.redactString(stepText)).not.toContain(BOUND_VALUE)
  })

  it('failure — a template naming an unbound secret keeps its current semantics', () => {
    // Pins today's behavior (store.require throws MissingSecretError); no change.
    // loop/index.ts resolves INSIDE the try, so this surfaces as a redacted
    // execError and the action never reaches the adapter.
    expect(() =>
      resolveSecretTemplatesInValue({ value: '{{secret:neverBound}}' }, store),
    ).toThrow(MissingSecretError)
  })
})
