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

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
import { CONFIG_FIELD_SET_FUNCTION_ID } from '@vostride/agent-qa-agent'
import { maskedToolResult } from '@vostride/agent-qa-mcp'
import { ConfigProposalV1Schema } from '@vostride/agent-qa-schema'
import type { ConfigProposalV1 } from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { renderFnResult } from '../../commands/fn.js'
import { renderClauseResults } from '../../commands/result-render.js'
import { registryDeclarations } from './adapters.js'
import { SCENARIO_TABLE } from './scenario-table.js'
import type { ScenarioRow } from './scenario-table.js'
import {
  CLI_ENTRY,
  PACKAGES_ROOT,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  driveChatSpawned,
  fixtureProject,
  hermeticEnv,
  spawnCollecting,
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
  /**
   * The receipt line the echoed clause sits ON — which is where the VERDICT WORD is.
   *
   * `receipt-line.ts` renders `  <status>  <op>  <clause>`, so the status word PRECEDES the clause
   * the marker is and no post-marker slice can carry it. This is still one marker-anchored line and
   * still below every starter prompt; it is not a search of stdout.
   */
  readonly receiptLine: string
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

  const lineEnd = outcome.stdout.indexOf('\n', markerIndex)

  return {
    utterance,
    slice: outcome.stdout.slice(markerIndex + utterance.length),
    receiptLine: outcome.stdout.slice(
      outcome.stdout.lastIndexOf('\n', markerIndex) + 1,
      lineEnd === -1 ? undefined : lineEnd,
    ),
    filed: filedProposal(fixture.root),
    stdout: outcome.stdout,
    stderr: outcome.stderr,
  }
}

/**
 * The one word the receipt line LEADS with — the verdict a person reads before anything else.
 *
 * Split on whitespace rather than sliced at a column, because the styling is `pc`'s and the leading
 * indent is the renderer's; what is being asserted is the WORD, not its typography.
 */
function verdictWord(reading: RenderReading): string {
  return reading.receiptLine.trim().split(/\s+/u)[0] ?? ''
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

  it('reports each arm\'s own VERDICT WORD on the receipt line, refusals and success alike',
    async () => {
      // WHY THIS CELL EXISTS, AND IT IS A MEASUREMENT RATHER THAN AN ARGUMENT. Every content
      // assertion in this file reads the POST-MARKER slice — the payload block. 399.1-07's VERDICT
      // leg folded `blocked` to `executed` in `config-propose-verdict.ts` (the exact implementation
      // D-01 forbids, and the literal G-399-2 defect: a guardrail declined and chat said the change
      // was carried out), rebuilt, and ran the whole conformance directory: 271/271 GREEN. A
      // guardrail's own words printed underneath the word `executed` is not the repair this phase
      // claims — it is the defect with better prose. So the verdict word is pinned here, on the
      // line a person reads it on, and the leg that found this file blind now reds exactly here.
      //
      // WHY IT WAS MISSED, structurally rather than by oversight: `receipt-line.ts` renders
      // `  <status>  <op>  <clause>`, so the status word PRECEDES the clause the marker is and a
      // strict post-marker slice CANNOT carry it. `receiptLine` above reads the marker's own line.
      const guardrail = await driveFieldSet('verdict-guardrail', SETTABLE_PATH, PLANTED_SECRET)
      const schemaFail = await driveFieldSet('verdict-schema-fail', UNSETTABLE_PATH, BENIGN_VALUE)
      const proposed = await driveFieldSet('verdict-proposed', SETTABLE_PATH, BENIGN_VALUE)

      // NON-VACUITY FIRST: the three drives really reached the two blocked arms and the applyable
      // one. Without this, a fixture that landed three identical arms would satisfy every pin below
      // while measuring one arm three times.
      expect(
        [guardrail, schemaFail, proposed].map((reading) => reading.filed.payloadKind),
        'the three drives did not reach two blocked arms and the applyable arm, so the verdict '
        + 'words below would be pinning whatever this fixture happened to produce',
      ).toEqual(['blocked', 'blocked', 'applyable'])

      // D-01's decision, arm by arm. `blocked` is `refused` because the CONTROL WORKED and nothing
      // happened; `applyable` is `executed` because a proposal really was filed. The success arm is
      // pinned in the SAME cell deliberately: a cell asserting only the two refusals would pass
      // against a build that answered `refused` for everything — which would destroy every real
      // verdict in the product — so both directions are one cell's business.
      expect(
        verdictWord(guardrail),
        'a guardrail declined to write a secret into the config and the receipt does not read '
        + `\`refused\`. the line the person read: ${JSON.stringify(guardrail.receiptLine)}`,
      ).toBe('refused')
      expect(
        verdictWord(schemaFail),
        'the validator refused the mutation and the receipt does not read `refused`. the line the '
        + `person read: ${JSON.stringify(schemaFail.receiptLine)}`,
      ).toBe('refused')
      expect(
        verdictWord(proposed),
        'a proposal really was filed and the receipt does not read `executed`. the line the person '
        + `read: ${JSON.stringify(proposed.receiptLine)}`,
      ).toBe('executed')
    }, 300_000)

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

// ---- The per-surface render anchors: in-process ≡ shipped, one cell per door (D-08) -------------
//
// WHAT THESE THREE ADD THAT THE MATRIX CANNOT. `render-parity.test.ts` drives the shipped render
// FUNCTIONS for all 42 capabilities on all three doors, in this process, against documents produced
// from the ops' own contracts. That is the coverage half, and it is blind to exactly one thing: the
// artifact a person installs is a bundle, and a bundle can differ from the source it was built from
// — a tree-shaken branch, an unbundled dependency resolved to a stale `dist`, a masker wired
// differently at the composition root a `dist` entry point reaches. Each cell below spawns the built
// binary for ONE door and asserts that the bytes it printed are the bytes the in-process render
// produces for THE CHILD'S OWN RESULT. Spawned cells stay few, on D-08's wall-clock argument.
//
// THE COMPARAND IS THE CHILD'S OWN OUTPUT, NEVER A LITERAL (390-03, and `filedProposal` above is the
// same move). Each anchor obtains the result the child actually computed — out of the session log
// the chat child wrote, out of the `--json` channel the `fn` child publishes, off the wire the MCP
// child answered on — and renders THAT in this process. A cell carrying its own copy of an expected
// document keeps passing after the thing it claims to be about has changed.

/**
 * The row all three anchors drive, DERIVED from the table by a stated rule rather than picked.
 *
 * THE RULE, and each clause of it is a requirement of the measurement rather than a taste: the first
 * row in the table's committed sorted order that (1) is reachable on every rostered door, so one op
 * makes three comparable readings instead of three incomparable ones; (2) takes the EMPTY input, so
 * the same fixture invocation can be typed at a chat prompt, passed to `fn --input` and sent as MCP
 * tool arguments without three different spellings; and (3) whose output contract's root is an
 * OBJECT, because an op answering a bare array answers `[]` in an empty fixture and a render of `[]`
 * has no declared field to withhold — a cell driven there would pass on a door that prints nothing
 * but brackets.
 *
 * DERIVED RATHER THAN NAMED because a hardcoded op id here is the shape success criterion 6 forbids
 * one file away: the day this op is retired, a literal would leave three anchors asserting about a
 * capability that no longer exists, while the rule re-lands on whatever the table's next qualifying
 * row is and says so.
 */
function anchorRow(): ScenarioRow {
  const projections = new Map(registryDeclarations().map((d) => [d.id, d.output]))
  const row = SCENARIO_TABLE.find((candidate) => {
    if (!candidate.perSurface.fn.reachable) return false
    if (!('reachable' in candidate.perSurface.mcp)) return false
    const input = candidate.input as Record<string, unknown>
    if (typeof input !== 'object' || input === null || Object.keys(input).length > 0) return false
    const projection = projections.get(candidate.opId) as Record<string, unknown> | undefined
    return projection?.['type'] === 'object'
  })
  expect(
    row,
    'no scenario row is reachable on all three doors with an empty input and an object-rooted '
    + 'output contract, so these anchors have nothing they can drive on every door at once',
  ).toBeDefined()
  return row as ScenarioRow
}

/** The bytes a declared field occupies — `render-parity.test.ts`'s token, for its reason. */
function fieldToken(marker: string): string {
  return `${JSON.stringify(marker)}:`
}

/** The one clause_result the chat child filed for an op, parsed off the session log it wrote. */
function childClauseResult(root: string, opId: string): { functionId: string; payload: unknown } {
  const sessions = join(root, '.agent-qa', 'sessions')
  expect(existsSync(sessions), `the chat child filed no session directory under ${sessions}`)
    .toBe(true)
  const found: { functionId: string; payload: unknown }[] = []
  for (const file of readdirSync(sessions)) {
    for (const line of readFileSync(join(sessions, file), 'utf8').split('\n')) {
      if (line.trim() === '') continue
      const event = JSON.parse(line) as Record<string, unknown>
      if (event['kind'] !== 'clause_result') continue
      if (event['functionId'] !== opId) continue
      found.push({ functionId: opId, payload: event['payload'] })
    }
  }
  expect(
    found.length,
    `the chat child filed ${found.length} clause_result events for ${opId}; this anchor needs `
    + 'exactly one, or the render it compares against is not the render of one turn',
  ).toBe(1)
  return found[0]!
}

describe('the per-surface render anchors (399.1 D-08): in-process ≡ shipped', () => {
  it('chat: the shipped binary prints the bytes this process renders from its own filed result',
    async () => {
      expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
      const row = anchorRow()
      const fixture = fixtureProject('399-1-anchor-chat')
      const utterance = `/fn ${row.opId} ${JSON.stringify(row.input)}`
      const outcome = await driveChatSpawned(fixture.root, fixture.configPath, utterance)

      expect(
        { code: outcome.code, signal: outcome.signal, stderr: outcome.stderr.trim().slice(0, 600) },
        'the spawned chat binary did not exit cleanly for the chat render anchor',
      ).toMatchObject({ code: 0, signal: null })

      // The post-marker slice discipline, on the echoed clause and with its uniqueness asserted —
      // `render-anchors.test.ts`'s header says why the marker is the clause and not the outcome line.
      const markerIndex = outcome.stdout.indexOf(utterance)
      expect(
        markerIndex,
        `the spawned chat binary never echoed ${JSON.stringify(utterance)}; its stdout was `
        + `${JSON.stringify(outcome.stdout.slice(0, 800))} and its stderr `
        + `${JSON.stringify(outcome.stderr.trim().slice(0, 400))}`,
      ).toBeGreaterThanOrEqual(0)
      expect(
        outcome.stdout.lastIndexOf(utterance),
        'the anchor clause occurs more than once in the child stdout, so the slice searched is not '
        + 'the one turn it means',
      ).toBe(markerIndex)
      const slice = outcome.stdout.slice(markerIndex + utterance.length)

      // IN-PROCESS ≡ SHIPPED. The comparand is this process's render of the result THE CHILD filed.
      const filed = childClauseResult(fixture.root, row.opId)
      const inProcess = renderClauseResults([filed]).join('\n')
      expect(inProcess.length, 'the in-process render of the child\'s result is empty, so the '
        + 'comparison below would be vacuous').toBeGreaterThan(0)
      expect(
        slice,
        `the shipped chat binary and the in-process render disagree about what this result looks `
        + `like. the binary printed ${JSON.stringify(slice.slice(0, 700))}; this process renders `
        + `${JSON.stringify(inProcess.slice(0, 700))}`,
      ).toContain(inProcess)

      // …and the row's own declared expectation, asserted on child stdout exactly as its in-process
      // twin asserts it on the produced document.
      for (const marker of row.renderExpect.markers) {
        expect(
          slice,
          `${row.opId} on chat (spawned): the field ${marker} never reached the terminal. `
          + `post-marker stdout: ${JSON.stringify(slice.slice(0, 700))}`,
        ).toContain(fieldToken(marker))
      }
    }, 180_000)

  it('fn: the shipped binary\'s human bytes ARE this process\'s render of its own JSON channel',
    async () => {
      expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
      const row = anchorRow()
      const fixture = fixtureProject('399-1-anchor-fn')
      const base = [CLI_ENTRY, '--config', fixture.configPath, 'fn', row.opId, '--input',
        JSON.stringify(row.input)]

      const human = await spawnCollecting(fixture.root, base)
      const machine = await spawnCollecting(fixture.root, [...base, '--json'])

      for (const [label, outcome] of [['human', human], ['--json', machine]] as const) {
        expect(
          { code: outcome.code, signal: outcome.signal, stderr: outcome.stderr.trim().slice(0, 600) },
          `the spawned fn binary did not exit cleanly on its ${label} channel`,
        ).toMatchObject({ code: 0, signal: null })
      }

      // The child's OWN result, off the machine channel it publishes for exactly this purpose.
      const payload = JSON.parse(machine.stdout) as unknown
      expect(
        payload,
        'the fn child\'s --json channel answered nothing to render, so the comparison below is '
        + 'vacuous',
      ).not.toBeUndefined()

      // EXACT EQUALITY, which is available here and nowhere else in this file: `fn` prints one
      // document and nothing around it, so "the door showed the whole result" and "the door showed
      // only the result" are one assertion. A `toContain` would pass on a build that printed the
      // payload inside a wrapper this suite has never seen.
      expect(
        human.stdout.trim(),
        'the shipped `agent-qa fn` printed something other than this process\'s render of the very '
        + 'result it answered on its own --json channel',
      ).toBe(renderFnResult(payload))

      for (const marker of row.renderExpect.markers) {
        expect(
          human.stdout,
          `${row.opId} on fn (spawned): the field ${marker} never reached the terminal. stdout: `
          + `${JSON.stringify(human.stdout.slice(0, 700))}`,
        ).toContain(fieldToken(marker))
      }
    }, 180_000)

  it('mcp: the shipped server\'s two channels are one masking, and carry the declared fields',
    async () => {
      expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
      const row = anchorRow()
      const mcp = row.perSurface.mcp
      expect('reachable' in mcp, 'the derived anchor row has no MCP door').toBe(true)
      if (!('reachable' in mcp)) return
      const fixture = fixtureProject('399-1-anchor-mcp')

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [CLI_ENTRY, '--config', fixture.configPath, 'mcp'],
        cwd: fixture.root,
        env: hermeticEnv(fixture.root),
        stderr: 'pipe',
      })
      let captured = ''
      transport.stderr?.on('data', (chunk: Buffer | string) => {
        captured += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      })
      const client = new Client({ name: 'agent-qa-399-1-render-anchor', version: '0.0.0' })
      try {
        await client.connect(transport)
        const result = await client.callTool({
          name: mcp.reachable.tool,
          arguments: row.input as Record<string, unknown>,
        })

        expect(
          {
            isError: (result as { isError?: boolean }).isError === true,
            stderr: captured.trim().slice(0, 400),
          },
          'the spawned MCP binary refused the anchor call in band; its stderr is quoted beside this',
        ).toMatchObject({ isError: false })

        const structured = (result as { structuredContent?: unknown }).structuredContent
        expect(
          structured,
          'the spawned MCP binary answered with no structuredContent, so this door rendered no '
          + 'result at all',
        ).toBeDefined()

        // IN-PROCESS ≡ SHIPPED, in the form this door's render makes checkable: `maskedToolResult`
        // answers BOTH channels from ONE masking, so the text a person reads must be the
        // serialization of the object a machine reads. Recomputing it here against the wire's own
        // structuredContent is the identity — a build whose two channels had drifted apart reds.
        const content = (result as { content?: readonly { type: string; text?: string }[] }).content
        const wireText = (content ?? [])
          .map((entry) => (entry.type === 'text' ? (entry.text ?? '') : ''))
          .join('\n')
        const recomputed = maskedToolResult(structured, (text: string) => text)
        const recomputedText = (recomputed.content ?? [])
          .map((entry) => (entry.type === 'text' ? (entry.text ?? '') : ''))
          .join('\n')
        expect(
          wireText,
          'the shipped MCP server\'s text channel is not the serialization of the object channel it '
          + 'answered beside it — the two are supposed to be one masking of one document',
        ).toBe(recomputedText)

        const serialized = JSON.stringify(structured)
        for (const marker of row.renderExpect.markers) {
          expect(
            serialized,
            `${row.opId} on mcp (spawned): the field ${marker} never reached the wire. `
            + `structuredContent: ${JSON.stringify(serialized.slice(0, 700))}`,
          ).toContain(fieldToken(marker))
        }
      } finally {
        await client.close().catch(() => {})
      }
    }, 180_000)
})
