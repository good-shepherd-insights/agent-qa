import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

import { DIGEST_JOB_ID_SOURCE } from '@vostride/agent-qa-agent-local'
import { FsHandoffStore } from '@vostride/agent-qa-runner-local'
import {
  asRef,
  asRunId,
  type CompletedRunHandoff,
  type ElementInfo,
  type ScreenState,
  type StepEvidence,
} from '@vostride/agent-qa-schema'
import { afterEach, describe, expect, it } from 'vitest'

import { createDeclaredSecretMask } from '../../composition/declared-secrets.js'
import { completedRunDir, readCurationTailReceipt } from '../curation-tail.js'
import { composeCliPostRunTail } from '../post-run-tail-composition.js'
import type { PostRunTailHostInput, PostRunTailOperations } from '../post-run-tail.js'

// 2026-10-16 (442-10, D-14): reconciliation 23 reads SC3's distinct secrets as distinct secretsFiles.
const VALUE_A = 'alpha-tenant-7731'
const VALUE_B = 'bravo-tenant-4410'
const MARKER_A = '[secret:A_SECRET]'
const RUN_A = 'r-c442-run-a'
const RUN_B = 'r-c442-run-b'
const SCOPE_A = 'tenant-a'
const SCOPE_B = 'tenant-b'
const TAIL_TIMEOUT_MS = 180_000

type ChainResult = Awaited<ReturnType<PostRunTailHostInput['curateRun']>>

interface Project {
  readonly root: string
  readonly agentQaRoot: string
  readonly aConfig: string
  readonly bConfig: string
  readonly aSecrets: string
  readonly knowledgeA: string
  readonly knowledgeB: string
  readonly knowledgeDirA: string
  readonly knowledgeDirB: string
}

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function config(secretsFile: string, knowledgeDir: string): string {
  return `workspace:
  testMatch:
    - tests/**/*.yaml
  suiteMatch:
    - suites/**/*.suite.yaml
  hooksFile: hooks.yaml
  envFile: .env
  secretsFile: ${secretsFile}

knowledge:
  dir: ${knowledgeDir}

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
}

function project(options: { sharedKnowledge: boolean }): Project {
  const root = mkdtempSync(join(tmpdir(), 'c442-run-config-'))
  roots.push(root)
  const knowledgeDirA = 'knowledge-a'
  const knowledgeDirB = options.sharedKnowledge ? knowledgeDirA : 'knowledge-b'
  const aConfig = join(root, 'a.config.yaml')
  const bConfig = join(root, 'b.config.yaml')
  const aSecrets = join(root, '.env.secrets.a')
  writeFileSync(aConfig, config('.env.secrets.a', knowledgeDirA))
  writeFileSync(bConfig, config('.env.secrets.b', knowledgeDirB))
  writeFileSync(aSecrets, `A_SECRET=${VALUE_A}\n`)
  writeFileSync(join(root, '.env.secrets.b'), `B_SECRET=${VALUE_B}\n`)
  const knowledgeA = join(root, knowledgeDirA)
  const knowledgeB = join(root, knowledgeDirB)
  mkdirSync(knowledgeA, { recursive: true })
  mkdirSync(knowledgeB, { recursive: true })
  return {
    root,
    agentQaRoot: join(root, '.agent-qa'),
    aConfig,
    bConfig,
    aSecrets,
    knowledgeA,
    knowledgeB,
    knowledgeDirA,
    knowledgeDirB,
  }
}

function element(ref: string, name: string): ElementInfo {
  return {
    ref: asRef(ref),
    role: 'button',
    name,
    nameNormalized: name.toLowerCase(),
    bounds: { x: 10, y: 20, width: 100, height: 40 },
    center: { x: 60, y: 40 },
    state: { enabled: true, focused: false, visible: true, clickable: true },
    labels: {},
    attributes: { 'data-testid': name },
  }
}

function screen(target: ElementInfo, url: string): ScreenState {
  return {
    platform: 'web',
    tree: `${target.role} ${target.name}`,
    elements: [target],
    refMap: { [target.ref]: { bounds: target.bounds!, center: target.center! } },
    url,
    timestamp: 1_750_000_000_000,
    metadata: {
      captureMode: 'textOnly',
      coordSpace: 'viewport',
      viewportWidth: 1_280,
      viewportHeight: 720,
      scroll: { offsetX: 0, offsetY: 0, contentWidth: 1_280, contentHeight: 1_440 },
    },
  }
}

function step(stepIndex: number, scopeKey: string, value: string): StepEvidence {
  const target = element(`open-${stepIndex}`, value)
  const state = screen(target, `https://${scopeKey}.example/account?user=${value}`)
  return {
    stepIndex,
    stepText: `Open the ${value} account`,
    cacheStatus: 'miss',
    servedBrief: {
      scope: { tier: 'product', key: scopeKey },
      asOfBuild: 42,
      budget: 1_000,
      truncation: 'none',
      channel1: [],
      channel2: [],
      channel3: [],
      briefDigest: 'brief-digest',
    },
    subActions: [{
      plan: `Use ${target.ref}`,
      plannedAction: { type: 'click', ref: target.ref },
      stateBefore: state,
      stateAfter: state,
      result: { success: true },
    }],
    verifierVerdict: { pass: true, reasoning: 'step verified' },
  }
}

function seedRun(p: Project, runId: string, scopeKey: string, values: readonly string[]): void {
  const handoff: CompletedRunHandoff = {
    schemaVersion: 3,
    runId: asRunId(runId),
    scope: { tier: 'product', key: scopeKey },
    buildOrdinal: 42,
    executionContext: 'local-interactive',
    aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1_750_000_000_000,
    endedAt: 1_750_000_001_000,
    tests: [{
      testId: `${scopeKey}::open-account`,
      testName: 'Open the account',
      testIndex: 0,
      outcome: 'passed',
      steps: values.map((value, index) => step(index, scopeKey, value)),
      filePath: 'account.spec.yaml',
    }],
  }
  new FsHandoffStore({ root: p.agentQaRoot, runId }).save(handoff)
}

function writeRecord(p: Project, runId: string, configPath: string): void {
  writeFileSync(
    join(completedRunDir(p.agentQaRoot, runId), 'run-config.json'),
    `${JSON.stringify({ schemaVersion: 1, runId, configPath })}\n`,
  )
}

// memory/index is the gitignored derived index, not committed knowledge (441 D-06, D-27).
function committedFilesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !relative(dir, file).startsWith(join('memory', 'index')))
}

function filesHolding(dir: string, text: string): string[] {
  return committedFilesUnder(dir).filter((file) =>
    file.includes(text) || readFileSync(file, 'utf8').includes(text))
}

function recordsOfRun(knowledgeRoot: string, runId: string): string[] {
  const memory = join(knowledgeRoot, 'memory')
  let scopes: string[]
  try {
    scopes = readdirSync(memory)
  } catch {
    return []
  }
  return scopes.flatMap((scope) => {
    const bundles = join(memory, scope, 'bundles')
    let names: string[]
    try {
      names = readdirSync(bundles)
    } catch {
      return []
    }
    return names
      .map((name) => join(bundles, name))
      .filter((bundle) => readFileSync(join(bundle, 'provenance.json'), 'utf8').includes(runId))
      .map((bundle) => readFileSync(join(bundle, 'record.md'), 'utf8'))
  })
}

function fakeHost(): never {
  return {
    jobs: async () => ({
      queue: {
        runNextJob: async () => ({ ran: false, reason: 'no-job' }),
        recoverAbandonedClaims: async () => ({ released: [] }),
      },
      store: { adoptEpoch: async (epoch: number) => ({ epoch }) },
      idSource: DIGEST_JOB_ID_SOURCE,
    }),
    close: async () => undefined,
  } as never
}

async function drainTail(input: {
  readonly p: Project
  readonly runId: string
  readonly configPath: string
  readonly knowledgeDir: string
  readonly chainRunId?: string
}): Promise<{ readonly warns: string[]; readonly chain?: ChainResult }> {
  const warns: string[] = []
  let bound: PostRunTailHostInput | undefined
  let chain: ChainResult | undefined
  const operations: Partial<PostRunTailOperations> = {
    composeHost: (host) => {
      bound = host
      return fakeHost()
    },
    createChipEmitter: () => ({ observe: () => undefined, finish: () => undefined }) as never,
    nudgeDaemon: async () => undefined,
    ...(input.chainRunId === undefined
      ? {}
      : {
          runCurationTail: async () => {
            chain = await bound!.curateRun({
              runId: input.chainRunId!,
              executionContext: 'local-interactive',
            })
          },
        }),
  }
  const tail = composeCliPostRunTail({
    runId: input.runId,
    configDir: input.p.root,
    configFilePath: input.configPath,
    knowledgeConfig: { dir: input.knowledgeDir },
    mask: createDeclaredSecretMask(input.configPath).mask,
    log: { warn: (message: string) => warns.push(message), info: () => undefined },
    operations,
  })
  await tail.drain()
  return { warns, ...(chain === undefined ? {} : { chain }) }
}

describe('C442-RUN-CONFIG-CURATION', () => {
  it(
    "run B's tail curates run A only under A's secrets (janitor)",
    async () => {
      const p = project({ sharedKnowledge: true })
      seedRun(p, RUN_A, SCOPE_A, [VALUE_A])
      writeRecord(p, RUN_A, p.aConfig)
      seedRun(p, RUN_B, SCOPE_B, [VALUE_B])

      await drainTail({ p, runId: RUN_B, configPath: p.bConfig, knowledgeDir: p.knowledgeDirB })

      const recordsA = recordsOfRun(p.knowledgeA, RUN_A)
      expect(recordsA.length, "run A's run was never folded").toBeGreaterThan(0)
      expect(filesHolding(p.knowledgeA, VALUE_A)).toEqual([])
      expect(recordsA.every((record) => record.includes(MARKER_A))).toBe(true)
    },
    TAIL_TIMEOUT_MS,
  )

  it(
    "run B's tail curates run A only under A's secrets (chain)",
    async () => {
      const p = project({ sharedKnowledge: true })
      seedRun(p, RUN_A, SCOPE_A, [VALUE_A])
      writeRecord(p, RUN_A, p.aConfig)
      seedRun(p, RUN_B, SCOPE_B, [VALUE_B])

      const { chain } = await drainTail({
        p,
        runId: RUN_B,
        configPath: p.bConfig,
        knowledgeDir: p.knowledgeDirB,
        chainRunId: RUN_A,
      })

      expect(chain?.complete).toBe(true)
      const recordsA = recordsOfRun(p.knowledgeA, RUN_A)
      expect(recordsA.length, "run A's run was never folded").toBeGreaterThan(0)
      expect(filesHolding(p.knowledgeA, VALUE_A)).toEqual([])
      expect(recordsA.every((record) => record.includes(MARKER_A))).toBe(true)
      expect(readCurationTailReceipt(completedRunDir(p.agentQaRoot, RUN_A))).toBeDefined()
    },
    TAIL_TIMEOUT_MS,
  )
})
