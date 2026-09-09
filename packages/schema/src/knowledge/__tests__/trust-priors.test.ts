import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canonicalJson } from '../../index'
import { BundleOutcomeEventSchema, type OriginClass } from '../outcome-event'
import * as trust from '../trust-fold'

type Priors = Partial<Record<OriginClass, { alpha: number; beta: number }>>
const fold = trust.foldBundleTrust as (
  events: Parameters<typeof trust.foldBundleTrust>[0],
  opts: Parameters<typeof trust.foldBundleTrust>[1], priors?: Priors,
) => ReturnType<typeof trust.foldBundleTrust>
const opts = { originClass: 'agent-verified' as const, evidenceIncomplete: false, createdAtOrdinal: 10 }
const baseline = JSON.parse(readFileSync(new URL(
  '../../../../knowledge-local/src/__tests__/fixtures/420-prior-baseline.json', import.meta.url,
), 'utf8')) as { cases: { name: string; snapshots: {
  events: unknown[]; provenance: { originClass: OriginClass };
  manifest: { evidenceIncomplete: boolean; createdAtOrdinal: number }; expectedBytes: string;
}[] }[] }

describe('420 neutral trust priors', () => {
  it('uses supplied pseudo-counts instead of the provisional mean', () => {
    expect(fold([], opts, { 'agent-verified': { alpha: 2.7, beta: 0.3 } }).trust).toBe(0.9)
  })

  for (const entry of baseline.cases) {
    it(`preserves independently captured absent and empty bytes for ${entry.name}`, () => {
      for (const snapshot of entry.snapshots) {
        const events = snapshot.events.map(event => BundleOutcomeEventSchema.parse(event))
        const options = { ...snapshot.manifest, originClass: snapshot.provenance.originClass }
        expect(canonicalJson(fold(events, options))).toBe(snapshot.expectedBytes)
        expect(canonicalJson(fold(events, options, {}))).toBe(snapshot.expectedBytes)
        const priors: Priors = { 'agent-verified': { alpha: 2.7, beta: 0.3 } }
        const state = fold(events, options, priors)
        const { trust: savedTrust, ...savedRest } = JSON.parse(snapshot.expectedBytes)
        const { trust: actualTrust, ...actualRest } = state
        expect(actualRest).toEqual(savedRest)
        if (options.originClass !== 'agent-verified') expect(actualTrust).toBe(savedTrust)
        else {
          const alpha = options.evidenceIncomplete ? 1.35 : 2.7
          const positive = savedRest.counters.confirmed + 0.25 * savedRest.counters.helpful
          const negative = savedRest.counters.contradicted + 0.25 * savedRest.counters.harmful
          expect(actualTrust).toBe((positive + alpha) / (positive + negative + alpha + 0.3))
        }
        const before = canonicalJson({ events, options, priors })
        expect(canonicalJson(fold(events, options, priors))).toBe(canonicalJson(state))
        expect(canonicalJson({ events, options, priors })).toBe(before)
      }
    })
  }

  it.each([false, true])('keeps exact endpoint priors finite with incomplete=%s and later evidence', incomplete => {
    const options = { ...opts, evidenceIncomplete: incomplete }
    const events = ['confirmed', 'contradicted', 'helpful', 'harmful'].map((type, index) =>
      BundleOutcomeEventSchema.parse({ type, evidenceToken: `endpoint-${index}`, curationJobId: 'endpoint', buildOrdinal: 11 + index }))
    for (const p of [0, 1]) {
      const priors = { 'agent-verified': { alpha: p * 3, beta: (1 - p) * 3 } }
      expect(fold([], options, priors).trust).toBe(p)
      const alpha = p * 3 * (incomplete ? 0.5 : 1)
      expect(fold(events, options, priors).trust).toBe((1.25 + alpha) / (2.5 + alpha + (1 - p) * 3))
      expect(Number.isFinite(fold(events, options, priors).trust)).toBe(true)
    }
  })

  it('accepts explicit user/import overrides and does not mutate frozen data', () => {
    const priors = Object.freeze({ user: Object.freeze({ alpha: 0, beta: 4 }), import: Object.freeze({ alpha: 1.5, beta: 0 }) })
    expect(fold([], { ...opts, originClass: 'user' }, priors).trust).toBe(0)
    expect(fold([], { ...opts, originClass: 'import' }, priors).trust).toBe(1)
  })

  it.each([
    null, [], 1, 'private-input', { unknown: { alpha: 1, beta: 1 } },
    { user: undefined }, { user: null }, { user: [] }, { user: { alpha: 1 } },
    { user: { alpha: 1, beta: 1, privateInput: 'secret' } },
    ...[-1, NaN, Infinity, -Infinity, '1'].flatMap(value => [
      { user: { alpha: value, beta: 1 } }, { user: { alpha: 1, beta: value } },
    ]),
    { user: { alpha: 0, beta: 0 } }, { user: { alpha: Number.MAX_VALUE, beta: Number.MAX_VALUE } },
  ])('refuses malformed prior table %# with a fixed safe error', value => {
    expect(() => fold([], opts, value as Priors)).toThrow(new TypeError('Invalid trust prior table'))
  })

  it('exports a neutral guard that returns only validated data', () => {
    const guard = (trust as unknown as { guardTrustPriorTable: (value: unknown) => Priors }).guardTrustPriorTable
    expect(guard).toBeTypeOf('function')
    expect(guard({})).toEqual({})
    expect(guard({ 'agent-observed': { alpha: 0, beta: 2 } })).toEqual({ 'agent-observed': { alpha: 0, beta: 2 } })
    expect(() => guard({ unknown: 'private-input' })).toThrow(new TypeError('Invalid trust prior table'))
  })
})
