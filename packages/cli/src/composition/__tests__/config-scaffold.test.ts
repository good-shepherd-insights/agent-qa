// Scaffold from zero, through the REAL producer, on a real repository (395-08 · CFGM-05 · D-04/
// D-13/D-14/D-15).
//
// THE PRODUCER IS PRODUCTION'S. `createScaffoldContentPort` is the same factory
// `composeCliLocalAgent` binds, over `commands/scaffold-content.ts` — the one module `agent-qa init`
// renders its own scaffold from. So what these cells pin is what a person actually gets, and D-04's
// no-drift claim is measured rather than asserted: there is no second content path for a golden to
// be taken over.
//
// THE GOLDENS ARE BYTES, COMMITTED, FOR TWO DIFFERENT DOMAINS. `__fixtures__/scaffold-*.diff` hold
// the exact `shownDiffBase64` bytes the pipeline rendered, produced BY THE REAL OP and reviewed at
// authoring time. Two domains rather than one is the acceptance bar, not thoroughness: a cell
// asserting one exact booking.com diff passes under an implementation that hard-codes booking.com,
// and the second golden is the case that implementation cannot produce. Regenerate deliberately
// with `SCAFFOLD_GOLDEN=write`, and read the diff before committing it — a golden updated without
// being read is a pin that has stopped pinning.
//
// WHAT MAKES EACH CELL RED:
//
//   (1) enumeration    — a config-set enumeration that answered differently for a project with no
//                        config file, or an apply whose pathspec disagreed with it. Both halves are
//                        read out of the SHIPPED `enumerateConfigFileSet` and out of git's own
//                        account of the commit, so neither side is this file's opinion.
//   (2) the golden     — ANY change to the derived scaffold's bytes, including one made in `init`'s
//                        half of the shared module. That is the point: the two write paths share a
//                        producer, so a drift in either is a red here.
//   (3) two domains    — an implementation that hard-codes a site. Same producer, same assertions,
//                        a golden it cannot emit.
//   (4) APPLYABLE      — the WINDOWS-129 shape: an op whose derived artifact cannot pass the
//                        pipeline's own whole-config validation has no success path at all, and the
//                        only way to find that out is to assert the arm. The config bytes are ALSO
//                        parsed through the shipped `AgentQaConfigSchema` here, so a proposal that
//                        was applyable because validation was skipped fails too.
//   (5) the commit     — an apply that wrote something other than the payload's bytes, or that
//                        committed more paths than the proposal names. Byte-compared against the
//                        record read back OFF DISK.
//   (6) the upsert     — a scaffold that overwrote a project's existing `.gitignore` instead of
//                        appending the managed block to it. The seeded file's own rule is asserted
//                        still present, which is the half a "the block is there" cell would miss.
//   (7) the confirm    — D-14's pause. The confirm port is a SPY and the cell asserts it was
//                        CALLED, because a turn that never reached a confirm also completes.
//   (8) fail closed    — a non-TTY caller. The same accept with no confirm bound must not commit.
//  (13) the MERGE      — 395-12: an `already-configured` predicate keyed on a config file EXISTING
//                        rather than on a configuration this scaffold would overwrite. The fixture
//                        declares an LLM, carries comments, and declares ZERO targets — the only
//                        project class that can reach a chat turn at all — so a file-keyed
//                        predicate reds here with `refused / already-configured`. Its second half
//                        is the merge itself: the emitted config is the person's own bytes with
//                        exactly one target entry inserted, asserted by REMOVING the inserted text
//                        and byte-comparing what is left against the committed file.
// (13b) hooks left be  — a merge that composed the scaffold's hooks template over a hooks file a
//                        person already wrote. That is the same wholesale overwrite
//                        `already-configured` refuses for the config yaml, one file over.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createFunctionRegistry, invokeFunction } from '@vostride/agent-qa-agent'
import type { FunctionDeps } from '@vostride/agent-qa-agent'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import {
  createProposalsInbox,
  mintProposalId,
  writePendingProposalRecord,
} from '@vostride/agent-qa-knowledge-local'
import {
  CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  base64Decode,
  enumerateConfigFileSet,
  utf8Decode,
} from '@vostride/agent-qa-schema'
import type {
  ConfigProposeOutput,
  FunctionCaller,
  ProposalRecord,
  ProposalsAcceptOutput,
} from '@vostride/agent-qa-schema'
import { scanConstructedArtifact } from '@vostride/agent-qa-safety'
import { parseDocument, parse as parseYaml } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createConfigApplyPort,
  createConfigFilesPort,
  createConfigUndoSourcePort,
  createConfigValidatePort,
  createScaffoldContentPort,
} from '../local-agent-host.js'

const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')
const CONFIG_FILE = 'agent-qa.config.yaml'

/** The project's OWN gitignore rule, seeded so the upsert has something to compose with. */
const SEEDED_GITIGNORE = '# the project\'s own rules\ndist/\n.agent-qa/\n'

/**
 * A configuration that declares an LLM, carries comments, and declares NO TARGETS (395-12).
 *
 * THIS IS THE CLASS SC-5 HAS TO SERVE, and it is measured rather than imagined:
 * `resolveCliChatCapabilities` reads the chat model out of `registry.llms`, so a project that can
 * hold a conversation at all is a project that HAS a config file. WINDOWS 132's jaw 2 is that the
 * scaffold refused exactly those projects — the ones able to reach it — because `already-configured`
 * was keyed on the file existing rather than on a configuration this scaffold would overwrite.
 *
 * IT ROUND-TRIPS BYTE-IDENTICALLY THROUGH `parseDocument` → `toString`, and cell (13) asserts that
 * FIRST. The comment-preserving edit re-emits some constructs with canonical spacing, so a fixture
 * that did not round-trip would fail the byte-preservation assertion below for a reason that has
 * nothing to do with the merge. Asserting the identity round-trip separately is what separates the
 * serializer's fidelity — which every `config.field.set` already rides — from this plan's own
 * claim, which is that the merge inserts one entry and moves no other byte.
 */
const ZERO_TARGET_CONFIG = `# my own agent-qa configuration

workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: .env.secrets.local

# The model this project chats with. Without it there is no planner, and without a
# planner the write_test route never fires at all.
registry:
  llms:
    - name: judge
      provider: openai-subscription
      model: gpt-5.6-terra

use:
  llm: judge
  mobile:
    appState: preserve
  parallel: false
`

/** The target entry the merge inserts, as the exact text it occupies in the emitted document. */
const INSERTED_TARGET_ENTRY
  = '  targets:\n    booking-com:\n      platform: web\n      url: https://booking.com\n'

/** A hooks file a person wrote themselves — valid, and NOT the scaffold's template. */
const SEEDED_HOOKS = '# the project\'s own hooks\nhooks: []\n'

let root: string
let configPath: string
let agentQaRoot: string
let confirms: number

function git(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function commitCount(): number {
  return Number(git('rev-list', '--count', 'HEAD').stdout.trim())
}

function headFiles(): string[] {
  return git('show', '--stat', '--name-only', '--format=', 'HEAD').stdout
    .split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
    .sort()
}

function storedRecord(proposalId: string): ProposalRecord {
  return JSON.parse(
    readFileSync(join(agentQaRoot, 'proposals', `${proposalId}.json`), 'utf8'),
  ) as ProposalRecord
}

function storedApplyable(proposalId: string) {
  const record = storedRecord(proposalId)
  if (record.kind !== 'config') throw new Error(`stored ${proposalId} is a ${record.kind} proposal`)
  if (record.payload.payloadKind !== 'applyable') {
    throw new Error(
      `stored payload is ${record.payload.payloadKind}: ${record.payload.summaryLine}`,
    )
  }
  return record.payload
}

/**
 * The golden, compared or written.
 *
 * WRITTEN ONLY UNDER AN EXPLICIT ENVIRONMENT FLAG. A golden that regenerates itself on mismatch is
 * not a pin; it is a record of the last thing that happened.
 */
function golden(name: string, actual: string): void {
  const path = join(FIXTURES, name)
  if (process.env.SCAFFOLD_GOLDEN === 'write') {
    mkdirSync(FIXTURES, { recursive: true })
    writeFileSync(path, actual)
    return
  }
  expect(existsSync(path), `golden ${name} is missing — regenerate with SCAFFOLD_GOLDEN=write`)
    .toBe(true)
  expect(actual).toBe(readFileSync(path, 'utf8'))
}

function registryFor(options: { readonly confirm?: boolean } = {}) {
  const inbox = createProposalsInbox({
    resolveAgentQaRoot: () => agentQaRoot,
    now: () => Date.now(),
  })

  const deps: FunctionDeps = {
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
      getMasked: () => Promise.resolve({
        schemaVersion: MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
        configPath: CONFIG_FILE,
        entries: [],
      }),
    },
    proposalsInbox: inbox,
    configFiles: createConfigFilesPort(configPath),
    configValidate: createConfigValidatePort(),
    configApply: createConfigApplyPort(configPath),
    configUndoSource: createConfigUndoSourcePort(configPath),
    // THE REAL PRODUCER. Not a double, and not a copy — the factory the CLI composition binds.
    scaffoldContent: createScaffoldContentPort(),
    // The REAL scan with an EMPTY seed set, on `config-apply.test.ts`'s stated reasoning: the
    // function is production's, the seeds are not, because a cell whose verdict depends on the
    // developer's exported variables measures the machine.
    configScan: { scan: (parts) => scanConstructedArtifact(parts, {}) },
    configProposals: {
      put: (record) => {
        const proposalId = mintProposalId(() => `${Date.now()}-${Math.floor(performance.now())}`)
        writePendingProposalRecord(agentQaRoot, {
          schemaVersion: CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
          id: proposalId,
          kind: record.kind,
          origin: { emittedBy: record.emittedBy, at: Date.now() },
          payload: record.payload,
        } as ProposalRecord)
        return Promise.resolve({ proposalId })
      },
    },
  }

  return createFunctionRegistry({
    deps,
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    resolveExecutionContext: () => 'local-interactive',
    // A SPY, so "the confirm was reached" is a measurement rather than an inference from the turn
    // having completed (D-14). Omitted entirely for the fail-closed cell.
    ...(options.confirm === undefined
      ? {}
      : {
        confirm: () => {
          confirms += 1
          return options.confirm as boolean
        },
      }),
  })
}

async function scaffold(
  registry: ReturnType<typeof registryFor>,
  domain: string,
): Promise<ConfigProposeOutput> {
  return await invokeFunction(
    registry, 'config.project.scaffold', { domain }, HUMAN,
  ) as ConfigProposeOutput
}

function proposedId(answer: ConfigProposeOutput): string {
  if (answer.outcome !== 'proposed') {
    throw new Error(`expected a proposal, got ${JSON.stringify(answer)}`)
  }
  return answer.proposalId
}

/**
 * THE SECOND LAYOUT for the CREATE direction: configDir is not the repository root (395-11).
 *
 * The undo's half of this axis is `config-apply-discipline.test.ts` cells 15-17; this is the same
 * blind spot on the other side of the same pipeline. Every fixture in this file used one temp
 * directory as both git root and config dir, so a scaffold that answered in the wrong path
 * vocabulary would have written to the same place either way and no cell could tell.
 *
 * `sub/dir/.gitignore` IS SEEDED AND COMMITTED, because the pinned set is resolved relative to the
 * CONFIG directory: the project's `.gitignore` for this layout is the one beside the config, and a
 * fixture that seeded only the root's would be measuring the upsert against a file the scaffold
 * never reads.
 */
function relocateToSubdir(): string {
  const configDir = join(root, 'sub', 'dir')
  mkdirSync(configDir, { recursive: true })
  configPath = join(configDir, CONFIG_FILE)
  agentQaRoot = join(configDir, '.agent-qa')
  writeFileSync(join(configDir, '.gitignore'), SEEDED_GITIGNORE)
  git('add', '--', 'sub/dir/.gitignore')
  git('commit', '--quiet', '-m', 'seed the subdirectory that will hold the configuration')
  return configDir
}

/**
 * Commit a configuration that declares an LLM and no targets (395-12), plus an optional hooks file.
 *
 * COMMITTED, never merely written. `config.project.scaffold` re-reads the committed set at proposal
 * time (CFGM-04) and the apply's porcelain check is scoped to that same set, so a fixture that left
 * the config dirty would be measuring D-05's two-commit human-first road instead of the merge.
 */
function seedZeroTargetConfig(options: { readonly hooks?: string } = {}): void {
  writeFileSync(configPath, ZERO_TARGET_CONFIG)
  const paths = [CONFIG_FILE]
  if (options.hooks !== undefined) {
    writeFileSync(join(root, 'hooks.yaml'), options.hooks)
    paths.push('hooks.yaml')
  }
  git('add', '--', ...paths)
  git('commit', '--quiet', '-m', 'the project configures a model and no targets')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-scaffold-'))
  configPath = join(root, CONFIG_FILE)
  agentQaRoot = join(root, '.agent-qa')
  confirms = 0

  git('init', '--quiet')
  git('config', 'user.name', 'agent-qa scaffold test')
  git('config', 'user.email', 'scaffold-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  // A project with source and a gitignore of its own — and NO agent-qa configuration. That absence
  // is the whole fixture: CFGM-05's sentence is about the from-zero case.
  writeFileSync(join(root, '.gitignore'), SEEDED_GITIGNORE)
  writeFileSync(join(root, 'README.md'), 'a project that has never run agent-qa\n')
  git('add', '--', '.gitignore', 'README.md')
  git('commit', '--quiet', '-m', 'seed')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the pinned config set answers for a project that has no config file (D-02/D-05)', () => {
  it('(1) enumerates three members, and the apply commits exactly those it touches', async () => {
    // THE SHIPPED ENUMERATION, ASKED DIRECTLY. A project with no config file names no hooks file
    // either, so the answer comes from the default — which is the enumeration's own business and
    // not this test's. Read back rather than typed, so a member added later reds here first.
    expect(enumerateConfigFileSet({ configFile: CONFIG_FILE }))
      .toEqual(['.gitignore', CONFIG_FILE, 'hooks.yaml'])

    const registry = registryFor({ confirm: true })
    const id = proposedId(await scaffold(registry, 'booking.com'))
    const payload = storedApplyable(id)

    // The proposal's own file set IS the enumeration. A scaffold that wrote a fourth file would be
    // flagged `out-of-set-path` and refused by an apply that cannot scope to it.
    expect([...payload.files.map((file) => file.path)].sort())
      .toEqual([...enumerateConfigFileSet({ configFile: CONFIG_FILE })])

    const before = commitCount()
    const accepted = await invokeFunction(
      registry, 'proposals.accept', { proposalId: id }, HUMAN,
    ) as ProposalsAcceptOutput
    expect(accepted.apply.outcome).toBe('applied')

    // ONE commit — the tree is clean apart from files the proposal creates, so there is nothing
    // for D-05's human-first preserve commit to hold. Its pathspec agrees with the enumeration.
    expect(commitCount()).toBe(before + 1)
    expect(headFiles()).toEqual(['.gitignore', CONFIG_FILE, 'hooks.yaml'])
  })
})

describe('the derivation is byte-pinned through the real producer (D-13/D-16)', () => {
  for (const row of [
    { domain: 'booking.com', targetName: 'booking-com', golden: 'scaffold-booking-com.diff' },
    {
      domain: 'shop.example.co.uk',
      targetName: 'shop-example-co-uk',
      golden: 'scaffold-shop-example-co-uk.diff',
    },
  ]) {
    it(`(2/3) ${row.domain} → exactly the committed golden bytes`, async () => {
      const registry = registryFor({ confirm: true })
      const answer = await scaffold(registry, row.domain)
      const id = proposedId(answer)
      const payload = storedApplyable(id)

      // (4) APPLYABLE, from the record on disk. `storedApplyable` throws with the blocked record's
      // own summary line otherwise, so a scaffold whose derived config the shipped schema refuses
      // fails here naming the reason rather than failing somewhere downstream.
      expect(payload.payloadKind).toBe('applyable')

      // THE GOLDEN. Every byte of the rendered diff — the config yaml, the hooks file and the
      // gitignore upsert — compared against a file produced by this same op and reviewed.
      golden(row.golden, utf8Decode(base64Decode(payload.shownDiffBase64)))

      // And the derived facts are IN those bytes, stated separately so a golden somebody
      // regenerated without reading still has to carry the derivation.
      const shown = utf8Decode(base64Decode(payload.shownDiffBase64))
      expect(shown).toContain(`url: https://${row.domain}`)
      expect(shown).toContain(`    ${row.targetName}:`)
      // NO AUTH BINDING ON THE TARGET, and no auth plugin declaration. The utterance carried a
      // domain and nothing else, and D-13 says the derivation adds nothing it was not given. Stated
      // over the PARSED target entry rather than over the diff text, because the scaffolded config
      // legitimately carries `services.authState.dir` — a directory setting, not a credential
      // binding — and an absence assertion over the whole text would have been wrong about which
      // fact it was making. The presence half is the keyset itself: exactly `platform` and `url`.
      const derived = parseYaml(
        utf8Decode(base64Decode(
          payload.files.find((file) => file.path === CONFIG_FILE)?.newContentBase64 as string,
        )),
      ) as { registry?: { targets?: Record<string, Record<string, unknown>> }; plugins?: unknown }
      expect(Object.keys(derived.registry?.targets?.[row.targetName] ?? {}).sort())
        .toEqual(['platform', 'url'])
      expect(derived.plugins).toBeUndefined()
      expect(payload.summaryLine)
        .toBe(`configure this project for https://${row.domain} as target ${row.targetName}`)

      // ALWAYS CROSS-BOUNDARY (D-14/D-02) — computed, and therefore never satisfiable by a standing
      // grant from either side after 395-07.
      expect(payload.crossBoundary).toBe(true)
      expect(payload.crossBoundaryReasons).toContain('new-origin')
    })
  }

  it('(4) the derived config parses through the SHIPPED AgentQaConfigSchema', async () => {
    // The half `payloadKind: applyable` alone would not give: this reads the bytes the apply is
    // about to write and parses them with `core`'s own schema. A pipeline that stopped validating
    // would still answer `applyable`, and this cell is what notices.
    const registry = registryFor({ confirm: true })
    const id = proposedId(await scaffold(registry, 'booking.com'))
    const payload = storedApplyable(id)
    const config = payload.files.find((file) => file.path === CONFIG_FILE)
    expect(config).toBeDefined()

    const parsed = AgentQaConfigSchema.safeParse(
      parseYaml(utf8Decode(base64Decode(config?.newContentBase64 as string))),
    )
    expect(parsed.success ? null : JSON.stringify(parsed.error?.issues)).toBeNull()
  })
})

describe('the accepted scaffold commits exactly the bytes it showed (CFGM-03/CFGM-04 · D-14)', () => {
  it('(5/6/7) confirms, commits, and APPENDS the managed block to the project\'s own gitignore',
    async () => {
      const registry = registryFor({ confirm: true })
      const id = proposedId(await scaffold(registry, 'booking.com'))
      const payload = storedApplyable(id)

      const accepted = await invokeFunction(
        registry, 'proposals.accept', { proposalId: id }, HUMAN,
      ) as ProposalsAcceptOutput
      expect(accepted.apply.outcome).toBe('applied')

      // (7) THE CONFIRM WAS REACHED. Asserted as a call count on a spy, because a turn that never
      // reached a confirm also completes — which is the failure mode a "the accept succeeded"
      // assertion cannot see.
      expect(confirms).toBeGreaterThan(0)

      // (5) The bytes on disk are the payload's bytes, decoded from the record READ BACK OFF DISK
      // rather than from anything this test built.
      for (const file of payload.files) {
        expect(readFileSync(join(root, file.path), 'utf8'))
          .toBe(utf8Decode(base64Decode(file.newContentBase64)))
      }

      // (6) THE UPSERT. The project's own rules survive and the managed block is appended — the
      // half a "the block is present" assertion would miss entirely.
      const gitignore = readFileSync(join(root, '.gitignore'), 'utf8')
      expect(gitignore.startsWith(SEEDED_GITIGNORE)).toBe(true)
      expect(gitignore).toContain('# agent-qa init:start')
      expect(gitignore).toContain('# agent-qa init:end')

      // And the config really is a working configuration for the site that was named.
      const written = parseYaml(readFileSync(configPath, 'utf8')) as {
        registry?: { targets?: Record<string, { url?: string }> }
      }
      expect(written.registry?.targets?.['booking-com']?.url).toBe('https://booking.com')
    })

  it('(8) fails closed with no confirm bound, and commits nothing', async () => {
    const registry = registryFor()
    const id = proposedId(await scaffold(registry, 'booking.com'))

    const before = commitCount()
    // THE V48 POSTURE: with no confirm bound the gate DENIES by name rather than answering. The
    // refusal names the tier it was denied at, so a build that silently proceeded would fail here
    // on the absence of a throw rather than on a message.
    await expect(invokeFunction(registry, 'proposals.accept', { proposalId: id }, HUMAN))
      .rejects.toThrow(/prompted-denied|fail-closed/)

    expect(commitCount()).toBe(before)
    expect(existsSync(configPath)).toBe(false)
  })
})

describe('undoing a scaffold is WINDOWS 128\'s case, measured (D-07 · 395-06)', () => {
  it('(11) refuses `undo-needs-delete` — the scaffold is the delete gap the undo names', async () => {
    // 395-06 filed `undo-needs-delete` naming 395-08 as its owner, on the reasoning that this plan
    // "meets the whole-new-file case from the other direction". It does — from the CREATE side —
    // and this cell is what turns that entry from a hypothetical into a measured one: a scaffold
    // applies, its commit carries the D-06 trailer, so it IS the next undo's source, and reversing
    // it would DELETE two files this write path can only propose CONTENT for.
    const registry = registryFor({ confirm: true })
    const id = proposedId(await scaffold(registry, 'booking.com'))
    const accepted = await invokeFunction(
      registry, 'proposals.accept', { proposalId: id }, HUMAN,
    ) as ProposalsAcceptOutput
    expect(accepted.apply.outcome).toBe('applied')

    const before = commitCount()
    const undone = await invokeFunction(
      registry, 'config.undo.propose', {}, HUMAN,
    ) as ConfigProposeOutput

    expect(undone).toMatchObject({ outcome: 'refused', reason: 'undo-needs-delete' })
    // It names both created files, and it commits and files nothing — refused WHOLE rather than
    // applied by halves, which is the property 395-06 wrote the refusal for.
    expect(undone.outcome === 'refused' && undone.detail).toContain(CONFIG_FILE)
    expect(undone.outcome === 'refused' && undone.detail).toContain('hooks.yaml')
    expect(commitCount()).toBe(before)
  })
})

describe('a project that already has a configuration is refused, not overwritten (D-15)', () => {
  it('(9) refuses `already-configured` for a config that DECLARES targets, and writes nothing',
    async () => {
      // A DESIGNED FIXTURE BREAK (395-12). This fixture used to be `workspace:\n  hooksFile: …` —
      // a config file that declares NO targets — so it measured "a config file exists" and would
      // now propose a merge. The predicate it is here to pin is the narrowed one: a configuration
      // this scaffold would OVERWRITE, which is a declared target registry. The refusal must still
      // stand where it should, and this is the two-sided half of cell (13) rather than a separate
      // claim: the same op, the same fixture family, the opposite verdict.
      writeFileSync(
        configPath,
        'workspace:\n  hooksFile: hooks.yaml\n'
        + 'registry:\n  targets:\n    shop:\n      platform: web\n      url: https://shop.test\n',
      )
      const before = readFileSync(configPath, 'utf8')

      const answer = await scaffold(registryFor({ confirm: true }), 'booking.com')
      expect(answer).toMatchObject({ outcome: 'refused', reason: 'already-configured' })
      // It names the targets it will not replace, so a person reads WHICH configuration is standing
      // in the way rather than merely that one is — and still points at the op that adds a target.
      expect(answer.outcome === 'refused' && answer.detail).toContain('shop')
      expect(answer.outcome === 'refused' && answer.detail).toContain('config.target.create')
      expect(readFileSync(configPath, 'utf8')).toBe(before)
    })

  it('(10) refuses a token that is not a hostname, and proposes nothing', async () => {
    const answer = await scaffold(registryFor({ confirm: true }), 'the checkout flow')
    expect(answer).toMatchObject({ outcome: 'refused', reason: 'not-a-hostname' })
    expect(existsSync(join(agentQaRoot, 'proposals'))).toBe(false)
  })
})

describe('a configuration with ZERO declared targets is MERGED, never replaced (395-12 · SC-5)', () => {
  it('(13) inserts exactly one target entry and preserves every other byte of the person\'s config',
    async () => {
      seedZeroTargetConfig()

      // THE FIXTURE'S OWN ROUND TRIP, asserted before anything else — see ZERO_TARGET_CONFIG's
      // header. This line is what keeps the byte assertion below a statement about the INSERTION
      // rather than about the serializer's spacing.
      expect(String(parseDocument(ZERO_TARGET_CONFIG))).toBe(ZERO_TARGET_CONFIG)

      const registry = registryFor({ confirm: true })
      // RED PRE-FIX: `refused` / `already-configured`, because the predicate was keyed on the config
      // FILE existing. This project declares no target at all — there is nothing to overwrite.
      const id = proposedId(await scaffold(registry, 'booking.com'))
      const payload = storedApplyable(id)

      const configChange = payload.files.find((file) => file.path === CONFIG_FILE)
      expect(configChange?.changeKind).toBe('modify')

      // THE MERGE, MEASURED BY SUBTRACTION. Removing the inserted entry's exact text from the
      // emitted document must leave the committed bytes untouched — the LLM entry, both comment
      // blocks, the blank lines and the key order. A whole-file render fails this by every line it
      // rewrote, which is precisely the overwrite `already-configured` existed to prevent.
      const merged = utf8Decode(base64Decode(configChange?.newContentBase64 as string))
      expect(merged).toContain(INSERTED_TARGET_ENTRY)
      expect(merged.replace(INSERTED_TARGET_ENTRY, '')).toBe(ZERO_TARGET_CONFIG)
      expect(merged).toContain('provider: openai-subscription')
      expect(merged).toContain('# my own agent-qa configuration')

      // The merged candidate is a WORKING configuration, through the shipped schema rather than by
      // inspection — the half that says the insert landed where a target belongs.
      const parsedConfig = AgentQaConfigSchema.safeParse(parseYaml(merged))
      expect(parsedConfig.success ? null : JSON.stringify(parsedConfig.error?.issues)).toBeNull()

      const before = commitCount()
      const accepted = await invokeFunction(
        registry, 'proposals.accept', { proposalId: id }, HUMAN,
      ) as ProposalsAcceptOutput
      expect(accepted.apply.outcome).toBe('applied')
      expect(confirms).toBeGreaterThan(0)

      // ONE commit whose files are exactly the changed members: the config it merged into, the
      // hooks file this project did not have, and the gitignore upsert.
      expect(commitCount()).toBe(before + 1)
      expect(headFiles()).toEqual(['.gitignore', CONFIG_FILE, 'hooks.yaml'])
      expect(readFileSync(configPath, 'utf8')).toBe(merged)
    })

  it('(13b) leaves a hooks file the project ALREADY has out of the candidate entirely', async () => {
    seedZeroTargetConfig({ hooks: SEEDED_HOOKS })

    const registry = registryFor({ confirm: true })
    const id = proposedId(await scaffold(registry, 'booking.com'))
    const payload = storedApplyable(id)

    // NOT A MEMBER OF THE CHANGE SET AT ALL. The scaffold's hooks template is content for a project
    // that has none; proposing it over a file a person wrote would be the widest silent overwrite
    // this op could still make after the narrowing — one file over from the one it stopped making.
    expect(payload.files.map((file) => file.path).sort()).toEqual(['.gitignore', CONFIG_FILE])
    // `addsHook` is STATED (D-02), so it must stop being stated when no hook is added.
    expect(payload.crossBoundaryReasons).not.toContain('hook-added')

    const accepted = await invokeFunction(
      registry, 'proposals.accept', { proposalId: id }, HUMAN,
    ) as ProposalsAcceptOutput
    expect(accepted.apply.outcome).toBe('applied')
    expect(readFileSync(join(root, 'hooks.yaml'), 'utf8')).toBe(SEEDED_HOOKS)
    expect(headFiles()).toEqual(['.gitignore', CONFIG_FILE])
  })
})

describe('the config dir is NOT the repository root (395-11 · CR-03\'s create direction)', () => {
  it('(12) a from-zero scaffold at sub/dir lands its three members THERE, once each, in one commit',
    async () => {
      const configDir = relocateToSubdir()
      const registry = registryFor({ confirm: true })
      const id = proposedId(await scaffold(registry, 'booking.com'))
      const payload = storedApplyable(id)

      // The proposal's own paths are configDir-relative — the vocabulary the pinned set, the apply
      // pathspec and the classifier all speak. A payload that had carried repo-root-relative paths
      // here would be CR-03's defect arriving from the create direction.
      expect([...payload.files.map((file) => file.path)].sort())
        .toEqual([...enumerateConfigFileSet({ configFile: CONFIG_FILE })])

      const before = commitCount()
      const accepted = await invokeFunction(
        registry, 'proposals.accept', { proposalId: id }, HUMAN,
      ) as ProposalsAcceptOutput
      expect(accepted.apply.outcome).toBe('applied')

      // ONE commit, and its file list is git's own — repo-root-relative, so the sub/dir prefix
      // appears EXACTLY ONCE per member. A doubled prefix is what an apply resolving a
      // repo-root-relative path against configDir produces, and it is the damage this cell names.
      expect(commitCount()).toBe(before + 1)
      expect(headFiles()).toEqual([
        'sub/dir/.gitignore', `sub/dir/${CONFIG_FILE}`, 'sub/dir/hooks.yaml',
      ])
      expect(existsSync(join(configDir, 'sub'))).toBe(false)

      // THE BYTES LANDED WHERE THE PAYLOAD SAID, resolved against the CONFIG dir, and the config
      // is a working one where it landed rather than merely present.
      for (const file of payload.files) {
        expect(readFileSync(join(configDir, file.path), 'utf8'))
          .toBe(utf8Decode(base64Decode(file.newContentBase64)))
      }
      const written = parseYaml(readFileSync(configPath, 'utf8')) as {
        registry?: { targets?: Record<string, { url?: string }> }
      }
      expect(AgentQaConfigSchema.safeParse(written).success).toBe(true)
      expect(written.registry?.targets?.['booking-com']?.url).toBe('https://booking.com')

      // The project's own rule in the gitignore BESIDE the config survives the upsert — the half
      // that says the scaffold composed with the right file rather than merely wrote one.
      const gitignore = readFileSync(join(configDir, '.gitignore'), 'utf8')
      expect(gitignore.startsWith(SEEDED_GITIGNORE)).toBe(true)
      expect(gitignore).toContain('# agent-qa init:start')
    })
})
