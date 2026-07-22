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
  acquireWriterLease,
  appendOutcomeEvent,
  guardPurgeReceipt,
  loadBundle,
  publishBundle,
  purgeRecord,
} from '@vostride/agent-qa-knowledge-local'
import type {
  BundleStoreConfig,
  PublishBundleInput,
} from '@vostride/agent-qa-knowledge-local'
import {
  asEvidenceToken,
  asRecordId,
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
  promptHook: undefined as (() => void) | undefined,
  rebuildIndexHook: undefined as ((input: Record<string, unknown>) => Promise<unknown>) | undefined,
  authorityRefreshHook: undefined as (
    (authority: Record<string, unknown>, call: number) => void
  ) | undefined,
  authorityRefreshCalls: 0,
  releaseLeaseCalls: 0,
  rebuildIndexInputs: [] as Record<string, unknown>[],
  purgeRecordInputs: [] as Record<string, unknown>[],
  rollbackCampaignInputs: [] as Record<string, unknown>[],
  rollbackCurationJobInputs: [] as Record<string, unknown>[],
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
        commandHarness.promptHook?.()
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
    rebuildIndex: vi.fn((...args: Parameters<typeof actual.rebuildIndex>) => {
      const input = args[0] as unknown as Record<string, unknown>
      commandHarness.rebuildIndexInputs.push(input)
      return commandHarness.rebuildIndexHook === undefined
        ? actual.rebuildIndex(...args)
        : commandHarness.rebuildIndexHook(input)
    }),
    refreshWriterLeaseAuthority: vi.fn((...args: Parameters<typeof actual.refreshWriterLeaseAuthority>) => {
      commandHarness.authorityRefreshCalls += 1
      commandHarness.authorityRefreshHook?.(
        args[0] as unknown as Record<string, unknown>,
        commandHarness.authorityRefreshCalls,
      )
      return actual.refreshWriterLeaseAuthority(...args)
    }),
    releaseLease: vi.fn((...args: Parameters<typeof actual.releaseLease>) => {
      commandHarness.releaseLeaseCalls += 1
      return actual.releaseLease(...args)
    }),
    purgeRecord: vi.fn((...args: Parameters<typeof actual.purgeRecord>) => {
      commandHarness.purgeRecordCalls += 1
      commandHarness.purgeRecordInputs.push(args[0] as unknown as Record<string, unknown>)
      return actual.purgeRecord(...args)
    }),
    rollbackCampaign: vi.fn((...args: Parameters<typeof actual.rollbackCampaign>) => {
      commandHarness.rollbackCampaignCalls += 1
      commandHarness.rollbackCampaignInputs.push(args[0] as unknown as Record<string, unknown>)
      return actual.rollbackCampaign(...args)
    }),
    rollbackCurationJob: vi.fn((...args: Parameters<typeof actual.rollbackCurationJob>) => {
      commandHarness.rollbackCurationJobCalls += 1
      commandHarness.rollbackCurationJobInputs.push(args[0] as unknown as Record<string, unknown>)
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

function fixtureWorkspace(
  roots: string[],
  ordinals: Readonly<Record<string, number>> = { [PRODUCT]: BUILD_ORDINAL },
  knowledgeDir = 'agent-qa-knowledge',
): FixtureWorkspace {
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
        dir: knowledgeDir,
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
    `${JSON.stringify(ordinals)}\n`,
    'utf8',
  )
  return {
    root,
    configPath,
    knowledgeRoot: join(root, knowledgeDir),
    runtimeRoot,
  }
}

interface SeedBundleOptions {
  product?: string
  scopeProduct?: string
  createdAtOrdinal?: number
  curationJobId?: string
}

function bundleInput(options: SeedBundleOptions = {}): PublishBundleInput {
  const product = options.product ?? PRODUCT
  const scopeProduct = options.scopeProduct ?? product
  const createdAtOrdinal = options.createdAtOrdinal ?? 5
  const curationJobId = options.curationJobId ?? CURATION_JOB_ID
  const draft: BundleDraft = {
    kind: 'fact',
    subtype: 'selector',
    anchors: [{ t: 'el', role: 'button', name: 'Checkout' }],
    scope: { tier: 'product', key: scopeProduct },
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
    createdAtOrdinal,
    screenStates: [],
    initialEvents: [BundleOutcomeEventSchema.parse({
      type: 'confirmed',
      evidenceToken: asEvidenceToken(`maintenance-confirmation-${product}-${createdAtOrdinal}`),
      curationJobId,
      buildOrdinal: createdAtOrdinal,
      origin: 'agent-verified',
    })],
    relations: [],
    provenance: {
      mode: 'run-linked',
      runId: `run-knowledge-maintenance-${product}`,
      testId: 'test-knowledge-maintenance',
      stepIndex: 0,
      curationJobId,
      sourceBuildOrdinal: createdAtOrdinal,
    },
    artifacts: [],
    evidenceMarkdown: 'Checkout was observed deterministically.\n',
  }
}

function seedBundle(
  workspace: FixtureWorkspace,
  options: SeedBundleOptions = {},
): { id: string; dir: string } {
  const product = options.product ?? PRODUCT
  const config: BundleStoreConfig = {
    knowledgeRoot: workspace.knowledgeRoot,
    productKey: product,
    auditBaseDir: workspace.runtimeRoot,
    commitArtifacts: 'none',
  }
  const published = publishBundle(config, bundleInput(options))
  if (published.kind !== 'published') {
    throw new Error(`expected published maintenance fixture, got ${published.kind}`)
  }
  return { id: published.id, dir: published.dir }
}

function expectedBundlePaths(workspace: FixtureWorkspace, bundleDir: string): string[] {
  const loaded = loadBundle(bundleDir)
  if (loaded.kind !== 'loaded') {
    throw new Error(`expected loaded purge fixture, got ${loaded.kind}`)
  }
  const relativeDir = relative(workspace.knowledgeRoot, bundleDir)
  return [
    relativeDir,
    ...Object.keys(loaded.bundle.manifest.contentHashes).map((path) => `${relativeDir}/${path}`),
    `${relativeDir}/manifest.json`,
  ].sort()
}

function rollbackInverseOrdinals(bundleDir: string): number[] {
  const loaded = loadBundle(bundleDir)
  if (loaded.kind !== 'loaded') {
    throw new Error(`expected loaded rollback fixture, got ${loaded.kind}`)
  }
  return loaded.bundle.events
    .filter(({ curationJobId }) => curationJobId.startsWith('rollback:'))
    .map(({ buildOrdinal }) => buildOrdinal)
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
    commandHarness.promptHook = undefined
    commandHarness.rebuildIndexHook = undefined
    commandHarness.authorityRefreshHook = undefined
    commandHarness.authorityRefreshCalls = 0
    commandHarness.releaseLeaseCalls = 0
    commandHarness.rebuildIndexInputs.splice(0)
    commandHarness.purgeRecordInputs.splice(0)
    commandHarness.rollbackCampaignInputs.splice(0)
    commandHarness.rollbackCurationJobInputs.splice(0)
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
    vi.useRealTimers()
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
    expect(commandHarness.rollbackCurationJobInputs[0]?.writerAuthority).toMatchObject({
      knowledgeRoot: workspace.knowledgeRoot,
      leaseId: expect.any(String),
      epoch: expect.any(Number),
    })
  })

  it('keeps nested knowledge maintenance audit evidence in the canonical runtime root', async () => {
    const workspace = fixtureWorkspace(
      roots,
      { [PRODUCT]: BUILD_ORDINAL },
      'docs/knowledge',
    )
    seedBundle(workspace)

    const result = await invoke(workspace, [
      'rollback', '--job', CURATION_JOB_ID, '--yes', '--json',
    ])

    expect(result.exitCode).toBeUndefined()
    expect(commandHarness.rollbackCurationJobInputs).toHaveLength(1)
    expect(commandHarness.rollbackCurationJobInputs[0]?.auditBaseDir).toBe(workspace.runtimeRoot)
    expect(existsSync(join(workspace.root, 'docs', '.agent-qa'))).toBe(false)
  })

  it('rolls back a job minted at the current product ordinal using the reserved next ordinal', async () => {
    const workspace = fixtureWorkspace(roots)
    const bundle = seedBundle(workspace, { createdAtOrdinal: BUILD_ORDINAL })

    const result = await invoke(workspace, [
      'rollback',
      '--job',
      CURATION_JOB_ID,
      '--yes',
      '--json',
    ])

    expect(result.exitCode).toBeUndefined()
    expect(JSON.parse(result.stdout)).toMatchObject({
      inverseCount: 1,
      deprecatedBundles: [bundle.id],
    })
    expect(commandHarness.rollbackCurationJobCalls).toBe(1)
    expect(JSON.parse(readFileSync(
      join(workspace.runtimeRoot, 'build-ordinals.json'),
      'utf8',
    ))).toEqual({ [PRODUCT]: BUILD_ORDINAL + 1 })
    expect(rollbackInverseOrdinals(bundle.dir)).toEqual([BUILD_ORDINAL + 1])
  })

  it('retries the same completed rollback without changing bundle or counter bytes', async () => {
    const workspace = fixtureWorkspace(roots)
    const bundle = seedBundle(workspace, { createdAtOrdinal: BUILD_ORDINAL })
    const args = ['rollback', '--job', CURATION_JOB_ID, '--yes', '--json'] as const

    const first = await invoke(workspace, args)
    expect(first.exitCode).toBeUndefined()
    expect(JSON.parse(first.stdout)).toMatchObject({ inverseCount: 1 })
    const bundleAfterFirst = snapshotFiles(bundle.dir)
    const counterPath = join(workspace.runtimeRoot, 'build-ordinals.json')
    const counterAfterFirst = readFileSync(counterPath)

    const second = await invoke(workspace, args)
    expect(second.exitCode).toBeUndefined()
    expect(JSON.parse(second.stdout)).toMatchObject({
      inverseCount: 0,
      affected: { plannedEffects: [] },
    })
    expect(snapshotFiles(bundle.dir)).toEqual(bundleAfterFirst)
    expect(readFileSync(counterPath)).toEqual(counterAfterFirst)
    expect(commandHarness.rollbackCurationJobCalls).toBe(2)
  })

  it('advances every affected campaign product to one reserved ordinal', async () => {
    const firstProduct = 'campaign-alpha'
    const secondProduct = 'campaign-beta'
    const workspace = fixtureWorkspace(roots, {
      [firstProduct]: 7,
      [secondProduct]: 11,
      untouched: 99,
    })
    const first = seedBundle(workspace, {
      product: firstProduct,
      createdAtOrdinal: 7,
      curationJobId: 'campaign-job-alpha',
    })
    const second = seedBundle(workspace, {
      product: secondProduct,
      createdAtOrdinal: 11,
      curationJobId: 'campaign-job-beta',
    })

    const result = await invoke(workspace, [
      'rollback',
      '--from-build',
      '7',
      '--to-build',
      '11',
      '--yes',
      '--json',
    ])

    expect(result.exitCode).toBeUndefined()
    expect(JSON.parse(result.stdout)).toMatchObject({
      inverseCount: 2,
      deprecatedBundles: [first.id, second.id].sort(),
    })
    expect(commandHarness.rollbackCampaignCalls).toBe(1)
    expect(JSON.parse(readFileSync(
      join(workspace.runtimeRoot, 'build-ordinals.json'),
      'utf8',
    ))).toEqual({
      [firstProduct]: 12,
      [secondProduct]: 12,
      untouched: 99,
    })
    expect(rollbackInverseOrdinals(first.dir)).toEqual([12])
    expect(rollbackInverseOrdinals(second.dir)).toEqual([12])
  })

  it('refuses missing and exhausted affected counters before invoking rollback mutators', async () => {
    const missingProduct = 'missing-counter-product'
    const missingWorkspace = fixtureWorkspace(roots, { untouched: 4 })
    seedBundle(missingWorkspace, {
      product: missingProduct,
      createdAtOrdinal: 5,
      curationJobId: 'missing-counter-job',
    })
    const missingCounters = readFileSync(
      join(missingWorkspace.runtimeRoot, 'build-ordinals.json'),
      'utf8',
    )

    const missing = await invoke(missingWorkspace, [
      'rollback',
      '--job',
      'missing-counter-job',
      '--yes',
      '--json',
    ])
    expect(missing.exitCode).toBe(1)
    expect(missing.stderr).toContain('missing-counter-product')
    expect(commandHarness.rollbackCurationJobCalls).toBe(0)
    expect(readFileSync(
      join(missingWorkspace.runtimeRoot, 'build-ordinals.json'),
      'utf8',
    )).toBe(missingCounters)

    const exhaustedProduct = 'exhausted-counter-product'
    const exhaustedWorkspace = fixtureWorkspace(roots, {
      [exhaustedProduct]: Number.MAX_SAFE_INTEGER,
    })
    seedBundle(exhaustedWorkspace, {
      product: exhaustedProduct,
      createdAtOrdinal: 6,
      curationJobId: 'exhausted-counter-job',
    })
    const exhaustedCounters = readFileSync(
      join(exhaustedWorkspace.runtimeRoot, 'build-ordinals.json'),
      'utf8',
    )

    const exhausted = await invoke(exhaustedWorkspace, [
      'rollback',
      '--job',
      'exhausted-counter-job',
      '--yes',
      '--json',
    ])
    expect(exhausted.exitCode).toBe(1)
    expect(exhausted.stderr).toContain('exhausted')
    expect(commandHarness.rollbackCurationJobCalls).toBe(0)
    expect(readFileSync(
      join(exhaustedWorkspace.runtimeRoot, 'build-ordinals.json'),
      'utf8',
    )).toBe(exhaustedCounters)
    expect(readdirSync(exhaustedWorkspace.runtimeRoot).some(file => file.endsWith('.tmp'))).toBe(
      false,
    )
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
    expect(commandHarness.purgeRecordInputs[0]?.writerAuthority).toMatchObject({
      knowledgeRoot: workspace.knowledgeRoot,
      leaseId: expect.any(String),
      epoch: expect.any(Number),
    })
    expect(commandHarness.purgeRecordInputs[0]?.expectedAffectedSetFingerprint).toMatch(
      /^[0-9a-f]{64}$/u,
    )
  })

  for (const legacyVersion of [1, 2] as const) {
    it(`previews and completes a partially applied v${legacyVersion} purge intent`, async () => {
      const workspace = fixtureWorkspace(roots)
      const bundle = seedBundle(workspace)
      expect(() => purgeRecord({
        knowledgeRoot: workspace.knowledgeRoot,
        recordId: asRecordId(bundle.id),
        initiator: 'legacy-intent-fixture',
        auditBaseDir: workspace.runtimeRoot,
        hooks: {
          afterIntentWritten: () => {
            throw new Error('leave legacy purge intent')
          },
        },
      })).toThrow('leave legacy purge intent')
      const intentPath = join(
        workspace.knowledgeRoot,
        'memory',
        'receipts',
        `purge-${bundle.id}.intent.json`,
      )
      const intent = JSON.parse(readFileSync(intentPath, 'utf8')) as Record<string, unknown>
      intent.schemaVersion = legacyVersion
      delete intent.affectedSet
      if (legacyVersion === 1) delete intent.receiptCycle
      writeFileSync(intentPath, `${JSON.stringify(intent)}\n`, 'utf8')
      rmSync(bundle.dir, { recursive: true, force: true })
      commandHarness.purgeRecordCalls = 0
      commandHarness.purgeRecordInputs = []

      const result = await invoke(workspace, [
        'purge',
        bundle.id,
        '--confirm',
        bundle.id,
        '--json',
      ])

      expect(result.exitCode).toBeUndefined()
      expect(guardPurgeReceipt(JSON.parse(result.stdout))).toMatchObject({
        purgedRecordId: bundle.id,
      })
      expect(commandHarness.purgeRecordCalls).toBe(1)
      expect(existsSync(intentPath)).toBe(false)
      expect(existsSync(join(
        workspace.knowledgeRoot,
        'memory',
        'receipts',
        `purge-${bundle.id}.json`,
      ))).toBe(true)
    })
  }

  it('renders every product bundle tree and receipt-named path in the purge preview', async () => {
    const workspace = fixtureWorkspace(roots)
    const primary = seedBundle(workspace)
    const secondaryProduct = 'maintenance-z-non-servable-copy'
    const secondary = seedBundle(workspace, {
      product: secondaryProduct,
      scopeProduct: PRODUCT,
    })
    expect(secondary.id).toBe(primary.id)
    expect(appendOutcomeEvent(
      {
        knowledgeRoot: workspace.knowledgeRoot,
        productKey: secondaryProduct,
        auditBaseDir: workspace.runtimeRoot,
        commitArtifacts: 'none',
      },
      asRecordId(secondary.id),
      BundleOutcomeEventSchema.parse({
        type: 'deprecated',
        evidenceToken: 'maintenance-preview-non-servable',
        curationJobId: 'maintenance-preview-non-servable-job',
        buildOrdinal: 6,
        reason: 'Preview must include loadable non-servable copies',
      }),
    ).kind).toBe('appended')
    setTerminalTopology({ stdin: true, stdout: true, stderr: true })
    commandHarness.promptAnswers.push(`${primary.id}-abort`)

    const result = await invoke(workspace, ['purge', primary.id, '--json'])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    for (const path of [
      ...expectedBundlePaths(workspace, primary.dir),
      ...expectedBundlePaths(workspace, secondary.dir),
    ]) {
      expect(result.stderr).toContain(path)
    }
    expect(result.stderr).toContain(relative(workspace.knowledgeRoot, primary.dir))
    expect(result.stderr).toContain(relative(workspace.knowledgeRoot, secondary.dir))
    expect(commandHarness.purgeRecordCalls).toBe(0)
    expect(existsSync(primary.dir)).toBe(true)
    expect(existsSync(secondary.dir)).toBe(true)
  })

  it('refuses purge target drift after exact-id authorization and before mutation', async () => {
    const workspace = fixtureWorkspace(roots)
    const primary = seedBundle(workspace)
    const driftProduct = 'maintenance-z-purge-drift'
    let drifted: { id: string; dir: string } | undefined
    setTerminalTopology({ stdin: true, stdout: true, stderr: true })
    commandHarness.promptAnswers.push(primary.id)
    commandHarness.promptHook = () => {
      drifted = seedBundle(workspace, {
        product: driftProduct,
        scopeProduct: PRODUCT,
      })
      expect(drifted.id).toBe(primary.id)
    }

    const result = await invoke(workspace, ['purge', primary.id, '--json'])

    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('preview-changed')
    expect(commandHarness.purgeRecordCalls).toBe(0)
    expect(existsSync(primary.dir)).toBe(true)
    expect(drifted).toBeDefined()
    expect(existsSync(drifted!.dir)).toBe(true)
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

  it('holds no writer lease while rollback and purge await human authorization', async () => {
    const rollbackWorkspace = fixtureWorkspace(roots)
    seedBundle(rollbackWorkspace)
    setTerminalTopology({ stdin: true, stdout: true, stderr: true })
    commandHarness.promptAnswers.push('y')
    commandHarness.promptHook = () => {
      expect(existsSync(join(rollbackWorkspace.knowledgeRoot, '.lease'))).toBe(false)
    }
    expect((await invoke(rollbackWorkspace, [
      'rollback', '--job', CURATION_JOB_ID, '--json',
    ])).exitCode).toBeUndefined()

    const purgeWorkspace = fixtureWorkspace(roots)
    const bundle = seedBundle(purgeWorkspace)
    commandHarness.promptAnswers.push(bundle.id)
    commandHarness.promptHook = () => {
      expect(existsSync(join(purgeWorkspace.knowledgeRoot, '.lease'))).toBe(false)
    }
    expect((await invoke(purgeWorkspace, ['purge', bundle.id, '--json'])).exitCode).toBeUndefined()
  })

  it('rejects an authorized rollback when the under-lease target fingerprint changes', async () => {
    const driftProduct = 'preview-drift-product'
    const workspace = fixtureWorkspace(roots, {
      [PRODUCT]: BUILD_ORDINAL,
      [driftProduct]: 6,
    })
    seedBundle(workspace)
    setTerminalTopology({ stdin: true, stdout: true, stderr: true })
    commandHarness.promptAnswers.push('y')
    commandHarness.promptHook = () => {
      seedBundle(workspace, { product: driftProduct, createdAtOrdinal: 6 })
    }

    const result = await invoke(workspace, ['rollback', '--job', CURATION_JOB_ID, '--json'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('preview-changed')
    expect(commandHarness.rollbackCurationJobCalls).toBe(0)
  })

  it('rejects a promotion added while the rollback preview awaits authorization', async () => {
    const workspace = fixtureWorkspace(roots)
    const baseJob = 'promotion-preview-base-job'
    const bundle = seedBundle(workspace, { curationJobId: baseJob, createdAtOrdinal: 5 })
    const config: BundleStoreConfig = {
      knowledgeRoot: workspace.knowledgeRoot,
      productKey: PRODUCT,
      auditBaseDir: workspace.runtimeRoot,
      commitArtifacts: 'none',
    }
    expect(appendOutcomeEvent(config, asRecordId(bundle.id), {
      type: 'retracted',
      evidenceToken: asEvidenceToken('promotion-preview-base-retraction'),
      curationJobId: 'promotion-preview-setup',
      buildOrdinal: 6,
      retractsEvidenceToken: asEvidenceToken(`maintenance-confirmation-${PRODUCT}-5`),
      retractsCurationJobId: baseJob,
      rollbackReceiptId: 'promotion-preview-setup',
    })).toEqual({ kind: 'appended' })
    expect(appendOutcomeEvent(config, asRecordId(bundle.id), {
      type: 'confirmed',
      evidenceToken: asEvidenceToken('promotion-preview-selected-confirmation'),
      curationJobId: CURATION_JOB_ID,
      buildOrdinal: 7,
      origin: 'agent-verified',
    })).toEqual({ kind: 'appended' })
    setTerminalTopology({ stdin: true, stdout: true, stderr: true })
    commandHarness.promptAnswers.push('y')
    commandHarness.promptHook = () => {
      expect(appendOutcomeEvent(config, asRecordId(bundle.id), {
        type: 'promoted',
        evidenceToken: asEvidenceToken('promotion-preview-late-promotion'),
        curationJobId: 'promotion-preview-other-job',
        buildOrdinal: 8,
      })).toEqual({ kind: 'appended' })
    }

    const result = await invoke(workspace, ['rollback', '--job', CURATION_JOB_ID, '--json'])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('preview-changed')
    expect(commandHarness.rollbackCurationJobCalls).toBe(0)
    const loaded = loadBundle(bundle.dir)
    if (loaded.kind !== 'loaded') throw new Error('expected promotion race bundle')
    expect(loaded.bundle.events.filter(({ type }) => type === 'retracted')).toHaveLength(1)
  })

  it('heartbeats work beyond the lease TTL and passes authority into rebuild', async () => {
    const workspace = fixtureWorkspace(roots)
    seedBundle(workspace)
    vi.useFakeTimers({ now: 1_000_000 })
    let continueOperation!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolveStarted) => {
      markStarted = resolveStarted
    })
    const operationGate = new Promise<void>((resolveOperation) => {
      continueOperation = resolveOperation
    })
    commandHarness.rebuildIndexHook = async () => {
      markStarted()
      await operationGate
      return {
        projected: 0,
        skippedIncomplete: 0,
        scanIssues: [],
        removed: 0,
        backfilled: 0,
        vec: 'brute',
        pendingEmbeddings: 0,
        maintenanceRemaining: false,
      }
    }

    const invocation = invoke(workspace, ['rebuild-index', '--json'])
    await started
    expect(commandHarness.rebuildIndexInputs[0]?.writerAuthority).toMatchObject({
      knowledgeRoot: workspace.knowledgeRoot,
      leaseId: expect.any(String),
      epoch: 1,
    })
    await vi.advanceTimersByTimeAsync(30_001)
    const competitor = acquireWriterLease(workspace.knowledgeRoot)
    expect(competitor.kind).toBe('held')
    continueOperation()

    expect((await invocation).exitCode).toBeUndefined()
    expect(commandHarness.releaseLeaseCalls).toBe(1)
  })

  it('leaves ordinal counters byte-identical when reclaim wins before persistence', async () => {
    const workspace = fixtureWorkspace(roots)
    seedBundle(workspace, { createdAtOrdinal: BUILD_ORDINAL })
    const ordinalFile = join(workspace.runtimeRoot, 'build-ordinals.json')
    const before = readFileSync(ordinalFile, 'utf8')
    commandHarness.authorityRefreshHook = (authority, call) => {
      if (call !== 1) return
      const leaseFile = join(String(authority.knowledgeRoot), '.lease')
      const lease = JSON.parse(readFileSync(leaseFile, 'utf8')) as Record<string, unknown>
      writeFileSync(
        leaseFile,
        `${JSON.stringify({ ...lease, heartbeatAtMs: Date.now() - 30_000 })}\n`,
        'utf8',
      )
      expect(acquireWriterLease(String(authority.knowledgeRoot)).kind).toBe('acquired')
    }

    const result = await invoke(workspace, [
      'rollback', '--job', CURATION_JOB_ID, '--yes', '--json',
    ])

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('writer authority lost')
    expect(readFileSync(ordinalFile, 'utf8')).toBe(before)
    expect(readdirSync(workspace.runtimeRoot).some((file) => file.endsWith('.tmp'))).toBe(false)
    expect(commandHarness.rollbackCurationJobCalls).toBe(0)
    expect(commandHarness.rollbackCampaignCalls).toBe(0)
    expect(commandHarness.releaseLeaseCalls).toBe(1)
  })
})
