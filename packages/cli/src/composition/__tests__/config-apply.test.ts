// The tracer, proven end to end on a real git repository (395-01 · CFGM-01/03/04 · D-01/D-17/D-19).
//
// 2026-09-30, 432-11 D-05/D-07: `config.field.set` WRITES IN THE CALL and files nothing, so cells
// (a)/(a2) now measure the direct write. The accept path (b)-(g) is still shipped for the proposal
// records already on disk until 432-16/17 delete it; those cells start from such a record, written
// by `filePre432ConfigProposal` exactly as the old pipeline wrote it.
//
// ONE UTTERANCE-SHAPED INPUT TRAVELS THE WHOLE PATH: `config.field.set` constructs a proposal from
// bytes it re-read off disk, whole-config validation runs before anything surfaces, the envelope is
// PERSISTED in the real 391 proposals store, `proposals.accept` routes it, and the CLI apply port
// makes exactly one commit in a real repository whose bytes are the bytes the diff showed.
//
// EVERY PORT ON THIS PATH IS THE PRODUCTION ONE. `createConfigFilesPort`, `createConfigValidatePort`
// and `createConfigApplyPort` are the same factories `composeCliLocalAgent` binds; the proposals
// store is `knowledge-local`'s real `writePendingProposalRecord`/`createProposalsInbox` over a real
// runtime root; the registry is the real one and the accept goes through the real gate. The four
// REQUIRED read ports are the only doubles, and they answer emptily because nothing on this path
// reads them.
//
// WHAT MAKES EACH CELL RED, answered per cell rather than claimed for the file — the acceptance bar
// is the implementation a cell must fail on, never the suite it passes:
//
//   (a) construction  — a pipeline that skipped the re-read, skipped validation, or filed a payload
//                       without the diff bytes. It also reds on a payload whose digest is not over
//                       the bytes it stored, because the digest is recomputed here from the file the
//                       repository actually holds rather than read back out of the record.
//   (b) one commit    — a repo-wide `git add`/`git commit -a` (the stat would name more than the
//                       config file), a second commit, a missing author or trailer. The byte-equality
//                       half reds on an apply that wrote anything other than the payload's decoded
//                       `newContentBase64` — proven NON-tautological below by decoding the record
//                       from the STORE rather than from the value the test constructed.
//   (c) idempotency   — an apply that committed again, or one that threw instead of answering with
//                       the original receipt. It reds on removing the trailer lookup.
//   (d) freshness     — removing the `baseDigest` re-check. Measured by mutation, not asserted: the
//                       cell drives an out-of-band edit AND names which guard fired, and the SUMMARY
//                       records the observed RED for the digest check disabled alone.
//   (e) comments      — a mutation that round-tripped the config through plain objects instead of
//                       the yaml Document API. Every comment in the seeded file would be gone.
//   (f) shown==applied — the D-19 byte comparison removed. The payload is doctored to widen the
//                       change AFTER the proposal was filed, and the apply must refuse before any
//                       write.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  CURRENT_PROPOSAL_RECORD_SCHEMA_VERSION,
  FunctionScopeSchema,
  MASKED_RESOLVED_CONFIG_SCHEMA_VERSION,
  base64Decode,
  base64Encode,
  sha256hexBytes,
  utf8Decode,
  utf8Encode,
} from '@vostride/agent-qa-schema'
import type {
  ConfigApplyOutcome,
  ConfigChangeOutput,
  FunctionCaller,
  ProposalRecord,
  ProposalsAcceptOutput,
} from '@vostride/agent-qa-schema'
import { scanConstructedArtifact } from '@vostride/agent-qa-safety'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AGENT_CONFIG_COMMIT_AUTHOR_UNRECORDED,
  AGENT_CONFIG_PROPOSAL_TRAILER_KEY,
  createConfigApplyPort,
  createConfigFilesPort,
  createConfigValidatePort,
  createConfigWritePort,
} from '../local-agent-host.js'
import * as hostModule from '../local-agent-host.js'
import { filePre432ConfigProposal } from './pre-432-config-proposal.js'

const HUMAN: FunctionCaller = {
  surface: 'test',
  grantedScopes: [...FunctionScopeSchema.options],
  safeMode: false,
  origin: 'human',
}

/**
 * The seeded config, in the house style — COMMENT-DENSE ON PURPOSE.
 *
 * The comments are the subject of cell (e) and the reason the mutation goes through the yaml
 * Document API at all: `init.ts` has a whole `addYamlComments` function to put these back after a
 * stringify, so a config a person actually has is one a plain round trip would strip to nothing.
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

let root: string
let configPath: string
let agentQaRoot: string

function git(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    // 395-24 · WR-12 — a `git` that ran and failed must not return quietly; see
    // validate-resolution-surface.test.ts for the full note.
    throw new Error(`git ${args.join(' ')} exited ${result.status}: ${result.stderr}`)
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function commitCount(): number {
  return Number(git('rev-list', '--count', 'HEAD').stdout.trim())
}

function headFiles(): string[] {
  return git('show', '--stat', '--name-only', '--format=', 'HEAD').stdout
    .split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

/** Where the durable store keeps a PENDING proposal — the store's own naming, not a guess. */
function pendingProposalPath(proposalId: string): string {
  return join(agentQaRoot, 'proposals', `${proposalId}.json`)
}

/** The stored record, read back OFF DISK — never the object the test handed the store. */
function storedRecord(proposalId: string): ProposalRecord {
  return JSON.parse(readFileSync(pendingProposalPath(proposalId), 'utf8')) as ProposalRecord
}

function storedConfigPayload(proposalId: string) {
  const record = storedRecord(proposalId)
  if (record.kind !== 'config') throw new Error(`stored ${proposalId} is a ${record.kind} proposal`)
  if (record.payload.payloadKind !== 'applyable') throw new Error('stored payload is not applyable')
  return record.payload
}

/**
 * The registry, with the REAL config ports and the REAL proposals store.
 *
 * Cell (f)'s fault injection is NOT a seam here: it doctors the PERSISTED RECORD on disk, which is
 * the arrangement a tampering threat really produces — a record altered between the render a person
 * read and the commit a port makes. A test-only override would have measured a hook instead.
 */
function registryFor(options: { readonly bindApply?: boolean } = {}) {
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
    // THE REAL THREE, over the real workspace and the real repository.
    configFiles: createConfigFilesPort(configPath),
    configValidate: createConfigValidatePort(),
    // 395-04: the REAL scan, with an EMPTY seed set. The function is production's; the seeds are
    // not, and the difference is deliberate — `composeLocalAgent` seeds from `sensitiveEnvSlice`,
    // which reads the environment this suite happens to run in, and a cell whose verdict depends on
    // whether the developer exported a token is a cell that measures the machine. The pattern half
    // still runs over every artifact below, so a secret-shaped value in any of these fixtures would
    // block here. The SEEDED half is measured where it belongs, in `config-blocked-renders.test.ts`,
    // which sets the variable it depends on.
    configScan: { scan: (parts) => scanConstructedArtifact(parts, {}) },
    ...(options.bindApply === false ? {} : { configApply: createConfigApplyPort(configPath) }),
    // 432-11: the direct writer the config operations publish through.
    configWrite: createConfigWritePort(configPath),
    // The REAL store write, through the same two verbs `composeLocalAgent` binds — so the envelope
    // this path files is one the inbox below really reads back off disk.
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
    // The production door for an accept: `mutating-shared` asks in every context, and this is the
    // arm the CLI host binds. Without it every cell below would pass while measuring nothing.
    resolveExecutionContext: () => 'local-interactive',
  })
}

async function change(
  registry: ReturnType<typeof registryFor>,
  input: { path: string; value: string | number | boolean },
): Promise<ConfigChangeOutput> {
  return await invokeFunction(registry, 'config.field.set', input, HUMAN) as ConfigChangeOutput
}

/** A pre-432 proposal record for the tracer edit, filed as the old pipeline filed it. */
async function pre432Proposal(): Promise<string> {
  return (await filePre432ConfigProposal({
    configPath,
    agentQaRoot,
    edits: [{ path: 'use.timeout.step', value: '45s' }],
  })).proposalId
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-apply-'))
  configPath = join(root, 'agent-qa.config.yaml')
  agentQaRoot = join(root, '.agent-qa')
  writeFileSync(configPath, SEEDED_CONFIG)

  git('init', '--quiet')
  // RESEARCH Pitfall 7: a fresh temp repository has no identity, and `git commit` refuses without
  // one. Signing is disabled for the same reason — a developer machine configured to sign every
  // commit would otherwise make this suite depend on a key.
  git('config', 'user.name', 'agent-qa config apply test')
  git('config', 'user.email', 'config-apply-test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(root, '.gitignore'), '.agent-qa/\n')
  writeFileSync(join(root, 'README.md'), 'seeded\n')
  git('add', '--', '.gitignore', 'README.md', 'agent-qa.config.yaml')
  git('commit', '--quiet', '-m', 'seed')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the config tracer: propose, accept, ONE byte-matched commit', () => {
  it('(a) writes the edit in the call, answering the diff of the bytes it read and filing nothing', async () => {
    const seededDigest = sha256hexBytes(Uint8Array.from(readFileSync(configPath)))
    const answer = await change(registryFor(), { path: 'use.timeout.step', value: '45s' })
    expect(answer.outcome).toBe('applied')
    if (answer.outcome !== 'applied') throw new Error('unreachable')

    expect(answer.summaryLine).toBe('set use.timeout.step to 45s')
    expect(answer.files).toEqual(['agent-qa.config.yaml'])
    expect(answer.fields).toEqual(['use.timeout.step'])

    // The rendered diff really is a diff of this change against the file as it was.
    expect(answer.shownDiff).toContain('--- a/agent-qa.config.yaml')
    expect(answer.shownDiff).toContain('-    step: 30s')
    expect(answer.shownDiff).toContain('+    step: 45s')

    // THE FILE MOVED IN THE CALL, by exactly the edit, off the bytes that were there.
    expect(seededDigest).not.toBe(sha256hexBytes(Uint8Array.from(readFileSync(configPath))))
    expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG.replace('step: 30s', 'step: 45s'))

    // NO RECORD AND NO COMMIT (D-07): a plain edit git shows as modified.
    expect(existsSync(join(agentQaRoot, 'proposals'))).toBe(false)
    expect(commitCount()).toBe(1)
    expect(git('status', '--porcelain', '--', 'agent-qa.config.yaml').stdout.trim())
      .toBe('M agent-qa.config.yaml')
  })

  it('(a2) refuses a mutation that breaks the WHOLE config, before anything surfaces', async () => {
    // CFGM-01: validation runs before any APPLYABLE proposal exists. `use.parallel` is a boolean in
    // the schema, so a string there is a candidate config that does not validate.
    //
    // 432-11: the blocked answer is the report, and nothing is kept — no record, no write. The claim
    // it protects is unchanged: nothing a person could accept or apply was ever produced.
    const answer = await change(registryFor(), { path: 'use.parallel', value: 'yes please' })

    expect(answer.outcome).toBe('blocked')
    if (answer.outcome !== 'blocked') throw new Error('unreachable')
    expect(answer.blockedReason).toBe('schema-fail')
    expect(answer.validationIssues?.length ?? 0).toBeGreaterThan(0)
    expect((answer.validationIssues ?? []).join('\n')).toContain('use.parallel')
    // NO RECORD ON DISK and no content in the answer, which is the structural half of D-10.
    expect(existsSync(join(agentQaRoot, 'proposals'))).toBe(false)
    expect(JSON.stringify(answer)).not.toContain('shownDiff')
    expect(JSON.stringify(answer)).not.toContain('newContentBase64')
    // NOTHING WAS WRITTEN AND NOTHING WAS COMMITTED.
    expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG)
    expect(commitCount()).toBe(1)
  })

  it('(b) accepting adds exactly ONE commit of exactly the config file, byte-matched', async () => {
    const registry = registryFor()
    const id = await pre432Proposal()

    // The bytes the proposal PROMISED, decoded from the record ON DISK. Read before the accept, so
    // the comparison below cannot be the apply's own variable compared against itself — the
    // tautology this cell exists to avoid.
    const promised = base64Decode(storedConfigPayload(id).files[0]!.newContentBase64)

    const answer = await invokeFunction(
      registry, 'proposals.accept', { proposalId: id }, HUMAN,
    ) as ProposalsAcceptOutput

    expect(answer.apply.outcome).toBe('applied')
    expect(answer.apply).toMatchObject({ applied: { kind: 'config' } })

    // ONE commit, of ONE file, and the file is the config.
    expect(commitCount()).toBe(2)
    expect(headFiles()).toEqual(['agent-qa.config.yaml'])

    // BYTE EQUALITY, against bytes that came off the store rather than out of this test.
    expect(Uint8Array.from(readFileSync(configPath))).toEqual(promised)

    // The receipt names the commit that exists.
    const applied = answer.apply.outcome === 'applied' ? answer.apply.applied : undefined
    if (applied?.kind !== 'config' || applied.outcome.outcome !== 'applied') {
      throw new Error('expected an applied config outcome')
    }
    expect(applied.outcome.commits[0]?.hash).toBe(git('rev-parse', '--short', 'HEAD').stdout.trim())
    expect(applied.outcome.files).toEqual(['agent-qa.config.yaml'])

    // Subject, author and the D-06 machine-readable trailer — each read off the real commit.
    expect(git('log', '-1', '--format=%s', 'HEAD').stdout.trim())
      .toBe('config: set use.timeout.step to 45s')
    expect(git('log', '-1', '--format=%an <%ae>', 'HEAD').stdout.trim())
      .toBe(AGENT_CONFIG_COMMIT_AUTHOR_UNRECORDED)
    expect(git('log', '-1', '--format=%B', 'HEAD').stdout)
      .toContain(`${AGENT_CONFIG_PROPOSAL_TRAILER_KEY}: ${id}`)

    // NOTHING ELSE MOVED. A repo-wide add would have swept the untracked runtime root in.
    expect(git('status', '--porcelain').stdout.trim()).toBe('')
  })

  it('(c) accepting the SAME proposal twice answers already-applied and commits nothing more', async () => {
    const registry = registryFor()
    const id = await pre432Proposal()

    const first = await invokeFunction(
      registry, 'proposals.accept', { proposalId: id }, HUMAN,
    ) as ProposalsAcceptOutput
    const firstApplied = first.apply.outcome === 'applied' ? first.apply.applied : undefined
    if (firstApplied?.kind !== 'config') throw new Error('expected a config apply')
    const originalHash = firstApplied.outcome.commits[0]?.hash
    const afterFirst = commitCount()

    // THE SECOND ACCEPT GOES THROUGH THE REGISTERED APPLY VERB, which is the surface a retrying
    // caller actually reaches — a dropped socket, a re-issued MCP call, a key pressed twice.
    // `proposals.accept` cannot serve the retry: the store has already recorded the decision, so
    // the envelope is `applied` and the accept has its own answer for that. The idempotency edge
    // CFGM-03 names belongs to the apply, and this is where it is measured.
    const second = await invokeFunction(
      registry, 'config.proposal.apply', { proposalId: id }, HUMAN,
    ) as ConfigApplyOutcome

    expect(second.outcome).toBe('already-applied')
    // THE ORIGINAL RECEIPT, not a new one and not an absence.
    expect(second.commits[0]?.hash).toBe(originalHash)
    expect(second.files).toEqual(['agent-qa.config.yaml'])
    // git log delta ZERO.
    expect(commitCount()).toBe(afterFirst)
    expect(git('status', '--porcelain').stdout.trim()).toBe('')
  })

  it('(d) an out-of-band edit between propose and accept refuses, writing nothing', async () => {
    const registry = registryFor()
    const id = await pre432Proposal()

    // The human edits the file themselves, and COMMITS it — so the tree is clean and the ONLY
    // thing that can refuse this apply is the digest re-check. A dirty-tree refusal would pass
    // this cell while measuring the wrong guard, which is exactly what committing rules out.
    const humanEdit = SEEDED_CONFIG.replace('step: 30s', 'step: 90s')
    writeFileSync(configPath, humanEdit)
    git('commit', '--quiet', '-m', 'human raises the timeout', '--', 'agent-qa.config.yaml')
    const beforeAccept = commitCount()
    expect(git('status', '--porcelain').stdout.trim()).toBe('')

    // 395-06: the class MOVED from the shared `ApplyTargetChangedError` to the config path's own
    // `ConfigApplyStaleError`, which is D-18's refusal — the same guard, with a recovery sentence
    // that names the proposing action instead of the test-draft authoring loop. The claim this cell
    // protects is unchanged: the digest re-check is what refuses, and it refuses on a CLEAN tree.
    await expect(invokeFunction(registry, 'proposals.accept', { proposalId: id }, HUMAN))
      .rejects.toMatchObject({ name: 'ConfigApplyStaleError' })

    // THE HUMAN'S EDIT IS INTACT, nothing was written, and no commit was made.
    expect(readFileSync(configPath, 'utf8')).toBe(humanEdit)
    expect(commitCount()).toBe(beforeAccept)
    expect(git('status', '--porcelain').stdout.trim()).toBe('')
  })

  it('(e) the comments survive the applied mutation, verbatim and in place', async () => {
    const registry = registryFor()
    const id = await pre432Proposal()
    await invokeFunction(registry, 'proposals.accept', { proposalId: id }, HUMAN)

    const committed = readFileSync(configPath, 'utf8')
    // Every comment the seed carried, still there — a plain-object round trip would have kept none.
    for (const comment of [
      '# agent-qa Configuration',
      '# File discovery and project settings',
      '# Named resource definitions (LLM configs, app targets)',
      '# How runs behave by default.',
      '# Raise this when the app under test is slow to settle.',
    ]) {
      expect(committed).toContain(comment)
    }
    // And the change is the ONE line: the file differs from the seed by exactly the edited value.
    expect(committed).toBe(SEEDED_CONFIG.replace('step: 30s', 'step: 45s'))
  })

  it('(f) a payload widened after the render refuses at the byte comparison, before any write', async () => {
    // D-19's fault-injection differential. The proposal is filed honestly and then DOCTORED — the
    // arrangement a tampering threat really produces (T-395-01): the record a person read is not
    // the record the port is handed. The stored `shownDiff` bytes are left alone, which is what
    // makes the comparison the thing that fires.
    const registry = registryFor()
    const id = await pre432Proposal()

    const payload = storedConfigPayload(id)
    const widened = utf8Decode(base64Decode(payload.files[0]!.newContentBase64))
      .replace('parallel: false', 'parallel: true')
    const record = storedRecord(id)
    if (record.kind !== 'config' || record.payload.payloadKind !== 'applyable') {
      throw new Error('unreachable')
    }
    record.payload.files[0]!.newContentBase64 = base64Encode(utf8Encode(widened))
    writeFileSync(pendingProposalPath(id), `${JSON.stringify(record, null, 2)}\n`)

    const before = readFileSync(configPath, 'utf8')
    await expect(invokeFunction(registry, 'proposals.accept', { proposalId: id }, HUMAN))
      .rejects.toMatchObject({ name: 'ConfigApplyDiffMismatchError' })

    // NOTHING WAS WRITTEN. The refusal is above the write, which is the property, not the message.
    expect(readFileSync(configPath, 'utf8')).toBe(before)
    expect(commitCount()).toBe(1)
    expect(git('status', '--porcelain').stdout.trim()).toBe('')
  })

  it('(g) an unbound apply refuses BY NAME and leaves the repository untouched', async () => {
    const id = await pre432Proposal()

    const hostWithoutApply = registryFor({ bindApply: false })
    await expect(invokeFunction(hostWithoutApply, 'proposals.accept', { proposalId: id }, HUMAN))
      .rejects.toThrow(/declared but not bound/)

    expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG)
    expect(commitCount()).toBe(1)
  })
})

// 2026-09-30, 432-07 D-05/D-07: the direct writer publishes the tracer's field edit in one call.
// 432-11 switched `config.field.set` onto it; cell (a) above is the op's own road.
describe('C432-CONFIG-DIRECT: the tracer edit through the direct writer', () => {
  it('publishes the field edit byte-matched with its comments, files no proposal and makes no commit', async () => {
    const create = (hostModule as Record<string, unknown>).createConfigWritePort
    expect(typeof create, 'the direct config writer is exported').toBe('function')
    const port = (create as (path: string) => NonNullable<FunctionDeps['configWrite']>)(configPath)

    const outcome = await port.applyFields({
      changes: [{ op: 'set', path: ['use', 'timeout', 'step'], value: '45s' }],
    })

    expect(outcome).toMatchObject({ kind: 'applied', file: 'agent-qa.config.yaml' })
    expect(readFileSync(configPath, 'utf8')).toBe(SEEDED_CONFIG.replace('step: 30s', 'step: 45s'))
    expect(commitCount()).toBe(1)
    expect(git('status', '--porcelain').stdout.trim()).toBe('M agent-qa.config.yaml')
    expect(existsSync(join(agentQaRoot, 'proposals'))).toBe(false)
  })
})
