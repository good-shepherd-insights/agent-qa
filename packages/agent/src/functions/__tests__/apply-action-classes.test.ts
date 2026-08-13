// The evaluability pin: every class a standing approval can be minted under is one a gate sees
// (Phase 394, gap round 1, plan 16 — CR-04).
//
// WHY THIS FILE EXISTS. `APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND`'s own doc block claimed each entry
// equalled a registered op's `risk.name`, "machine-checked". Nothing checked it. The `test-draft`
// entry was the hand-typed literal `fn:authoring.draft.apply`, and no registered op carried that
// name — the apply rides the `draftApply` PORT, so the gate is never called with it. A person who
// typed `--always` at a draft accept minted a durable ledger line that parses, folds, lists and
// reads as authorization, and matches nothing forever. That is the silent failure the produced-
// not-literal rule exists to prevent, shipped in the one file whose header states the rule.
//
// So the claim is made a check. It lives HERE rather than beside the constant for the same reason
// `protected-classes-registry.test.ts` does: the table is in `agent`, the registry is in `agent`,
// and the comparison needs both — a restatement inside the op's own module would bind nothing to
// reality.
//
// THE CHECK IS PRODUCED ON BOTH SIDES. The admissible classes are read off the LIVE registry
// listing (`declaration.risk.name`), never a hand-written list of the names the registry is
// believed to carry; the classes under test are read off the exported table, which is itself
// produced from `ROUTE_FOR_KIND`. Nothing in the equality is typed twice.
//
// WHAT THE DISJUNCTION COLLAPSED TO. The resolution admits two kinds of honest entry — a
// registered committing op's class, or the accept's own class for a kind with no committing op
// behind it (`finding`, and now `test-draft`). The second is subsumed by the first: the accept is
// itself a registered op, so `fn:proposals.accept` IS a registered `risk.name`. One condition is
// therefore checked rather than two, and it is the stronger one.

import {
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  PROPOSAL_KINDS,
  PROTECTED_ACTION_CLASSES,
  isProtectedActionClass,
} from '@vostride/agent-qa-schema'
import type {
  FunctionCaller,
  GrantRecordInput,
  ProposalInboxEntryDto,
  ProposalKind,
  ProposalsAcceptOutput,
  RiskActionDescriptor,
  StandingGrantsPort,
} from '@vostride/agent-qa-schema'
import type { AuditSink } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import { CONFIG_PROPOSAL_APPLY_FUNCTION_ID } from '../ops/config-proposal-apply.js'
import { invokeFunction } from '../invoke.js'
import {
  APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND,
  PROPOSALS_ACCEPT_FUNCTION_ID,
} from '../ops/proposals-accept.js'
import { createFunctionRegistry } from '../registry.js'
import type { FunctionDeclaration, FunctionDeps, KnowledgeReviewPort } from '../spec.js'
import type { DraftApplyPortLike, TestDraftApplyRequestLike } from '../../authoring/ports.js'

const PROPOSAL_ID = 'prop_aaaaaaaa-bbbb'

const PROPOSALS_ACCEPT_ACTION_CLASS = `fn:${PROPOSALS_ACCEPT_FUNCTION_ID}`

/**
 * The class the `test-draft` entry used to carry, kept as the REJECTED arm of the pair.
 *
 * A literal on purpose, and the only one in this file: an admitted/rejected pair needs a value the
 * production side cannot emit, and this is precisely such a value — the whole point of the check is
 * that no registered op answers to it.
 */
const RETIRED_HAND_TYPED_CLASS = 'fn:authoring.draft.apply'

/** Every scope, human origin — so a refusal below can only ever be the axis under test. */
const FULLY_GRANTED: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

function noOpSink(): AuditSink {
  return { appendExecutionAudit() {}, appendGuardrailAudit() {} }
}

/**
 * The four REQUIRED ports, answering emptily.
 *
 * The listing cells read DECLARATIONS and never dispatch, so what these return is irrelevant —
 * what matters is that every registered op is LISTED, including the ones a real host leaves
 * `unbound`. An action class is a fact about the catalogue, not about one composition's bindings.
 */
function listingDeps(): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () =>
        Promise.resolve({
          schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
          configPath: 'agent-qa.config.yaml',
          entries: [],
        }),
    },
  }
}

function declarations(): readonly FunctionDeclaration[] {
  return createFunctionRegistry({ deps: listingDeps(), auditSink: noOpSink() }).list(FULLY_GRANTED)
}

/** The action names the live catalogue actually carries — the admissible set, produced. */
function registeredActionClasses(): ReadonlySet<string> {
  return new Set(declarations().map((declaration) => declaration.risk.name))
}

/**
 * The ONE computation both the real check and its discrimination control run.
 *
 * Written as a function over a table so the control below can feed it a table the production side
 * no longer emits. A control that re-derived the comparison would be measuring a second copy of it.
 */
function unevaluableEntries(
  table: Readonly<Record<ProposalKind, string>>,
  evaluable: ReadonlySet<string>,
): { kind: ProposalKind; actionClass: string }[] {
  return PROPOSAL_KINDS.filter((kind) => !evaluable.has(table[kind])).map((kind) => ({
    kind,
    actionClass: table[kind],
  }))
}

describe('the published apply-class table is evaluable — every entry is a class some gate sees', () => {
  it('is not vacuous: the catalogue, the kind vocabulary and the table are all non-empty', () => {
    // The guard the claims below lean on. A registry that listed nothing, or a table with no rows,
    // would satisfy "no entry is unevaluable" perfectly and measure nothing at all.
    expect(declarations().length).toBeGreaterThan(0)
    expect(PROPOSAL_KINDS.length).toBeGreaterThan(0)
    expect(Object.keys(APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND).sort()).toEqual(
      [...PROPOSAL_KINDS].sort(),
    )
  })

  it('no entry names a class no registered op carries — a grant can never match nothing', () => {
    // THE CELL. Its failure names the kind AND the class, because "one entry is wrong" is not
    // something anybody can act on, and the whole defect was that nobody could see which.
    expect(unevaluableEntries(APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND, registeredActionClasses()))
      .toEqual([])
  })

  it('the check discriminates: the retired hand-typed class is reported by the same computation', () => {
    // The REJECTED half of the pair, run through the identical function rather than a re-derivation
    // of it. Without this the cell above is satisfied by any comparison that never rejects — which
    // is exactly the state the table's doc block was in when it claimed to be machine-checked.
    const evaluable = registeredActionClasses()
    expect(evaluable.has(RETIRED_HAND_TYPED_CLASS)).toBe(false)
    expect(
      unevaluableEntries(
        { ...APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND, 'test-draft': RETIRED_HAND_TYPED_CLASS },
        evaluable,
      ),
    ).toEqual([{ kind: 'test-draft', actionClass: RETIRED_HAND_TYPED_CLASS }])
  })

  it('each entry matches EXACTLY ONE registered op — a class covering two is ambiguous', () => {
    const listed = declarations()

    for (const kind of PROPOSAL_KINDS) {
      const actionClass = APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND[kind]
      const matched = listed.filter((declaration) => declaration.risk.name === actionClass)
      // A refusal that could not say which op it was refusing for would be a refusal a reviewer
      // cannot check. Named per kind so a failure says WHICH row lost — or gained — an op.
      expect({ kind, actionClass, matchedOps: matched.map((declaration) => declaration.id) })
        .toEqual({ kind, actionClass, matchedOps: [matched[0]?.id ?? '<no registered op>'] })
    }
  })

  it('the config route reads its class off the REGISTERED apply op, and that op is listed', () => {
    // 395-01. The three cells above already range `config` — it is a member of `PROPOSAL_KINDS`,
    // so it is inside every one of them — and this one states the phase-specific half they leave
    // implicit: the class the config route publishes is the class the registered committing op
    // carries, produced on BOTH sides of the comparison.
    //
    // WHAT MAKES IT RED, measured rather than claimed (395-01): replacing
    // `configProposalApplySpec.risk.name` in the route with the hand-typed literal
    // `'fn:config.apply'` was applied and observed — it reds THIS cell and three of the four
    // above, each naming the kind and the class. The mutation was reverted from a byte-compared
    // snapshot.
    const apply = declarations().find(
      (declaration) => declaration.id === CONFIG_PROPOSAL_APPLY_FUNCTION_ID,
    )
    expect(apply?.risk.name).toBe(`fn:${CONFIG_PROPOSAL_APPLY_FUNCTION_ID}`)
    expect(APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND.config).toBe(apply?.risk.name)
    // GRANTABLE, and that is the D-02 decision rather than an oversight. Unlike the two 394 arms,
    // the config apply IS a registered op a gate evaluates, so a standing approval over it can
    // match something. What protects a boundary-crossing change is the per-proposal `crossBoundary`
    // flag (395-04's two-sided enforcement), not a blanket refusal of the class.
    expect(isProtectedActionClass(APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND.config)).toBe(false)
  })

  it('partitions the kinds by whether their apply class is protected — the decision, not a default', () => {
    // `knowledge` is the only grantable kind, and that is the whole shape of the resolution.
    // `finding` acknowledges (no committing op, so its class is the accept's own, which is
    // protected). `test-draft` commits through the draftApply PORT with no gate evaluation of its
    // own, so the only class a grant over it could truthfully cover is likewise the accept's — and
    // the accept is protected, so no standing approval over draft accepts exists today.
    const protectedKinds = PROPOSAL_KINDS.filter((kind) =>
      isProtectedActionClass(APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND[kind]),
    )
    expect(protectedKinds).toEqual(['test-draft', 'finding'])
  })
})

/** The TEST-DRAFT envelope, the arm the refusal cell below drives. */
function testDraftEntry(): ProposalInboxEntryDto {
  return {
    applyInFlight: false,
    envelope: {
      id: PROPOSAL_ID,
      kind: 'test-draft',
      status: 'pending',
      evidenceRefs: [],
      payload: {
        schemaVersion: 1,
        draftRef: {
          filePath: 'tests/.agent-qa-drafts/abc123.yaml',
          testId: 't_coupon',
          testName: 'The coupon banner appears',
          contentDigest: 'abc123',
        },
        targetPath: 'tests/the-coupon-banner-appears.yaml',
        disposition: 'keep-eligible',
        runsPreviewed: 9,
        runsConsumed: 3,
        repairIterations: 0,
        summaryLine: 'The coupon banner appears — keep-eligible',
      },
    },
  }
}

/**
 * A mint that answers the way the ONE shipped implementation answers.
 *
 * The protection arm calls `isProtectedActionClass` — the SAME exported predicate
 * `knowledge-local/src/grants/operations.ts` calls first thing in `record`, imported rather than
 * restated, because a fake carrying its own copy of the rule would let this cell pass over a
 * predicate production had stopped agreeing with. `packages/agent` may not import
 * `knowledge-local`; the loop over the real committed ledger is `agent-local`'s
 * `grant-loop.e2e.test.ts`.
 */
function protectionHonestGrants(): { port: StandingGrantsPort; calls: GrantRecordInput[] } {
  const calls: GrantRecordInput[] = []
  return {
    calls,
    port: {
      list: () => Promise.resolve({ grants: [], refusedLines: [] }),
      revoke: ({ grantId }) => Promise.resolve({ outcome: 'no-grant', grantId }),
      record: (input) => {
        calls.push(input)
        return Promise.resolve(
          isProtectedActionClass(input.actionClass)
            ? { kind: 'protected-class' as const, actionClass: input.actionClass }
            : {
                kind: 'recorded' as const,
                grant: {
                  grantId: 'grant_fixture',
                  actionClass: input.actionClass,
                  scope: input.scope,
                  grantedAt: '2026-08-12T10:00:00.000Z',
                  ...(input.proposalId === undefined ? {} : { proposalId: input.proposalId }),
                },
              },
        )
      },
    },
  }
}

function recordingDraftApply(): { port: DraftApplyPortLike; calls: TestDraftApplyRequestLike[] } {
  const calls: TestDraftApplyRequestLike[] = []
  return {
    calls,
    port: {
      apply: (request) => {
        calls.push(request)
        return Promise.resolve({ filePath: request.targetPath, commit: 'c0ffee1' })
      },
    },
  }
}

const NEVER_PROPOSES: KnowledgeReviewPort = {
  propose: () => Promise.reject(new Error('this file never proposes')),
  apply: (proposalId: string) =>
    Promise.reject(new Error(`this file never applies knowledge: ${proposalId}`)),
}

describe('accept-with-always over a test-draft — the refusal is the protected class, named', () => {
  it('applies the draft, asks the mint for the TABLE’s class, and is refused as protected', async () => {
    const grants = protectionHonestGrants()
    const draftApply = recordingDraftApply()
    const confirmed: RiskActionDescriptor[] = []
    const entry = testDraftEntry()

    const registry = createFunctionRegistry({
      deps: {
        ...listingDeps(),
        proposalsInbox: {
          list: () => Promise.resolve([]),
          reject: ({ proposalId }) => Promise.resolve({ outcome: 'not-found', proposalId }),
          show: () => Promise.resolve({ kind: 'found' as const, entry }),
          // 394-18: the decision half. A route that applies without recording leaves the proposal
          // pending forever, which is what made the funnel's `accepted` stage structurally 0.
          recordApplied: () => Promise.resolve({ outcome: 'recorded' as const }),
        },
        knowledgeReview: NEVER_PROPOSES,
        standingGrants: grants.port,
        draftApply: draftApply.port,
      },
      auditSink: noOpSink(),
      // `mutating-shared` asks in EVERY context, and two of the gate's five doors are permanently
      // shut for this op (no trust mode through `invokeFunction`, no standing approval over a
      // protected class). The interactive door is the production path the CLI binds.
      resolveExecutionContext: () => 'local-interactive',
      confirm: (action) => {
        confirmed.push(action)
        return true
      },
    })

    const answer = await invokeFunction(
      registry,
      PROPOSALS_ACCEPT_FUNCTION_ID,
      { proposalId: PROPOSAL_ID, always: true },
      FULLY_GRANTED,
    ) as ProposalsAcceptOutput

    // The apply COMMITTED, and the refusal travels beside it rather than instead of it.
    expect(answer.apply.outcome).toBe('applied')
    expect(draftApply.calls.map((call) => call.targetPath))
      .toEqual(['tests/the-coupon-banner-appears.yaml'])
    // The mint was asked for exactly what the published table publishes — this is the link between
    // the listing cells above and what a person's `--always` actually reaches.
    expect(grants.calls.map((call) => call.actionClass))
      .toEqual([APPLY_ACTION_CLASS_FOR_PROPOSAL_KIND['test-draft']])
    // Named by REFUSAL KIND and by class, not by message substring.
    expect(answer.grant).toEqual({
      kind: 'protected-class',
      actionClass: PROPOSALS_ACCEPT_ACTION_CLASS,
    })
    // The ask arm really ran, and ran about this action.
    expect(confirmed.map((action) => action.name)).toEqual([PROPOSALS_ACCEPT_ACTION_CLASS])
  })

  it('the accept stays protected and human-origin — the resolution does not unprotect it', () => {
    // The tempting wrong fix, refused as a running check rather than as a rule in a comment:
    // making the draft class grantable by dropping the accept out of the closed set, or by letting
    // an agent-origin caller reach it, would resolve CR-04 by opening the hole it is about.
    expect([...PROTECTED_ACTION_CLASSES]).toContain(PROPOSALS_ACCEPT_ACTION_CLASS)

    const accept = declarations().find(
      (declaration) => declaration.id === PROPOSALS_ACCEPT_FUNCTION_ID,
    )
    expect(accept?.risk.name).toBe(PROPOSALS_ACCEPT_ACTION_CLASS)
    expect(accept?.requiresHumanOrigin).toBe(true)
  })
})
