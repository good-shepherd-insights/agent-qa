// The apply discipline, on real repositories (395-06 · CFGM-03/CFGM-04 · D-05/D-06/D-07/D-18/D-19).
//
// WHAT THIS FILE MEASURES THAT `config-apply.test.ts` DOES NOT. That one proves the tracer: one
// proposal, one clean tree, one commit. This one is about the arrangements where a PERSON is in the
// middle of something — uncommitted work at the file the agent is about to write, an edit that
// landed between the proposal and the accept, two applies racing over one file, an apply that dies
// half way through a two-file write — plus the undo that rides the same gated path.
//
// EVERY CELL DRIVES A REAL TEMP GIT REPOSITORY AND THE PRODUCTION PORTS. `createConfigFilesPort`,
// `createConfigValidatePort`, `createConfigApplyPort` and `createConfigUndoSourcePort` are the same
// factories `composeCliLocalAgent` binds; the proposals store is `knowledge-local`'s real writer
// over a real runtime root; the registry and the gate are the real ones.
//
// WHAT MAKES EACH CELL RED — the acceptance bar is the implementation a cell must FAIL on, never
// the suite it passes. Answered per cell at its own site, and summarised here:
//
//   (1) two commits    — a one-commit apply that swept the human's bytes into the agent's commit,
//                        an apply that made two AGENT commits, or one that put them in the other
//                        order. The cell asserts ORDER and AUTHORSHIP, not a count of 2: a count
//                        passes under an implementation that makes two agent commits.
//   (2) no sweeping    — an apply staging `-A`, `.`, or the pinned config SET rather than the
//                        PROPOSAL's files. The dirty non-proposal files include a member of the
//                        config set, which is the case a set-scoped pathspec would pass this cell
//                        on if the fixture only used a README.
//   (3) outside the set — an apply that preserve-committed a dirty file this product does not own.
//   (4) racing applies — the digest re-check removed. The tree is CLEAN at the second apply, so
//                        nothing else on the path can refuse it.
//   (5) stale refusal  — the D-18 refusal reduced to a message. The cell reads the named recovery
//                        verb back out of the CLI's own command registry and the named action out
//                        of the function registry, so an instruction to run something that does not
//                        exist fails here rather than in somebody's terminal.
//   (6) no mutation    — the preserve commit moved ABOVE the freshness check. That ordering makes
//                        a refused apply commit the person's work on its way to doing nothing, and
//                        this is the only cell that can tell the two orders apart.
//   (7) re-propose     — a construction that did not re-read (CFGM-04). The new `baseDigest` is
//                        compared against a sha256 computed in this test from the file on disk.
//   (8) rollback       — any statement of the write sequence left outside the protected region,
//                        and — the multi-file half — a rollback that stops at the first failure.
//   (9) idempotency    — an `already-applied` answer that dropped the human-first commit from the
//                        receipt it claims is the original one.
//   (10-13) undo       — an undo built from the commit's own applied bytes instead of `current →
//                        parent` (cell 12 reds), an undo that reached a second write path (every
//                        undo cell goes through `proposals.accept`), a missing no-agent-commit
//                        refusal, and an undo-of-undo needing a special case.
//   (15-17) sub/dir    — 395-11 / CR-03. THE SECOND LAYOUT, and the reason it exists is that until
//                        it did, every fixture in this file used ONE temp directory as both the git
//                        root and the config dir, so the two path vocabularies coincided in every
//                        cell and a port that answered in the wrong one could not be seen. Cell 15
//                        reds on the shipped `git show --name-only` without `--relative` (files
//                        carries `sub/dir/agent-qa.config.yaml`, the change renders as an `add`
//                        with no `baseDigest`, and an accept commits a duplicate at a doubled
//                        path); cell 16 reds on an undo source that trusts git's answer instead of
//                        checking it against the pinned set; cell 17 reds on any apply whose
//                        human-first discipline holds only when configDir IS the repository root.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createFunctionRegistry, invokeFunction } from '@vostride/agent-qa-agent'
import type { FunctionDeps } from '@vostride/agent-qa-agent'
import {
  createProposalsInbox,
  mintProposalId,
  writePendingProposalRecord,
} from '@vostride/agent-qa-knowledge-local'
import {
  CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
  CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  base64Decode,
  base64Encode,
  enumerateConfigFileSet,
  renderConfigDiff,
  sha256hexBytes,
  utf8Decode,
  utf8Encode,
} from '@vostride/agent-qa-schema'
import type {
  ConfigProposalApplyableV1,
  ConfigProposeOutput,
  FunctionCaller,
  ProposalRecord,
} from '@vostride/agent-qa-schema'
import { scanConstructedArtifact } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createFnCommand } from '../../commands/fn.js'
import {
  AGENT_CONFIG_COMMIT_AUTHOR,
  AGENT_CONFIG_PROPOSAL_TRAILER_KEY,
  CONFIG_REPROPOSE_CLI_VERB,
  ConfigUndoSourceOutOfSetError,
  HUMAN_FIRST_COMMIT_SUBJECT,
  applyConfigProposalAsOneCommit,
  createConfigApplyPort,
  createConfigFilesPort,
  createConfigUndoSourcePort,
  createConfigValidatePort,
} from '../local-agent-host.js'
import type { GitApplyExec } from '../local-agent-host.js'

const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

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

const SEEDED_GITIGNORE = '.agent-qa/\n'

let root: string
let configPath: string
let agentQaRoot: string

function git(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function commitCount(): number {
  return Number(git('rev-list', '--count', 'HEAD').stdout.trim())
}

/** One commit's subject, author and body, read off the repository — never off a receipt. */
function commitAt(rev: string): { subject: string; author: string; body: string } {
  return {
    subject: git('log', '-1', '--format=%s', rev).stdout.trim(),
    author: git('log', '-1', '--format=%an <%ae>', rev).stdout.trim(),
    body: git('log', '-1', '--format=%B', rev).stdout,
  }
}

function filesIn(rev: string): string[] {
  return git('show', '--stat', '--name-only', '--format=', rev).stdout
    .split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

/** The whole repository's porcelain, so a cell can say what is STILL dirty after an apply. */
function porcelain(): string[] {
  return git('status', '--porcelain').stdout
    .split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

/** The staged index entry for one path, as git's own plumbing spells it. */
function indexEntry(path: string): string {
  return git('ls-files', '--stage', '--', path).stdout.trim()
}

function pendingProposalPath(proposalId: string): string {
  return join(agentQaRoot, 'proposals', `${proposalId}.json`)
}

function storedRecord(proposalId: string): ProposalRecord {
  return JSON.parse(readFileSync(pendingProposalPath(proposalId), 'utf8')) as ProposalRecord
}

function storedApplyablePayload(proposalId: string): ConfigProposalApplyableV1 {
  const record = storedRecord(proposalId)
  if (record.kind !== 'config') throw new Error(`stored ${proposalId} is a ${record.kind} proposal`)
  if (record.payload.payloadKind !== 'applyable') throw new Error('stored payload is not applyable')
  return record.payload
}

/**
 * THE SECOND LAYOUT: the git root and the config directory are different directories (395-11).
 *
 * Every other fixture in this file is `mkdtemp` + `git init` + a config file at its top, so
 * `configDir === <git root>` and the configDir-relative vocabulary every port in this phase speaks
 * is byte-identical to the repo-root-relative vocabulary git answers in. That coincidence is what
 * hid CR-03 for a whole phase. This helper breaks it by MOVING the seeded config under `sub/dir`
 * and committing it there, so the two vocabularies differ by a prefix and any port that confuses
 * them produces a visibly doubled path.
 *
 * IT REUSES `root` AS THE GIT ROOT rather than making a second repository, so `git()`, `commitAt`,
 * `filesIn` and `porcelain` keep answering about the whole repository — which is what lets cell 15
 * assert that no `sub/dir/sub/dir` path exists ANYWHERE, not just where it looked.
 */
function seedSubdirLayout(): void {
  git('rm', '--quiet', '--cached', '--', 'agent-qa.config.yaml')
  rmSync(configPath)

  const configDir = join(root, 'sub', 'dir')
  mkdirSync(configDir, { recursive: true })
  configPath = join(configDir, 'agent-qa.config.yaml')
  // The runtime root travels WITH the config, which is where a real project's does.
  agentQaRoot = join(configDir, '.agent-qa')
  writeFileSync(configPath, SEEDED_CONFIG)
  writeFileSync(join(configDir, '.gitignore'), SEEDED_GITIGNORE)

  git('add', '--', 'sub/dir/agent-qa.config.yaml', 'sub/dir/.gitignore')
  git('commit', '--quiet', '-m', 'seed the configuration in a subdirectory')
}

/** Every tracked path in the repository, so a cell can say a shape exists NOWHERE. */
function trackedPaths(): string[] {
  return git('ls-files').stdout.split('\n').map((line) => line.trim()).filter((l) => l.length > 0)
}

function registryFor(overrides: Partial<FunctionDeps> = {}) {
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
        configPath: 'agent-qa.config.yaml',
        entries: [],
      }),
    },
    proposalsInbox: inbox,
    configFiles: createConfigFilesPort(configPath),
    configValidate: createConfigValidatePort(),
    // The REAL scan with EMPTY seeds, on `config-apply.test.ts`'s stated reasoning: the function is
    // production's, the seeds are not, and a cell whose verdict depends on whether the developer
    // exported a token is a cell that measures the machine.
    configScan: { scan: (parts) => scanConstructedArtifact(parts, {}) },
    configApply: createConfigApplyPort(configPath),
    configUndoSource: createConfigUndoSourcePort(configPath),
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
    // 395-11: the ONE seam a cell may replace, spread last and empty for every cell but the
    // rejected-case one. Every other dependency above stays production's.
    ...overrides,
  }

  return createFunctionRegistry({
    deps,
    auditSink: { appendExecutionAudit() {}, appendGuardrailAudit() {} },
    resolveExecutionContext: () => 'local-interactive',
    confirm: () => true,
  })
}

type Registry = ReturnType<typeof registryFor>

async function call(
  registry: Registry,
  id: string,
  input: unknown,
): Promise<ConfigProposeOutput> {
  return await invokeFunction(registry, id, input, HUMAN) as ConfigProposeOutput
}

function proposedId(answer: ConfigProposeOutput): string {
  if (answer.outcome !== 'proposed') {
    throw new Error(`expected a proposal, got ${answer.outcome}: ${JSON.stringify(answer)}`)
  }
  return answer.proposalId
}

async function accept(registry: Registry, proposalId: string): Promise<unknown> {
  return await invokeFunction(registry, 'proposals.accept', { proposalId }, HUMAN)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-discipline-'))
  configPath = join(root, 'agent-qa.config.yaml')
  agentQaRoot = join(root, '.agent-qa')
  writeFileSync(configPath, SEEDED_CONFIG)
  writeFileSync(join(root, '.gitignore'), SEEDED_GITIGNORE)
  writeFileSync(join(root, 'notes.md'), 'a scratch note\n')

  git('init', '--quiet')
  git('config', 'user.name', 'A Person')
  git('config', 'user.email', 'a-person@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  git('add', '--', '.gitignore', 'notes.md', 'agent-qa.config.yaml')
  git('commit', '--quiet', '-m', 'seed')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('D-05: the human commits first, and the agent commits only what was approved', () => {
  it('(1) a dirty proposal file produces TWO commits — human first, and only the second is the agent\'s', async () => {
    // THE HUMAN IS MID-EDIT WHEN THE PROPOSAL IS MADE. Their bytes are uncommitted, so the proposal
    // reads them and the digest re-check at apply will find exactly them — which is what makes this
    // the SUCCEEDING two-commit path rather than the stale one.
    const humanEdit = SEEDED_CONFIG.replace('test: 90m', 'test: 45m')
    writeFileSync(configPath, humanEdit)

    const registry = registryFor()
    const id = proposedId(await call(registry, 'config.field.set', {
      path: 'use.timeout.step', value: '45s',
    }))
    const before = commitCount()

    await accept(registry, id)

    // TWO commits, and the assertion is about ORDER and AUTHORSHIP rather than about the number.
    // A count of 2 passes just as happily under an implementation that made two AGENT commits, or
    // one that made them in the other order — which is why neither of those is what is asserted.
    expect(commitCount()).toBe(before + 2)

    const agent = commitAt('HEAD')
    const human = commitAt('HEAD~1')

    expect(human.subject).toBe(HUMAN_FIRST_COMMIT_SUBJECT)
    expect(human.author).toBe('A Person <a-person@example.invalid>')
    // NO AGENT ATTRIBUTION AND NO TRAILER on the human's commit. Both absences are integrity
    // claims, and both have a paired presence one line below, so neither can be satisfied by a
    // commit message this apply failed to write at all.
    expect(human.body).not.toContain(AGENT_CONFIG_PROPOSAL_TRAILER_KEY)
    expect(human.body).not.toContain('agent-qa (proposed by chat)')

    expect(agent.subject).toBe('config: set use.timeout.step to 45s')
    expect(agent.author).toBe(AGENT_CONFIG_COMMIT_AUTHOR)
    expect(agent.body).toContain(`${AGENT_CONFIG_PROPOSAL_TRAILER_KEY}: ${id}`)

    // THE HUMAN'S COMMIT CARRIES THE HUMAN'S BYTES AND NOTHING ELSE. Read out of the repository,
    // not out of a receipt: at the human-first commit the file is exactly what they typed, with
    // none of the agent's change in it yet.
    expect(git('show', 'HEAD~1:agent-qa.config.yaml').stdout).toBe(humanEdit)
    expect(git('show', 'HEAD:agent-qa.config.yaml').stdout)
      .toBe(humanEdit.replace('step: 30s', 'step: 45s'))
    expect(filesIn('HEAD~1')).toEqual(['agent-qa.config.yaml'])
    expect(filesIn('HEAD')).toEqual(['agent-qa.config.yaml'])
  })

  it('(1b) the receipt names both commits, human first, and they are the commits git holds', async () => {
    writeFileSync(configPath, SEEDED_CONFIG.replace('test: 90m', 'test: 45m'))
    const registry = registryFor()
    const id = proposedId(await call(registry, 'config.field.set', {
      path: 'use.timeout.step', value: '45s',
    }))

    const answer = await accept(registry, id) as {
      apply: { outcome: string; applied?: { kind: string; outcome: { commits: { role: string; hash: string }[] } } }
    }
    const outcome = answer.apply.applied?.outcome
    if (outcome === undefined) throw new Error('expected an applied config outcome')

    expect(outcome.commits.map((commit) => commit.role)).toEqual(['human', 'agent'])
    expect(outcome.commits[0]?.hash).toBe(git('rev-parse', '--short', 'HEAD~1').stdout.trim())
    expect(outcome.commits[1]?.hash).toBe(git('rev-parse', '--short', 'HEAD').stdout.trim())
  })

  it('(2) dirty bytes in files the proposal does not touch stay uncommitted — including a CONFIG-SET member', async () => {
    // THE `.gitignore` IS THE SHARP HALF. It is a member of the pinned config set (the classifier
    // and the porcelain scope both read `enumerateConfigFileSet`), so an apply that scoped its
    // preserve commit to the SET rather than to the PROPOSAL's files would sweep it in — and a
    // fixture that only dirtied a README would pass under that implementation.
    const pinned = enumerateConfigFileSet({ configFile: 'agent-qa.config.yaml', hooksFile: 'hooks.yaml' })
    expect(pinned).toContain('.gitignore')

    writeFileSync(configPath, SEEDED_CONFIG.replace('test: 90m', 'test: 45m'))
    writeFileSync(join(root, '.gitignore'), `${SEEDED_GITIGNORE}scratch/\n`)
    writeFileSync(join(root, 'notes.md'), 'a scratch note, edited\n')

    const registry = registryFor()
    const id = proposedId(await call(registry, 'config.field.set', {
      path: 'use.timeout.step', value: '45s',
    }))
    await accept(registry, id)

    // Neither commit names them...
    expect(filesIn('HEAD')).toEqual(['agent-qa.config.yaml'])
    expect(filesIn('HEAD~1')).toEqual(['agent-qa.config.yaml'])
    // ...and both are STILL DIRTY, which is the fact a commit listing cannot show on its own.
    expect(porcelain().sort()).toEqual(['M .gitignore', 'M notes.md'])
  })

  it('(3) a dirty proposal file OUTSIDE the pinned config set is refused, never preserved', async () => {
    // Produced, not literal: the payload comes out of the shipped diff primitive over real bytes.
    // No registered op can address a path outside the set, so this drives the apply directly — the
    // arrangement a doctored payload really produces.
    const scratch = join(root, 'notes.md')
    const before = readFileSync(scratch)
    const after = utf8Encode('a scratch note the agent wants to rewrite\n')
    writeFileSync(scratch, 'a scratch note the HUMAN is editing\n')
    const dirtyBytes = readFileSync(scratch)

    const rendered = renderConfigDiff([
      { path: 'notes.md', oldBytes: Uint8Array.from(dirtyBytes), newBytes: after },
    ])
    if (rendered.outcome !== 'changed') throw new Error('fixture produced no diff')

    expect(() => applyConfigProposalAsOneCommit({
      configPath,
      pinnedFileSet: enumerateConfigFileSet({ configFile: 'agent-qa.config.yaml', hooksFile: 'hooks.yaml' }),
      request: {
        proposalId: 'p_outside',
        payload: {
          schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
          payloadKind: 'applyable',
          action: 'config.field.set',
          summaryLine: 'rewrite a scratch note',
          files: [{
            path: 'notes.md',
            changeKind: 'modify',
            baseDigest: sha256hexBytes(Uint8Array.from(dirtyBytes)),
            newContentBase64: base64Encode(after),
          }],
          shownDiffBase64: base64Encode(rendered.diffBytes),
          shownDiffDigest: rendered.diffDigest,
          crossBoundary: true,
          crossBoundaryReasons: ['out-of-set-path'],
        },
      },
    })).toThrowError(/ConfigApplyDirtyOutsideSetError|not a member of this project's configuration/)

    // The human's in-progress bytes are untouched and still uncommitted.
    expect(readFileSync(scratch, 'utf8')).toBe('a scratch note the HUMAN is editing\n')
    expect(readFileSync(scratch)).not.toEqual(before)
    expect(commitCount()).toBe(1)
  })
})

describe('CFGM-04: a concurrent human edit always beats the agent (D-18)', () => {
  it('(4) two applies racing over one file: the second refuses at the digest re-check', async () => {
    const registry = registryFor()
    // BOTH PROPOSALS ARE MINTED AGAINST THE SAME PRE-STATE, which is what makes them a race rather
    // than a sequence: B's `baseDigest` describes bytes A is about to replace.
    const a = proposedId(await call(registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' }))
    const b = proposedId(await call(registry, 'config.field.set', { path: 'use.timeout.test', value: '10m' }))
    expect(storedApplyablePayload(a).files[0]?.baseDigest)
      .toBe(storedApplyablePayload(b).files[0]?.baseDigest)

    await accept(registry, a)
    const afterA = commitCount()
    // THE TREE IS CLEAN, so nothing but the digest re-check can refuse B.
    expect(porcelain()).toEqual([])

    await expect(accept(registry, b)).rejects.toMatchObject({ name: 'ConfigApplyStaleError' })

    expect(commitCount()).toBe(afterA)
    expect(porcelain()).toEqual([])
    // A's change is intact — the refusal wrote nothing over it.
    expect(readFileSync(configPath, 'utf8')).toContain('step: 45s')
    expect(readFileSync(configPath, 'utf8')).toContain('test: 90m')
  })

  it('(5) the stale refusal names the file, the fact, and a recovery command that EXISTS', async () => {
    const registry = registryFor()
    const id = proposedId(await call(registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' }))

    const humanEdit = SEEDED_CONFIG.replace('test: 90m', 'test: 20m')
    writeFileSync(configPath, humanEdit)
    git('commit', '--quiet', '-m', 'human shortens the test timeout', '--', 'agent-qa.config.yaml')

    const refusal = await accept(registry, id).then(
      () => { throw new Error('expected a refusal') },
      (error: Error) => error,
    )
    expect(refusal.name).toBe('ConfigApplyStaleError')

    // NAMES THE FILE, and states the out-of-band edit as a fact rather than as a suspicion.
    expect(refusal.message).toContain('"agent-qa.config.yaml"')
    expect(refusal.message).toContain('out of band')

    // RENDERS NOTHING STALE. The diff the proposal stored describes a file that no longer exists in
    // that form, and the refusal must not repeat it. What is asserted absent is the diff's CONTENT
    // — every added and removed line, with its prefix stripped — rather than the whole rendered
    // text: the `--- a/<path>` header carries the file name, which the refusal names deliberately
    // and correctly, so asserting the header absent would be asserting the wrong thing.
    //
    // NOT VACUOUS: the content lines are asserted to EXIST first, so an absence over an empty list
    // cannot pass, and the file name is asserted PRESENT above, so a refusal that printed nothing
    // at all fails on the other side.
    const shown = utf8Decode(base64Decode(storedApplyablePayload(id).shownDiffBase64))
    const contentLines = shown.split('\n')
      .filter((line) => /^[+-]/.test(line) && !line.startsWith('---') && !line.startsWith('+++'))
      .map((line) => line.slice(1).trim())
      .filter((line) => line.length > 0)
    expect(contentLines.length).toBeGreaterThanOrEqual(2)
    for (const line of contentLines) expect(refusal.message).not.toContain(line)

    // NAMES ONE RECOVERY, AND THE RECOVERY EXISTS. Both halves are read back out of the shipped
    // registries rather than trusted: the CLI verb out of the command this CLI actually builds,
    // and the action out of the function registry. A refusal telling somebody to run a command the
    // product does not have fails here instead of in their terminal.
    expect(createFnCommand().name()).toBe(CONFIG_REPROPOSE_CLI_VERB)
    expect(refusal.message).toContain(`agent-qa ${CONFIG_REPROPOSE_CLI_VERB} config.field.set`)
    expect(registryFor().list(HUMAN).map((entry) => entry.id)).toContain('config.field.set')

    // STATELESS: nothing was minted, nothing was rebased, and the store is where it was.
    expect(storedRecord(id).kind).toBe('config')
    expect(readFileSync(configPath, 'utf8')).toBe(humanEdit)
  })

  it('(6) a refusal on a DIRTY file mutates nothing — the preserve commit is below the freshness check', async () => {
    // THE ONE CELL THAT TELLS THE TWO ORDERS APART. With the preserve commit above the digest
    // re-check, this apply refuses AND leaves a commit behind — "your apply was refused, and it
    // committed your work". Here the person's bytes must still be sitting uncommitted afterwards.
    const registry = registryFor()
    const id = proposedId(await call(registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' }))

    const humanEdit = SEEDED_CONFIG.replace('test: 90m', 'test: 20m')
    writeFileSync(configPath, humanEdit)
    const before = commitCount()
    const indexBefore = indexEntry('agent-qa.config.yaml')
    expect(porcelain()).toEqual(['M agent-qa.config.yaml'])

    await expect(accept(registry, id)).rejects.toMatchObject({ name: 'ConfigApplyStaleError' })

    // NO COMMIT, and the person's work is still theirs to do what they like with: unstaged,
    // uncommitted, and byte-identical to what they typed. The INDEX assertion is the third of the
    // three, and it catches the arrangement the other two cannot see — a preserve step that staged
    // their file and then threw would leave the porcelain reading `M ` in the other column while
    // the commit count stayed put.
    expect(commitCount()).toBe(before)
    expect(porcelain()).toEqual(['M agent-qa.config.yaml'])
    expect(readFileSync(configPath, 'utf8')).toBe(humanEdit)
    expect(indexEntry('agent-qa.config.yaml')).toBe(indexBefore)
  })

  it('(7) re-proposing after a stale refusal reads the human\'s bytes — the new digest is over THEM', async () => {
    const registry = registryFor()
    const stale = proposedId(await call(registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' }))

    const humanEdit = SEEDED_CONFIG.replace('test: 90m', 'test: 20m')
    writeFileSync(configPath, humanEdit)
    git('commit', '--quiet', '-m', 'human shortens the test timeout', '--', 'agent-qa.config.yaml')
    await expect(accept(registry, stale)).rejects.toMatchObject({ name: 'ConfigApplyStaleError' })

    // THE NAMED RECOVERY, PERFORMED BY THE PERSON — never by the refusal (D-18).
    const fresh = await call(registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' })
    const id = proposedId(fresh)

    // COMPUTED IN THIS TEST FROM THE FILE ON DISK, not read back out of the record the pipeline
    // also produced. A construction that skipped the re-read would carry the pre-edit digest here.
    expect(storedApplyablePayload(id).files[0]?.baseDigest)
      .toBe(sha256hexBytes(Uint8Array.from(readFileSync(configPath))))

    // AND THE HUMAN'S LINE IS IN THE DIFF a person is asked to approve.
    if (fresh.outcome !== 'proposed') throw new Error('unreachable')
    expect(fresh.shownDiff).toContain('test: 20m')

    // The fresh proposal applies cleanly, over the human's committed state.
    await accept(registry, id)
    expect(readFileSync(configPath, 'utf8')).toBe(humanEdit.replace('step: 30s', 'step: 45s'))
  })
})

describe('the multi-file rollback: an interrupted apply leaves no partial config and no commit', () => {
  it('(8) a write that fails on the SECOND file restores both worktree bytes and both index entries', async () => {
    // TWO FILES, PRODUCED THROUGH THE SHIPPED PRIMITIVE. No registered op writes two members yet,
    // so the payload is built from `renderConfigDiff` over real bytes rather than hand-typed — the
    // digests, the change kinds and the diff bytes are all the primitive's own answers.
    const gitignorePath = join(root, '.gitignore')
    const configBefore = Uint8Array.from(readFileSync(configPath))
    const ignoreBefore = Uint8Array.from(readFileSync(gitignorePath))
    const configAfter = utf8Encode(SEEDED_CONFIG.replace('step: 30s', 'step: 45s'))
    const ignoreAfter = utf8Encode(`${SEEDED_GITIGNORE}node_modules/\n`)

    const rendered = renderConfigDiff([
      { path: '.gitignore', oldBytes: ignoreBefore, newBytes: ignoreAfter },
      { path: 'agent-qa.config.yaml', oldBytes: configBefore, newBytes: configAfter },
    ])
    if (rendered.outcome !== 'changed') throw new Error('fixture produced no diff')
    const digestFor = (path: string): string => {
      const found = rendered.perFileDigests.find((entry) => entry.path === path)?.oldDigest
      if (found === undefined) throw new Error(`no old digest for ${path}`)
      return found
    }

    const indexBefore = {
      config: indexEntry('agent-qa.config.yaml'),
      ignore: indexEntry('.gitignore'),
    }
    const commitsBefore = commitCount()

    // THE SEAM FAILS ON THE SECOND FILE, after the first has been written AND staged — which is
    // exactly the state a rollback that stopped at the first failure, or one whose write sat
    // outside the protected region, would leave behind.
    let writes = 0
    expect(() => applyConfigProposalAsOneCommit({
      configPath,
      pinnedFileSet: enumerateConfigFileSet({ configFile: 'agent-qa.config.yaml', hooksFile: 'hooks.yaml' }),
      writeTarget: (absolutePath, bytes) => {
        writes += 1
        if (writes === 2) throw new Error('the disk went away half way through')
        writeFileSync(absolutePath, bytes)
      },
      request: {
        proposalId: 'p_rollback',
        payload: {
          schemaVersion: CURRENT_CONFIG_PROPOSAL_SCHEMA_VERSION,
          payloadKind: 'applyable',
          action: 'config.field.set',
          summaryLine: 'two files at once',
          files: [
            {
              path: '.gitignore',
              changeKind: 'modify',
              baseDigest: digestFor('.gitignore'),
              newContentBase64: base64Encode(ignoreAfter),
            },
            {
              path: 'agent-qa.config.yaml',
              changeKind: 'modify',
              baseDigest: digestFor('agent-qa.config.yaml'),
              newContentBase64: base64Encode(configAfter),
            },
          ],
          shownDiffBase64: base64Encode(rendered.diffBytes),
          shownDiffDigest: rendered.diffDigest,
          crossBoundary: false,
          crossBoundaryReasons: [],
        },
      },
    })).toThrowError(/the disk went away/)

    // THE SEAM SAW FOUR CALLS: two applies (the second of which threw) and two RESTORES. The
    // restores going through the same writer is 394's WR-04 in this file's own arrangement — a
    // rollback that wrote text where the apply wrote bytes would put U+FFFD through every sequence
    // the decoder could not read — and counting them here is what proves the restore ran at all
    // rather than being inferred from the bytes happening to look right.
    expect(writes).toBe(4)

    // BOTH FILES' WORKTREE BYTES ARE BACK — including the FIRST one, which had already been
    // written and staged when the failure hit.
    expect(Uint8Array.from(readFileSync(gitignorePath))).toEqual(ignoreBefore)
    expect(Uint8Array.from(readFileSync(configPath))).toEqual(configBefore)
    // BOTH INDEX ENTRIES ARE BACK. This is the half that stops the agent's blob from folding into
    // the person's next commit, and it is the half 394 shipped without for a round.
    expect(indexEntry('.gitignore')).toBe(indexBefore.ignore)
    expect(indexEntry('agent-qa.config.yaml')).toBe(indexBefore.config)
    // AND NO COMMIT.
    expect(commitCount()).toBe(commitsBefore)
    expect(porcelain()).toEqual([])
  })
})

describe('CFGM-03 idempotency: the retry gets the ORIGINAL receipt, both commits of it', () => {
  it('(9) a second apply of a two-commit proposal answers already-applied naming human AND agent', async () => {
    writeFileSync(configPath, SEEDED_CONFIG.replace('test: 90m', 'test: 45m'))
    const registry = registryFor()
    const id = proposedId(await call(registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' }))
    await accept(registry, id)

    const humanHash = git('rev-parse', '--short', 'HEAD~1').stdout.trim()
    const agentHash = git('rev-parse', '--short', 'HEAD').stdout.trim()
    const afterFirst = commitCount()

    const retry = await invokeFunction(
      registry, 'config.proposal.apply', { proposalId: id }, HUMAN,
    ) as { outcome: string; commits: { role: string; hash: string }[]; files: string[] }

    expect(retry.outcome).toBe('already-applied')
    expect(retry.commits).toEqual([
      { role: 'human', hash: humanHash },
      { role: 'agent', hash: agentHash },
    ])
    expect(commitCount()).toBe(afterFirst)
    expect(porcelain()).toEqual([])
  })

  it('(9b) a ONE-commit apply\'s retry names only the agent commit — the parent is not swept in', async () => {
    // The negative half of the cell above. `seed` is the agent commit's parent here and its subject
    // is not the preserve subject, so a receipt that named it would be claiming somebody else's
    // commit as part of this apply.
    const registry = registryFor()
    const id = proposedId(await call(registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' }))
    await accept(registry, id)
    const agentHash = git('rev-parse', '--short', 'HEAD').stdout.trim()

    const retry = await invokeFunction(
      registry, 'config.proposal.apply', { proposalId: id }, HUMAN,
    ) as { outcome: string; commits: { role: string; hash: string }[] }

    expect(retry.outcome).toBe('already-applied')
    expect(retry.commits).toEqual([{ role: 'agent', hash: agentHash }])
  })
})

describe('D-07: undo is a proposal, and it rides the one gated write path', () => {
  it('(10) with no agent config commit in history, the undo refuses by name and files nothing', async () => {
    const registry = registryFor()
    const answer = await call(registry, 'config.undo.propose', {})

    expect(answer.outcome).toBe('refused')
    if (answer.outcome !== 'refused') throw new Error('unreachable')
    expect(answer.reason).toBe('no-agent-commit')
    // ANSWERED AND GONE: nothing in the inbox, and no commit.
    expect(await invokeFunction(registry, 'proposals.list', {}, HUMAN))
      .toMatchObject({ entries: [] })
    expect(commitCount()).toBe(1)
  })

  it('(11) undo restores the pre-mutation bytes EXACTLY, as one more trailered agent commit', async () => {
    const registry = registryFor()
    const original = Uint8Array.from(readFileSync(configPath))

    await accept(registry, proposedId(await call(
      registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' },
    )))
    expect(Uint8Array.from(readFileSync(configPath))).not.toEqual(original)

    const undo = await call(registry, 'config.undo.propose', {})
    const undoId = proposedId(undo)
    await accept(registry, undoId)

    // BYTE EQUALITY against the bytes read before anything happened.
    expect(Uint8Array.from(readFileSync(configPath))).toEqual(original)
    // ONE more commit, trailered and agent-authored like any other apply — because it IS one.
    expect(commitCount()).toBe(3)
    expect(commitAt('HEAD').author).toBe(AGENT_CONFIG_COMMIT_AUTHOR)
    expect(commitAt('HEAD').body).toContain(`${AGENT_CONFIG_PROPOSAL_TRAILER_KEY}: ${undoId}`)
    expect(commitAt('HEAD').subject).toContain('revert agent-qa configuration commit')
  })

  it('(12) an intervening human commit SURFACES inside the revert diff instead of colliding', async () => {
    const registry = registryFor()
    await accept(registry, proposedId(await call(
      registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' },
    )))

    // The human edits a DIFFERENT line of the same file, and commits it.
    const current = readFileSync(configPath, 'utf8')
    const withHuman = current.replace('test: 90m', 'test: 20m')
    writeFileSync(configPath, withHuman)
    git('commit', '--quiet', '-m', 'human shortens the test timeout', '--', 'agent-qa.config.yaml')

    const undo = await call(registry, 'config.undo.propose', {})
    if (undo.outcome !== 'proposed') throw new Error(`expected a proposal, got ${undo.outcome}`)

    // THE DIFF IS CURRENT -> PARENT, AND THIS IS WHAT "SURFACES INSTEAD OF COLLIDING" MEANS. A
    // revert to the parent state takes back the human's line TOO — that is what reverting a commit
    // does — and the whole of D-07's concurrency claim is that the person SEES it happening, as a
    // removal in the diff they are being asked to approve, and can say no. The alternative designs
    // are the two this refuses: a three-way merge that silently keeps their line (and therefore
    // does not revert the commit it says it reverts), or a blind apply of the agent commit's own
    // recorded bytes, which would not mention their edit at all.
    //
    // A DIFF BUILT FROM THE AGENT COMMIT'S APPLIED BYTES CONTAINS NO `test: 20m` LINE, so that
    // implementation reds here — which is what makes `current` rather than `commit` the measured
    // left-hand side rather than a claimed one.
    expect(undo.shownDiff).toContain('-    test: 20m')
    expect(undo.shownDiff).toContain('+    test: 90m')
    expect(undo.shownDiff).toContain('-    step: 45s')
    expect(undo.shownDiff).toContain('+    step: 30s')

    // And applying it lands on exactly the parent state — the bytes the repository held before the
    // agent commit — with nothing invented in between.
    await accept(registry, proposedId(undo))
    expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG)
  })

  it('(13) undo-of-undo needs no special case — the undo\'s own commit is the next undo\'s source', async () => {
    const registry = registryFor()
    const original = readFileSync(configPath, 'utf8')

    await accept(registry, proposedId(await call(
      registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' },
    )))
    const mutated = readFileSync(configPath, 'utf8')

    await accept(registry, proposedId(await call(registry, 'config.undo.propose', {})))
    expect(readFileSync(configPath, 'utf8')).toBe(original)

    // The second undo locates the FIRST undo's apply commit, because that commit carries the same
    // trailer every agent config commit does. Nothing here knows what an undo is.
    await accept(registry, proposedId(await call(registry, 'config.undo.propose', {})))
    expect(readFileSync(configPath, 'utf8')).toBe(mutated)

    expect(commitCount()).toBe(4)
    for (const rev of ['HEAD', 'HEAD~1', 'HEAD~2']) {
      expect(commitAt(rev).body).toContain(`${AGENT_CONFIG_PROPOSAL_TRAILER_KEY}: `)
      expect(commitAt(rev).author).toBe(AGENT_CONFIG_COMMIT_AUTHOR)
    }
  })

  it('(14) there is no revert VERB — the registry publishes a propose op and nothing else (L10)', async () => {
    // The checkable half of "one write path". A person or a catalogue consumer reading the registry
    // sees `config.undo.propose` and `config.proposal.apply`; if a direct-revert op is ever added,
    // this cell is where it shows up.
    const ids = registryFor().list(HUMAN).map((entry) => entry.id).filter((id) => id.startsWith('config.'))
    expect(ids).toContain('config.undo.propose')
    expect(ids.filter((id) => id.endsWith('.apply'))).toEqual(['config.proposal.apply'])
    expect(ids.filter((id) => id.includes('revert'))).toEqual([])
    expect(ids.filter((id) => id === 'config.undo' || id === 'config.undo.apply')).toEqual([])
  })
})

describe('the config dir is NOT the repository root (395-11 · CR-03)', () => {
  it('(15) an undo at sub/dir names the configDir-relative member, modifies it, and restores its bytes', async () => {
    seedSubdirLayout()
    const registry = registryFor()
    const original = Uint8Array.from(readFileSync(configPath))

    await accept(registry, proposedId(await call(
      registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' },
    )))
    const mutated = Uint8Array.from(readFileSync(configPath))
    expect(mutated).not.toEqual(original)

    const undo = await call(registry, 'config.undo.propose', {})
    const undoId = proposedId(undo)
    const payload = storedApplyablePayload(undoId)

    // PRESENCE INTEGRITY BEFORE ABSENCE. `not.toContain` on a field that does not exist, and an
    // equality against a list nobody populated, both pass under an undo that proposed nothing —
    // so the two facts that make the assertions below mean something are asserted first.
    expect(payload.files.length).toBeGreaterThan(0)
    expect(Array.isArray(payload.crossBoundaryReasons)).toBe(true)

    // THE VOCABULARY. This is the CR-03 assertion: git answers in repo-root-relative paths unless
    // told otherwise, and every other participant in this pipeline — the pinned set, the apply's
    // pathspec, the classifier's `pinnedFileSet` — speaks configDir-relative.
    expect(payload.files.map((file) => file.path)).toEqual(['agent-qa.config.yaml'])

    const change = payload.files.find((file) => file.path === 'agent-qa.config.yaml')
    if (change === undefined) throw new Error('unreachable — asserted above')
    // A MODIFY CARRYING A baseDigest, not an ADD. The distinction is D-18's whole freshness
    // semantics: an ABSENT `baseDigest` means "the apply must find no file there", which is
    // vacuously true of a path that does not exist — so an undo rendered as an add slides past
    // the guard that exists to catch exactly a stale write.
    expect(change.changeKind).toBe('modify')
    expect(change.baseDigest).toBe(sha256hexBytes(mutated))

    // The classifier's own verdict on the same question, read independently of the path assertion.
    expect(payload.crossBoundaryReasons).not.toContain('out-of-set-path')

    await accept(registry, undoId)

    // BYTE EQUALITY at the sub/dir layout — the fact an undo that "succeeded" against a phantom
    // path cannot produce, because it never touched the real file.
    expect(Uint8Array.from(readFileSync(configPath))).toEqual(original)
    expect(commitAt('HEAD').author).toBe(AGENT_CONFIG_COMMIT_AUTHOR)
    expect(commitAt('HEAD').body).toContain(`${AGENT_CONFIG_PROPOSAL_TRAILER_KEY}: ${undoId}`)
    expect(commitAt('HEAD').subject).toContain('revert agent-qa configuration commit')

    // AND NOTHING AT A DOUBLED PATH, asked of the filesystem AND of the index. The shipped
    // implementation's accept would `mkdirSync` and commit `sub/dir/sub/dir/agent-qa.config.yaml`,
    // so this is the assertion that names the damage rather than only its cause.
    expect(existsSync(join(root, 'sub', 'dir', 'sub'))).toBe(false)
    expect(trackedPaths().filter((path) => path.includes('sub/dir/sub'))).toEqual([])
  })

  it('(16) a git answer naming a path OUTSIDE the pinned set is refused by name, and nothing is filed', async () => {
    seedSubdirLayout()

    // THE EXEC SEAM, DOUBLED FOR ONE ANSWER AND FAITHFUL FOR THE REST. `rev-parse` and `log` are
    // delegated to the real `spawnSync` against the real repository, so the port reaches its
    // `show` with a real commit and a real trailer it read for itself; only the file listing is
    // replaced. A double that answered all three would be measuring the double.
    //
    // WHY THIS CELL EXISTS AT ALL: the guard it drives is precondition-guarded, and a guard whose
    // only cases are ones it ACCEPTS is drawn from inside its own assumption. Cell 15 is the
    // accepted case. This is the rejected one.
    const stray = 'packages/cli/src/composition/local-agent-host.ts'
    const strayExec: GitApplyExec = (file, args, options) => {
      const real = spawnSync(file, args, options) as unknown as ReturnType<GitApplyExec>
      if (args[0] !== 'show') return real
      return { status: 0, signal: null, stdout: `${stray}\n`, stderr: '' }
    }

    const registry = registryFor({
      configUndoSource: createConfigUndoSourcePort(configPath, strayExec),
    })

    await accept(registry, proposedId(await call(
      registry, 'config.field.set', { path: 'use.timeout.step', value: '45s' },
    )))
    const commitsBefore = commitCount()
    const filedBefore = await invokeFunction(registry, 'proposals.list', {}, HUMAN)

    // REFUSED WHOLE, BY NAME. Not a flag, not a warning on a proposal a person is then asked to
    // decide about — the construction never happens, because a commit path outside the pinned set
    // is either a relativity bug or a file this product does not own, and neither is something to
    // build a write proposal from.
    await expect(call(registry, 'config.undo.propose', {}))
      .rejects.toThrow(ConfigUndoSourceOutOfSetError)
    await expect(call(registry, 'config.undo.propose', {}))
      .rejects.toThrow(new RegExp(stray.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    // The message names the SET too, so a person reading it can see what the answer was checked
    // against rather than only that it failed.
    await expect(call(registry, 'config.undo.propose', {}))
      .rejects.toThrow(/agent-qa\.config\.yaml/)

    // ZERO DELTA on both stores a refusal could have touched.
    expect(await invokeFunction(registry, 'proposals.list', {}, HUMAN)).toEqual(filedBefore)
    expect(commitCount()).toBe(commitsBefore)
    expect(porcelain()).toEqual([])
  })

  it('(17) at sub/dir a dirty config file still produces TWO commits — human first, by author and file list', async () => {
    seedSubdirLayout()

    const humanEdit = SEEDED_CONFIG.replace('test: 90m', 'test: 45m')
    writeFileSync(configPath, humanEdit)

    const registry = registryFor()
    const id = proposedId(await call(registry, 'config.field.set', {
      path: 'use.timeout.step', value: '45s',
    }))
    const before = commitCount()

    await accept(registry, id)
    expect(commitCount()).toBe(before + 2)

    const agent = commitAt('HEAD')
    const human = commitAt('HEAD~1')

    // ORDER, AUTHORSHIP AND PER-COMMIT FILE LISTS — never a count (the A2 lesson: a count of two
    // passes under an apply that made two AGENT commits, or made them in the other order).
    expect(human.subject).toBe(HUMAN_FIRST_COMMIT_SUBJECT)
    expect(human.author).toBe('A Person <a-person@example.invalid>')
    expect(human.body).not.toContain(AGENT_CONFIG_PROPOSAL_TRAILER_KEY)

    expect(agent.subject).toBe('config: set use.timeout.step to 45s')
    expect(agent.author).toBe(AGENT_CONFIG_COMMIT_AUTHOR)
    expect(agent.body).toContain(`${AGENT_CONFIG_PROPOSAL_TRAILER_KEY}: ${id}`)

    // THE FILE LISTS, which is where the layout shows up: git reports them repo-root-relative, so
    // the member appears ONCE at its real place and never at a doubled one. Both commits are
    // asserted, so an apply that got the human's commit right and the agent's wrong reds here.
    expect(filesIn('HEAD~1')).toEqual(['sub/dir/agent-qa.config.yaml'])
    expect(filesIn('HEAD')).toEqual(['sub/dir/agent-qa.config.yaml'])
    expect(trackedPaths().filter((path) => path.includes('sub/dir/sub'))).toEqual([])
  })
})
