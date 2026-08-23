// Who a config-apply commit says proposed it (Phase 400 plan 05, DASH-01).
//
// THE DEFECT THIS FILE MEASURES. `applyConfigProposalAsOneCommit` wrote every agent commit under a
// single constant — `agent-qa (proposed by chat) <agent-qa@local>` — whatever surface had actually
// minted the proposal. Before this phase that was imprecise: three of the four doors could mint a
// config change and one of them was named. With the dashboard door shipping in 400-01 it became
// actively wrong, and it is wrong in the one place a repository is supposed to be authoritative:
// `git log --author` is what a person filters on when they want to know where a change came from.
//
// WHAT IS DRIVEN, AND WHY NOTHING BELOW IS A LOOKALIKE. Every cell composes a REAL host through
// `composeCliLocalAgent` (or, for the dashboard arm, through `composeDashboardDoor` — the one
// assembly `agent-qa dashboard` itself calls), mints a proposal through the shipped
// `config.field.set` op, accepts it through the shipped `proposals.accept` op, and then reads the
// author off the repository with `git log`. Not off a receipt: a receipt is this product's account
// of what it did, and the whole subject here is whether that account and git's agree.
//
// MORE THAN ONE SURFACE IS DRIVEN, DELIBERATELY. A suite that only ever drove `chat` was green
// against the hardcoded constant for five phases; that is how the constant shipped as the only
// author in the first place. Per-surface attribution is a claim about a DIFFERENCE, so the cells
// have to produce the difference.
//
// MODEL-FREE. `chatModel` is unsupplied on every composition here, which is the shipped headless
// posture rather than a stub — `config.field.set` is a deterministic op and reaches no provider.
//
// THE EXECUTION CONTEXT IS INJECTED (400-01's seam), never pinned on the process, so no cell here
// leaks a posture into a sibling.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { invokeFunction } from '@vostride/agent-qa-agent'
import type { FunctionCaller } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { CHAT_DOOR_SURFACE } from '../commands/chat.js'
import { composeDashboardDoor, DASHBOARD_FUNCTION_CALLER } from '../commands/dashboard.js'
import {
  AGENT_CONFIG_COMMIT_AUTHOR_BY_SURFACE,
  AGENT_CONFIG_COMMIT_AUTHOR_UNRECOGNISED,
  AGENT_CONFIG_COMMIT_AUTHOR_UNRECORDED,
  composeCliLocalAgent,
  CLI_FUNCTION_CALLER,
} from '../composition/local-agent-host.js'
import { SURFACE_ROSTER } from './conformance/roster.js'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The legacy envelope's bytes, PRODUCED BY THE SHIPPED PROPOSE PATH before this plan changed it.
 *
 * PROVENANCE, because a fixture nobody can trace is a claim rather than evidence. This file is the
 * verbatim `.agent-qa/proposals/<id>.json` a real `composeCliLocalAgent` host wrote when
 * `config.field.set` was driven against {@link SEEDED_CONFIG} at commit `b87b4f48` — the tip of
 * `version-0.2` before plan 400-05 changed a byte. It was copied out of the temp workspace unedited;
 * `legacy fixture` cell (3a) below re-checks that claim mechanically by asserting the record still
 * parses through the SHIPPED reader and carries no `surface` anywhere in its origin.
 *
 * NOT A HAND-WRITTEN TYPE LITERAL, and the distinction is 390's produced-not-literal law: a literal
 * can pin a shape the producer cannot emit, and a legacy-compatibility cell built on one would be
 * measuring an envelope that never existed. The whole question this fixture answers is "what does a
 * proposal minted before this change actually look like on disk".
 */
const LEGACY_FIXTURE = join(HERE, 'fixtures', 'legacy-config-proposal.json')

/**
 * A committed project a config proposal can be minted against.
 *
 * `config-apply-discipline.test.ts`'s seed, verbatim, so a fixture produced against one file is
 * replayable against the other: the proposal's `baseDigest` is a claim about THESE bytes, and a
 * legacy record replayed into a workspace seeded with different ones would refuse at the freshness
 * re-check for a reason that has nothing to do with attribution.
 */
const SEEDED_CONFIG = `# agent-qa Configuration

# File discovery and project settings
workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local

# Named resource definitions (LLM configs, app targets)
registry:
  llms:
    - name: judge
      provider: openai-subscription
      model: gpt-5.6-terra
  targets:
    local-form:
      platform: web
      url: http://127.0.0.1:8931/form.html

# How runs behave by default.
use:
  llm: judge
  timeout:
    # Raise this when the app under test is slow to settle.
    step: 30s
    test: 90m
    navigation: 2m
  mobile:
    appState: reset
  parallel: false
`

interface Workspace {
  readonly root: string
  readonly configPath: string
  readonly agentQaRoot: string
  git(...args: string[]): string
}

function seedWorkspace(): Workspace {
  const root = mkdtempSync(join(tmpdir(), 'proposal-author-'))
  const configPath = join(root, 'agent-qa.config.yaml')
  const agentQaRoot = join(root, '.agent-qa')
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' })

  writeFileSync(configPath, SEEDED_CONFIG)
  writeFileSync(join(root, '.gitignore'), '.agent-qa/\n')
  git('init', '--quiet')
  git('config', 'user.name', 'A Person')
  git('config', 'user.email', 'a-person@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('add', '--', '.gitignore', 'agent-qa.config.yaml')
  git('commit', '--quiet', '-m', 'seed')

  return { root, configPath, agentQaRoot, git }
}

/** The author git holds for one commit — never the receipt's account of it. */
function authorAt(workspace: Workspace, rev: string): string {
  return workspace.git('log', '-1', '--format=%an <%ae>', rev).trim()
}

/** Mint one config proposal on a composed host, returning its id. */
async function mint(
  registry: Parameters<typeof invokeFunction>[0],
  caller: FunctionCaller,
  value: string,
): Promise<string> {
  const proposed = await invokeFunction(
    registry,
    'config.field.set',
    { path: 'use.timeout.step', value },
    caller,
  ) as { outcome: string; proposalId?: string }
  if (proposed.outcome !== 'proposed' || proposed.proposalId === undefined) {
    throw new Error(`expected a proposal, got ${JSON.stringify(proposed)}`)
  }
  return proposed.proposalId
}

/**
 * THE APPLYING HOST, AND IT IS THE SAME ONE IN EVERY CELL BELOW — deliberately.
 *
 * The claim under test is that attribution follows the surface that MINTED a proposal, so holding
 * the applying surface fixed while varying the minting one is what isolates that axis. A cell that
 * minted and applied on the same host could not tell a correct implementation from one that read
 * the applying surface, which is the wrong answer that would look right on three doors out of four.
 *
 * It is `agent-qa`'s own CLI composition because that is where a person actually accepts a
 * proposal: `proposals.accept` declares `requiresHumanOrigin`, and this is the host that mints
 * `human`.
 */
function applyingHost(workspace: Workspace): Parameters<typeof invokeFunction>[0] {
  return composeCliLocalAgent({
    agentQaRoot: workspace.agentQaRoot,
    configPath: workspace.configPath,
    resolveExecutionContext: () => 'local-interactive',
    confirm: { surface: 'tty-prompt', ask: () => true },
  }).registry
}

async function accept(
  registry: Parameters<typeof invokeFunction>[0],
  proposalId: string,
): Promise<unknown> {
  return await invokeFunction(registry, 'proposals.accept', { proposalId }, CLI_FUNCTION_CALLER)
}

describe('a config-apply commit names the surface that MINTED the proposal', () => {
  it('(1) a dashboard-minted proposal is attributed to the dashboard, though the CLI applied it', async () => {
    const workspace = seedWorkspace()
    // THE SHIPPED DOOR COMPOSER, the one `agent-qa dashboard` calls. A host assembled here from its
    // parts would make this cell a statement about this file rather than about the product.
    const { host } = composeDashboardDoor({
      agentQaRoot: workspace.agentQaRoot,
      configPath: workspace.configPath,
      boundOrigin: () => undefined,
      resolveExecutionContext: () => 'local-interactive',
    })

    const proposalId = await mint(host.registry, DASHBOARD_FUNCTION_CALLER, '45s')
    await accept(applyingHost(workspace), proposalId)

    const author = authorAt(workspace, 'HEAD')
    // THE POSITIVE AND THE NEGATIVE TOGETHER. The positive alone would pass under an author that
    // named every surface at once; the negatives alone would pass under one that named none. The
    // `cli` negative is the one that makes this a MINTING claim rather than an applying one — the
    // CLI is what accepted this proposal, and its name must not be on the commit.
    expect(author).toContain(DASHBOARD_FUNCTION_CALLER.surface)
    expect(author).not.toContain('proposed by chat')
    expect(author).not.toContain('proposed by the cli')
  })

  it('(2) a chat-minted proposal is still attributed to chat', async () => {
    const workspace = seedWorkspace()
    // THE WORD `agent-qa chat` ITSELF SUPPLIES, imported rather than re-typed. A literal `'chat'`
    // here would agree with the door today and be free to disagree with it forever after.
    const { registry } = composeCliLocalAgent({
      agentQaRoot: workspace.agentQaRoot,
      configPath: workspace.configPath,
      mintingSurface: CHAT_DOOR_SURFACE,
      resolveExecutionContext: () => 'local-interactive',
      confirm: { surface: 'tty-prompt', ask: () => true },
    })

    const proposalId = await mint(registry, CLI_FUNCTION_CALLER, '45s')
    await accept(applyingHost(workspace), proposalId)

    // THE CONTROL, and it is honest about being one: this arm was green against the hardcoded
    // constant too, because the hardcode said `chat`. What it guards is that naming the other
    // three doors did not cost the one door that was already named correctly. Its non-vacuity is
    // established by mutation (see the SUMMARY's ledger), not by its own colour — and by the
    // `cli` negative below, which the hardcode could not have satisfied by accident.
    const author = authorAt(workspace, 'HEAD')
    expect(author).toBe(AGENT_CONFIG_COMMIT_AUTHOR_BY_SURFACE.chat)
    expect(author).not.toContain('proposed by the cli')
  })

  it('(4) a surface this build does not recognise is named as such, never interpolated', async () => {
    const workspace = seedWorkspace()
    // A WORD FROM THE FUTURE, carrying the two characters that structure a git author field. A
    // reader that rendered the stored surface into `Name <email>` would let a record rewrite the
    // field it is being read into; the map's unrecognised arm is what makes that unreachable.
    const { registry } = composeCliLocalAgent({
      agentQaRoot: workspace.agentQaRoot,
      configPath: workspace.configPath,
      mintingSurface: 'voice> <someone-else@example.invalid',
      resolveExecutionContext: () => 'local-interactive',
      confirm: { surface: 'tty-prompt', ask: () => true },
    })

    const proposalId = await mint(registry, CLI_FUNCTION_CALLER, '45s')

    // THE RECORD STILL HOLDS THE WORD IT WAS GIVEN, read off disk BEFORE the accept moves it out
    // of the pending directory. The reading side is closed; the writing side is not, which is what
    // keeps a record written by a later build parseable here at all.
    const stored = JSON.parse(readFileSync(
      join(workspace.agentQaRoot, 'proposals', `${proposalId}.json`), 'utf8',
    )) as { origin: { surface?: string } }
    expect(stored.origin.surface).toBe('voice> <someone-else@example.invalid')

    await accept(applyingHost(workspace), proposalId)

    const author = authorAt(workspace, 'HEAD')
    expect(author).toBe(AGENT_CONFIG_COMMIT_AUTHOR_UNRECOGNISED)
    // PRESENCE IS NOT ABSENCE. Something WAS recorded; saying `unrecorded` would report the wrong
    // fact, and this is the negative that keeps the two arms from collapsing into one.
    expect(author).not.toBe(AGENT_CONFIG_COMMIT_AUTHOR_UNRECORDED)
    expect(author).not.toContain('someone-else@example.invalid')
  })

  it('(5) every rostered door supplies a minting surface — the census, over the roster itself', () => {
    // THE COMPLETE SET IS THE CONFORMANCE ROSTER'S, not a list kept here. `SURFACE_ROSTER` is what
    // this phase treats as the set of invocation doors, so a fifth door added there without a
    // module named below throws rather than passing quietly — the census cannot be greener than
    // its own discovery predicate, so the predicate is the product's own enumeration.
    const MODULE_FOR_DOOR: Readonly<Record<string, string>> = {
      chat: 'chat.ts',
      mcp: 'mcp.ts',
      fn: 'fn.ts',
      dashboard: 'dashboard.ts',
    }
    expect(SURFACE_ROSTER.length).toBeGreaterThan(0)
    for (const entry of SURFACE_ROSTER) {
      const module = MODULE_FOR_DOOR[entry.id]
      if (module === undefined) {
        throw new Error(
          `the roster carries a door this census has no module for: ${entry.id}. `
          + 'Name its command module here, and check that it supplies a mintingSurface.',
        )
      }
      const source = readFileSync(join(HERE, '..', 'commands', module), 'utf8')
      expect(`${entry.id}: ${source.includes('mintingSurface:') ? 'supplies' : 'omits'}`)
        .toBe(`${entry.id}: supplies`)
    }
  })

  it('(3) a legacy proposal — no surface recorded — applies, and is NOT attributed to chat', async () => {
    const workspace = seedWorkspace()
    const bytes = readFileSync(LEGACY_FIXTURE, 'utf8')
    const record = JSON.parse(bytes) as { id: string; origin: Record<string, unknown> }
    // (3a) THE FIXTURE'S OWN CLAIM, re-checked mechanically rather than asserted in prose: these
    // bytes record no minting surface, which is what makes them a legacy envelope at all.
    expect(Object.keys(record.origin)).not.toContain('surface')
    expect(bytes).not.toContain('"surface"')

    mkdirSync(join(workspace.agentQaRoot, 'proposals'), { recursive: true })
    writeFileSync(join(workspace.agentQaRoot, 'proposals', `${record.id}.json`), bytes)

    // IT STILL APPLIES. A read-side hardening that refused envelopes minted before the write-side
    // mint existed would turn a working entry point into a poisoned one — the one-sided-fix
    // regression this project has minted three times.
    const applied = await accept(applyingHost(workspace), record.id)
    expect(JSON.stringify(applied)).toContain('applied')

    // AND IT IS ATTRIBUTED HONESTLY. Not `chat` — that is the fabrication this plan closes — and
    // not any other surface either: nothing recorded one, so nothing may claim one.
    const author = authorAt(workspace, 'HEAD')
    expect(author).not.toContain('proposed by chat')
    expect(author).not.toContain(DASHBOARD_FUNCTION_CALLER.surface)
    expect(author).toBe(AGENT_CONFIG_COMMIT_AUTHOR_UNRECORDED)
  })
})
