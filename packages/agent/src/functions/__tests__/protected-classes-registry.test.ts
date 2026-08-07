// The cross-spelling pin: schema's closed protected set ↔ the registry it protects (Phase 391,
// PROP-05, plan 05).
//
// WHY THIS FILE EXISTS, stated precisely, because a weaker version of it already shipped.
//
// `schema/src/__tests__/proposal-envelope.test.ts` asserts `PROTECTED_ACTION_CLASSES` equals
// `['fn:proposals.accept', 'fn:grants.revoke']`. That is the constant restating itself inside its
// own package, and it binds NOTHING to reality: schema cannot import agent, so nothing there can
// see whether an op by either of those names is registered, or ever was. Rename
// `proposals.accept` tomorrow and that assertion stays green while the protected set silently
// loses a member — the grant-ineligible floor would be protecting a name nobody answers to.
//
// The real pin has to live where the constant and the registry are BOTH reachable, and this
// package is the only place that is true: `agent` owns the registry and depends on `schema`. So
// the pin is here rather than beside the constant, and the constant's own module head says to
// come looking for it here.
//
// FOUR CLAIMS, and the third and fourth are what keep the first two from being decorative:
//
//   1. every member of the protected set is the `risk.name` of a registered op — the set does not
//      protect a ghost;
//   2. every member matches EXACTLY ONE op — a member covering two ops would be ambiguous about
//      what a mint refusal was actually refusing;
//   3. the BARE spelling of each member — the `fn:` prefix stripped — matches no registered op at
//      all. This is the admitted/rejected pair the precondition-guarded corpus law asks for: it
//      proves the comparison in claim 1 discriminates, rather than being satisfied by any string
//      that happens to contain an op id. It is also the exact failure the ledger's module head
//      warns about, asserted at the OTHER end of the same contract;
//   4. NO registered op classifies as `restricted` today. That is a fact about the catalogue, not
//      a rule, and it is pinned as a FORWARD RED — see its own case below.
//
// WHAT IS DELIBERATELY NOT ASSERTED: the classified TIER of a protected member. `grants.revoke`
// classifies `destructive` (its name carries the soft destructive verb `revoke`) even though it
// declares `mutating-shared`, and both resolve to `ask`. Pinning a tier here would pin the
// lexicon's opinion about a verb's NAME, which is a different contract owned by a different suite.

import { classifyRisk } from '@vostride/agent-qa-safety'
import {
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  PROTECTED_ACTION_CLASSES,
} from '@vostride/agent-qa-schema'
import type { FunctionCaller } from '@vostride/agent-qa-schema'
import type { AuditSink } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import { createFunctionRegistry } from '../registry.js'
import type { FunctionDeclaration, FunctionDeps } from '../spec.js'

/**
 * The four REQUIRED ports, answering emptily.
 *
 * This file reads DECLARATIONS and never dispatches, so what these return is irrelevant — what
 * matters is that every op the catalogue carries is LISTED, including the ones this fixture leaves
 * `unbound`. Binding is a property of a composition; membership of the protected set is a property
 * of the catalogue, and conflating them would make the pin miss exactly the ops that are unbound
 * in the host a reader happens to be looking at.
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

/**
 * Every scope, human origin — so a capability missing from the listing below is missing because it
 * is not registered, never because this caller could not be shown it. The safe-mode filter is the
 * only thing `list` withholds anything for, and this caller is not in it.
 */
const FULLY_GRANTED: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

function noOpSink(): AuditSink {
  return {
    appendExecutionAudit() {},
    appendGuardrailAudit() {},
  }
}

function declarations(): readonly FunctionDeclaration[] {
  return createFunctionRegistry({ deps: listingDeps(), auditSink: noOpSink() }).list(FULLY_GRANTED)
}

describe('the protected action classes name real registered ops', () => {
  it('is not vacuous: the catalogue and the protected set are both non-empty', () => {
    // The guard every claim below leans on. A registry that listed nothing would satisfy "no
    // member matches two ops" and "no bare id matches anything" perfectly.
    expect(declarations().length).toBeGreaterThan(0)
    expect(PROTECTED_ACTION_CLASSES.length).toBeGreaterThan(0)
  })

  it('each member is the risk.name of EXACTLY ONE registered op', () => {
    const listed = declarations()

    for (const member of PROTECTED_ACTION_CLASSES) {
      const matching = listed.filter((declaration) => declaration.risk.name === member)
      // Named per member so a failure says WHICH class lost its op, rather than reporting a
      // count nobody can act on.
      expect({ member, ids: matching.map((declaration) => declaration.id) }).toEqual({
        member,
        ids: [member.replace(/^fn:/, '')],
      })
    }
  })

  it('the BARE spelling of each member matches no registered op — the `fn:` prefix is the contract',
    () => {
      const listed = declarations()

      for (const member of PROTECTED_ACTION_CLASSES) {
        const bare = member.replace(/^fn:/, '')
        // The prefix is really being stripped: a member that never carried one would make this
        // whole case a comparison of a string against itself.
        expect(bare).not.toBe(member)
        // This is the ADMITTED/REJECTED pair. The case above proves the prefixed spelling FINDS
        // its op; this proves the un-prefixed one finds nothing — so the equality up there is
        // discriminating, and a member hand-typed without the prefix would be a class that
        // protects nothing while looking exactly like one that does.
        expect(listed.filter((declaration) => declaration.risk.name === bare)).toEqual([])
      }
    })

  it('no registered op classifies as `restricted` today — a FORWARD RED, not a rule', () => {
    // NOT a property anybody should preserve. It is a measurement of the catalogue as it stands,
    // pinned so that the day it stops being true, somebody is told.
    //
    // Two things follow from it right now. First, `restricted` is unreachable through
    // `invokeFunction`, which is why the deny-finality differential (plan 05, PROP-05) is driven
    // against the shipped gate with fixture descriptors in
    // `agent-local/src/__tests__/sovereignty-differentials.test.ts` rather than through a
    // registered op — stated here so the choice is visible from the registry side too. Second, the
    // only tier that BLOCKS is one no capability can currently reach, so nothing in the catalogue
    // is un-runnable by classification alone.
    //
    // WHEN THIS GOES RED: an op has arrived that can never execute in any context, whatever the
    // ledger says. Add the invokeFunction-level leg of the deny-finality differential over that
    // op — it is now reachable — and re-state this case as the list of ops that are meant to be.
    const restricted = declarations()
      .map((declaration) => ({
        id: declaration.id,
        ...classifyRisk(declaration.risk),
      }))
      .filter((row) => row.riskTier === 'restricted')

    expect(restricted).toEqual([])
  })
})
