// The BLOCKED posture, end to end through the real pipeline (Phase 395-04, CFGM-01/02 · D-09/D-10/
// D-12).
//
// THE SCAN AND THE DIFF PRIMITIVE ARE THE PRODUCTION ONES. `scanConstructedArtifact` is imported
// from `packages/safety` and `renderConfigDiff` from `packages/schema`; the doubles are the three
// host facts this layer may not touch — bytes on disk, the yaml edit, and the store. That split is
// the point: what is measured here is the PIPELINE's order and its dispositions, over the same
// scanner and the same renderer production runs.
//
// THE SEED SET IS EMPTY IN THIS FILE, DELIBERATELY. `composeLocalAgent` seeds from
// `sensitiveEnvSlice(process.env)`, which is the environment this suite happens to run in; a cell
// whose verdict depended on whether a developer exported a token would measure the machine. Every
// planted secret below is caught by the PATTERN half, which needs no seeds. The SEEDED half and the
// binding that supplies it are measured where they belong, in `cli`'s composed renders file, which
// sets the variable it depends on.
//
// WHAT MAKES EACH CELL RED — the acceptance bar is the implementation it must fail on:
//
//   (1) schema-fail       — the pre-395-04 pipeline: a bare typed refusal that filed nothing. The
//                           cell asserts a RECORD reached the store, so "return an error" fails it.
//   (2) guardrail-hit     — the scan call site removed, or its findings ignored. This is the cell
//                           `scripts/395-scan-mutation.sh` reds on purpose.
//   (3) non-disclosure    — a blocked record built from the applyable one (diff bytes retained), a
//                           finding carrying a prefix of its value, or a scan that never ran. The
//                           three halves fail independently: the WINDOWED absence, the externally
//                           computed fingerprint, and the summary line.
//   (4) the summary line  — `configFieldSetSummaryLine` reused for the blocked arm. That function
//                           prints the VALUE, and the value is what the guardrail just refused, so
//                           the leak would move one field to the left. The cell proves the channel
//                           can carry it before asserting it does not.
//   (5) context line      — A SCAN NARROWED TO THE CHANGED LINES. The planted secret sits on a
//                           CONTEXT line of the rendered diff — asserted, in the cell, against the
//                           real renderer — so a scan reading only `+`/`-` lines returns clean and
//                           this cell fails. It is the D-12 claim and the one 395-03 measured.
//   (6) two reasons       — a pipeline that collapsed both roads into one indistinguishable
//                           "blocked". Each half asserts the OTHER report is absent, so a record
//                           carrying both would fail too. The precedence half reds on a validator
//                           whose words persist for a secret-bearing value.
//   (7) crossBoundary     — 395-01/02's `false, []` stub left in place.
//   (8) not-applyable     — an accept that threw instead of answering, or one that reached the
//                           apply route with a blocked payload.
//   (9) unbound scan      — a propose op that constructed anyway when no scan was bound. The
//                           permissive direction a security control may not fail in.
//  (10) the scan RAN      — every absence above passing because nothing was ever scanned. The
//                           invocation count is what makes the rest of this file non-vacuous.

import {
  CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
  renderConfigDiff,
  utf8Decode,
  utf8Encode,
} from '@vostride/agent-qa-schema'
import type {
  ConfigProposalV1,
  ConfigProposeOutput,
  ProposalEnvelope,
  ProposalsAcceptOutput,
} from '@vostride/agent-qa-schema'
import { scanConstructedArtifact } from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import { configFieldSetSpec } from '../../functions/ops/config-field-set.js'
import { proposalsAcceptSpec } from '../../functions/ops/proposals-accept.js'
import { FunctionNotBoundError } from '../../functions/spec.js'
import type { FunctionDeps } from '../../functions/spec.js'
import {
  BlockedConfigProposalError,
  applyablePayload,
  configFieldSetSummaryLine,
  constructConfigFieldSetProposal,
} from '../construct.js'
import type { ConstructConfigProposalDeps } from '../construct.js'
import type { ConfigFieldValue } from '../ports.js'

const CONFIG_FILE = 'agent-qa.config.yaml'

/**
 * An AWS access key by shape, matched by the `awsKey` detector with no seeding at all.
 *
 * A SHAPED VALUE RATHER THAN A SEEDED ONE, because this file's seed set is empty on purpose (see the
 * header). 395-03 records that `email` and `injectionShape` are excluded from the construction scan
 * by decision, so an email fixture here would produce a clean scan and a green cell measuring
 * nothing.
 */
const PLANTED = 'AKIAQWERTYUIOPASDFGH'

/**
 * A SECOND, DIFFERENT secret for the pre-existing case, so the two cells cannot pass on each other's
 * fixture.
 */
const COMMITTED_SECRET = 'AKIAZZZZZZZZZZZZZZZZ'

/**
 * The fingerprints, computed OUTSIDE this codebase — `hashlib.sha256(value).hexdigest()[:16]`.
 *
 * A cell whose expectation came from calling `sha256hex16` could not tell a correct recipe from a
 * consistently wrong one. Matching these means the report demonstrably observed those exact bytes
 * and chose not to carry them, which is what turns an absence assertion into evidence.
 */
const PLANTED_FINGERPRINT = 'a93e68f8176af0b0'
const COMMITTED_FINGERPRINT = '295cfae3fd0324ea'

const CLEAN_CONFIG = `# agent-qa Configuration
workspace:
  hooksFile: hooks.yaml
  envFile: .env
registry:
  targets:
    shop:
      url: https://shop.example.com/cart
use:
  timeout:
    step: 30s
    test: 90m
  parallel: false
`

/**
 * A config a HUMAN committed, carrying a secret three lines above the field this suite edits.
 *
 * THE DISTANCE IS LOAD-BEARING and is asserted rather than assumed: `DIFF_CONTEXT_LINES` is 3, so
 * `farmAccessKey` lands on a CONTEXT line of the hunk that renders the `step` edit. Cell (5) proves
 * that against the real renderer before it asserts the block, which is what makes it discriminate a
 * D-12 scan from a diff-narrowed one.
 */
const CONFIG_WITH_COMMITTED_SECRET = `# agent-qa Configuration
workspace:
  hooksFile: hooks.yaml
registry:
  farmAccessKey: ${COMMITTED_SECRET}
use:
  timeout:
    step: 30s
    test: 90m
`

interface Filed {
  readonly payload: ConfigProposalV1
  readonly emittedBy: string
}

interface Harness {
  readonly deps: ConstructConfigProposalDeps
  readonly filed: Filed[]
  /** How many times the scan was actually called — the non-vacuity counter for every absence. */
  scans: () => number
}

/**
 * The three host doubles and the REAL scan.
 *
 * `setField` is a line-level fake: it finds the last path segment as a key and replaces its value,
 * answering the previous scalar beside the new bytes exactly as the shipped yaml port does. It is a
 * double because `yaml` is not a runtime dependency of this package by ownership contract — the
 * production edit is measured against a real file in `cli`'s composed suite.
 */
function harness(options: {
  readonly config: string
  readonly validation?: { ok: false; issues: readonly string[] } | { ok: true }
}): Harness {
  const filed: Filed[] = []
  let scanCount = 0

  return {
    filed,
    scans: () => scanCount,
    deps: {
      configFiles: {
        read: () => Promise.resolve({
          configFile: CONFIG_FILE,
          files: [
            { path: CONFIG_FILE, bytes: utf8Encode(options.config) },
            { path: 'hooks.yaml' },
            { path: '.gitignore' },
          ],
        }),
        // 395-05 widened the port with a structural probe. `config.field.set` never asks one — it
        // addresses a path directly and has no collision or not-found posture — so this double
        // THROWS rather than answering, and a pipeline that started probing on this op's behalf
        // would fail here by name instead of quietly passing on a fabricated answer.
        inspect: () => {
          throw new Error('config.field.set must not inspect the document')
        },
        setField: ({ bytes, path, value }) => {
          const text = bytes === undefined ? '' : utf8Decode(bytes)
          const key = path.split('.').at(-1) ?? path
          const lines = text.split('\n')
          const index = lines.findIndex((line) => new RegExp(`^\\s*${key}:`).test(line))
          if (index === -1) {
            return Promise.resolve({ bytes: utf8Encode(`${text}${key}: ${String(value)}\n`) })
          }
          const line = lines[index] ?? ''
          const previous = line.slice(line.indexOf(':') + 1).trim()
          lines[index] = `${line.slice(0, line.indexOf(':'))}: ${String(value)}`
          return Promise.resolve({
            bytes: utf8Encode(lines.join('\n')),
            ...(previous === '' ? {} : { previousValue: previous as ConfigFieldValue }),
          })
        },
      },
      configValidate: {
        validate: () => Promise.resolve(options.validation ?? { ok: true }),
      },
      configProposals: {
        put: (record) => {
          filed.push({ payload: record.payload, emittedBy: record.emittedBy })
          return Promise.resolve({ proposalId: `prop-${filed.length}` })
        },
      },
      configScan: {
        scan: (parts) => {
          scanCount += 1
          return scanConstructedArtifact(parts, {})
        },
      },
    },
  }
}

async function propose(
  test: Harness,
  input: { path: string; value: ConfigFieldValue },
): Promise<ConfigProposeOutput> {
  return await constructConfigFieldSetProposal(
    { action: 'config.field.set', path: input.path, value: input.value },
    test.deps,
  )
}

/** Every 8-character window of a secret — a PARTIAL disclosure is the tempting middle ground. */
function windows(secret: string): string[] {
  const out: string[] = []
  for (let index = 0; index + 8 <= secret.length; index++) out.push(secret.slice(index, index + 8))
  return out
}

describe('the blocked posture: one posture, two reasons (CFGM-01 · D-10)', () => {
  it('(1) files a BLOCKED record when the whole config no longer validates', async () => {
    const test = harness({
      config: CLEAN_CONFIG,
      validation: { ok: false, issues: ['use.parallel: expected boolean, received string'] },
    })

    const answer = await propose(test, { path: 'parallel', value: 'yes please' })

    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('schema-fail')
    expect(answer.proposalId).toBe('prop-1')

    // A RECORD REACHED THE STORE. The pre-395-04 pipeline answered and filed nothing, so this line
    // is what the change is: a person can find the refusal where they find everything else.
    expect(test.filed).toHaveLength(1)
    const payload = test.filed[0]?.payload
    expect(payload?.payloadKind).toBe('blocked')
    if (payload?.payloadKind !== 'blocked') throw new Error('unreachable')
    expect(payload.validationIssues).toEqual(['use.parallel: expected boolean, received string'])
    expect(payload.paths).toEqual([CONFIG_FILE])
    // The two reasons are kept apart in the RECORD, not only in the return value.
    expect(payload.scanFindings).toBeUndefined()
  })

  it('(2) files a BLOCKED record when the proposed change would write a secret', async () => {
    const test = harness({ config: CLEAN_CONFIG })

    const answer = await propose(test, { path: 'envFile', value: PLANTED })

    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('guardrail-hit')
    expect(answer.scanFindings?.map((finding) => finding.path)).toEqual([CONFIG_FILE])
    expect(answer.scanFindings?.[0]?.detector).toBe('awsKey')
    expect(answer.validationIssues).toBeUndefined()
    expect(test.filed).toHaveLength(1)
  })

  it('(3) the persisted record carries no diff, no content, and no window of the secret', async () => {
    const test = harness({ config: CLEAN_CONFIG })
    await propose(test, { path: 'envFile', value: PLANTED })

    const payload = test.filed[0]?.payload
    if (payload?.payloadKind !== 'blocked') throw new Error('expected a blocked payload')
    const serialized = JSON.stringify(payload)

    // THE INTEGRITY HALF FIRST, so the absence below is a fact about a channel that demonstrably
    // observed the value rather than about one that never had it. This fingerprint was computed
    // outside this codebase.
    expect(payload.scanFindings?.[0]?.redactedFingerprint).toBe(PLANTED_FINGERPRINT)
    expect(serialized).toContain(PLANTED_FINGERPRINT)

    // THE ABSENCE, WINDOWED — a partial disclosure fails too.
    for (const window of windows(PLANTED)) expect(serialized).not.toContain(window)

    // STRUCTURAL, not incidental: there are no fields for these on a blocked payload at all.
    expect(serialized).not.toContain('shownDiff')
    expect(serialized).not.toContain('newContentBase64')
  })

  it('(4) the blocked summary line drops the value the applyable one would print', async () => {
    const test = harness({ config: CLEAN_CONFIG })
    await propose(test, { path: 'envFile', value: PLANTED })

    const payload = test.filed[0]?.payload
    if (payload?.payloadKind !== 'blocked') throw new Error('expected a blocked payload')

    // THE CHANNEL CAN CARRY IT. The applyable line — the one this pipeline writes for a change that
    // passed — really does print the value, which is correct for a change nobody refused. That is
    // what makes the assertion below a fact about this line rather than about summary lines.
    expect(configFieldSetSummaryLine('envFile', PLANTED)).toContain(PLANTED)

    expect(payload.summaryLine).not.toContain(PLANTED)
    for (const window of windows(PLANTED)) expect(payload.summaryLine).not.toContain(window)
    // It still says what was ATTEMPTED, or the inbox row says nothing a person can act on.
    expect(payload.summaryLine).toContain('envFile')
  })

  it('(5) D-12: a secret on a CONTEXT line blocks, and is named as already committed', async () => {
    // THE NON-VACUITY PROOF, FIRST AND AGAINST THE REAL RENDERER. If the planted secret rendered on
    // a `+` or `-` line, the cell below would pass under a scan narrowed to the changed lines —
    // i.e. green under the very implementation D-12 forbids. It renders on a CONTEXT line, and this
    // is the assertion that says so.
    const before = utf8Encode(CONFIG_WITH_COMMITTED_SECRET)
    const after = utf8Encode(CONFIG_WITH_COMMITTED_SECRET.replace('step: 30s', 'step: 45s'))
    const rendered = renderConfigDiff([{ path: CONFIG_FILE, oldBytes: before, newBytes: after }])
    if (rendered.outcome !== 'changed') throw new Error('the fixture edit rendered no diff')
    const secretLines = utf8Decode(rendered.diffBytes)
      .split('\n')
      .filter((line) => line.includes(COMMITTED_SECRET))
    expect(secretLines).toHaveLength(1)
    expect(secretLines[0]?.startsWith('+')).toBe(false)
    expect(secretLines[0]?.startsWith('-')).toBe(false)

    const test = harness({ config: CONFIG_WITH_COMMITTED_SECRET })
    const answer = await propose(test, { path: 'step', value: '45s' })

    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('guardrail-hit')
    // NAMED AS A FINDING IN THE EXISTING CONFIG. A person told only "blocked" would keep re-trying
    // an edit that was never the problem.
    expect(answer.summaryLine).toContain('already carries a secret')
    expect(answer.summaryLine).toContain(CONFIG_FILE)
    expect(answer.scanFindings?.[0]?.redactedFingerprint).toBe(COMMITTED_FINGERPRINT)
    expect(JSON.stringify(test.filed)).not.toContain(COMMITTED_SECRET.slice(0, 8))
  })

  it('(5b) a secret the change itself introduces is NOT described as already committed', () => {
    // The two D-12 sentences are decided by a MEASUREMENT — the committed bytes are scanned — so
    // this cell reds on a pipeline that hard-codes either sentence, which is the cheapest way to
    // make (5) pass without answering the question it asks.
    return propose(harness({ config: CLEAN_CONFIG }), { path: 'envFile', value: PLANTED })
      .then((answer) => {
        if (answer.outcome !== 'blocked') throw new Error('unreachable')
        expect(answer.summaryLine).toContain('would write a secret')
        expect(answer.summaryLine).not.toContain('already carries')
      })
  })

  it('(6) the two reasons are told apart, and the guardrail wins when both apply', async () => {
    const schemaFail = harness({
      config: CLEAN_CONFIG,
      validation: { ok: false, issues: ['use.parallel: expected boolean, received string'] },
    })
    const guardrail = harness({ config: CLEAN_CONFIG })

    const first = await propose(schemaFail, { path: 'parallel', value: 'yes please' })
    const second = await propose(guardrail, { path: 'envFile', value: PLANTED })
    if (first.outcome !== 'blocked' || second.outcome !== 'blocked') throw new Error('unreachable')

    // NAMED, not merely different: each reason is asserted by its own word AND by the report the
    // other one cannot have. A predicate that collapsed the two would fail on both halves.
    expect(first.blockedReason).toBe('schema-fail')
    expect(first.validationIssues?.length).toBeGreaterThan(0)
    expect(first.scanFindings).toBeUndefined()
    expect(second.blockedReason).toBe('guardrail-hit')
    expect(second.scanFindings?.length).toBeGreaterThan(0)
    expect(second.validationIssues).toBeUndefined()

    // PRECEDENCE, AND WHY THE PIPELINE SCANS BEFORE IT VALIDATES: a validator reports issues in its
    // own words over the candidate bytes, so a refusal quoting the offending value would persist a
    // secret inside a blocked record. Scanning first means the words never get written.
    const both = harness({
      config: CLEAN_CONFIG,
      validation: { ok: false, issues: [`envFile: ${PLANTED} is not a path`] },
    })
    const answer = await propose(both, { path: 'envFile', value: PLANTED })
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('guardrail-hit')
    expect(JSON.stringify(both.filed)).not.toContain(PLANTED.slice(0, 8))
  })

  it('(7) a clean change is proposed, and carries the classifier\'s per-value verdict', async () => {
    const innocuous = harness({ config: CLEAN_CONFIG })
    const answer = await propose(innocuous, { path: 'use.timeout.step', value: '45s' })
    expect(answer.outcome).toBe('proposed')
    if (answer.outcome !== 'proposed') throw new Error('unreachable')
    expect(answer.crossBoundary).toBe(false)
    expect(answer.crossBoundaryReasons).toEqual([])

    // THE SAME PATH, A DIFFERENT VALUE — which is the whole of D-02 and the half a stub answering
    // `false` unconditionally cannot produce.
    const moved = harness({ config: CLEAN_CONFIG })
    const flagged = await propose(moved, { path: 'url', value: 'https://shop.evil.example/cart' })
    if (flagged.outcome !== 'proposed') throw new Error('unreachable')
    expect(flagged.crossBoundary).toBe(true)
    expect(flagged.crossBoundaryReasons).toEqual(['new-origin'])

    const same = harness({ config: CLEAN_CONFIG })
    const unflagged = await propose(same, { path: 'url', value: 'https://shop.example.com/basket' })
    if (unflagged.outcome !== 'proposed') throw new Error('unreachable')
    expect(unflagged.crossBoundary).toBe(false)
    expect(unflagged.crossBoundaryReasons).toEqual([])
  })

  it('(8) accepting a blocked proposal answers not-applyable, with the reason and the id', async () => {
    const blocked: ConfigProposalV1 = {
      schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
      payloadKind: 'blocked',
      action: 'config.field.set',
      summaryLine: 'set workspace.envFile — blocked: the proposed change would write a secret',
      blockedReason: 'guardrail-hit',
      paths: [CONFIG_FILE],
      scanFindings: [{
        path: CONFIG_FILE,
        detector: 'awsKey',
        redactedFingerprint: PLANTED_FINGERPRINT,
      }],
    }
    const envelope: ProposalEnvelope = {
      id: 'prop-blocked',
      kind: 'config',
      status: 'pending',
      evidenceRefs: [],
      payload: blocked,
    }

    const deps = {
      proposalsInbox: {
        list: () => Promise.resolve([]),
        show: () => Promise.resolve({ kind: 'found' as const, entry: { envelope, applyInFlight: false } }),
        reject: () => Promise.resolve({ outcome: 'not-found' as const, proposalId: 'prop-blocked' }),
        recordApplied: () => {
          throw new Error('a blocked proposal must never reach the decision recorder')
        },
      },
      configApply: {
        apply: () => {
          throw new Error('a blocked proposal must never reach the apply port')
        },
      },
    } as unknown as FunctionDeps

    const answer = await proposalsAcceptSpec.invoke(
      { proposalId: 'prop-blocked' },
      deps,
    ) as ProposalsAcceptOutput

    expect(answer.apply.outcome).toBe('not-applyable')
    if (answer.apply.outcome !== 'not-applyable') throw new Error('unreachable')
    expect(answer.apply.proposalId).toBe('prop-blocked')
    expect(answer.apply.reason).toBe('guardrail-hit')
    // No standing approval is minted for an apply that did not happen.
    expect(answer.grant.kind).toBe('not-requested')

    // AND THE FUNNEL STILL REFUSES BY NAME one layer down, for every caller no surface mediates.
    expect(() => applyablePayload(blocked)).toThrow(BlockedConfigProposalError)
  })

  it('(9) a composition with no scan bound cannot propose at all', async () => {
    const test = harness({ config: CLEAN_CONFIG })
    const deps = {
      configFiles: test.deps.configFiles,
      configValidate: test.deps.configValidate,
      configProposals: test.deps.configProposals,
    } as unknown as FunctionDeps

    await expect(configFieldSetSpec.invoke({ path: 'use.timeout.step', value: '45s' }, deps))
      .rejects.toThrow(FunctionNotBoundError)
    expect(test.filed).toHaveLength(0)
  })

  it('(10) the scan really runs on every construction — the counter behind every absence', async () => {
    const clean = harness({ config: CLEAN_CONFIG })
    await propose(clean, { path: 'use.timeout.step', value: '45s' })
    expect(clean.scans()).toBe(1)

    // A hit costs a SECOND call: the D-12 question "was this already committed?" is answered by
    // scanning the committed bytes, which is a measurement rather than an inference from diff
    // syntax. A pipeline that guessed would show one call here.
    const hit = harness({ config: CLEAN_CONFIG })
    await propose(hit, { path: 'envFile', value: PLANTED })
    expect(hit.scans()).toBe(2)
  })
})
