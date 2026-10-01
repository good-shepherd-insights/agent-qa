// 422-22-T2 — the COMPILE-TIME half of the post-run chain's closed-set oracle.
//
// AN INDEPENDENT ORACLE, NOT A SECOND VIEW of `422-chain-closed-sets.test.ts`. It shares no
// fixture and no helper with the runtime half; the only things both touch are the production
// declarations they are each measuring.
//
// EVERY SET IS SPELLED OUT AS A LITERAL UNION. No cell states `keyof X` equals
// `(typeof XS)[number]` and stops there — that assertion is satisfied by any pair that happens to
// match however both of them change. The literal statement is what REDs when the shape moves; the
// `Exclude<...>` cells beside it pin the two directions against the runtime list.
//
// THE ASSERTIONS SIT INSIDE `test` BLOCKS ON PURPOSE. A `.test-d.ts` whose assertions are all
// top-level still typechecks, but vitest reports "no tests" for it — and a type oracle with a zero
// counted total is a failure wearing a pass's clothes. Every cell below is counted.
//
// THE NEGATIVE CONTROLS ARE THE ORACLE'S OWN PROOF THAT IT BITES: each `@ts-expect-error` states a
// claim that is FALSE, so TypeScript errors on the suppression comment itself if the claim ever
// becomes true.

import { describe, expectTypeOf, test } from 'vitest'

import type { JobKind } from '@vostride/agent-qa-schema'

import { CHAIN_JOB_ID_KEYS } from '../chain-identity.js'
import type { ChainJobIds } from '../chain-identity.js'
import type { JobKindDeclaration } from '../kind-registry.js'

describe('the chain id key set', () => {
  // A SECOND, independent statement of the three keys, as a union.
  type ThreeKeys = 'analyzeRun' | 'curateMemory' | 'proposeImprovements'

  test('is exactly three keys, hand-spelled', () => {
    expectTypeOf<keyof ChainJobIds>().toEqualTypeOf<ThreeKeys>()
  })

  test('is closed in both directions against the runtime list', () => {
    expectTypeOf<
      Exclude<keyof ChainJobIds, (typeof CHAIN_JOB_ID_KEYS)[number]>
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Exclude<(typeof CHAIN_JOB_ID_KEYS)[number], keyof ChainJobIds>
    >().toEqualTypeOf<never>()
  })

  test('bars a fourth key under any name a later stage would reach for', () => {
    // The chain's tail is `propose-improvements` and it declares no successor, so there is no
    // fourth stage for an id to address — named after what it would do or after where it sits.
    expectTypeOf<Extract<keyof ChainJobIds, 'stageAdversarial'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<keyof ChainJobIds, 'admitProposals'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<keyof ChainJobIds, 'consolidate'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<keyof ChainJobIds, 'chat'>>().toEqualTypeOf<never>()
  })

  test('keeps every member a job id, so no key can carry a candidate list', () => {
    // Identity is derived from the run, never from what the fold discovered. A key whose value
    // were an array would be one nothing can predict before the fold has run.
    expectTypeOf<ChainJobIds['analyzeRun']>().toEqualTypeOf<ChainJobIds['proposeImprovements']>()
  })

  test('negative control: the key set is not the kind set', () => {
    // @ts-expect-error — the keys are camel-case id names, not the kebab-case job kinds.
    expectTypeOf<keyof ChainJobIds>().toEqualTypeOf<JobKind>()
  })
})

describe('the job kind vocabulary', () => {
  // A SECOND, independent statement of the five kinds. Deriving it from the shipped list would
  // make this cell agree by construction: a sixth kind would flow straight through.
  type FiveKinds =
    | 'chat'
    | 'analyze-run'
    | 'curate-memory'
    | 'consolidate'
    | 'propose-improvements'

  test('is still exactly the five kinds 385 declared', () => {
    expectTypeOf<JobKind>().toEqualTypeOf<FiveKinds>()
  })

  test('grew no sixth kind for the third chain stage', () => {
    // D-13 added an EDGE and an ID. `propose-improvements` was already a declared kind, so a
    // kind named after the stage's mechanism would be a second name for a member that exists.
    expectTypeOf<Extract<JobKind, 'stage-adversarial'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<JobKind, 'propose'>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<JobKind, 'admit-proposals'>>().toEqualTypeOf<never>()
  })

  test('keeps the successor topology typed over that same five-kind set', () => {
    expectTypeOf<JobKindDeclaration['kind']>().toEqualTypeOf<JobKind>()
    expectTypeOf<JobKindDeclaration['allowedSuccessors']>().toEqualTypeOf<readonly JobKind[]>()
    // A declaration cannot name a successor outside the vocabulary — the topology is closed by
    // the type rather than by a runtime membership check.
    expectTypeOf<
      Exclude<JobKindDeclaration['allowedSuccessors'][number], FiveKinds>
    >().toEqualTypeOf<never>()
  })

  test('negative control: the five kinds are not the three terminal ones', () => {
    // @ts-expect-error — `chat` and `consolidate` are declared kinds that never land a chain
    // terminal, so the two sets must not be equal.
    expectTypeOf<JobKind>().toEqualTypeOf<'analyze-run' | 'curate-memory' | 'propose-improvements'>()
  })
})

// 2026-10-01 (432-17, D-05): the proposal-inbox kind vocabulary (`ProposalKind`, `PROPOSAL_KINDS`) is
// deleted with the inbox, so the closed-set and no-shared-member pins it carried have no subject.
describe('the proposal-inbox kind vocabulary', () => {
  test('is deleted with the inbox', () => {
    // @ts-expect-error — `ProposalKind` is no longer exported.
    expectTypeOf<import('@vostride/agent-qa-schema').ProposalKind>().toBeNever()
  })
})
