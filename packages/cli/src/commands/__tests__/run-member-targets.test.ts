// THE ONE PER-MEMBER TARGET PASS both of `run`'s producers now call (401-19, WR-04).
//
// AGAINST A HAND-BUILT CONFIG, DELIBERATELY, and that is the same road WR-02 is about:
// `resolveTarget` reads `(config as any).registry?.targets` and casts, so a config assembled in
// memory is what reaches it in a programmatic host. It is also the only way to put a MOBILE member
// and a WEB member in one call without standing up a device — the claim being ranged is which
// member gets a probe URL, and that is decided here, before anything is fetched.

import { describe, expect, it } from 'vitest'

import type { AgentQaConfig } from '@vostride/agent-qa-core'

import { resolveMemberTargetFacts } from '../run.js'

const config = {
  registry: {
    targets: {
      web: { platform: 'web', url: 'https://web.example/one', environment: 'local' },
      'web-shared': { platform: 'web', url: 'https://web.example/two', environment: 'shared' },
      phone: { platform: 'ios', bundleId: 'com.example.app', environment: 'local' },
      'web-no-url': { platform: 'web', environment: 'local' },
    },
  },
} as unknown as AgentQaConfig

describe('every member gets its own answer, in its own slot', () => {
  it('a mobile member contributes no probe URL while its web sibling in the SAME call contributes one', () => {
    const facts = resolveMemberTargetFacts(config, ['phone', 'web'])
    expect(facts.probeUrls).toEqual([undefined, 'https://web.example/one'])
    // …and the mobile member is still CLASSIFIED. No probe is not no declaration.
    expect(facts.declaredClasses).toEqual(['local', 'local'])
  })

  it('a web target with no url contributes no probe URL either', () => {
    expect(resolveMemberTargetFacts(config, ['web-no-url']).probeUrls).toEqual([undefined])
  })

  it('two members naming the same target both carry that target’s URL — the dedupe is the probe’s job, not this pass’s', () => {
    // Stated as a cell because the alternative — collapsing here — would lose the alignment the
    // classifier reads: the member at index 1 would have no baseline of its own.
    const facts = resolveMemberTargetFacts(config, ['web', 'web'])
    expect(facts.probeUrls).toEqual(['https://web.example/one', 'https://web.example/one'])
    expect(facts.targetNames).toEqual(['web'])
  })

  it('a member naming NO target occupies its slot with undefined and contributes no name', () => {
    const facts = resolveMemberTargetFacts(config, [undefined, 'web'])
    expect(facts.declaredClasses).toEqual([undefined, 'local'])
    expect(facts.probeUrls).toEqual([undefined, 'https://web.example/one'])
    expect(facts.targetNames).toEqual(['web'])
  })

  it('a member naming an UNRESOLVABLE target keeps its slot, keeps its name, and gets no probe', () => {
    const facts = resolveMemberTargetFacts(config, ['nowhere', 'web-shared'])
    expect(facts.declaredClasses).toEqual([undefined, 'shared'])
    expect(facts.probeUrls).toEqual([undefined, 'https://web.example/two'])
    // Declared is declared, whether or not it resolves — the preview names the run being approved.
    expect(facts.targetNames).toEqual(['nowhere', 'web-shared'])
  })

  it('the arrays are one-per-member, never one-per-distinct-target', () => {
    const members = ['web', 'phone', 'web', undefined, 'web-shared']
    const facts = resolveMemberTargetFacts(config, members)
    expect(facts.declaredClasses).toHaveLength(members.length)
    expect(facts.probeUrls).toHaveLength(members.length)
    expect(facts.targetNames).toEqual(['web', 'phone', 'web-shared'])
  })
})
