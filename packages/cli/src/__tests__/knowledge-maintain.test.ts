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
  let originalIsTty: boolean | undefined

  beforeEach(() => {
    originalExitCode = process.exitCode
    originalIsTty = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
    })
  })

  afterEach(() => {
    process.exitCode = originalExitCode
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalIsTty,
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
