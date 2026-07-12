import { describe, expect, it } from 'vitest'

import type { ScopeKey } from '../../identity/scope-key'
import {
  BUNDLE_ID_HASH_SUFFIX_LENGTH,
  BUNDLE_SLUG_MAX_LENGTH,
  bundleSlug,
  computeBundleIdentityHash,
  computeStepSequenceSignature,
  deriveDiscriminantKey,
  mintBundleId,
} from '../content-address'

const productScope: ScopeKey = { tier: 'product', key: 'shop' }

describe('bundle content address (D-05/D-06/D-07)', () => {
  it('normalizes the primary anchor before hashing and mints the pinned id shape', () => {
    const discriminantKey = deriveDiscriminantKey({
      kind: 'fact',
      subtype: 'selector',
      elementRef: { role: 'button', name: 'Cart' },
    })
    const first = {
      kind: 'fact' as const,
      subtype: 'selector' as const,
      primaryAnchor: { t: 'el' as const, role: 'BUTTON', name: 'Cart (3)' },
      scope: productScope,
      discriminantKey,
    }
    const second = {
      ...first,
      primaryAnchor: { t: 'el' as const, role: 'button', name: 'Cart (7)' },
    }

    expect(computeBundleIdentityHash(first)).toBe(computeBundleIdentityHash(second))
    expect(mintBundleId(first)).toBe(mintBundleId(second))
    expect(mintBundleId(first)).toMatch(/^[a-z0-9-]+-[0-9a-f]{16}$/)
    expect(BUNDLE_ID_HASH_SUFFIX_LENGTH).toBe(16)
    expect(BUNDLE_SLUG_MAX_LENGTH).toBe(48)
  })

  it('derives stable discriminants and order-sensitive procedure signatures', () => {
    expect(
      deriveDiscriminantKey({
        kind: 'unknown',
        conflictRecordIds: ['record-b', 'record-a'],
      }),
    ).toBe(
      deriveDiscriminantKey({
        kind: 'unknown',
        conflictRecordIds: ['record-a', 'record-b'],
      }),
    )
    expect(
      deriveDiscriminantKey({ kind: 'caution', errorKey: 'Timeout after 5000ms' }),
    ).toBe(deriveDiscriminantKey({ kind: 'caution', errorKey: 'timeout after 3000ms' }))
    expect(computeStepSequenceSignature(['open-cart', 'checkout'])).not.toBe(
      computeStepSequenceSignature(['checkout', 'open-cart']),
    )
  })

  it('forms a bounded slug through the shared path-segment sanitizer', () => {
    const slug = bundleSlug('fact', {
      t: 'el',
      role: 'BUTTON',
      name: `../../Cart\u0000 ${'very long '.repeat(12)}`,
    })

    expect(slug).toMatch(/^[a-z0-9-]+$/)
    expect(slug.length).toBeLessThanOrEqual(BUNDLE_SLUG_MAX_LENGTH)
    expect(slug).not.toContain('..')
    expect(slug).not.toContain('/')
  })
})
