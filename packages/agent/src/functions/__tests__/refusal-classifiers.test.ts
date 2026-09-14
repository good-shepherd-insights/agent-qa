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

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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
import { z } from 'zod'

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
import type { FunctionRegistry } from '../registry.js'
import type { FunctionDeps, FunctionSpec } from '../spec.js'
import { classifyBodies, executableSource, scanFile, scanText } from './op-source-scan.js'

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

// ---- D-03, the two branches plan 01 shipped undriven (399.1-04 discharges them) -----------------

/**
 * The fail-closed branches that needed a SYNTHETIC spec to reach, driven at last.
 *
 * WHY THEY WERE UNDRIVEN FOR TWO PLANS, AND WHY THAT ENDED HERE. Plan 01 filed them; plan 03 drove
 * two of the four with a shipped op (a hand-mutated discriminant, and `null`) and left the rest,
 * because a shipped classifier is TOTAL over its own union and cannot be made to answer a
 * structurally-valid non-verdict, nor to be absent. Plan 04 is the plan that makes `classify`
 * REQUIRED — which is precisely the change that turns "an op with no fold" from an ordinary
 * expected state into a cast that got past both enforcement layers, and gives the branch an input
 * a test can construct.
 *
 * EVERY FIXTURE HERE IS A SPEC THIS PROJECT WOULD NEVER SHIP, AND THAT IS THE POINT. A guard
 * against op-authored code going wrong cannot be measured with op-authored code that is right. The
 * casts below are the same casts the guard exists to survive.
 */
describe('399.1-04 D-03 — the fail-closed branches a shipped op cannot reach', () => {
  const SYNTHETIC_ID = 'synthetic.fold-probe'

  /** A registry over one hand-built spec, so each cell chooses what the classifier answers. */
  function registryAnswering(classify: unknown): FunctionRegistry {
    return createRegistryFromSpecs(
      [{
        id: SYNTHETIC_ID,
        summary: 'A probe spec whose fold answers whatever the cell hands it.',
        requiredScopes: ['read'],
        resultKind: 'unary',
        input: z.object({}).strict(),
        output: z.object({}).strict(),
        risk: { name: `fn:${SYNTHETIC_ID}`, recognized: true, readOnly: true },
        // The cast is the subject. A spec whose `classify` is absent or answers a non-verdict is
        // exactly what `tsc` cannot see and what the census catches only at the registry — so the
        // probe reproduces the shape rather than describing it.
        ...(classify === undefined ? {} : { classify }),
        invoke: () => Promise.resolve({}),
      } as unknown as FunctionSpec],
      {
        deps: {} as unknown as FunctionDeps,
        auditSink: {
          appendExecutionAudit: () => { /* nothing dispatches here */ },
          appendGuardrailAudit: () => { /* nothing dispatches here */ },
        },
      },
    )
  }

  it('reports failed/unclassifiable-result for an op that declares NO fold at all', () => {
    // THE BRANCH THE REQUIRED MEMBER CREATED. Until 399.1-04 this answered the legacy
    // `{ status: 'executed', outcome: '' }`, which was the honest report while an op without a fold
    // was an expected state. It is not one any more: `classify` is required, so an absent one means
    // a cast got past `tsc` AND past the conformance census, and `executed` would be the receipt
    // certifying a claim nothing substantiates.
    const folded = foldFunctionResult(registryAnswering(undefined), SYNTHETIC_ID, { ok: true })

    expect(folded.verdict).toEqual({ status: 'failed', outcome: 'unclassifiable-result' })
  })

  it('reports failed/unclassifiable-result for a WELL-FORMED answer that is not a verdict', () => {
    // Plan 01's remaining stub, named there: "a classifier answering an object that is not a
    // verdict". `status` is a word no surface knows how to render; a cast instead of a check would
    // put it on a receipt, into the session log and into the goldens.
    const folded = foldFunctionResult(
      registryAnswering(() => ({ status: 'sideways', outcome: 'the fold invented a fourth word' })),
      SYNTHETIC_ID,
      { ok: true },
    )

    expect(folded.verdict).toEqual({ status: 'failed', outcome: 'unclassifiable-result' })
  })

  it('reports failed/unclassifiable-result when the OUTCOME is not a string', () => {
    // The other half of the same check, and it is not a restatement: the status word is legal here,
    // so a guard that only screened `status` would let this through and a receipt would carry a
    // number where every surface renders a sentence.
    const folded = foldFunctionResult(
      registryAnswering(() => ({ status: 'executed', outcome: 42 })),
      SYNTHETIC_ID,
      { ok: true },
    )

    expect(folded.verdict).toEqual({ status: 'failed', outcome: 'unclassifiable-result' })
  })

  it('reports failed/unclassifiable-result for an op the registry does not hold', () => {
    // The `spec === undefined` arm — unreachable in a composed host, because the op dispatched a
    // moment ago through this same registry, and answered fail-closed anyway.
    const folded = foldFunctionResult(registryAnswering(undefined), 'synthetic.not-registered', {})

    expect(folded.verdict).toEqual({ status: 'failed', outcome: 'unclassifiable-result' })
  })

  it('control: a probe answering a REAL verdict is reported verbatim', () => {
    // The discrimination control for all four. Without it every cell above would pass against a
    // wrapper that answered `unclassifiable-result` unconditionally — which is the same wrapper
    // that would also destroy every real verdict in the product.
    const folded = foldFunctionResult(
      registryAnswering(() => ({ status: 'refused', outcome: 'the probe declined' })),
      SYNTHETIC_ID,
      { ok: true },
    )

    expect(folded.verdict).toEqual({ status: 'refused', outcome: 'the probe declined' })
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

  // ---- the same claim, over EVERY fold in the directory (399.1-04) ------------------------------

  /** The ops directory, read from disk — never a list of file names somebody maintains. */
  const OPS_DIR = new URL('../ops/', import.meta.url).pathname

  /** Files that DECLARE a spec, which is the population the claim is about. */
  function specFiles(): readonly string[] {
    return readdirSync(OPS_DIR)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => {
        const text = readFileSync(join(OPS_DIR, name), 'utf8')
        return text.includes(': FunctionSpec<') || text.includes(': FunctionStreamSpec<')
      })
      .sort()
  }

  it('every spec file either declares a fold or points at the shared one — no third answer', () => {
    // THE DISCOVERY PREDICATE IS THE WHOLE RISK, so it is derived and two-sided. The population is
    // "files declaring a spec", read off the directory; the claim is that each one accounts for its
    // fold in one of exactly two ways. A file that did neither would be a spec whose classifier
    // lives somewhere this scan never looks — which is the shape of a census that is green because
    // it cannot see the thing it is counting.
    //
    // THE SHARED-FOLD ARM IS NOT AN ESCAPE HATCH: `config-propose-verdict.ts` is itself in the
    // hand-named list above AND its own body is scanned by the cell below, because it declares
    // `classify` for the seven ops that point at it.
    const unaccounted = specFiles().filter((name) => {
      const text = readFileSync(join(OPS_DIR, name), 'utf8')
      return classifyBodies(text).length === 0 && !text.includes('config-propose-verdict.js')
    })

    expect(
      unaccounted,
      'these files declare a capability whose result fold is neither written here nor delegated to '
        + 'the shared config-propose fold — the scan below cannot see it, so it is unchecked',
    ).toEqual([])

    // …and the population is not empty, which every line above would pass on.
    expect(specFiles().length, 'no spec files were discovered — this cell ranges nothing')
      .toBeGreaterThan(30)
  })

  it('no fold in the ops directory inspects value CONTENT — every body, brace-matched', () => {
    // The 399.1-03 three-file list widened to the whole directory, at the granularity that makes
    // the widening possible: the fold BODY. A whole-file scan cannot be used here and the reason is
    // recorded on `classifyBodies` — `authoring-verify-draft.ts` matches a draft file EXTENSION in
    // a helper the fold never calls, and exempting it by name would be the door enumeration this
    // rule exists to refuse.
    const offenders: string[] = []
    let bodiesScanned = 0

    // OVER EVERY FILE IN THE DIRECTORY, not just the spec-declaring ones, so a future shared fold
    // module written as a spec member is inside this scan on the day it lands rather than on the
    // day somebody remembers.
    for (const name of readdirSync(OPS_DIR).filter((entry) => entry.endsWith('.ts'))) {
      for (const body of classifyBodies(readFileSync(join(OPS_DIR, name), 'utf8'))) {
        bodiesScanned += 1
        for (const hit of scanText(body, VALUE_SNIFFING).hits) offenders.push(`${name} :: ${hit}`)
      }
    }

    expect(
      offenders,
      'a fold that sniffs its payload\'s content is the chat-side value matching D-01 rejected, '
        + 'moved one file over and wearing the declaration\'s clothes',
    ).toEqual([])

    // Non-vacuity, and it is the load-bearing half: an extractor that returned nothing would make
    // the loop above pass over an empty set forever. The number is the census's own arithmetic,
    // measured 2026-08-20: 42 registered ops minus the SEVEN that delegate to
    // `config-propose-verdict.ts` leaves 35 folds written as a spec member. The shared module's
    // `classifyConfigProposeOutput` is a named exported function rather than a `classify(` member,
    // so this extractor does not see it and the whole-file scan above does. An equality rather
    // than a floor, because an op deleting its fold and this scan quietly ranging one body fewer
    // is the drift a floor cannot see.
    //
    // 2026-08-25 (403-01 D-03): 36. `runs.liveurl` arrives with its own `classify` member, and it
    // is a fold this scan MUST range — the whole reason it declares one explicitly is that its
    // result carries a live credential its outcome sentence may never interpolate.
    //
    // 2026-08-27 (405-01 D-03): 37. `runs.detail` arrives with its own `classify` member, and it
    // is a fold this scan MUST range for a reason of its own: its result is a whole run's
    // projection — plan text, planned actions, error strings, sha-keyed refs — so a fold that
    // reached into that payload for its outcome sentence would put a run's content on a receipt.
    // It counts the three collections and interpolates nothing from inside them.
    //
    // 2026-08-27 (405-05 D-12/D-13): 38. `runs.artifact` arrives with its own `classify` member,
    // and it is a fold this scan MUST range for the sharpest reason on this list: its result IS a
    // payload — a base64 blob — so a fold that reached into it would put a screenshot's bytes on a
    // receipt kept forever. It interpolates the sniffed type, the DECLARED `byteLength` and the
    // run id, which is why that length is a field on the result rather than something to measure.
    //
    // 2026-08-29 (407-01 D-05): 39. `runs.knowledge` arrives with its own `classify` member, and it
    // is a fold this scan MUST range on `runs.detail`'s reasoning made sharper: its result carries
    // every step's text AND every served brief line's summary — producer prose that is masked at
    // rest — so a fold that reached into that payload for its outcome sentence would put a run's
    // knowledge content, possibly masked material, onto a receipt. It counts steps, served lines
    // and learned changes, and interpolates nothing from inside any of them.
    // 2026-09-06 (416 D-17): 40. `knowledge.gates.list` adds a fold over the receipt count
    // and declared verdict/path/reason. Gate evidence payloads remain inside the scanned
    // boundary: this classifier may not inspect their content to derive its outcome.
    // 2026-09-08 (419 GATE3-01): 41. runs.mark folds only governed kinds and address indexes.
    // 2026-09-14 (423-29 D-04): 42 source/spec bodies. runs.evidence folds only its outcome;
    // registration is owned by 423-09, and evidence document content stays outside receipts.
    // 2026-09-15 (423-36 D-19): 43. runs.marks.history folds its outcome kind, the entry count
    // and the corrupt line number; notes, producers and proposal reasons never reach a receipt.
    // 2026-09-15 (423-37 D-16): 44. runs.mark.preview folds the mark kind, draft kind, decision
    // count and quarantine class, and delegates refusals to runs.mark's fold; no reasoning or
    // corrected expectation reaches a receipt.
    expect(bodiesScanned, 'no classify bodies were extracted — this scan ranges nothing').toBe(44)
  })

  it('control: the body extractor and the scan both FIRE on a fold that sniffs', () => {
    // A scanner nobody has seen fire is a comment, and an extractor nobody has seen return the
    // right thing is a scanner over an empty string. Both halves are driven with synthetic source:
    // one fold that reads a discriminant and one that reads content, in a file shaped like an op.
    const planted = [
      'export const probeSpec: FunctionSpec<never, never> = {',
      '  classify(output): ClauseVerdict {',
      "    if (output.message.toLowerCase().includes('denied')) return REFUSED",
      '    return EXECUTED',
      '  },',
      '}',
    ].join('\n')

    const bodies = classifyBodies(planted)
    expect(bodies.length, 'the extractor found no body in source that plainly has one').toBe(1)
    expect(
      scanText(bodies[0] ?? '', VALUE_SNIFFING).hits.length,
      'the scan did not flag a fold that lowercases its payload and searches it for a word',
    ).toBeGreaterThan(0)

    // And the inverse: a fold that reads its own discriminant is NOT flagged. A scan that fired on
    // everything would certify as little as one that fired on nothing.
    const clean = classifyBodies([
      'export const cleanSpec: FunctionSpec<never, never> = {',
      '  classify(output): ClauseVerdict {',
      "    return output.kind === 'found' ? FOUND : ABSENT",
      '  },',
      '}',
    ].join('\n'))
    expect(clean.length).toBe(1)
    expect(scanText(clean[0] ?? '', VALUE_SNIFFING).hits).toEqual([])
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
