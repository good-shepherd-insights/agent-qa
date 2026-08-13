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

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/** The env NAME matters: `sensitiveEnvSlice` selects by name suffix, never by value. */
const SECRET_ENV_NAME = 'AGENT_QA_395_ACCEPTANCE_TOKEN'

const CONFIG_FILE = 'agent-qa.config.yaml'

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
    const host = composeCliLocalAgent({ agentQaRoot, configPath, confirm: () => true })
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
})
