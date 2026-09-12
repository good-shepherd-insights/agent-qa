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

import type { JobKind, ProposalKind } from '@vostride/agent-qa-schema'
import { PROPOSAL_KINDS } from '@vostride/agent-qa-schema'

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

describe('the proposal-inbox kind vocabulary', () => {
  test('is exactly three kinds, hand-spelled and closed in both directions', () => {
    expectTypeOf<ProposalKind>().toEqualTypeOf<'knowledge' | 'test-draft' | 'config'>()
    expectTypeOf<Exclude<ProposalKind, (typeof PROPOSAL_KINDS)[number]>>().toEqualTypeOf<never>()
    expectTypeOf<Exclude<(typeof PROPOSAL_KINDS)[number], ProposalKind>>().toEqualTypeOf<never>()
  })

  test('shares no member with the job kinds it is named beside', () => {
    // The proposal STAGE is a job kind and the proposal INBOX entries are a different closed
    // set that happens to share a word. A member in both would make one of them ambiguous at
    // exactly the seam where the stage writes into the inbox.
    expectTypeOf<Extract<ProposalKind, JobKind>>().toEqualTypeOf<never>()
    expectTypeOf<Extract<JobKind, ProposalKind>>().toEqualTypeOf<never>()
  })

  test('negative control: the inbox set is non-empty', () => {
    // @ts-expect-error — 'knowledge' is a real member, so extracting it is not never.
    expectTypeOf<Extract<ProposalKind, 'knowledge'>>().toEqualTypeOf<never>()
  })
})
