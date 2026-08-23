// CFGM-02's acceptance, measured on RENDERS through the production composition (395-04 · D-09/D-10/
// D-12).
//
// CFGM-02's sentence is about what a person can SEE, so this file drives the surfaces a person
// drives: `agent-qa proposals list` and `agent-qa proposals show`, through `createProposalsCommand`,
// over a real workspace, with `composeCliLocalAgent` building the host. Nothing here is stubbed —
// the scan, its SEEDS, the store, the registry and the renderers are all the shipped ones. That is
// the difference between this file and `construct-blocked.test.ts`, which measures the pipeline with
// an empty seed set and host doubles.
//
// THE SEEDED HALF IS THE SUBJECT, AND IT IS WHY THIS FILE SETS AN ENVIRONMENT VARIABLE. The planted
// value below matches no detector shape at all: no lexicon entry names it, and nothing about it
// looks like a credential. It is caught only because the composition root seeds the scan from
// `sensitiveEnvSlice(process.env)` — the SAME name-based filter the run masker is built with. So the
// blocking cells here are a measurement of the D-09 binding itself, and they red on a composition
// that bound the scan with no seeds, or with the wrong ones.
//
// AND THE CONTROL IS THE OTHER HALF OF THAT SAME CLAIM. A config value equal to `HOME` must NOT
// block. `seedMaskingContext` registers EVERY env value it is handed — filtering is explicitly the
// caller's job — so a composition that passed the raw environment would seed HOME, PATH and every
// planner-visible setting, and any config edit near one of them would be refused as a secret. The
// guard would then be unusable, which is how guards get turned off. That cell reds on the most
// obvious wrong binding there is.
//
// WHAT MAKES EACH CELL RED:
//
//   (A) D-12 renders  — a scan narrowed to the changed lines. The cell PROVES, against the real
//                       renderer and before it asserts anything else, that the planted secret lands
//                       on a CONTEXT line — so a `+`/`-`-only scan returns clean and this cell fails.
//   (B) absence       — the blocked record carrying the diff, or a summary line built from the
//                       value. Both are asserted against the real `list` and `show` output, windowed
//                       at eight characters so a partial disclosure fails too.
//   (C) naming        — a render that says only "blocked". A person needs the file, the reason and
//                       the field, or the block is a dead end.
//   (D) the control   — the composition binding raw environment instead of the name-based slice.
//   (E) accept        — an accept that threw, or one that reached the apply port.
//   (F) RANGE         — 395-10, GAP 1 / CR-01. A scan whose INPUT is the diff while the validator's
//                       input is the whole pinned set. The planted value sits in a set member this
//                       proposal never touches, so it appears in no hunk and in no added file: a
//                       diff-ranged scan returns clean, the validator reads those bytes, and its
//                       words carry them onto three surfaces. The cell is red on exactly that
//                       implementation — it was observed red on pre-395-10 HEAD, where the record
//                       filed `schema-fail` and `validationIssues` quoted the offending source line
//                       verbatim.
//   (G) POSITION        — 395-10, the same gap's second missing item, plus WR-11. A yaml parse
//                       failure whose issue string is built from the LIBRARY'S error text: the
//                       vendored `yaml` package pretty-prints its parse errors with an excerpt of
//                       the offending source line, so `errorText(error)` publishes whatever that
//                       line held. The cell's fixture is deliberately NOT secret-shaped and NOT
//                       seeded, so the scan legitimately passes it and the schema-fail road really
//                       runs — the channel is closed by REDUCING the issue to its position, not by
//                       blocking earlier. It also pins WR-11: the record's `paths` must name the
//                       file the issue is about, which pre-395-10 it did not.

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { invokeFunction } from '@vostride/agent-qa-agent'
import { renderConfigDiff, utf8Decode, utf8Encode } from '@vostride/agent-qa-schema'
import type { ConfigProposeOutput, ProposalsAcceptOutput } from '@vostride/agent-qa-schema'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createProposalsCommand, renderAccept } from '../../commands/proposals.js'
import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../local-agent-host.js'

/**
 * A value NO detector names, and that is the point.
 *
 * The pattern half cannot see this. If a block happens, the seeded half saw it, which means the
 * composition really did hand the scan the environment slice the masker is built from.
 */
const SEEDED_SECRET = 'grommet-hinge-395-parlour-slate'

/**
 * `sha256hex16(SEEDED_SECRET)`, computed OUTSIDE this codebase — `hashlib.sha256(v).hexdigest()[:16]`.
 *
 * The presence half of cell (F)'s absence assertions. A surface that carries this demonstrably
 * observed those exact bytes and chose not to print them, which is what separates a non-disclosing
 * render from a channel that never had the value in the first place.
 */
const SEEDED_FINGERPRINT = '624a6dac7a3dc6cb'

/** The env NAME matters: `sensitiveEnvSlice` selects by name suffix, never by value. */
const SECRET_ENV_NAME = 'AGENT_QA_395_ACCEPTANCE_TOKEN'

const CONFIG_FILE = 'agent-qa.config.yaml'
const HOOKS_FILE = 'hooks.yaml'

function configText(options: { readonly note: string }): string {
  // THE NOTE SITS TWO LINES ABOVE THE `step` THIS SUITE EDITS, so it renders on a CONTEXT line of
  // the hunk rather than on a changed one. A comment is the most faithful fixture there is for the
  // D-12 case: a person pasted something into their config months ago and it has been sitting there
  // ever since. Cell (A) asserts the context-line placement against the real renderer rather than
  // trusting this arithmetic.
  //
  // The rest is the house-style config, valid against the real schema — `use.llm` names a registry
  // entry that exists, because a candidate that fails whole-config validation would block for the
  // OTHER reason and every cell here would be measuring the wrong road in.
  return `# agent-qa Configuration
workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local

registry:
  llms:
    - name: judge
      provider: openai-subscription
      model: gpt-5.6-terra

use:
  llm: judge
  # deploy note: ${options.note}
  timeout:
    step: 30s
    test: 90m
    navigation: 2m
  mobile:
    appState: reset
  parallel: false
`
}

/**
 * A committed hooks file this suite's proposals never touch, malformed around the line that carries
 * `value` (395-10 · GAP 1).
 *
 * MALFORMED ON PURPOSE, and the malformation is the VERIFICATION fixture reproduced: `yaml`'s parse
 * error for a nested mapping in a compact mapping is pretty-printed with a verbatim excerpt of the
 * offending source line, so the pre-395-10 pipeline — which validated these bytes without ever
 * scanning them — put `value` into `validationIssues`, onto the propose return, into the persisted
 * record and into `proposals show`. It stays malformed after the fix because the fix must block
 * BEFORE the validator runs, not because the validator got quieter.
 */
function hooksTextCarrying(value: string): string {
  return `# project hooks
hooks:
  - name: deploy note
    token: ${value}: oops
`
}

/**
 * Everything this workspace persisted, as one text — paths included.
 *
 * THE WHOLE STORE RATHER THAN ONE RECORD PATH. The claim under test is that no persisted byte
 * anywhere carries the planted value, and a helper that knew the record's filename could be
 * satisfied by a leak that landed in a sibling file (an index, a decision trail, a log).
 */
function persistedText(dir: string): string {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    out.push(full)
    if (statSync(full).isDirectory()) out.push(persistedText(full))
    else out.push(readFileSync(full, 'utf8'))
  }
  return out.join('\n')
}

let root: string
let configPath: string
let agentQaRoot: string
let priorEnv: string | undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-blocked-renders-'))
  configPath = join(root, CONFIG_FILE)
  agentQaRoot = join(root, '.agent-qa')
  mkdirSync(agentQaRoot, { recursive: true })
  priorEnv = process.env[SECRET_ENV_NAME]
  process.env[SECRET_ENV_NAME] = SEEDED_SECRET
})

afterEach(() => {
  if (priorEnv === undefined) delete process.env[SECRET_ENV_NAME]
  else process.env[SECRET_ENV_NAME] = priorEnv
  rmSync(root, { recursive: true, force: true })
})

/** Drive a verb exactly as a person does — the real command, the real composition it builds. */
async function cli(args: readonly string[]): Promise<string> {
  const stdout: string[] = []
  const stderr: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    stdout.push(values.map(String).join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
    stderr.push(values.map(String).join(' '))
  })
  const priorExit = process.exitCode
  process.exitCode = undefined
  try {
    const program = new Command()
      .option('--config <path>', 'config file path')
      .addCommand(createProposalsCommand())
    program.exitOverride()
    await program.parseAsync(['node', 'agent-qa', '--config', configPath, ...args])
    // STDERR IS RETURNED BESIDE STDOUT, not swallowed: a verb that failed and printed its error to
    // the other stream would otherwise satisfy an absence assertion by printing nothing at all.
    return [...stdout, ...stderr].join('\n')
  } finally {
    process.exitCode = priorExit
    log.mockRestore()
    error.mockRestore()
  }
}

/** Propose through the PRODUCTION composition — the one that binds the scan's seeds. */
async function propose(input: {
  readonly path: string
  readonly value: string
}): Promise<ConfigProposeOutput> {
  const host = composeCliLocalAgent({ agentQaRoot, configPath })
  try {
    return await invokeFunction(
      host.registry,
      'config.field.set',
      input,
      CLI_FUNCTION_CALLER,
    ) as ConfigProposeOutput
  } finally {
    await host.close()
  }
}

function windows(secret: string): string[] {
  const out: string[] = []
  for (let index = 0; index + 8 <= secret.length; index++) out.push(secret.slice(index, index + 8))
  return out
}

describe('CFGM-02 on the surfaces a person reads (D-10/D-12)', () => {
  it('(A) a committed secret on a CONTEXT line blocks an innocuous edit', async () => {
    writeFileSync(configPath, configText({ note: SEEDED_SECRET }))

    // THE NON-VACUITY PROOF FIRST. If the planted value rendered on a changed line, everything below
    // would pass under a scan that read only `+`/`-` lines — green under the implementation D-12
    // forbids. It renders on a CONTEXT line, and this says so against the real renderer.
    const rendered = renderConfigDiff([{
      path: CONFIG_FILE,
      oldBytes: utf8Encode(configText({ note: SEEDED_SECRET })),
      newBytes: utf8Encode(configText({ note: SEEDED_SECRET }).replace('step: 30s', 'step: 45s')),
    }])
    if (rendered.outcome !== 'changed') throw new Error('the fixture edit rendered no diff')
    const carrying = utf8Decode(rendered.diffBytes)
      .split('\n')
      .filter((line) => line.includes(SEEDED_SECRET))
    expect(carrying).toHaveLength(1)
    expect(carrying[0]?.startsWith('+')).toBe(false)
    expect(carrying[0]?.startsWith('-')).toBe(false)

    const answer = await propose({ path: 'use.timeout.step', value: '45s' })

    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('guardrail-hit')
    expect(answer.summaryLine).toContain('already carries a secret')
    // CAUGHT BY THE SEEDED HALF, not by a shape. `seeded-secret` is the detector id for a value the
    // masker already knows, so this assertion is the D-09 binding measured end to end.
    expect(answer.scanFindings?.[0]?.detector).toBe('seeded-secret')
    expect(answer.scanFindings?.[0]?.path).toBe(CONFIG_FILE)
  })

  it('(B,C) list and show name the file and the reason, and carry no window of the secret',
    async () => {
      writeFileSync(configPath, configText({ note: SEEDED_SECRET }))
      const answer = await propose({ path: 'use.timeout.step', value: '45s' })
      if (answer.outcome !== 'blocked') throw new Error('expected a blocked proposal')

      const listed = await cli(['proposals', 'list'])
      const shown = await cli(['proposals', 'show', answer.proposalId])

      // THE CHANNEL DEMONSTRABLY WORKS: both surfaces really rendered this proposal, so the absence
      // below is a fact about what they print rather than about a command that printed nothing.
      expect(listed).toContain(answer.proposalId.slice(0, 8))
      expect(listed).toContain('blocked')
      expect(shown).toContain('BLOCKED')
      expect(shown).toContain('guardrail-hit')
      expect(shown).toContain(CONFIG_FILE)
      expect(shown).toContain('seeded-secret')
      expect(shown).toContain('use.timeout.step')

      // AND NEITHER CARRIES THE VALUE, NOR ANY EIGHT-CHARACTER RUN OF IT.
      for (const window of windows(SEEDED_SECRET)) {
        expect(listed).not.toContain(window)
        expect(shown).not.toContain(window)
      }
      // No diff reached a surface either — there is none stored to reach one.
      expect(shown).not.toContain('--- a/')
      expect(shown).not.toContain('+++ b/')
    })

  it('(D) CONTROL: a config value equal to an ordinary env value does NOT block', async () => {
    // `HOME` is exported in every shell this suite can run in, is not credential-shaped by name, and
    // `sensitiveEnvSlice` therefore does not seed it. A composition that handed the scan the raw
    // environment would seed it and refuse this edit — which is the most obvious wrong binding, and
    // the one this cell exists to catch. It also proves the blocking cells above are not passing
    // because everything blocks.
    const home = process.env.HOME
    expect(typeof home).toBe('string')
    expect((home ?? '').length).toBeGreaterThan(4)
    writeFileSync(configPath, configText({ note: home ?? 'no-home-in-this-shell' }))

    const answer = await propose({ path: 'use.timeout.step', value: '45s' })

    expect(answer.outcome).toBe('proposed')
    if (answer.outcome !== 'proposed') throw new Error('unreachable')
    expect(answer.shownDiff).toContain('+    step: 45s')
    expect(answer.crossBoundary).toBe(false)
  })

  it('(E) accepting the blocked proposal answers not-applyable and commits nothing', async () => {
    writeFileSync(configPath, configText({ note: SEEDED_SECRET }))
    const answer = await propose({ path: 'use.timeout.step', value: '45s' })
    if (answer.outcome !== 'blocked') throw new Error('expected a blocked proposal')

    // THE PRODUCTION COMPOSITION, with the gate SATISFIED rather than avoided. `proposals.accept`
    // is `mutating-shared`, so a headless process is fail-closed-denied before the route is
    // reached — and a denial would answer a question about the gate instead of about the blocked
    // payload. The context scoping and the injected confirm are the same two lines
    // `proposals-digest-commands.test.ts` uses for the same reason.
    const host = composeCliLocalAgent({
      agentQaRoot,
      configPath,
      confirm: { surface: 'tty-prompt', ask: () => true },
    })
    let accepted: ProposalsAcceptOutput
    try {
      accepted = await runSafetyScope({ executionContext: 'local-interactive' }, async () =>
        await invokeFunction(
          host.registry,
          'proposals.accept',
          { proposalId: answer.proposalId },
          CLI_FUNCTION_CALLER,
        ) as ProposalsAcceptOutput)
    } finally {
      await host.close()
    }

    // IT RESOLVED. A throw here would be the defect: `applyablePayload` refusing by name is the
    // port's invariant, and letting it escape would report this surface's ordinary answer as a
    // fault, discarding the id and the reason with it.
    expect(accepted.apply.outcome).toBe('not-applyable')
    if (accepted.apply.outcome !== 'not-applyable') throw new Error('unreachable')
    expect(accepted.apply.proposalId).toBe(answer.proposalId)
    expect(accepted.apply.reason).toBe('guardrail-hit')
    expect(accepted.grant.kind).toBe('not-requested')

    // The person's config is exactly where they left it, and the render says why without quoting.
    expect(readFileSync(configPath, 'utf8')).toBe(configText({ note: SEEDED_SECRET }))
    const rendered = renderAccept(accepted)
    expect(rendered).toContain('not-applyable')
    expect(rendered).toContain('guardrail-hit')
    for (const window of windows(SEEDED_SECRET)) expect(rendered).not.toContain(window)
  })

  it('(F) a secret in an UNCHANGED set member blocks, and no surface carries a window of it',
    async () => {
      // THE CONFIG IS CLEAN AND VALID; the planted value lives in the hooks file, which this
      // proposal does not touch. That is the CR-01 geometry: the scan's input was the diff, the
      // validator's input was the whole pinned set, and the difference between the two ranges was a
      // disclosure channel.
      writeFileSync(configPath, configText({ note: 'no secret in this file' }))
      writeFileSync(join(root, HOOKS_FILE), hooksTextCarrying(SEEDED_SECRET))

      // NON-VACUITY FIRST, AGAINST THE REAL RENDERER. The planted value is in NO hunk and in no
      // added file — the rendered artifact does not contain it at all — so this cell cannot pass
      // under a diff-ranged scan by accident of where the fixture put its bytes. It is red on that
      // implementation by construction.
      const rendered = renderConfigDiff([{
        path: CONFIG_FILE,
        oldBytes: utf8Encode(configText({ note: 'no secret in this file' })),
        newBytes: utf8Encode(
          configText({ note: 'no secret in this file' }).replace('step: 30s', 'step: 45s'),
        ),
      }])
      if (rendered.outcome !== 'changed') throw new Error('the fixture edit rendered no diff')
      expect(utf8Decode(rendered.diffBytes)).not.toContain(SEEDED_SECRET)

      const answer = await propose({ path: 'use.timeout.step', value: '45s' })

      // BLOCKED BY THE GUARDRAIL, NOT BY THE SCHEMA. Pre-395-10 this answered `schema-fail`: the
      // scan never read these bytes and the yaml parser did, so the refusal came from the validator
      // and carried the validator's words.
      expect(answer.outcome).toBe('blocked')
      if (answer.outcome !== 'blocked') throw new Error('unreachable')
      expect(answer.blockedReason).toBe('guardrail-hit')
      // D-12's existing-config sentence, produced by the same carried-over MEASUREMENT the changed
      // -member road uses — the bytes are committed, so the person is told they already have them.
      expect(answer.summaryLine).toContain('already carries a secret')
      expect(answer.summaryLine).toContain(HOOKS_FILE)
      expect(answer.paths).toContain(HOOKS_FILE)
      expect(answer.scanFindings?.[0]?.detector).toBe('seeded-secret')
      expect(answer.scanFindings?.[0]?.path).toBe(HOOKS_FILE)
      // No validator words at all: the block happened before the validator was handed anything.
      expect(answer.validationIssues).toBeUndefined()

      const returned = JSON.stringify(answer)
      const persisted = persistedText(agentQaRoot)
      const shown = await cli(['proposals', 'show', answer.proposalId])

      // THE PRESENCE HALVES, PER SURFACE, BEFORE ANY ABSENCE. Each of the three demonstrably
      // rendered THIS block, about THIS file, from a report that observed THOSE bytes — so the
      // windowed absence below is a fact about what they print rather than about three channels
      // that printed nothing.
      for (const surface of [returned, persisted, shown]) {
        expect(surface).toContain('guardrail-hit')
        expect(surface).toContain(HOOKS_FILE)
        expect(surface).toContain(SEEDED_FINGERPRINT)
      }

      // AND NONE OF THE THREE CARRIES ANY EIGHT-CHARACTER RUN OF THE VALUE.
      for (const window of windows(SEEDED_SECRET)) {
        expect(returned).not.toContain(window)
        expect(persisted).not.toContain(window)
        expect(shown).not.toContain(window)
      }
    })

  it('(G) a yaml parse failure names WHERE, never WHAT — and the record names the right file',
    async () => {
      // NOT SECRET-SHAPED AND NOT SEEDED, on purpose: the scan passes these bytes, which is what
      // lets the schema-fail road actually run. Cell (F) closes the road where a secret is the
      // subject; this one closes the channel for everything else a person's file might hold, since
      // a parse error quotes its source line whatever that line contains.
      const marker = 'zeta-nine-deploy-marker'
      writeFileSync(configPath, configText({ note: 'no secret in this file' }))
      writeFileSync(join(root, HOOKS_FILE), `# project hooks
hooks:
  - name: nightly
    note: ${marker}: oops
`)

      const answer = await propose({ path: 'use.timeout.step', value: '45s' })

      expect(answer.outcome).toBe('blocked')
      if (answer.outcome !== 'blocked') throw new Error('unreachable')
      expect(answer.blockedReason).toBe('schema-fail')

      // POSITION-ONLY. The issue names the file, the line and the column, and nothing else — no
      // property of the thrown error other than where it happened reaches this string.
      const issues = answer.validationIssues ?? []
      const parseIssue = issues.find((issue) => issue.startsWith(`${HOOKS_FILE}: `))
      expect(parseIssue).toBeDefined()
      expect(parseIssue).toMatch(
        new RegExp(`^${HOOKS_FILE}: not readable as YAML at line \\d+, column \\d+$`),
      )

      // WR-11: the record points a person at the file the issue is ABOUT, unioned with the file the
      // proposal diffed. Pre-395-10 `paths` was the diffed files alone, so a person told their
      // configuration was invalid was handed the one file that was fine.
      expect(answer.paths).toContain(HOOKS_FILE)
      expect(answer.paths).toContain(CONFIG_FILE)

      const returned = JSON.stringify(answer)
      const persisted = persistedText(agentQaRoot)
      const shown = await cli(['proposals', 'show', answer.proposalId])

      // PRESENCE FIRST, PER SURFACE: each really rendered this refusal, its reason, and the issue
      // about this file. The absence below is therefore about what they print.
      for (const surface of [returned, persisted, shown]) {
        expect(surface).toContain('schema-fail')
        expect(surface).toContain(HOOKS_FILE)
        expect(surface).toContain('not readable as YAML at line')
      }

      // AND NONE OF THEM CARRIES THE SOURCE LINE'S TEXT.
      expect(returned).not.toContain(marker)
      expect(persisted).not.toContain(marker)
      expect(shown).not.toContain(marker)
    })
})
