// THE ONE PREDICATE MUST ANSWER FOR A CONTAINER THE WAY IT ANSWERS FOR ITS LEAVES (395-23 · F-03-R4a).
//
// WHAT THE VERIFIER MEASURED. `isCredentialEntry` returned `false` for ANY non-string value
// (`credential-entry.ts:106` before this plan), so a caller holding a whole `registry.llms[]` array
// — every provider credential this product has, sitting inside it — got the same answer it would
// get for an empty config: no. `config show` was the road the verifier drove; the MCP masker is the
// other one, and 395-25 is the cells for it.
//
// WHY THIS IS NOT DEAD CODE BESIDE 395-23's OTHER HALF, stated as the thing to check rather than
// asserted. Task 1 taught `flattenObject` to decompose arrays, so on the RENDER road the predicate
// is never handed a container any more — it sees `registry.llms[0].baseURL`, a string, and the
// value-shape arm catches it. That is exactly why the two halves are measured on DISJOINT cells:
// tear out the recursion and (K5) reds while this file stays green; tear out the arm below and this
// file reds while (K5) stays green. Each half is proven to carry its own weight, and the arm below
// is the backstop for every caller that does NOT decompose first.
//
// AND IT IS THE SAME VOCABULARY, NOT A SECOND ONE. The arm scans the value's JSON serialization
// through `CREDENTIAL_VALUE_DETECTORS` — the identical families the string arm and the SC-2
// construction scan use. Minting a container-specific pattern list here would be the sibling
// predicate this whole phase exists to kill (388/390/392: two answers to one question drift).
//
// WHAT MAKES EACH CELL RED:
//
//  (K7) the firing arm      — a container carrying a credential-shaped byte. Reds if the non-string
//                             arm is removed, or if it is narrowed to arrays-of-objects only.
//  (K7-control) non-firing  — a container of the SAME shape with no credential byte in it. This is
//                             what forbids reading (K7) as "any non-string is a credential", which
//                             would blacken `workspace.testMatch` and every other ordinary list.
//  (K7-vocab) the pin       — the container answer equals the answer its own leaf gets. If someone
//                             gives this arm its own patterns, the two answers can drift and this
//                             cell is where that shows up.
//  (K7-nullish)             — `undefined`/`null` stay false. `JSON.stringify(undefined)` is
//                             `undefined`, not a string, and `JSON.stringify(null)` is the four
//                             characters `null`; an arm written without care throws on the first
//                             and could pass the second to a detector.
//  (K7-name)                — the key-name arm still wins first, on a container. A container under a
//                             credential NAME is credential-bearing whatever its bytes look like.

import { describe, expect, it } from 'vitest'

import { isCredentialEntry } from '../credential-entry.js'

/** Fixture-owned, `sk-`-shaped, and unmistakably not a live credential. */
const PLANTED = 'sk-ant-api03-395twentythreePREDICATEFIXTUREONLYnotarealkey'

/** The shape the verifier reproduced CR-01 on: this product's own `registry.llms[]` element. */
const LEAKY_CONTAINER = [
  { name: 'primary', baseURL: `https://user:${PLANTED}@api.example.com` },
]

/** The same shape with the credential taken out — the non-firing control's input. */
const CLEAN_CONTAINER = [
  { name: 'primary', baseURL: 'https://api.example.com' },
]

describe('the one credential predicate answers for containers too (395-23 · F-03-R4a)', () => {
  it('(K7) a container carrying a credential-shaped byte IS credential-bearing', () => {
    expect(
      isCredentialEntry('llms', LEAKY_CONTAINER),
      'a credential nested in an array subtree must not be invisible to the predicate',
    ).toBe(true)
  })

  it('(K7-control) a container with no credential byte in it is NOT', () => {
    expect(
      isCredentialEntry('llms', CLEAN_CONTAINER),
      'an ordinary array must stay ordinary — the arm reads bytes, it does not fear containers',
    ).toBe(false)
    expect(
      isCredentialEntry('workspace.testMatch', ['tests/**/*.yaml', 'e2e/**/*.yaml']),
      'an ordinary list of globs must stay ordinary',
    ).toBe(false)
    expect(isCredentialEntry('registry.llms', []), 'an empty array carries no bytes').toBe(false)
    expect(isCredentialEntry('use.parallel', false), 'a boolean carries no bytes').toBe(false)
    expect(isCredentialEntry('services.dashboard.port', 4173), 'a port is not a credential')
      .toBe(false)
  })

  it('(K7-vocab) the container\'s answer is the answer its own leaf gets', () => {
    // ONE VOCABULARY, PINNED. Both of these resolve through the same
    // `CREDENTIAL_VALUE_DETECTORS` families; if the non-string arm ever grows its own pattern list,
    // the two sides can disagree and that disagreement lands here.
    const leaf = LEAKY_CONTAINER[0].baseURL
    expect(isCredentialEntry('baseURL', leaf), 'the string arm on the leaf').toBe(true)
    expect(
      isCredentialEntry('llms', LEAKY_CONTAINER),
      'the container arm must agree with the leaf arm on the same bytes',
    ).toBe(isCredentialEntry('baseURL', leaf))

    const cleanLeaf = CLEAN_CONTAINER[0].baseURL
    expect(
      isCredentialEntry('llms', CLEAN_CONTAINER),
      'and they must agree on the negative too',
    ).toBe(isCredentialEntry('baseURL', cleanLeaf))
  })

  it('(K7-nullish) undefined and null stay false', () => {
    expect(isCredentialEntry('someOrdinaryKey', undefined)).toBe(false)
    expect(isCredentialEntry('someOrdinaryKey', null)).toBe(false)
    expect(isCredentialEntry('someOrdinaryKey', ''), 'the empty string was already false')
      .toBe(false)
  })

  it('(K7-unreadable) a value the predicate cannot serialize fails CLOSED', () => {
    // THE DIRECTION OF THE UNKNOWN. `JSON.stringify` throws on a circular structure and on a
    // BigInt. Answering `false` there would mean "not a credential" for the one input class this
    // function knows nothing about — on a predicate that gates both a redaction and a write
    // refusal. It answers `true`, which costs a `<redacted>` and a refused write and cannot cost a
    // disclosure.
    const circular: Record<string, unknown> = { name: 'primary' }
    circular.self = circular
    expect(
      isCredentialEntry('llms', circular),
      'an unserializable value must not be cleared by a scan that never ran',
    ).toBe(true)
    expect(isCredentialEntry('someOrdinaryKey', 10n), 'a BigInt is unserializable too').toBe(true)

    // AND THE BOUND ON THAT: a value that serializes to NOTHING is not unknown, it is empty.
    expect(
      isCredentialEntry('someOrdinaryKey', () => 'x'),
      'a function renders no bytes and hides nothing',
    ).toBe(false)
  })

  it('(K7-name) the key-name arm still answers first, container or not', () => {
    expect(
      isCredentialEntry('credentials', [{ opaque: 'nothing-a-detector-recognises' }]),
      'a container under a credential NAME is credential-bearing whatever its bytes look like',
    ).toBe(true)
  })
})

// AN ANCESTOR'S NAME IS PART OF THE PATH A DECOMPOSED LEAF INHERITS (395-26 · T-395-R5-04).
//
// WHAT THE SECURITY AUDITOR MEASURED. `flattenObject` hands this predicate the WHOLE dotted row key,
// and the name arm read only the last segment of it. So `credentials[0].pass`,
// `plugins.myplugin.credentials.pass` and `registry.llms[0].apiKey.value` all normalized to `pass`
// or `value` — members of no set — and the shipped `config show` printed every one of them at exit
// 0. Round 5 fixed the ARRAY instance (`credentials[0]` keeping its own name); the class is
// ancestor-name loss, and a plain nested object leaks by the identical mechanism with no array
// anywhere on the path.
//
// THE VALUES BELOW ARE OPAQUE ON PURPOSE. A `sk-`-shaped value would be cleared by the value arm and
// these cells would pass with the ancestor arm deleted — the (K3-name) non-vacuity discipline,
// applied to the arm this family is actually about.
//
//  (K8)         the ancestor arm fires — reds if the name question is narrowed back to one segment.
//  (K8-control) it is SCOPED, not global — reds if the arm answers true for any deep path, which
//               would blacken `workspace.testMatch`, a port and a timeout and make `config show`
//               useless.
//  (K8-index)   the trailing index is stripped on ANCESTOR segments too, not only on the last one.
describe('the credential name question reads every segment of the path (395-26 · T-395-R5-04)', () => {
  /** Unremarkable word-and-digit strings. No detector family recognises any of them. */
  const OPAQUE = 'tealwood-7412-delta-fixtureonly'

  it('(K8) the arm fires on an ancestor, whether that ancestor holds an object, an array element or a nested key', () => {
    // NON-VACUITY FIRST: the value carries no credential shape, so only the NAME question can
    // answer true below.
    expect(
      isCredentialEntry('someOrdinaryKey', OPAQUE),
      'the fixture value must be opaque or the value arm is carrying this family',
    ).toBe(false)

    expect(
      isCredentialEntry('plugins.myplugin.credentials.pass', OPAQUE),
      'a plain nested object under a credential-named key — the CLASS, no array anywhere',
    ).toBe(true)
    expect(
      isCredentialEntry('credentials[0].pass', OPAQUE),
      'an object element of a credential-named array — the instance round 5 closed',
    ).toBe(true)
    expect(
      isCredentialEntry('registry.llms[0].apiKey.value', OPAQUE),
      'an object under a credential-named key inside an array — the register\'s own named component',
    ).toBe(true)
  })

  it('(K8-control) the arm is SCOPED to credential names — an ordinary deep path stays ordinary', () => {
    expect(
      isCredentialEntry('workspace.testMatch', ['tests/**/*.yaml', 'e2e/**/*.yaml']),
      'an ordinary list of globs must stay ordinary under a deep key',
    ).toBe(false)
    expect(
      isCredentialEntry('registry.llms[0].baseURL', 'https://api.example.com/v1'),
      'a credential-free base URL must stay verbatim',
    ).toBe(false)
    expect(isCredentialEntry('services.dashboard.port', 4173), 'a port is not a credential').toBe(false)
    expect(isCredentialEntry('use.timeout.step', '45s'), 'a timeout is not a credential').toBe(false)
    expect(isCredentialEntry('deployment.rolloutTag', OPAQUE), 'an ordinary tag is not a credential')
      .toBe(false)
    expect(isCredentialEntry('rolloutTag', OPAQUE), 'a single-segment ordinary key is unchanged')
      .toBe(false)
    // AND THE ONE THE SET DELIBERATELY EXCLUDES stays excluded through an ancestor too: `auth` is a
    // configuration block this product's own refusal message tells people to use.
    expect(
      isCredentialEntry('plugins.auth.endpoint', 'https://auth.example.com/callback'),
      '`auth` is not in the name set, and reading more segments must not smuggle it in',
    ).toBe(false)
  })

  it('(K8-index) a trailing index is stripped on ANCESTOR segments too, not only on the last one', () => {
    expect(
      isCredentialEntry('credentials[3].pass', OPAQUE),
      'a non-zero index must not hide the container\'s own name',
    ).toBe(true)
    expect(
      isCredentialEntry('registry.credentials[11].nested.value', OPAQUE),
      'the index strip applies wherever the segment sits in the path',
    ).toBe(true)
    // THE BOUND: stripping an index must not invent a name. `credentialsX` is not `credentials`.
    expect(
      isCredentialEntry('credentialsx[0].pass', OPAQUE),
      'the strip removes an index, not arbitrary trailing characters',
    ).toBe(false)
  })
})
