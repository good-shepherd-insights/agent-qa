// The D-13 action-anchor fingerprint: the sibling recipe, pinned as golden BYTES.
//
// Gate 3 compares a draft's elements against the union of the suite's, and the derived
// fingerprint table accumulates those elements across runs — so changing this recipe re-keys
// every accrued coverage comparison (the 389 D-13 lesson, applied to the sibling). The goldens
// below are what make that cost visible: they anchor the contract OUTSIDE the module's own
// vocabulary rather than phrasing it as a relation among its own outputs (the 383 lesson).
//
// The first commit of this file is RED by construction: `../action-anchor-fingerprint` does
// not exist yet.

import { describe, expect, it } from 'vitest'

import type { Anchor } from '../../identity/anchor'
import {
  ACTION_ANCHOR_FINGERPRINT_VERSION,
  actionAnchorElement,
  actionAnchorSequence,
  type ActionAnchorElementInput,
} from '../action-anchor-fingerprint'

const USERNAME: Anchor = { t: 'el', role: 'textbox', name: 'Username' }
/** The same element as a human would retype it: shouting role, padded and wrapped name. */
const USERNAME_NOISY: Anchor = { t: 'el', role: '  TextBox ', name: '  Username\n ' }
const SUBMIT: Anchor = { t: 'el', role: 'button', name: 'Submit' }

describe('actionAnchorElement (393 D-13/D-14)', () => {
  it('is deterministic: the same input yields byte-identical elements', () => {
    const input: ActionAnchorElementInput = { kind: 'action', type: 'click', anchor: SUBMIT }
    expect(actionAnchorElement(input)).toBe(actionAnchorElement(input))
  })

  it('collapses casing and whitespace noise — conservatism lives in the normalizer (D-14)', () => {
    // D-14 has no similarity threshold to defend, so near-same elements MUST normalize equal
    // or the set difference over-reports novelty and gate 3 waves duplicates through.
    expect(actionAnchorElement({ kind: 'action', type: 'click', anchor: USERNAME_NOISY })).toBe(
      actionAnchorElement({ kind: 'action', type: 'click', anchor: USERNAME }),
    )
  })

  it('pins the action element golden bytes', () => {
    expect(actionAnchorElement({ kind: 'action', type: 'click', anchor: SUBMIT })).toBe(
      '{"anchor":{"name":"submit","role":"button","t":"el"},"kind":"action","type":"click"}',
    )
  })

  it('separates an assertion from an action on the same anchor', () => {
    const action = actionAnchorElement({ kind: 'action', type: 'click', anchor: USERNAME })
    const assertion = actionAnchorElement({
      kind: 'assert',
      type: 'assertValue',
      anchor: USERNAME,
    })
    expect(assertion).not.toBe(action)
  })

  it('pins the assertion element golden bytes — assert-kind plus normalized target', () => {
    expect(
      actionAnchorElement({ kind: 'assert', type: 'assertValue', anchor: USERNAME }),
    ).toBe(
      '{"anchor":{"name":"username","role":"textbox","t":"el"},"kind":"assert","type":"assertValue"}',
    )
  })

  it('separates two different action types on the same anchor', () => {
    expect(actionAnchorElement({ kind: 'action', type: 'fill', anchor: USERNAME })).not.toBe(
      actionAnchorElement({ kind: 'action', type: 'click', anchor: USERNAME }),
    )
  })

  it('distinguishes an element carrying a route context from the same element without one', () => {
    const withRoute = actionAnchorElement({
      kind: 'action',
      type: 'click',
      anchor: SUBMIT,
      route: '/form.html',
    })
    expect(withRoute).not.toBe(
      actionAnchorElement({ kind: 'action', type: 'click', anchor: SUBMIT }),
    )
    expect(withRoute).toBe(
      '{"anchor":{"name":"submit","role":"button","t":"el"},"kind":"action","route":"/form.html","type":"click"}',
    )
  })

  it('normalizes the route context through the frozen anchor contract', () => {
    // Routes casefold and lose hashes and trailing slashes — the same collapse
    // `normalizeAnchor` already applies to a page anchor, reused rather than re-derived.
    expect(
      actionAnchorElement({
        kind: 'action',
        type: 'click',
        anchor: SUBMIT,
        route: '/Form.html/#thanks',
      }),
    ).toBe(
      actionAnchorElement({ kind: 'action', type: 'click', anchor: SUBMIT, route: '/form.html' }),
    )
  })

  it('keys a page anchor and a flow anchor apart from an element anchor', () => {
    const page = actionAnchorElement({ kind: 'action', type: 'goto', anchor: { t: 'page', route: '/form.html' } })
    const flow = actionAnchorElement({ kind: 'action', type: 'goto', anchor: { t: 'flow', name: 'form.html' } })
    expect(page).not.toBe(flow)
  })

  it('is byte-stable across an argument-order rewrite of the same input', () => {
    // canonicalJson sorts keys, so a caller building the input object in another order cannot
    // mint a second key for the same fact.
    const a: ActionAnchorElementInput = { kind: 'action', type: 'click', anchor: SUBMIT, route: '/x' }
    const b: ActionAnchorElementInput = { route: '/x', anchor: SUBMIT, type: 'click', kind: 'action' }
    expect(actionAnchorElement(b)).toBe(actionAnchorElement(a))
  })

  it('pins the recipe version at 1', () => {
    expect(ACTION_ANCHOR_FINGERPRINT_VERSION).toBe(1)
  })
})

describe('actionAnchorSequence (393 D-13)', () => {
  const STEPS: readonly ActionAnchorElementInput[] = [
    { kind: 'action', type: 'fill', anchor: USERNAME },
    { kind: 'action', type: 'click', anchor: SUBMIT },
    { kind: 'assert', type: 'assertValue', anchor: SUBMIT },
  ]

  it('preserves input order and length', () => {
    const sequence = actionAnchorSequence(STEPS)
    expect(sequence).toHaveLength(STEPS.length)
    expect(sequence).toEqual(STEPS.map((step) => actionAnchorElement(step)))
  })

  it('is order-sensitive as a sequence', () => {
    expect(actionAnchorSequence([...STEPS].reverse())).not.toEqual(actionAnchorSequence(STEPS))
  })

  it('keeps repeated elements rather than collapsing them — the SET lives at the consumer', () => {
    // D-14's set semantics are the gate-3 consumer's job. The recipe mints elements in order;
    // deduplicating here would quietly destroy the sequence information a later enrichment needs.
    const repeated = actionAnchorSequence([STEPS[0], STEPS[0]])
    expect(repeated).toHaveLength(2)
    expect(repeated[0]).toBe(repeated[1])
  })

  it('maps an empty step list to an empty sequence', () => {
    expect(actionAnchorSequence([])).toEqual([])
  })
})
