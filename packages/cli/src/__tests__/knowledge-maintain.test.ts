import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import {
  guardPurgeReceipt,
  publishBundle,
} from '@vostride/agent-qa-knowledge-local'
import type {
  BundleStoreConfig,
  PublishBundleInput,
} from '@vostride/agent-qa-knowledge-local'
import {
  asEvidenceToken,
  BundleOutcomeEventSchema,
} from '@vostride/agent-qa-schema'
import type {
  BundleDiscriminant,
  BundleDraft,
} from '@vostride/agent-qa-schema'
import { Command, CommanderError } from 'commander'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const commandHarness = vi.hoisted(() => ({
  promptAnswers: [] as string[],
  promptCalls: [] as Array<{
    input: 'stdin' | 'other'
    output: 'stdout' | 'stderr' | 'other'
    question: string
  }>,
  purgeRecordCalls: 0,
  rollbackCampaignCalls: 0,
  rollbackCurationJobCalls: 0,
}))

vi.mock('node:readline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:readline')>()
  return {
    ...actual,
    createInterface: vi.fn((options: {
      input: NodeJS.ReadableStream
      output?: NodeJS.WritableStream
    }) => ({
      close: vi.fn(),
      question: (question: string, resolveAnswer: (answer: string) => void) => {
        const output = options.output
        if (output === undefined) throw new Error('maintenance prompt requires an output stream')
        commandHarness.promptCalls.push({
          input: options.input === process.stdin ? 'stdin' : 'other',
          output: output === process.stdout
            ? 'stdout'
            : output === process.stderr ? 'stderr' : 'other',
          question,
        })
        output.write(question)
        const answer = commandHarness.promptAnswers.shift()
        if (answer === undefined) throw new Error(`missing prompt answer for ${question}`)
        resolveAnswer(answer)
      },
    })),
  }
})

vi.mock('@vostride/agent-qa-knowledge-local', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@vostride/agent-qa-knowledge-local')
  >()
  return {
    ...actual,
    purgeRecord: vi.fn((...args: Parameters<typeof actual.purgeRecord>) => {
      commandHarness.purgeRecordCalls += 1
      return actual.purgeRecord(...args)
    }),
    rollbackCampaign: vi.fn((...args: Parameters<typeof actual.rollbackCampaign>) => {
      commandHarness.rollbackCampaignCalls += 1
      return actual.rollbackCampaign(...args)
    }),
    rollbackCurationJob: vi.fn((...args: Parameters<typeof actual.rollbackCurationJob>) => {
      commandHarness.rollbackCurationJobCalls += 1
      return actual.rollbackCurationJob(...args)
    }),
  }
})

import { createKnowledgeCommand } from '../commands/knowledge.js'

const PRODUCT = 'maintenance-storefront'
const CURATION_JOB_ID = 'maintenance-curation-job'
const BUILD_ORDINAL = 12
const LIVE_LEASE_ID = '11111111-1111-4111-8111-111111111111'

interface FixtureWorkspace {
  root: string
  configPath: string
  knowledgeRoot: string
  runtimeRoot: string
}

interface InvocationResult {
  stdout: string
  stderr: string
  exitCode: typeof process.exitCode
  commanderError?: CommanderError
}

function fixtureWorkspace(roots: string[]): FixtureWorkspace {
  const root = mkdtempSync(join(tmpdir(), `agent-qa-knowledge-maintain-${randomUUID()}-`))
  roots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  const runtimeRoot = join(root, '.agent-qa')
  mkdirSync(runtimeRoot, { recursive: true })
  writeFileSync(
    configPath,
    `${JSON.stringify({
      workspace: {
        testMatch: ['tests/**/*.yaml'],
        suiteMatch: ['suites/**/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
      knowledge: {
        dir: 'agent-qa-knowledge',
        commitArtifacts: 'none',
      },
      use: {
        mobile: { appState: 'preserve' },
      },
    }, null, 2)}\n`,
    'utf8',
  )
  writeFileSync(
    join(runtimeRoot, 'build-ordinals.json'),
    `${JSON.stringify({ [PRODUCT]: BUILD_ORDINAL })}\n`,
    'utf8',
  )
  return {
    root,
    configPath,
    knowledgeRoot: join(root, 'agent-qa-knowledge'),
    runtimeRoot,
  }
}

function bundleInput(): PublishBundleInput {
  const draft: BundleDraft = {
    kind: 'fact',
    subtype: 'selector',
    anchors: [{ t: 'el', role: 'button', name: 'Checkout' }],
    scope: { tier: 'product', key: PRODUCT },
    summary: 'Use the Checkout button to continue.',
    body: 'The checkout selector was confirmed by a completed run.',
    distilledEvidenceRef: {
      id: 'maintenance-evidence',
      sha: 'a'.repeat(64),
    },
    originStage: 'run-curation',
  }
  const discriminant: BundleDiscriminant = {
    kind: 'fact',
    subtype: 'selector',
    elementRef: { role: 'button', name: 'Checkout' },
  }
  return {
    draft,
    discriminant,
    originClass: 'agent-verified',
    createdAtOrdinal: 5,
    screenStates: [],
    initialEvents: [BundleOutcomeEventSchema.parse({
      type: 'confirmed',
      evidenceToken: asEvidenceToken('maintenance-confirmation'),
      curationJobId: CURATION_JOB_ID,
      buildOrdinal: 5,
      origin: 'agent-verified',
    })],
    relations: [],
    provenance: {
      mode: 'run-linked',
      runId: 'run-knowledge-maintenance',
      testId: 'test-knowledge-maintenance',
      stepIndex: 0,
      curationJobId: CURATION_JOB_ID,
      sourceBuildOrdinal: 5,
    },
    artifacts: [],
    evidenceMarkdown: 'Checkout was observed deterministically.\n',
  }
}

function seedBundle(workspace: FixtureWorkspace): { id: string; dir: string } {
  const config: BundleStoreConfig = {
    knowledgeRoot: workspace.knowledgeRoot,
    productKey: PRODUCT,
    auditBaseDir: workspace.runtimeRoot,
    commitArtifacts: 'none',
  }
  const published = publishBundle(config, bundleInput())
  if (published.kind !== 'published') {
    throw new Error(`expected published maintenance fixture, got ${published.kind}`)
  }
  return { id: published.id, dir: published.dir }
}

function snapshotFiles(root: string): Record<string, string> {
  if (!existsSync(root)) return {}
  const files: Record<string, string> = {}

  function visit(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        files[relative(root, path)] = readFileSync(path).toString('base64')
      }
    }
  }

  visit(root)
  return files
}

async function invoke(
  workspace: FixtureWorkspace,
  args: readonly string[],
): Promise<InvocationResult> {
  const stdout: string[] = []
  const stderr: string[] = []
  const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk))
    return true
  })
  const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk))
    return true
  })
  const consoleLog = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    stdout.push(`${values.map(String).join(' ')}\n`)
  })
  process.exitCode = undefined

  let commanderError: CommanderError | undefined
  try {
    const knowledge = createKnowledgeCommand()
    const program = new Command()
      .option('--config <path>', 'config file path')
      .addCommand(knowledge)
    for (const command of [program, knowledge, ...knowledge.commands]) {
      command.exitOverride()
    }
    try {
      await program.parseAsync([
        'node',
        'agent-qa',
        '--config',
        workspace.configPath,
        'knowledge',
        ...args,
      ])
    } catch (error) {
      if (!(error instanceof CommanderError)) throw error
      commanderError = error
    }
    return {
      stdout: stdout.join(''),
      stderr: stderr.join(''),
      exitCode: process.exitCode,
      ...(commanderError === undefined ? {} : { commanderError }),
    }
  } finally {
    stdoutWrite.mockRestore()
    stderrWrite.mockRestore()
    consoleLog.mockRestore()
  }
}

function plantLiveWriterLease(workspace: FixtureWorkspace): void {
  mkdirSync(join(workspace.knowledgeRoot, 'memory', 'index'), { recursive: true })
  writeFileSync(join(workspace.knowledgeRoot, '.epoch'), '7\n', 'utf8')
  writeFileSync(
    join(workspace.knowledgeRoot, '.lease'),
    `${JSON.stringify({
      leaseId: LIVE_LEASE_ID,
      pid: 4242,
      epoch: 7,
      heartbeatAtMs: Date.now() + 60_000,
    })}\n`,
    'utf8',
  )
}

describe('knowledge maintenance commands', () => {
  const roots: string[] = []
  let originalExitCode: typeof process.exitCode
  let originalStderrIsTty: boolean | undefined
  let originalStdinIsTty: boolean | undefined
  let originalStdoutIsTty: boolean | undefined

  function setTerminalTopology(input: {
    stderr: boolean
    stdin: boolean
    stdout: boolean
  }): void {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: input.stdin,
    })
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: input.stdout,
    })
    Object.defineProperty(process.stderr, 'isTTY', {
      configurable: true,
      value: input.stderr,
    })
  }

  beforeEach(() => {
    originalExitCode = process.exitCode
    originalStdinIsTty = process.stdin.isTTY
    originalStdoutIsTty = process.stdout.isTTY
    originalStderrIsTty = process.stderr.isTTY
    setTerminalTopology({ stdin: false, stdout: false, stderr: false })
    commandHarness.promptAnswers.splice(0)
    commandHarness.promptCalls.splice(0)
    commandHarness.purgeRecordCalls = 0
    commandHarness.rollbackCampaignCalls = 0
    commandHarness.rollbackCurationJobCalls = 0
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: originalStdinIsTty,
    })
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalStdoutIsTty,
    })
    Object.defineProperty(process.stderr, 'isTTY', {
      configurable: true,
      value: originalStderrIsTty,
    })
    vi.restoreAllMocks()
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails closed without non-interactive confirmation and preserves committed bundle bytes', async () => {
    const workspace = fixtureWorkspace(roots)
    const bundle = seedBundle(workspace)
    const before = snapshotFiles(bundle.dir)

    const rollback = await invoke(workspace, ['rollback', '--job', CURATION_JOB_ID])
    expect(rollback.exitCode).toBe(1)
    expect(rollback.stderr).toContain('knowledge rollback: refusal [confirmation-required]')
    expect(snapshotFiles(bundle.dir)).toEqual(before)

    const purge = await invoke(workspace, ['purge', bundle.id])
    expect(purge.exitCode).toBe(1)
    expect(purge.stderr).toContain('knowledge purge: refusal [confirmation-required]')
    expect(snapshotFiles(bundle.dir)).toEqual(before)
  })

  it('refuses piped stdin even when stdout is a TTY without invoking destructive mutators', async () => {
    const workspace = fixtureWorkspace(roots)
    const bundle = seedBundle(workspace)
    const before = snapshotFiles(bundle.dir)
    setTerminalTopology({ stdin: false, stdout: true, stderr: true })

    const rollback = await invoke(workspace, ['rollback', '--job', CURATION_JOB_ID])
    expect(rollback.exitCode).toBe(1)
    expect(rollback.stderr).toContain('knowledge rollback: refusal [confirmation-required]')

    const purge = await invoke(workspace, ['purge', bundle.id])
    expect(purge.exitCode).toBe(1)
    expect(purge.stderr).toContain('knowledge purge: refusal [confirmation-required]')

    expect(commandHarness.promptCalls).toEqual([])
    expect(commandHarness.rollbackCurationJobCalls).toBe(0)
    expect(commandHarness.rollbackCampaignCalls).toBe(0)
    expect(commandHarness.purgeRecordCalls).toBe(0)
    expect(snapshotFiles(bundle.dir)).toEqual(before)
  })

  it('keeps interactive rollback JSON stdout parseable while prompting on stderr', async () => {
    const workspace = fixtureWorkspace(roots)
    seedBundle(workspace)
    setTerminalTopology({ stdin: true, stdout: true, stderr: true })
    commandHarness.promptAnswers.push('y')

    const result = await invoke(workspace, [
      'rollback',
      '--job',
      CURATION_JOB_ID,
      '--json',
    ])

    expect(result.exitCode).toBeUndefined()
    expect(JSON.parse(result.stdout)).toMatchObject({
      receiptId: expect.stringMatching(/^rollback:/u),
      affected: { mintedBundleIds: expect.any(Array) },
    })
    expect(result.stderr).toContain('Rollback preview')
    expect(result.stderr).toContain('Apply this rollback? (y/N) ')
    expect(result.stdout).not.toContain('Rollback preview')
    expect(result.stdout).not.toContain('Apply this rollback?')
    expect(commandHarness.promptCalls).toEqual([{
      input: 'stdin',
      output: 'stderr',
      question: 'Apply this rollback? (y/N) ',
    }])
    expect(commandHarness.rollbackCurationJobCalls).toBe(1)
  })

  it('keeps interactive purge JSON stdout parseable while prompting on stderr', async () => {
    const workspace = fixtureWorkspace(roots)
    const bundle = seedBundle(workspace)
    setTerminalTopology({ stdin: true, stdout: true, stderr: true })
    commandHarness.promptAnswers.push(bundle.id)

    const result = await invoke(workspace, ['purge', bundle.id, '--json'])

    expect(result.exitCode).toBeUndefined()
    expect(guardPurgeReceipt(JSON.parse(result.stdout))).toMatchObject({
      purgedRecordId: bundle.id,
    })
    expect(result.stderr).toContain(`Purge preview for ${bundle.id}`)
    expect(result.stderr).toContain(`Type ${bundle.id} to confirm irreversible purge: `)
    expect(result.stdout).not.toContain('Purge preview')
    expect(result.stdout).not.toContain('Type ')
    expect(commandHarness.promptCalls).toEqual([{
      input: 'stdin',
      output: 'stderr',
      question: `Type ${bundle.id} to confirm irreversible purge: `,
    }])
    expect(commandHarness.purgeRecordCalls).toBe(1)
  })

  it('keeps JSON stdout empty and returns non-success when interactive answers refuse', async () => {
    const rollbackWorkspace = fixtureWorkspace(roots)
    seedBundle(rollbackWorkspace)
    setTerminalTopology({ stdin: true, stdout: true, stderr: true })
    commandHarness.promptAnswers.push('n')

    const rollback = await invoke(rollbackWorkspace, [
      'rollback',
      '--job',
      CURATION_JOB_ID,
      '--json',
    ])
    expect(rollback.exitCode).toBe(1)
    expect(rollback.stdout).toBe('')
    expect(commandHarness.rollbackCurationJobCalls).toBe(0)

    const purgeWorkspace = fixtureWorkspace(roots)
    const bundle = seedBundle(purgeWorkspace)
    commandHarness.promptAnswers.push(`${bundle.id}-mismatch`)

    const purge = await invoke(purgeWorkspace, ['purge', bundle.id, '--json'])
    expect(purge.exitCode).toBe(1)
    expect(purge.stdout).toBe('')
    expect(purge.stderr).toContain('knowledge purge: refusal [confirmation-mismatch]')
    expect(commandHarness.purgeRecordCalls).toBe(0)
  })

  it('requires the exact purge id, rejects --yes, and emits the persisted receipt verbatim', async () => {
    const workspace = fixtureWorkspace(roots)
    const bundle = seedBundle(workspace)
    const before = snapshotFiles(bundle.dir)

    const mismatch = await invoke(workspace, [
      'purge',
      bundle.id,
      '--confirm',
      `${bundle.id}-mismatch`,
      '--json',
    ])
    expect(mismatch.exitCode).toBe(1)
    expect(mismatch.stderr).toContain('knowledge purge: refusal [confirmation-mismatch]')
    expect(snapshotFiles(bundle.dir)).toEqual(before)

    const bypass = await invoke(workspace, ['purge', bundle.id, '--yes'])
    expect(bypass.commanderError?.code).toBe('commander.unknownOption')
    expect(bypass.stderr).toContain("unknown option '--yes'")
    expect(snapshotFiles(bundle.dir)).toEqual(before)

    const exact = await invoke(workspace, [
      'purge',
      bundle.id,
      '--confirm',
      bundle.id,
      '--json',
    ])
    expect(exact.exitCode).toBeUndefined()
    const emitted = guardPurgeReceipt(JSON.parse(exact.stdout))
    const persisted = guardPurgeReceipt(JSON.parse(readFileSync(
      join(workspace.knowledgeRoot, 'memory', 'receipts', `purge-${bundle.id}.json`),
      'utf8',
    )))
    expect(emitted).toEqual(persisted)
    expect(emitted.purgedRecordId).toBe(bundle.id)
    expect(emitted.initiator).toMatch(/^cli:.+/u)
    expect(existsSync(bundle.dir)).toBe(false)
  })

  it('refuses every mutating verb while a live writer lease names its holder', async () => {
    const workspace = fixtureWorkspace(roots)
    const bundle = seedBundle(workspace)
    plantLiveWriterLease(workspace)
    const before = snapshotFiles(workspace.knowledgeRoot)

    const invocations = [
      ['rebuild-index', '--json'],
      ['rollback', '--job', CURATION_JOB_ID, '--yes', '--json'],
      ['purge', bundle.id, '--confirm', bundle.id, '--json'],
    ] as const

    for (const args of invocations) {
      const result = await invoke(workspace, args)
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('refusal [writer-lease-held]')
      expect(result.stderr).toContain('pid 4242')
      expect(result.stderr).toContain(LIVE_LEASE_ID)
      expect(result.stdout).toBe('')
    }
    expect(snapshotFiles(workspace.knowledgeRoot)).toEqual(before)
  })

  it('emits a bare RebuildReport object for --json', async () => {
    const workspace = fixtureWorkspace(roots)
    seedBundle(workspace)

    const result = await invoke(workspace, ['rebuild-index', '--json'])
    expect(result.exitCode).toBeUndefined()
    expect(result.stderr).toBe('')
    const report = JSON.parse(result.stdout) as Record<string, unknown>
    expect(Object.keys(report).sort()).toEqual([
      'backfilled',
      'maintenanceRemaining',
      'pendingEmbeddings',
      'projected',
      'removed',
      'scanIssues',
      'skippedIncomplete',
      'vec',
    ])
    expect(report).toMatchObject({
      projected: 1,
      removed: 0,
      backfilled: 0,
      vec: expect.any(String),
      pendingEmbeddings: expect.any(Number),
      maintenanceRemaining: expect.any(Boolean),
    })
  })
})
