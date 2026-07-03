import { describe, expect, it } from 'vitest'
import {
  SecretStore,
  SecretRedactor,
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
