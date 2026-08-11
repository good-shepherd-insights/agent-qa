// `authoring.draft.edit` — the declared surface and the refusals (394-09, D-21 · WTST-07).
//
// This file owns what can be measured without a yaml CST: the scopes the verb declares, that it
// starts zero runs, and that every way an edit can be wrong is a NAMED refusal that constructs no
// proposal. The byte-confinement claim — an edit never reformats an untouched line — needs the real
// applier, which lives behind `packages/core` and is bound at the CLI host, so its cells are
// `packages/cli/src/__tests__/authoring-draft-edit.e2e.test.ts`.
//
// THE ZERO-RUNS CLAIM IS MADE STRUCTURALLY. The run port handed to every cell THROWS, so a verb
// that reached for a run fails the cell it is in rather than being caught by a counter somebody
// remembered to assert. That is the same posture the loop's own fakes take for a capability that
// must not be exercised.

import {
  AuthoringDraftEditOutputSchema,
  DRAFT_STABILITY_RUNS_N,
} from '@vostride/agent-qa-schema'
import type {
  AuthoringDraftEditOutput,
  EntityResolution,
  TestEditPatchSet,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import {
  AUTHORING_DRAFT_EDIT_FUNCTION_ID,
  EditPatchSetUnparsableError,
  EditRegionRefusedError,
  EditResultUnparsableError,
  EditTargetHasNoFileError,
  EditTargetUnreadableError,
  authoringDraftEditSpec,
} from '../ops/authoring-draft-edit.js'
import { UnresolvedEntityNameError } from '../../authoring/entity-binding.js'
import type { DraftEvaluationPort, FunctionDeps } from '../spec.js'
import type { DraftShelfPortLike, ParsedDraftLike } from '../../authoring/ports.js'

const TARGET: ParsedDraftLike = {
  testId: 't_committed-checkout',
  filePath: 'tests/checkout.yaml',
  testName: 'Checkout with a coupon',
  steps: ['Open the cart', 'Apply the coupon FREESHIP', 'Verify the total is 0.00'],
  contentDigest: 'digest-committed',
}

const REF = `${TARGET.filePath}::${TARGET.testName}`

const PATCHES: TestEditPatchSet['patches'] = [
  { op: 'add', path: '/steps/3', value: 'Verify the coupon banner is visible' },
]

interface Bench {
  readonly deps: FunctionDeps
  readonly applied: TestEditPatchSet[]
  readonly prompts: string[]
}

interface BenchOptions {
  readonly emission?: string
  readonly resolution?: EntityResolution
  readonly resolveDraft?: DraftEvaluationPort['resolveDraft']
  readonly apply?: DraftShelfPortLike['applyPatches']
}

function bench(options: BenchOptions = {}): Bench {
  const applied: TestEditPatchSet[] = []
  const prompts: string[] = []

  const shelf: DraftShelfPortLike = {
    model: () => Promise.resolve({
      modelId: 'fixture:edit',
      generate(request) {
        prompts.push(request.prompt)
        return Promise.resolve({
          text: options.emission ?? JSON.stringify({ thoughts: 'add the banner check', patches: PATCHES }),
        })
      },
    }),
    write: () => Promise.reject(new Error('an edit never emits a whole document')),
    applyPatches: options.apply ?? ((_draft, patchSet) => {
      applied.push(patchSet)
      return Promise.resolve({
        kind: 'staged' as const,
        draft: {
          ...TARGET,
          filePath: 'tests/.agent-qa-drafts/digest-edited.yaml',
          contentDigest: 'digest-edited',
          steps: [...TARGET.steps, 'Verify the coupon banner is visible'],
        },
      })
    }),
    // STRUCTURAL, not a counter: an op that reached for a run fails here by name.
    runs: {
      start: () => { throw new Error('authoring.draft.edit must start ZERO runs') },
      get: () => { throw new Error('authoring.draft.edit reads no runs') },
    },
    verifyDraft: () => {
      throw new Error('authoring.draft.edit re-runs no gates — authoring.draft.verify exists for that')
    },
  }

  const draftEvaluation: DraftEvaluationPort = {
    resolveDraft: options.resolveDraft
      ?? (() => Promise.resolve({ kind: 'parsed' as const, draft: TARGET })),
    openEvaluation: () => Promise.reject(new Error('an edit opens no evaluation')),
  }

  const deps = {
    entities: {
      resolve: () => Promise.resolve(
        options.resolution ?? { kind: 'none' as const, reason: 'no-match' as const },
      ),
      get: () => Promise.resolve(undefined),
    },
    draftShelf: shelf,
    draftEvaluation,
  } as unknown as FunctionDeps

  return { deps, applied, prompts }
}

async function edit(
  benched: Bench,
  input: { testRef?: string; intent?: string } = {},
): Promise<AuthoringDraftEditOutput> {
  return await authoringDraftEditSpec.invoke(
    {
      testRef: input.testRef ?? REF,
      intent: input.intent ?? 'also verify the coupon banner',
    },
    benched.deps,
  )
}

describe('the declared surface', () => {
  it('declares test-write and read, and NOT run', () => {
    // The absence is the mitigation (T-394-37). A grant a person issued so the agent could edit
    // their tests must not also buy the power to spend their machine on child processes, and
    // `requiredScopes` is the whole of what a grant matches on.
    expect(authoringDraftEditSpec.requiredScopes).toEqual(['test-write', 'read'])
    expect(authoringDraftEditSpec.requiredScopes).not.toContain('run')
    expect(authoringDraftEditSpec.id).toBe(AUTHORING_DRAFT_EDIT_FUNCTION_ID)
    expect(AUTHORING_DRAFT_EDIT_FUNCTION_ID).toBe('authoring.draft.edit')
    // The dot taxonomy the whole catalogue is checked against, asserted here too so the id's own
    // file states its constraint rather than relying on a census in another package to catch it.
    expect(AUTHORING_DRAFT_EDIT_FUNCTION_ID).toMatch(/^[a-z]+(?:\.[a-z]+)+$/)
  })

  it('is classified mutating-local — it edits a file and starts nothing', () => {
    expect(authoringDraftEditSpec.risk).toEqual({
      name: 'fn:authoring.draft.edit',
      recognized: true,
      declaredTier: 'mutating-local',
    })
    // NO `disclose`. 394-08 added that channel for an op whose per-invocation COST a person has to
    // consent to; this one previews nothing because it spends nothing, and a disclosure composed
    // for it would be a sentence about a fan-out that does not exist.
    expect(authoringDraftEditSpec.disclose).toBeUndefined()
  })

  it('starts zero runs on the happy path', async () => {
    const benched = bench()

    const result = await edit(benched)

    // The run port throws, so reaching this line at all is the claim. The schema parse beside it
    // is what makes the answer a contract rather than an object shaped like one.
    expect(AuthoringDraftEditOutputSchema.safeParse(result).success).toBe(true)
    expect(result.proposal.runsPreviewed).toBe(0)
    expect(result.proposal.runsConsumed).toBe(0)
    // …and the pair is genuinely zero rather than accidentally equal to the pinned N.
    expect(DRAFT_STABILITY_RUNS_N).toBeGreaterThan(0)
  })

  it('takes exactly ONE model call and applies what it emitted through the applier port', async () => {
    const benched = bench()

    const result = await edit(benched)

    expect(benched.prompts).toHaveLength(1)
    expect(benched.prompts[0]).toContain('also verify the coupon banner')
    expect(benched.prompts[0]).toContain('Apply the coupon FREESHIP')
    expect(benched.applied).toEqual([{ thoughts: 'add the banner check', patches: PATCHES }])
    // THE DIFF REACHES THE CALLER, in the contract's own vocabulary.
    expect(result.patches).toEqual(PATCHES)
    expect(result.thoughts).toBe('add the banner check')
    expect(result.editedFrom).toEqual({
      filePath: TARGET.filePath,
      testName: TARGET.testName,
      boundBy: 'exact-ref',
    })
    // `unverified` is the honest disposition: this op runs no gates, and any other value would be
    // a verdict about gates that never happened.
    expect(result.proposal.disposition).toBe('unverified')
    expect(result.draftRef.contentDigest).toBe('digest-edited')
  })
})

describe('every way an edit can be wrong is a named refusal that proposes nothing', () => {
  it('refuses a patch addressing a root outside the editable region, and constructs no proposal', async () => {
    const benched = bench({
      emission: JSON.stringify({
        thoughts: 'point it at the other app',
        patches: [
          { op: 'add', path: '/steps/3', value: 'Verify the coupon banner is visible' },
          { op: 'replace', path: '/target', value: 'someone-elses-app' },
        ],
      }),
    })

    const refusal = await edit(benched).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(EditRegionRefusedError)
    expect((refusal as EditRegionRefusedError).offendingPaths).toEqual(['/target'])
    // THE WHOLE SET, including the legitimate op ahead of the refused one. A per-op check would
    // already have staged the first patch before it refused the second (T-394-36).
    expect(benched.applied).toEqual([])
  })

  it('refuses a name the resolver would not bind, before a model is ever called', async () => {
    const benched = bench({ resolution: { kind: 'none', reason: 'no-match', closestSuggestion: 'TST-903' } })

    const refusal = await edit(benched, { testRef: 'the chekout test' }).catch(
      (error: unknown) => error,
    )

    // D-19 reaching this verb: a name that did not clear the resolver's bar ends the invocation,
    // and it ends it BEFORE the model call, so a never-guess refusal costs nothing.
    expect(refusal).toBeInstanceOf(UnresolvedEntityNameError)
    expect(benched.prompts).toEqual([])
    expect(benched.applied).toEqual([])
  })

  it('refuses a binding that names a real entity with no file behind it', async () => {
    const benched = bench({
      resolution: {
        kind: 'resolved',
        score: 0.95,
        descriptor: {
          kind: 'TST',
          shortId: 'TST-777',
          uri: 'agentqa://TST/TST-777',
          machineId: 'machine-777',
          title: 'A test whose store reported no identity',
          statusSource: 'active',
        },
      },
    })

    const refusal = await edit(benched, { testRef: 'that one test' }).catch((error: unknown) => error)

    // Recovering a path from the entity's TITLE is the plausible-but-wrong attribution the
    // render-never-recompute boundary refuses; this says so by name instead.
    expect(refusal).toBeInstanceOf(EditTargetHasNoFileError)
    expect(benched.prompts).toEqual([])
  })

  it('refuses when the bound file holds a different test than the ref named', async () => {
    const benched = bench({
      resolveDraft: () => Promise.resolve({
        kind: 'parsed' as const,
        draft: { ...TARGET, testName: 'Checkout with a saved card' },
      }),
    })

    const refusal = await edit(benched).catch((error: unknown) => error)

    // A rename since the ref was minted would otherwise edit somebody else's test under the name
    // the caller asked for.
    expect(refusal).toBeInstanceOf(EditTargetUnreadableError)
    expect((refusal as EditTargetUnreadableError).reason).toContain('Checkout with a saved card')
    expect(benched.prompts).toEqual([])
  })

  it('refuses a target the host will not resolve, carrying the resolution arm as the reason', async () => {
    const benched = bench({
      resolveDraft: () => Promise.resolve({ kind: 'outside-workspace' as const }),
    })

    const refusal = await edit(benched).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(EditTargetUnreadableError)
    expect((refusal as EditTargetUnreadableError).reason).toBe('outside-workspace')
  })

  it('refuses an emission that is not a patch set', async () => {
    const benched = bench({ emission: 'Sure, I have updated the test for you.' })

    const refusal = await edit(benched).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(EditPatchSetUnparsableError)
    expect(benched.applied).toEqual([])
  })

  it('refuses a patched document that no longer parses, and stages nothing', async () => {
    const benched = bench({
      apply: () => Promise.resolve({
        kind: 'unparsable' as const,
        reason: 'steps must have at least one entry',
      }),
    })

    const refusal = await edit(benched).catch((error: unknown) => error)

    expect(refusal).toBeInstanceOf(EditResultUnparsableError)
    expect((refusal as EditResultUnparsableError).message).toContain('nothing was staged')
  })
})
