// Every op whose output union carries a REFUSAL ARM folds that arm to `refused` (399.1-03 · D-01/D-02).
//
// WHAT THIS FILE IS THE ACCEPTANCE BAR FOR. Phase 399's UAT measured a credential-blocked config
// mutation reporting `executed` in green on the chat surface, because the engine derived the receipt
// status from throw-versus-return and every arm of a typed refusal RETURNS. Plan 01 closed that on
// one op (`config.field.set`); this file closes it on every op whose own union can say no.
//
// THE FIXTURES ARE PARSED, NEVER TYPED. Each one goes through the op's declared output schema before
// it reaches a classifier, so a fixture describing a shape the contract cannot produce fails HERE
// rather than certifying a fold over an impossible input (the produced-not-literal law).
//
// THE REFUSAL-BEARING SET IS SPELLED ONCE, here, as the specs themselves. Plan 04 makes `classify`
// required across all 42 ops and owns the registry census; until then this file is the roster, and
// an op that grows a refusal arm without a classifier is a named red rather than a silent
// `executed`.

import { readFileSync } from 'node:fs'

import {
  AuthoringDraftWriteOutputSchema,
  ConfigProposeOutputSchema,
  ProposalsAcceptOutputSchema,
  buildFanOutReport,
  computeFanOutBound,
  renderFanOutReport,
} from '@vostride/agent-qa-schema'
import type {
  AuthoringDraftWriteOutput,
  ConfigProposeOutput,
  ProposalsAcceptOutput,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { foldFunctionResult } from '../classify.js'
import { authoringDraftWriteSpec } from '../ops/authoring-draft-write.js'
import { configAuthSetSpec } from '../ops/config-auth-set.js'
import { configFieldSetSpec } from '../ops/config-field-set.js'
import { configHookAddSpec } from '../ops/config-hook-add.js'
import { configProjectScaffoldSpec } from '../ops/config-project-scaffold.js'
import { configTargetCreateSpec } from '../ops/config-target-create.js'
import { configTargetEditSpec } from '../ops/config-target-edit.js'
import { configUndoProposeSpec } from '../ops/config-undo-propose.js'
import { proposalsAcceptSpec } from '../ops/proposals-accept.js'
import { createRegistryFromSpecs } from '../registry.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'
import { executableSource, scanFile } from './op-source-scan.js'

// ---- fixtures, produced through the contracts ---------------------------------------------------

const blockedByGuardrail: ConfigProposeOutput = ConfigProposeOutputSchema.parse({
  outcome: 'blocked',
  proposalId: 'prop_blocked-guardrail',
  summaryLine: 'set use.buildTag — blocked: the proposed change would write a secret',
  blockedReason: 'guardrail-hit',
  paths: ['agent-qa.config.yaml'],
  scanFindings: [
    { path: 'agent-qa.config.yaml', detector: 'apiKey', redactedFingerprint: '6a8bb9dac7013904' },
  ],
})

const blockedBySchema: ConfigProposeOutput = ConfigProposeOutputSchema.parse({
  outcome: 'blocked',
  proposalId: 'prop_blocked-schema',
  summaryLine: 'set use.authState — blocked: the resulting configuration is invalid',
  blockedReason: 'schema-fail',
  paths: ['agent-qa.config.yaml'],
  validationIssues: ['agent-qa.config.yaml: use: Unrecognized key: "authState"'],
})

const refusedOutright: ConfigProposeOutput = ConfigProposeOutputSchema.parse({
  outcome: 'refused',
  reason: 'target-not-found',
  detail: 'no target named "staging" is configured',
  candidates: ['local', 'ci'],
})

const proposed: ConfigProposeOutput = ConfigProposeOutputSchema.parse({
  outcome: 'proposed',
  proposalId: 'prop_proposed',
  summaryLine: 'set use.buildTag to probe-build-tag-v1',
  crossBoundary: false,
  crossBoundaryReasons: [],
  files: ['agent-qa.config.yaml'],
  shownDiff: '--- a/agent-qa.config.yaml\n+++ b/agent-qa.config.yaml\n',
})

const noChange: ConfigProposeOutput = ConfigProposeOutputSchema.parse({
  outcome: 'no-change',
  path: 'use.buildTag',
})

/** The three-run happy fan-out, built rather than typed — `renderFanOutReport`'s own input. */
const happyFanOut = buildFanOutReport({
  previewed: computeFanOutBound({ initialN: 3, probeK: 3, finalN: 3 }),
  runs: [{ runId: 'r_gate-0', purpose: 'gate', completedAt: 1 }],
})

const DUPLICATE_REF = 'tests/checkout.spec.ts::adds a product to the cart'

const authoringRefused: AuthoringDraftWriteOutput = AuthoringDraftWriteOutputSchema.parse({
  outcome: 'refused',
  refusal: {
    filePath: 'tests/checkout.spec.ts',
    testName: 'adds a product to the cart',
    matchedRef: DUPLICATE_REF,
    score: 0.91,
    threshold: 0.8,
    sharedTokens: 5,
    comparedTests: 42,
    continuations: ['extend-that-test', 'name-the-differing-assertion'],
  },
  fanOut: buildFanOutReport({
    previewed: computeFanOutBound({ initialN: 3, probeK: 3, finalN: 3 }),
    runs: [],
  }),
})

const authoringDrafted: AuthoringDraftWriteOutput = AuthoringDraftWriteOutputSchema.parse({
  outcome: 'drafted',
  draftRef: {
    filePath: 'tests/authored/two-factor-auth.spec.ts',
    testId: 'draft_0001',
    testName: 'signs in with a one-time code',
    contentDigest: 'sha256:2f0c',
  },
  fanOut: happyFanOut,
})

function acceptOutput(apply: unknown): ProposalsAcceptOutput {
  return ProposalsAcceptOutputSchema.parse({ apply, grant: { kind: 'not-requested' } })
}

const EXPIRED_PROPOSAL_ID = 'prop_11111111-2222-3333-4444-555555555555'

const acceptNotApplyable = acceptOutput({
  outcome: 'not-applyable',
  proposalId: 'prop_blocked-guardrail',
  reason: 'guardrail-hit',
})

const acceptExpired = acceptOutput({
  outcome: 'expired',
  entry: {
    applyInFlight: false,
    envelope: {
      id: EXPIRED_PROPOSAL_ID,
      kind: 'knowledge',
      status: 'expired',
      evidenceRefs: [],
      payload: {
        schemaVersion: 1,
        proposalId: EXPIRED_PROPOSAL_ID,
        verb: 'accept',
        targetRef: { grain: 'record', recordId: 'rec-1' },
        deltas: [],
        proposedAt: 1_000_000,
        status: 'pending',
      },
    },
  },
})

// ---- the config-mutation family: one union, seven ops -------------------------------------------

/**
 * The seven ops that answer with `ConfigProposeOutput`.
 *
 * SPELLED AS THE SPECS THEMSELVES rather than as ids looked up in a registry, so an op that stops
 * declaring a classifier is a compile-adjacent red here and not a row that quietly reports the
 * legacy verdict.
 */
const CONFIG_PROPOSE_OPS: readonly FunctionSpec<never, ConfigProposeOutput>[] = [
  configAuthSetSpec,
  configFieldSetSpec,
  configHookAddSpec,
  configProjectScaffoldSpec,
  configTargetCreateSpec,
  configTargetEditSpec,
  configUndoProposeSpec,
] as unknown as readonly FunctionSpec<never, ConfigProposeOutput>[]

describe('399.1 D-01/D-02 — the config-mutation family folds its own refusal arms', () => {
  it('declares a classifier on every one of the seven ops sharing the union', () => {
    // Non-vacuity for every cell below: a spec with no classifier reports the LEGACY verdict, and
    // `executed` is exactly what this phase exists to stop it saying over a refusal.
    expect(CONFIG_PROPOSE_OPS).toHaveLength(7)
    for (const spec of CONFIG_PROPOSE_OPS) {
      expect(spec.classify, `${spec.id} declares no classifier`).toBeTypeOf('function')
    }
  })

  it('folds the guardrail block to refused, carrying the guardrail’s own reason', () => {
    for (const spec of CONFIG_PROPOSE_OPS) {
      expect(spec.classify?.(blockedByGuardrail as never), spec.id)
        .toEqual({ status: 'refused', outcome: 'guardrail-hit' })
    }
  })

  it('folds the validation block to refused, and says which road it came in by', () => {
    for (const spec of CONFIG_PROPOSE_OPS) {
      // The two blocked reasons must not collapse: a person cannot tell a refused security control
      // from an invalid config if both render the same word (the G-399-2 three-outcome reading).
      expect(spec.classify?.(blockedBySchema as never), spec.id)
        .toEqual({ status: 'refused', outcome: 'schema-fail' })
    }
  })

  it('folds the outright refusal to refused with the refusal’s own reason', () => {
    for (const spec of CONFIG_PROPOSE_OPS) {
      expect(spec.classify?.(refusedOutright as never), spec.id)
        .toEqual({ status: 'refused', outcome: 'target-not-found' })
    }
  })

  it('folds a filed proposal to executed, naming the id a person decides on', () => {
    for (const spec of CONFIG_PROPOSE_OPS) {
      expect(spec.classify?.(proposed as never), spec.id)
        .toEqual({ status: 'executed', outcome: 'proposed prop_proposed' })
    }
  })

  it('folds no-change to executed — nothing failed and nothing was declined', () => {
    for (const spec of CONFIG_PROPOSE_OPS) {
      const verdict = spec.classify?.(noChange as never)
      expect(verdict?.status, spec.id).toBe('executed')
      expect(verdict?.outcome, spec.id).toContain('use.buildTag')
    }
  })
})

// ---- authoring.draft.write: the RC-1b witness ---------------------------------------------------

describe('399.1 D-01/D-02 — authoring.draft.write folds its dedup refusal', () => {
  it('reports refused, and names the test the intent duplicates', () => {
    // THE MEASURED WITNESS. 399's todo recorded this op returning its refusal arm while chat printed
    // `executed  authoring.draft.write completed`: the screen refused to author, and the person was
    // told it had. The reference is what makes the refusal actionable — refuse AND LINK (394 D-04).
    const verdict = authoringDraftWriteSpec.classify?.(authoringRefused)
    expect(verdict?.status).toBe('refused')
    expect(verdict?.outcome).toContain(`duplicate-of:${DUPLICATE_REF}`)
    // AND THE FAN-OUT RIDES THE SAME LINE (394-14, migrated onto this verdict by 399.1-03). A
    // refusal's report is `NO_RUNS_FAN_OUT_BOUND` — "this invocation ran nothing" — and the
    // contract makes it required on EVERY arm precisely so "nobody counted" and "nothing ran"
    // cannot read the same. Composed by the renderer, never restated.
    expect(verdict?.outcome).toContain(renderFanOutReport(authoringRefused.fanOut))
  })

  it('reports executed for an authored draft, naming the draft a person can open', () => {
    const verdict = authoringDraftWriteSpec.classify?.(authoringDrafted)
    expect(verdict?.status).toBe('executed')
    expect(verdict?.outcome).toContain('signs in with a one-time code')
    expect(verdict?.outcome).toContain(renderFanOutReport(happyFanOut))
  })
})

// ---- proposals.accept: the census finding beyond the plan's floor -------------------------------

describe('399.1 D-01/D-02 — proposals.accept folds the arms that applied NOTHING', () => {
  it('reports refused when the record is a blocked one, in the blocked record’s own words', () => {
    // `not-applyable` is a blocked config proposal reaching the inbox's commit verb. Reporting it as
    // `executed` is the SAME defect one door over: the guardrail held, and the person was told the
    // change went in. Its `reason` is the very `guardrail-hit`/`schema-fail` vocabulary above.
    expect(proposalsAcceptSpec.classify?.(acceptNotApplyable))
      .toEqual({ status: 'refused', outcome: 'not-applyable: guardrail-hit' })
  })

  it('reports refused when the lifecycle declined an expired proposal', () => {
    const verdict = proposalsAcceptSpec.classify?.(acceptExpired)
    expect(verdict?.status).toBe('refused')
    expect(verdict?.outcome).toContain('expired')
  })
})

// ---- D-03: a result nobody can read is `failed`, never `executed` -------------------------------

describe('399.1 D-03 — the fail-closed wrapper, driven', () => {
  /** A registry over the real specs, so the fold under test is the one the composition root runs. */
  const registry = createRegistryFromSpecs(
    [configFieldSetSpec as FunctionSpec],
    {
      // The four required reader ports, never reached: the fold runs on the RETURN path and this
      // registry is only ever asked to look a spec up by id.
      deps: {} as unknown as FunctionDeps,
      // The fold runs on the RETURN path, after the gate has audited; this sink exists only so the
      // registry may be constructed at all (D-11 refuses a sinkless one).
      auditSink: {
        appendExecutionAudit: () => { /* nothing dispatches here */ },
        appendGuardrailAudit: () => { /* nothing dispatches here */ },
      },
    },
  )

  it('reports failed/unclassifiable-result for a result the declared fold cannot read', () => {
    // A HAND-MUTATED RESULT, which is the shape a wire, a cache or a doctored record can produce:
    // the discriminant is a word the union does not have, so the op's own exhaustive switch falls
    // off the end and answers nothing. `executed` is the one thing that must not come back.
    const folded = foldFunctionResult(registry, configFieldSetSpec.id, { outcome: 'who-knows' })

    expect(folded.verdict).toEqual({ status: 'failed', outcome: 'unclassifiable-result' })
  })

  it('reports failed/unclassifiable-result when the classifier THROWS', () => {
    // The second fail-closed branch: `null` has no `outcome` to switch on at all.
    const folded = foldFunctionResult(registry, configFieldSetSpec.id, null)

    expect(folded.verdict.status).toBe('failed')
    expect(folded.verdict.status).not.toBe('executed')
  })

  it('still reports the real verdict for a result it CAN read — the guard is not a blanket', () => {
    // The discrimination control. Without it the two cells above would pass against a wrapper that
    // answered `unclassifiable-result` for everything.
    expect(foldFunctionResult(registry, configFieldSetSpec.id, blockedByGuardrail).verdict)
      .toEqual({ status: 'refused', outcome: 'guardrail-hit' })
  })
})

// ---- D-01's rejected alternative, pinned in the source -----------------------------------------

/**
 * The classifier reads its OWN union's discriminant, and never the CONTENT of a value.
 *
 * D-01 rejected chat-side value-pattern matching BY NAME — "a rule that can only refuse what it can
 * NAME cannot be driven to zero" — and a classifier that sniffed its payload's strings would be that
 * same door-enumeration failure moved one file over, wearing the declaration's clothes. The scan
 * runs over EXECUTABLE text (comments and string literals stripped by `executableSource`) so a
 * header explaining what the fold may not do is not read as the fold doing it.
 */
describe('399.1 D-01 — no classifier pattern-matches a value', () => {
  const VALUE_SNIFFING = [
    '.includes(',
    '.startsWith(',
    '.endsWith(',
    '.indexOf(',
    '.match(',
    '.search(',
    '.toLowerCase(',
    '.toUpperCase(',
    'RegExp',
  ] as const

  const CLASSIFIER_SOURCES = [
    'src/functions/ops/config-propose-verdict.ts',
    'src/functions/ops/authoring-draft-write.ts',
    'src/functions/ops/proposals-accept.ts',
  ] as const

  it.each(CLASSIFIER_SOURCES)('%s inspects no value content', (relative) => {
    const scan = scanFile(new URL(`../../../${relative}`, import.meta.url).pathname, VALUE_SNIFFING)

    // Non-vacuity: the file was read and had executable text to scan. A path typo would otherwise
    // make this cell pass forever over an empty string.
    expect(scan.statements.length).toBeGreaterThan(10)
    expect(scan.hits).toEqual([])
  })

  it('folds on a DISCRIMINANT — the switch, spelled', () => {
    // The inverse control for the scan above: a fold that read nothing at all would also have no
    // hits. This says what it DOES read.
    const source = executableSource(
      readFileSync(
        new URL('../../../src/functions/ops/config-propose-verdict.ts', import.meta.url).pathname,
        'utf8',
      ),
    )

    expect(source).toContain('switch (output.outcome)')
  })
})
