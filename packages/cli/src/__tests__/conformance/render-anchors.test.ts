// The render anchors: what the SHIPPED chat binary prints when an op answers (Phase 399.1 plan 01).
//
// THE DEFECT THESE CELLS EXIST FOR (G-399-2, measured 2026-08-20 at HEAD 50513a31). A credential
// refusal, a validation refusal and a genuine success all rendered byte-identically on chat's
// stdout as `config.field.set completed`, with `executed` in green. The guardrail HELD — nothing
// was written — and the person was told the mutation completed. The corrective information the
// product had already computed and persisted (`blockedReason` distinguishing "you tried to write a
// secret" from "your config is invalid"; `scanFindings` naming the detector and the file) never
// reached the one person it was written for.
//
// THE ASSERTION SURFACE IS CHILD STDOUT, AND THAT IS THE POINT (criterion 1's own words; 395's
// corpus-blind-by-assertion-surface lesson). Every cell in phase 399 asserted on the op's RETURN
// VALUE, which was correct, complete and safely redacted the whole time — and none of them asked
// whether any byte of it reached a terminal. So these cells spawn `dist/cli.js`, type one turn into
// a real pipe, and read what came back. An in-process `renderTurn` assertion is not stdout either.
//
// THE VACUITY TRAP, NAMED RATHER THAN AVOIDED BY LUCK (the 398-13 cell's law). `chat.ts` prints
// three starter prompts at open, and each starter is a catalog row's own description — committed
// text is in this child's stdout before any turn runs. Worse for these cells specifically: the
// utterance is echoed on the receipt line, so a whole-stdout search for a value THE UTTERANCE
// CARRIES would pass on a build that renders nothing at all. Every search below therefore runs over
// the slice AFTER a marker, the marker is the echoed clause itself, and its uniqueness is asserted
// so the slice cannot be silently widened by a second occurrence.
//
// THE MARKER IS THE CLAUSE, NOT `<op> completed`. The 398-13 cell marks on the outcome line, which
// is exactly the string this phase changes: a refused clause stops saying `completed` the moment
// the fix lands, and a marker that vanished under the fix would red these cells for the wrong
// reason at GREEN time. The echoed clause is stable across both revisions and unique per cell.
//
// EXPECTATIONS ARE READ OFF THE RECORD THE RUN ITSELF FILED (produced-not-literal; 390-03's law).
// Not one blocked reason, detector name, validation issue or diff line is spelled in this file.
// Each cell drives the binary, opens the `.agent-qa/proposals` record that drive produced, parses it
// with the SHIPPED contract, and asks whether those bytes reached the terminal. A cell carrying its
// own copy of an expected string keeps passing after the thing it claims to be about has changed.
//
// NO CREDENTIAL, REAL OR OTHERWISE. The guardrail cell plants a SYNTHETIC value with an `sk-PROBE-`
// prefix and a body of zeroes — enough for the detector to fire, and nothing that exists anywhere.
// The blocked record it produces carries a fingerprint and never the value, which is the blocked
// arm's own design; nothing in this file prints the planted string, and the child's environment is
// constructed rather than inherited so no ambient provider credential can reach it.
//
// THE INSTRUMENT IS IMPORTED, NEVER RE-ROLLED. `spawned-chat.ts` owns the driver, the hermetic
// environment, the fixture recipe and the freshness guard — see its header for why a second copy of
// any of them would be a second answer to "what did the child inherit".

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

import { CONFIG_FIELD_SET_FUNCTION_ID } from '@vostride/agent-qa-agent'
import { ConfigProposalV1Schema } from '@vostride/agent-qa-schema'
import type { ConfigProposalV1 } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import {
  CLI_ENTRY,
  PACKAGES_ROOT,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  driveChatSpawned,
  fixtureProject,
} from './spawned-chat.js'

afterEach(() => {
  cleanupTempRoots()
})

// ---- The three inputs, and why each one is the input it is --------------------------------------

/**
 * A synthetic credential: enough shape for the `apiKey` detector, and a value nowhere in existence.
 *
 * The probe that measured this defect used exactly this prefix. A real key would make the cell a
 * secret-bearing artifact in a public repository, and a value the detector did not recognise would
 * make the guardrail cell silently become a second success cell.
 */
const PLANTED_SECRET = 'sk-PROBE-0000000000000000000000000000'

/** A real `z.string()` key on `UseSchema`, so the success cell's control is genuinely a success. */
const SETTABLE_PATH = 'use.buildTag'

/**
 * A path that is NOT a key on `UseSchema`, so whole-config validation refuses the result.
 *
 * ITS VALUE IS BENIGN, AND THAT IS LOAD-BEARING (RESEARCH Pitfall 6, measured by the probe's own
 * first attempt). The secret scan runs BEFORE validation, so an invalid path carrying a credential
 * lands `guardrail-hit` rather than `schema-fail` — and the differential silently loses a cell,
 * because two of its three arms then measure the same road in.
 */
const UNSETTABLE_PATH = 'use.authState'

const BENIGN_VALUE = 'anchor-build-tag-v1'

function utteranceFor(path: string, value: string): string {
  return `/fn ${CONFIG_FIELD_SET_FUNCTION_ID} ${JSON.stringify({ path, value })}`
}

/**
 * The bytes a string OCCUPIES inside a pretty-printed JSON payload.
 *
 * A validation issue reads `use: Unrecognized key: "authState"` on the record and reaches a terminal
 * with its inner quotes escaped, because the render is `JSON.stringify(payload, null, 2)`. Asserting
 * the raw form would fail against a build that renders the field perfectly. The transform is applied
 * to a value READ off the record, so this is still the record's own content and not a literal.
 */
function asRendered(value: string): string {
  return JSON.stringify(value).slice(1, -1)
}

// ---- Driving one turn, and reading what it filed ------------------------------------------------

interface RenderReading {
  readonly utterance: string
  /** Everything the person read AFTER the echoed clause: the outcome line, and any payload. */
  readonly slice: string
  /** The proposal this very drive filed, parsed with the shipped contract. */
  readonly filed: ConfigProposalV1
  readonly stdout: string
  readonly stderr: string
}

/**
 * The ONE record `.agent-qa/proposals` holds after a drive, parsed rather than read as JSON.
 *
 * PARSED WITH THE SHIPPED SCHEMA so a cell cannot build its expectation out of a shape the product
 * does not actually produce, and so a record that stopped conforming is a red here rather than an
 * `undefined` quietly reaching a `toContain`.
 */
function filedProposal(root: string): ConfigProposalV1 {
  const dir = join(root, '.agent-qa', 'proposals')
  expect(existsSync(dir), `the drive filed no proposals directory under ${dir}`).toBe(true)
  const files = readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  expect(files, 'the drive filed something other than exactly one proposal record').toHaveLength(1)
  const envelope = JSON.parse(readFileSync(join(dir, files[0]!), 'utf8')) as { payload?: unknown }
  const parsed = ConfigProposalV1Schema.safeParse(envelope.payload)
  expect(
    parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.')),
    'the filed record does not parse against the shipped config-proposal contract',
  ).toEqual([])
  if (!parsed.success) throw new Error('unreachable: the assertion above has already failed')
  return parsed.data
}

/**
 * Drive one `config.field.set` turn through the shipped binary and return what a person saw.
 *
 * THE FRESHNESS GUARD AND THE CLEAN EXIT ARE ASSERTED HERE, BEFORE ANY CONTENT IS RETURNED, and
 * both are the cells' own contract rather than a precondition somebody satisfied once: a child that
 * died folds to "nothing was printed", which is a red for the wrong reason wearing the calling
 * cell's failure message.
 */
async function driveFieldSet(label: string, path: string, value: string): Promise<RenderReading> {
  expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
  expect(
    existsSync(CLI_ENTRY),
    `the built CLI entry is missing at ${relative(PACKAGES_ROOT, CLI_ENTRY)}; ${REBUILD_INSTRUCTION}`,
  ).toBe(true)

  const fixture = fixtureProject(`399-1-render-${label}`)
  const utterance = utteranceFor(path, value)
  const outcome = await driveChatSpawned(fixture.root, fixture.configPath, utterance)

  expect(
    { code: outcome.code, signal: outcome.signal, stderr: outcome.stderr.trim().slice(0, 600) },
    `the spawned chat binary did not exit cleanly for the ${label} cell`,
  ).toMatchObject({ code: 0, signal: null })

  const markerIndex = outcome.stdout.indexOf(utterance)
  expect(
    markerIndex,
    `the spawned chat binary never echoed the ${label} cell's clause; its stdout was `
    + `${JSON.stringify(outcome.stdout.slice(0, 800))} and its stderr `
    + `${JSON.stringify(outcome.stderr.trim().slice(0, 400))}`,
  ).toBeGreaterThanOrEqual(0)
  expect(
    outcome.stdout.lastIndexOf(utterance),
    `the ${label} cell's clause occurs more than once in the child's stdout, so the post-marker `
    + 'slice this cell searches is not the one turn it means',
  ).toBe(markerIndex)

  return {
    utterance,
    slice: outcome.stdout.slice(markerIndex + utterance.length),
    filed: filedProposal(fixture.root),
    stdout: outcome.stdout,
    stderr: outcome.stderr,
  }
}

/** The failure message every content assertion shares: what was searched, and what was in it. */
function withheld(label: string, reading: RenderReading): string {
  return `the shipped chat binary printed none of the ${label} arm's own report after the clause `
    + `it echoed. post-marker stdout: ${JSON.stringify(reading.slice.slice(0, 900))}; child stderr: `
    + `${JSON.stringify(reading.stderr.trim().slice(0, 300))}`
}

// ---- The anchors --------------------------------------------------------------------------------

describe('the chat render anchors (399.1, G-399-2)', () => {
  it('prints the guardrail refusal and its findings when a mutation would write a secret',
    async () => {
      // THE PHASE'S LEADING CELL. A security control refused, and this asks whether the person was
      // told. The two facts searched for are the ones a person needs to act: WHY it was refused,
      // and WHAT the scan found — both read off the record this drive just filed.
      const reading = await driveFieldSet('guardrail', SETTABLE_PATH, PLANTED_SECRET)

      expect(reading.filed.payloadKind, 'the guardrail cell did not reach the blocked arm')
        .toBe('blocked')
      if (reading.filed.payloadKind !== 'blocked') return

      expect(reading.filed.blockedReason, 'the guardrail cell reached the wrong blocked road')
        .toBe('guardrail-hit')
      expect(reading.slice, withheld('guardrail', reading))
        .toContain(asRendered(reading.filed.blockedReason))

      const findings = reading.filed.scanFindings ?? []
      expect(findings.length, 'the blocked record carried no scan findings to look for').toBeGreaterThan(0)
      for (const finding of findings) {
        expect(reading.slice, withheld('guardrail', reading)).toContain(asRendered(finding.detector))
        expect(reading.slice, withheld('guardrail', reading)).toContain(asRendered(finding.path))
      }

      // THE VALUE ITSELF IS NEVER PRINTED, and the same slice proves it: the blocked arm carries a
      // fingerprint by design, so a render that leaked the planted secret would be this phase
      // trading one disclosure defect for a worse one.
      expect(
        reading.slice.includes(PLANTED_SECRET),
        'the rendered payload carried the planted secret itself rather than its fingerprint',
      ).toBe(false)
    }, 180_000)

  it('prints the validation refusal and the validator\'s own words when the result is invalid',
    async () => {
      const reading = await driveFieldSet('schema-fail', UNSETTABLE_PATH, BENIGN_VALUE)

      expect(reading.filed.payloadKind, 'the schema-fail cell did not reach the blocked arm')
        .toBe('blocked')
      if (reading.filed.payloadKind !== 'blocked') return

      // The benign value is what keeps these two arms apart: the scan runs first, so a credential
      // here would have landed `guardrail-hit` and this cell would be measuring the one above.
      expect(
        reading.filed.blockedReason,
        'the schema-fail cell landed on the scan road instead of the validation road — see '
        + 'UNSETTABLE_PATH above for why its value must stay benign',
      ).toBe('schema-fail')
      expect(reading.slice, withheld('schema-fail', reading))
        .toContain(asRendered(reading.filed.blockedReason))

      const issues = reading.filed.validationIssues ?? []
      expect(issues.length, 'the blocked record carried no validation issues to look for')
        .toBeGreaterThan(0)
      for (const issue of issues) {
        expect(reading.slice, withheld('schema-fail', reading)).toContain(asRendered(issue))
      }
    }, 180_000)

  it('prints the reviewable diff when the mutation is genuinely proposed', async () => {
    const reading = await driveFieldSet('success', SETTABLE_PATH, BENIGN_VALUE)

    expect(reading.filed.payloadKind, 'the success cell did not reach the applyable arm')
      .toBe('applyable')
    if (reading.filed.payloadKind !== 'applyable') return

    expect(reading.slice, withheld('success', reading))
      .toContain(asRendered(reading.filed.summaryLine))

    // THE WHOLE DIFF, not a line of it (D-04). The default render is `JSON.stringify(payload, null,
    // 2)` precisely so it is structurally incapable of withholding a field, and a cell that settled
    // for one recognisable line would pass against a hand-picked field join — which is the RC-2
    // drop-site shape this phase's prohibition exists to forbid.
    const shownDiff = Buffer.from(reading.filed.shownDiffBase64, 'base64').toString('utf8')
    expect(shownDiff.length, 'the filed record carried an empty diff to look for').toBeGreaterThan(0)
    expect(reading.slice, withheld('success', reading)).toContain(asRendered(shownDiff))
  }, 180_000)

  it('renders a SECOND op\'s payload too, on the read door chat advertises itself', async () => {
    // THE PER-DOOR RENDER CELL (RESEARCH Pitfall 4), and a D-11 witness: `proposals.list` is one of
    // the five filed witnesses, and it is the one the probe singled out — chat advertises
    // `proposals` in its own starter prompts, and answers `proposals.list completed`. A person told
    // a mutation "completed" who goes looking for it in the inbox chat offered them is told
    // "completed" a second time.
    //
    // TWO TURNS IN ONE SESSION, so the second turn has something real to list: the first files a
    // proposal, the second asks for the inbox. The payload searched for is the FIRST turn's filed
    // summary line, read off disk — so this cell cannot pass on an empty inbox rendered honestly.
    //
    // WHY A SECOND OP AT ALL: a render that worked for exactly one op id would be the hardcoded
    // shape this phase demotes (criterion 6). This cell reds if the mechanism is `config.field.set`
    // special-casing wearing a general name.
    expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
    const fixture = fixtureProject('399-1-render-inbox')
    const listClause = '/fn proposals.list {}'
    const outcome = await driveChatSpawned(
      fixture.root,
      fixture.configPath,
      `${utteranceFor(SETTABLE_PATH, BENIGN_VALUE)}\n${listClause}`,
    )

    expect(
      { code: outcome.code, signal: outcome.signal, stderr: outcome.stderr.trim().slice(0, 600) },
      'the spawned chat binary did not exit cleanly for the inbox cell',
    ).toMatchObject({ code: 0, signal: null })

    const markerIndex = outcome.stdout.indexOf(listClause)
    expect(
      markerIndex,
      `the spawned chat binary never echoed "${listClause}"; its stdout was `
      + `${JSON.stringify(outcome.stdout.slice(0, 900))}`,
    ).toBeGreaterThanOrEqual(0)
    expect(
      outcome.stdout.lastIndexOf(listClause),
      `"${listClause}" occurs more than once in the child's stdout, so the post-marker slice this `
      + 'cell searches is not the one turn it means',
    ).toBe(markerIndex)

    const slice = outcome.stdout.slice(markerIndex + listClause.length)
    const filed = filedProposal(fixture.root)
    expect(
      slice,
      'the shipped chat binary listed the inbox and printed nothing that is in it. post-marker '
      + `stdout: ${JSON.stringify(slice.slice(0, 900))}; child stderr: `
      + `${JSON.stringify(outcome.stderr.trim().slice(0, 300))}`,
    ).toContain(asRendered(filed.summaryLine))
  }, 180_000)

  it('renders three DIFFERENT filed payloads as three different terminal readings', async () => {
    // THE MEASUREMENT THAT SET THIS PHASE'S SEVERITY, as a standing cell. Content assertions above
    // can each be satisfied by a render that says a great deal; only this one asks the question the
    // owner actually rejected at UAT — whether a person can TELL THE THREE APART. All three slices
    // were byte-identical at HEAD 50513a31, and each of the three cells above passed no part of it.
    //
    // ITS OWN NON-VACUITY, both ways: the three drives are asserted to have reached three different
    // filed outcomes first, so "the payloads differ" is a fact about this run rather than an
    // assumption, and three identical renderings of three identical payloads could not pass here.
    const guardrail = await driveFieldSet('distinct-guardrail', SETTABLE_PATH, PLANTED_SECRET)
    const schemaFail = await driveFieldSet('distinct-schema-fail', UNSETTABLE_PATH, BENIGN_VALUE)
    const success = await driveFieldSet('distinct-success', SETTABLE_PATH, BENIGN_VALUE)

    const filedOutcomes = [guardrail, schemaFail, success].map((reading) =>
      reading.filed.payloadKind === 'blocked'
        ? `${reading.filed.payloadKind}/${reading.filed.blockedReason}`
        : reading.filed.payloadKind,
    )
    expect(
      new Set(filedOutcomes).size,
      `the three drives did not produce three different filed outcomes (${filedOutcomes.join(', ')}), `
      + 'so a distinctness reading over them would be measuring the fixture rather than the render',
    ).toBe(3)

    const readings: readonly { readonly label: string; readonly slice: string }[] = [
      { label: 'guardrail-hit', slice: guardrail.slice },
      { label: 'schema-fail', slice: schemaFail.slice },
      { label: 'applyable', slice: success.slice },
    ]
    for (const left of readings) {
      for (const right of readings) {
        if (left.label === right.label) continue
        expect(
          left.slice,
          `a ${left.label} mutation and a ${right.label} mutation render IDENTICALLY on this `
          + 'terminal — a person cannot tell a refused security control from a completed change. '
          + `both printed: ${JSON.stringify(left.slice.slice(0, 600))}`,
        ).not.toBe(right.slice)
      }
    }
  }, 300_000)
})
