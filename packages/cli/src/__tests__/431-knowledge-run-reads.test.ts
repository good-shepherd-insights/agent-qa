// Phase 431 plan 07 (D-11/D-12/D-13): the dedicated CLI reads over their canonical ops.
//
// In-process cells drive the Commander verbs against a populated project and compare `--json` with
// the MCP `structuredContent` answered by the same composition. `runs.overview` and the document arm
// of `runs.evidence` bind through a run-detail reader; these cells hand the composition the
// shipped dashboard reader over the project's runs database. Spawned cells run the built
// `dist/cli.js`: run `pnpm build` at the repository root first.

import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { DashboardDatabase, createDashboardRunDetailReader } from '@vostride/agent-qa-dashboard'
import { generateRunId, generateTestId } from '@vostride/agent-qa-ids'
import { FsEvidenceArtifactStore, FsHandoffStore } from '@vostride/agent-qa-runner-local'
import { CURRENT_HANDOFF_SCHEMA_VERSION } from '@vostride/agent-qa-schema'
import type { CompletedRunHandoff, EvidenceDocument, PerTestOutcome } from '@vostride/agent-qa-schema'
import { Command, CommanderError } from 'commander'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { composeMcpMasking, createMcpHttpRequestListener } from '../commands/mcp.js'
import { createKnowledgeCommand } from '../commands/knowledge.js'
import { createRunsCommand } from '../commands/runs.js'
import * as host from '../composition/local-agent-host.js'
import { resolveMcpTokens } from '../composition/mcp-token-resolution.js'
import { markFixture } from '../gates/__tests__/feedback-fixture.js'
import {
  CLI_ENTRY,
  REBUILD_INSTRUCTION,
  buildFreshness,
  cleanupTempRoots,
  fixtureProject,
  spawnCollecting,
} from './conformance/spawned-chat.js'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG = Uint8Array.from(atob(PNG_BASE64), (char) => char.charCodeAt(0))
const WEBM = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, ...Array.from({ length: 96 }, (_, index) => index)])
const UNICODE_NAME = 'Café checkout — 日本語 ✓ 🧪'
const UNICODE_STEP = 'Öffne den Warenkorb 🛒 «schnell»'
const NETWORK: Extract<EvidenceDocument, { kind: 'network' }> = {
  schemaVersion: 1, kind: 'network', records: [{
    url: 'https://app.test/api/cart?q=ümlaut', method: 'GET', status: 500,
    requestHeaders: { accept: 'application/json' }, responseHeaders: { 'content-type': 'application/json' },
    body: 'cart unavailable ✗', startTime: 1, endTime: 2,
  }],
}
const CONSOLE: Extract<EvidenceDocument, { kind: 'console' }> = {
  schemaVersion: 1, kind: 'console', records: [
    { level: 'error', text: 'TypeError: price is undefined — 価格', timestamp: 3 },
    { level: 'warning', text: 'slow response', timestamp: 4 },
  ],
}
const ARIA: Extract<EvidenceDocument, { kind: 'aria' }> = {
  schemaVersion: 1, kind: 'aria', tree: '- button "Payer ✓"',
}
const READER_TOKEN = 'zz-431-07-reader-credential-5c21aa'

const cleanups: (() => void | Promise<void>)[] = []
let originalExitCode: typeof process.exitCode
let runDetailDbPath: string | undefined
const realCompose = host.composeCliLocalAgent

beforeEach(() => {
  originalExitCode = process.exitCode
  runDetailDbPath = undefined
  vi.spyOn(host, 'composeCliLocalAgent').mockImplementation((input) => {
    if (runDetailDbPath === undefined || input.runDetail !== undefined) return realCompose(input)
    const db = new DashboardDatabase({ dbPath: runDetailDbPath })
    const composed = realCompose({ ...input, runDetail: createDashboardRunDetailReader(db) })
    const close = composed.close.bind(composed)
    return Object.assign(composed, {
      close: () => {
        try { return close() } finally { db.close() }
      },
    })
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  process.exitCode = originalExitCode
  for (const close of cleanups.splice(0).reverse()) await close()
  cleanupTempRoots()
})

// ---- The populated project ------------------------------------------------------------------------

function populatedProject() {
  const f = markFixture()
  cleanups.push(() => rmSync(f.root, { recursive: true, force: true }))
  writeFileSync(join(f.root, 'hooks.yaml'), 'hooks: []\n')
  writeFileSync(join(f.root, '.env'), '')
  writeFileSync(join(f.root, '.env.secrets.local'), '')
  mkdirSync(join(f.root, 'tests'), { recursive: true })
  mkdirSync(join(f.root, 'suites'), { recursive: true })

  const runId = String(f.handoff.runId)
  const recordId = String(f.published.id)
  const first = f.handoff.tests[0]!
  first.testName = UNICODE_NAME
  first.steps[0]!.stepText = UNICODE_STEP
  Object.assign(first.steps[0]!, { retrievalTrace: {
    schemaVersion: 1, servedLines: [{ recordId, leg: 'lexical', rank: 1, score: 1.5 }], truncated: [],
  } })
  const second = structuredClone(first)
  second.testId = generateTestId() as PerTestOutcome['testId']
  second.testIndex = 1
  second.testName = 'Second member'
  second.outcome = 'passed'
  Object.assign(second.steps[0]!, { retrievalTrace: {
    schemaVersion: 1, servedLines: [{ recordId, leg: 'dense', rank: 2, score: 0.25 }], truncated: [],
  } })
  f.handoff.tests.push(second)
  f.save()

  const blobs = new FsEvidenceArtifactStore({ root: f.agentQaRoot, runId: f.handoff.runId })
  const screenshot = blobs.persistDecisionScreenshot(PNG)
  const recording = blobs.persistDecisionScreenshot(WEBM)
  const networkRef = blobs.persistEvidenceDocument(NETWORK)
  const consoleRef = blobs.persistEvidenceDocument(CONSOLE)
  const ariaRef = blobs.persistEvidenceDocument(ARIA)
  const dbPath = join(f.agentQaRoot, 'runs.db')
  const db = new DashboardDatabase({ dbPath })
  db.insertRun({ id: runId, name: 'Discovery fixture', status: 'failed', duration: 1,
    startedAt: new Date(0).toISOString(), endedAt: new Date(1).toISOString() })
  db.upsertRunMember({ runId, testIndex: 0, testId: first.testId, name: UNICODE_NAME, totalSteps: 1,
    outcome: 'failed', recording: {
      state: 'present', ref: { id: `recording:${recording.sha}`, sha: recording.sha },
      contentType: 'video/webm', byteLength: WEBM.length,
    } })
  db.upsertRunMember({ runId, testIndex: 1, testId: second.testId, name: 'Second member', totalSteps: 1,
    outcome: 'passed', recording: { state: 'absent', reason: 'not-captured' } })
  db.insertRunStep({
    runId, testIndex: 0, stepIndex: 0, stepText: UNICODE_STEP, cacheStatus: 'miss',
    verifierVerdict: null, selfHealOccurred: false, briefDigest: '', status: 'failed',
    evidence: {
      console: { kind: 'console', state: 'present', ref: consoleRef as never, counts: { total: 2, errors: 1, warnings: 1 } },
      network: { kind: 'network', state: 'present', ref: networkRef as never, counts: { total: 1, failed: 1, errored: 0 } },
      a11y: { kind: 'a11y', state: 'absent', reason: 'unsupported' },
      variables: { kind: 'variables', state: 'absent', reason: 'empty' },
    },
  })
  db.insertRunStep({
    runId, testIndex: 1, stepIndex: 0, stepText: 'Second step', cacheStatus: 'hit',
    verifierVerdict: null, selfHealOccurred: false, briefDigest: '', status: 'passed',
    evidence: {
      console: { kind: 'console', state: 'absent', reason: 'empty' },
      network: { kind: 'network', state: 'absent', reason: 'empty' },
      a11y: { kind: 'a11y', state: 'absent', reason: 'unsupported' },
      variables: { kind: 'variables', state: 'absent', reason: 'empty' },
    },
  })
  db.insertRunSubAction({
    runId, testIndex: 0, stepIndex: 0, subActionIndex: 0, plan: 'click Pay', plannedAction: {},
    result: {}, screenStateHash: 'h0', artifactRefs: [screenshot, ariaRef],
    ariaEvidence: { kind: 'aria', state: 'present', ref: ariaRef as never },
  })
  db.close()
  runDetailDbPath = dbPath
  return {
    ...f, runId, recordId, dbPath, firstTestId: String(first.testId), secondTestId: String(second.testId),
    screenshotSha: screenshot.sha, recordingSha: recording.sha,
  }
}

type Project = ReturnType<typeof populatedProject>

function completedRun(agentQaRoot: string, endedAt: number, tests: { id: string; name: string }[],
  verdict: CompletedRunHandoff['aggregateVerdict'] = 'passed'): string {
  const runId = generateRunId()
  const handoff: CompletedRunHandoff = {
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION,
    runId: runId as CompletedRunHandoff['runId'],
    scope: { tier: 'product', key: 'shop' },
    buildOrdinal: 1,
    executionContext: 'local-headless',
    aggregateVerdict: verdict,
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: endedAt - 50,
    endedAt,
    tests: tests.map((test, testIndex) => ({
      testId: test.id, testName: test.name, filePath: `tests/${test.id}.yaml`, testIndex,
      outcome: verdict === 'passed' ? 'passed' : 'failed', steps: [],
    }) as PerTestOutcome),
  }
  new FsHandoffStore({ root: agentQaRoot, runId }).save(handoff)
  return runId
}

// ---- Drivers --------------------------------------------------------------------------------------

interface Invocation {
  stdout: string
  stderr: string
  exitCode: number
}

function allCommands(command: Command): Command[] {
  return [command, ...command.commands.flatMap(allCommands)]
}

async function cli(configPath: string, args: readonly string[]): Promise<Invocation> {
  const stdout: string[] = []
  const stderr: string[] = []
  const log = vi.spyOn(console, 'log').mockImplementation((...values: unknown[]) => {
    stdout.push(values.map(String).join(' '))
  })
  const error = vi.spyOn(console, 'error').mockImplementation((...values: unknown[]) => {
    stderr.push(values.map(String).join(' '))
  })
  process.exitCode = undefined
  const program = new Command()
    .option('--config <path>', 'config file path')
    .addCommand(createRunsCommand())
    .addCommand(createKnowledgeCommand())
  for (const command of allCommands(program)) {
    command.exitOverride().configureOutput({
      writeOut: (text) => { stdout.push(text) },
      writeErr: (text) => { stderr.push(text) },
    })
  }
  let exitCode: number
  try {
    await program.parseAsync(['node', 'agent-qa', '--config', configPath, ...args])
    exitCode = Number(process.exitCode ?? 0)
  } catch (thrown) {
    if (!(thrown instanceof CommanderError)) throw thrown
    exitCode = thrown.exitCode
  } finally {
    log.mockRestore()
    error.mockRestore()
    process.exitCode = undefined
  }
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n'), exitCode }
}

function json(invocation: Invocation): unknown {
  expect(invocation.exitCode, invocation.stderr).toBe(0)
  return JSON.parse(invocation.stdout) as unknown
}

type WireResult = {
  readonly content: readonly { type: string; text?: string; data?: string }[]
  readonly structuredContent?: unknown
  readonly isError?: boolean
}

async function mcpReader(p: { configPath: string; agentQaRoot: string }) {
  const composed = host.composeCliLocalAgent({ configPath: p.configPath, agentQaRoot: p.agentQaRoot })
  cleanups.push(() => composed.close())
  const declarations = [{ name: 'reader', tokenEnvVar: 'AGENT_QA_431_07_READER', scopes: ['read' as const] }]
  const tokens = resolveMcpTokens(declarations, { AGENT_QA_431_07_READER: READER_TOKEN })
  const masking = composeMcpMasking({ tokens, env: {} })
  const server = createServer(createMcpHttpRequestListener({
    registry: composed.registry, tokens, maskText: (text) => masking.mask(text),
  }))
  await new Promise<void>((listening, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', listening)
  })
  cleanups.push(() => new Promise<void>((closed) => server.close(() => closed())))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('MCP did not bind')
  const client = new Client({ name: 'agent-qa-431-07', version: '0.0.0' })
  cleanups.push(() => client.close())
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${String(address.port)}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${READER_TOKEN}` } },
  }))
  return {
    async call(name: string, args: Record<string, unknown>): Promise<WireResult> {
      return await client.callTool({ name, arguments: args }) as unknown as WireResult
    },
    async structured(name: string, args: Record<string, unknown>): Promise<unknown> {
      const result = await client.callTool({ name, arguments: args }) as unknown as WireResult
      const text = result.content.map((block) => block.text ?? '').join('\n')
      expect(result.isError ?? false, text.slice(0, 400)).toBe(false)
      return result.structuredContent
    },
  }
}

/** The SDK wraps a non-object root as `{ result }` on the wire; the op's own value is inside. */
function unwrapped(structured: unknown): unknown {
  const value = structured as { result?: unknown }
  return Array.isArray(value?.result) ? value.result : structured
}

// ---- CLI-RUN-READ-PARITY (07-1) -------------------------------------------------------------------

describe('CLI-RUN-READ-PARITY: runs list, overview and knowledge', () => {
  it('runs list --json equals the MCP list for zero, one and many rows', async () => {
    const empty = fixtureProject('431-07-empty')
    const emptyRoot = join(empty.root, '.agent-qa')
    const emptyMcp = await mcpReader({ configPath: empty.configPath, agentQaRoot: emptyRoot })
    expect(json(await cli(empty.configPath, ['runs', 'list', '--json']))).toEqual([])
    expect(unwrapped(await emptyMcp.structured('agent_qa_list_runs', {}))).toEqual([])
    const emptyHuman = await cli(empty.configPath, ['runs', 'list'])
    expect(emptyHuman.exitCode).toBe(0)
    expect(emptyHuman.stdout).toContain('No completed runs')

    const p = populatedProject()
    const mcp = await mcpReader(p)
    const one = json(await cli(p.configPath, ['runs', 'list', '--json']))
    expect(one).toEqual(unwrapped(await mcp.structured('agent_qa_list_runs', {})))
    expect(one).toMatchObject([{ runId: p.runId, tests: [{ testName: UNICODE_NAME }, { testName: 'Second member' }] }])

    const many = fixtureProject('431-07-many')
    const manyRoot = join(many.root, '.agent-qa')
    const written = [1, 2, 3].map((index) => completedRun(manyRoot, 1_700_000_000_000 + index * 1_000,
      [{ id: `t-${String(index)}`, name: `Checkout ${String(index)}` }], index === 2 ? 'failed' : 'passed'))
    const manyMcp = await mcpReader({ configPath: many.configPath, agentQaRoot: manyRoot })
    const listed = json(await cli(many.configPath, ['runs', 'list', '--json'])) as { runId: string }[]
    expect(listed.map((row) => row.runId)).toEqual([...written].reverse())
    expect(listed).toEqual(unwrapped(await manyMcp.structured('agent_qa_list_runs', {})))
  })

  it('normalizes every list flag into the canonical filter the MCP tool takes', async () => {
    const many = fixtureProject('431-07-flags')
    const root = join(many.root, '.agent-qa')
    const old = completedRun(root, Date.UTC(2026, 0, 1, 12), [{ id: 't-cart', name: 'Cart totals' }], 'failed')
    const recent = completedRun(root, Date.UTC(2026, 5, 1, 12), [{ id: 't-pay', name: 'Pay now' }], 'failed')
    completedRun(root, Date.UTC(2026, 5, 2, 12), [{ id: 't-pay', name: 'Pay now' }], 'passed')
    const mcp = await mcpReader({ configPath: many.configPath, agentQaRoot: root })
    const cases: [string[], Record<string, unknown>][] = [
      [['--verdict', 'failed'], { verdict: 'failed' }],
      [['--test', 'cart'], { test: 'cart' }],
      [['--target', 'web'], { target: 'web' }],
      [['--since', '2026-03-01T00:00:00+02:00'], { since: Date.UTC(2026, 1, 28, 22) }],
      [['--since', '2026-06-01T12:00:00.000Z'], { since: Date.UTC(2026, 5, 1, 12) }],
      [['--limit', '1'], { limit: 1 }],
      [['--verdict', 'failed', '--since', '2026-01-01T12:00:00Z', '--limit', '1'],
        { verdict: 'failed', since: Date.UTC(2026, 0, 1, 12), limit: 1 }],
    ]
    for (const [flags, input] of cases) {
      const listed = json(await cli(many.configPath, ['runs', 'list', ...flags, '--json']))
      expect(listed, flags.join(' ')).toEqual(unwrapped(await mcp.structured('agent_qa_list_runs', input)))
    }
    const failed = json(await cli(many.configPath, ['runs', 'list', '--verdict', 'failed', '--limit', '1', '--json']))
    expect((failed as { runId: string }[]).map((row) => row.runId)).toEqual([recent])
    const cart = json(await cli(many.configPath, ['runs', 'list', '--test', 'CART', '--json']))
    expect((cart as { runId: string }[]).map((row) => row.runId)).toEqual([old])
  })

  it.each([
    ['--since', '2026-03-01T00:00:00'],
    ['--since', '2026-03-01'],
    ['--since', '2026-02-30T00:00:00Z'],
    ['--since', '2026-03-01T24:00:00Z'],
    ['--since', '2026-03-01T00:00:60Z'],
    ['--since', '1969-12-31T23:59:59Z'],
    ['--since', '2026-03-01T00:00:00.1234Z'],
    ['--since', '1709251200000'],
    ['--limit', '0'],
    ['--limit', '201'],
    ['--limit', '1.5'],
    ['--verdict', 'flaky'],
    ['--test', '   '],
  ])('refuses %s %s with an actionable nonzero exit', async (flag, value) => {
    const project = fixtureProject('431-07-refuse')
    const refused = await cli(project.configPath, ['runs', 'list', flag, value, '--json'])
    expect(refused.exitCode).not.toBe(0)
    expect(refused.stdout).toBe('')
    expect(refused.stderr).toContain(flag)
  })

  it('renders list rows with the run id and test addresses the next command takes', async () => {
    const p = populatedProject()
    const human = await cli(p.configPath, ['runs', 'list'])
    expect(human.exitCode).toBe(0)
    expect(human.stdout).toContain(p.runId)
    expect(human.stdout).toContain(`test 0 · ${p.firstTestId} · ${UNICODE_NAME}`)
    expect(human.stdout).toContain(`test 1 · ${p.secondTestId} · Second member`)
    expect(human.stdout).toContain(`agent-qa runs overview ${p.runId}`)
  })

  it('runs overview --json equals agent_qa_get_run_overview and keeps Unicode unchanged', async () => {
    const p = populatedProject()
    const mcp = await mcpReader(p)
    const overview = json(await cli(p.configPath, ['runs', 'overview', p.runId, '--json']))
    expect(overview).toEqual(await mcp.structured('agent_qa_get_run_overview', { runId: p.runId }))
    expect(overview).toMatchObject({
      runId: p.runId,
      tests: [
        { testIndex: 0, testId: p.firstTestId, name: { text: UNICODE_NAME },
          recording: { state: 'present', address: { runId: p.runId, sha: p.recordingSha } },
          steps: [{ stepIndex: 0, label: { text: UNICODE_STEP }, status: 'failed',
            capture: { state: 'recorded', screenshots: [{ sha: p.screenshotSha }] } }] },
        { testIndex: 1, testId: p.secondTestId },
      ],
    })
  })

  it('renders the overview as addressed lines and names the next fetch', async () => {
    const p = populatedProject()
    const human = await cli(p.configPath, ['runs', 'overview', p.runId])
    expect(human.exitCode, human.stderr).toBe(0)
    const out = human.stdout
    expect(out).toContain(`Run ${p.runId}`)
    expect(out).toContain(`Test 0 · ${p.firstTestId} · ${UNICODE_NAME} · failed`)
    expect(out).toContain(`Test 1 · ${p.secondTestId} · Second member · passed`)
    expect(out).toContain(`step 0 · ${UNICODE_STEP} · failed`)
    expect(out).toContain(`screenshot ${p.screenshotSha}`)
    expect(out).toContain(`recording ${p.recordingSha}`)
    expect(out).toContain('console 2 (1 error)')
    expect(out).toContain('network 1 (1 failed)')
    expect(out).toContain('aria sub-action 0')
    expect(out).toContain(p.recordId)
    expect(out).toContain(`agent-qa runs evidence ${p.runId} --test 0 --step 0 --kind console`)
    expect(out).toContain(`agent-qa runs evidence ${p.runId} --screenshot ${p.screenshotSha} --out`)
    expect(out).toContain(`agent-qa knowledge brief-why ${p.runId} --step 0 --test ${p.firstTestId}`)
    expect(out).not.toContain('TypeError: price is undefined')
  })

  it('runs knowledge --json equals agent_qa_get_run_knowledge and renders step addresses', async () => {
    const p = populatedProject()
    const mcp = await mcpReader(p)
    const knowledge = json(await cli(p.configPath, ['runs', 'knowledge', p.runId, '--json']))
    expect(knowledge).toEqual(await mcp.structured('agent_qa_get_run_knowledge', { runId: p.runId }))
    expect(knowledge).toMatchObject({ kind: 'ready', runId: p.runId, steps: [{ stepText: UNICODE_STEP }, {}] })
    const human = await cli(p.configPath, ['runs', 'knowledge', p.runId])
    expect(human.exitCode, human.stderr).toBe(0)
    expect(human.stdout).toContain(`test 0 · ${p.firstTestId} · step 0 · ${UNICODE_STEP}`)
    expect(human.stdout).toContain(`test 1 · ${p.secondTestId} · step 0`)
    expect(human.stdout).toContain(p.recordId)
    expect(human.stdout).toContain(`agent-qa knowledge show ${p.recordId}`)
  })

  it('exits nonzero with an actionable message for a missing run on overview and knowledge', async () => {
    const p = populatedProject()
    const missing = generateRunId()
    const overview = await cli(p.configPath, ['runs', 'overview', missing, '--json'])
    expect(overview.exitCode).toBe(1)
    expect(overview.stdout).toBe('')
    expect(overview.stderr).toContain(missing)
    expect(overview.stderr).toContain('agent-qa runs list')
    const knowledge = await cli(p.configPath, ['runs', 'knowledge', missing, '--json'])
    expect(knowledge.exitCode).toBe(1)
    expect(JSON.parse(knowledge.stdout)).toEqual({ kind: 'evidence-incomplete', runId: missing })
    expect(knowledge.stderr).toContain('agent-qa runs list')
    const human = await cli(p.configPath, ['runs', 'knowledge', missing])
    expect(human.exitCode).toBe(1)
    expect(human.stdout).toContain(missing)
  })

  it('leaves runs mark registered with its shipped options', () => {
    const runs = createRunsCommand()
    const mark = runs.commands.find((command) => command.name() === 'mark')
    expect(mark?.options.map((option) => option.long)).toEqual([
      '--kind', '--test', '--step', '--note', '--corrected-expectation', '--corrected-action', '--json',
    ])
    expect(runs.commands.map((command) => command.name())).toEqual(
      expect.arrayContaining(['mark', 'list', 'overview', 'knowledge']))
  })
})

// ---- CLI-KNOWLEDGE-PARITY (07-2) ------------------------------------------------------------------

describe('CLI-KNOWLEDGE-PARITY: knowledge show and brief-why', () => {
  it('knowledge show --json equals agent_qa_show_knowledge_record and renders provenance, not the body', async () => {
    const p = populatedProject()
    const mcp = await mcpReader(p)
    const shown = json(await cli(p.configPath, ['knowledge', 'show', p.recordId, '--json']))
    const structured = await mcp.structured('agent_qa_show_knowledge_record', { recordId: p.recordId })
    expect(shown).toEqual(structured)
    expect(shown).toMatchObject({ kind: 'found', record: { recordId: p.recordId } })
    const found = shown as { body: string; summary: string; provenance: { mode: string } }
    const human = await cli(p.configPath, ['knowledge', 'show', p.recordId])
    expect(human.exitCode, human.stderr).toBe(0)
    expect(human.stdout).toContain(`record ${p.recordId}`)
    expect(human.stdout).toContain(`provenance ${found.provenance.mode}`)
    expect(human.stdout).toContain(found.summary)
    expect(found.body.length).toBeGreaterThan(0)
    expect(human.stdout).not.toContain(found.body)
  })

  it('knowledge show exits nonzero for a record no bundle carries, with the canonical not-found result', async () => {
    const p = populatedProject()
    const mcp = await mcpReader(p)
    const missing = await cli(p.configPath, ['knowledge', 'show', 'fact-no-such-record', '--json'])
    expect(missing.exitCode).toBe(1)
    expect(JSON.parse(missing.stdout)).toEqual(
      await mcp.structured('agent_qa_show_knowledge_record', { recordId: 'fact-no-such-record' }))
    expect(missing.stderr).toContain('fact-no-such-record')
    expect(missing.stderr).toContain('agent-qa knowledge inspect')
    const human = await cli(p.configPath, ['knowledge', 'show', 'fact-no-such-record'])
    expect(human.exitCode).toBe(1)
    expect(human.stdout).toContain('not found')
  })

  it('brief-why selects the brief by test id, equals agent_qa_explain_brief and keeps the trace in JSON', async () => {
    const p = populatedProject()
    const mcp = await mcpReader(p)
    const first = json(await cli(p.configPath, ['knowledge', 'brief-why', p.runId, '--step', '0', '--test', p.firstTestId, '--json']))
    expect(first).toEqual(await mcp.structured('agent_qa_explain_brief', { runId: p.runId, stepIndex: 0, testId: p.firstTestId }))
    expect(first).toMatchObject({ kind: 'answered', trace: { servedLines: [{ recordId: p.recordId, leg: 'lexical', rank: 1 }] } })
    const second = json(await cli(p.configPath, ['knowledge', 'brief-why', p.runId, '--step', '0', '--test', p.secondTestId, '--json']))
    expect(second).toEqual(await mcp.structured('agent_qa_explain_brief', { runId: p.runId, stepIndex: 0, testId: p.secondTestId }))
    expect(second).toMatchObject({ kind: 'answered', trace: { servedLines: [{ recordId: p.recordId, leg: 'dense', rank: 2 }] } })
    const filtered = json(await cli(p.configPath, [
      'knowledge', 'brief-why', p.runId, '--step', '0', '--test', p.firstTestId, '--record', 'fact-elsewhere', '--json']))
    expect(filtered).toEqual(await mcp.structured('agent_qa_explain_brief',
      { runId: p.runId, stepIndex: 0, testId: p.firstTestId, recordId: 'fact-elsewhere' }))
    expect(filtered).toMatchObject({ kind: 'answered', trace: { servedLines: [], truncated: [] } })

    const human = await cli(p.configPath, ['knowledge', 'brief-why', p.runId, '--step', '0', '--test', p.firstTestId])
    expect(human.exitCode, human.stderr).toBe(0)
    expect(human.stdout).toContain(`run ${p.runId} · test ${p.firstTestId} · step 0`)
    expect(human.stdout).toContain(`served ${p.recordId} · lexical · rank 1 · score 1.5`)
    expect(human.stdout).toContain(`agent-qa knowledge show ${p.recordId}`)
  })

  it('brief-why treats --test as a test id, never an index, and refuses an ambiguous step', async () => {
    const p = populatedProject()
    const byIndex = await cli(p.configPath, ['knowledge', 'brief-why', p.runId, '--step', '0', '--test', '1', '--json'])
    expect(byIndex.exitCode).toBe(1)
    expect(JSON.parse(byIndex.stdout)).toEqual({ kind: 'no-trace', reason: 'step-not-found' })
    expect(byIndex.stderr).toContain('agent-qa runs overview')
    const ambiguous = await cli(p.configPath, ['knowledge', 'brief-why', p.runId, '--step', '0', '--json'])
    expect(ambiguous.exitCode).toBe(1)
    expect(ambiguous.stdout).toBe('')
    expect(ambiguous.stderr).toContain(p.firstTestId)
    expect(ambiguous.stderr).toContain(p.secondTestId)
    expect(ambiguous.stderr).toContain('--test')
  })

  it('brief-why exits nonzero for a missing run and a missing step', async () => {
    const p = populatedProject()
    const mcp = await mcpReader(p)
    const missingRun = generateRunId()
    const run = await cli(p.configPath, ['knowledge', 'brief-why', missingRun, '--step', '0', '--json'])
    expect(run.exitCode).toBe(1)
    expect(JSON.parse(run.stdout)).toEqual(await mcp.structured('agent_qa_explain_brief', { runId: missingRun, stepIndex: 0 }))
    expect(JSON.parse(run.stdout)).toEqual({ kind: 'no-trace', reason: 'artifact-missing' })
    const step = await cli(p.configPath, ['knowledge', 'brief-why', p.runId, '--step', '7', '--test', p.firstTestId])
    expect(step.exitCode).toBe(1)
    expect(step.stdout).toContain('step-not-found')
  })

  it.each(['-1', '1.5', 'abc', '9007199254740993'])('brief-why refuses --step %s', async (value) => {
    const p = populatedProject()
    const refused = await cli(p.configPath, ['knowledge', 'brief-why', p.runId, '--step', value, '--json'])
    expect(refused.exitCode).not.toBe(0)
    expect(refused.stdout).toBe('')
    expect(refused.stderr).toContain('--step')
  })

  it('requires --step on brief-why', async () => {
    const p = populatedProject()
    const refused = await cli(p.configPath, ['knowledge', 'brief-why', p.runId, '--json'])
    expect(refused.exitCode).not.toBe(0)
    expect(refused.stderr).toContain('--step')
  })
})

// ---- The built CLI --------------------------------------------------------------------------------

describe('BUILT-CLI-RUN-READS: the shipped binary answers the run reads', () => {
  beforeAll(() => {
    expect(buildFreshness(), REBUILD_INSTRUCTION).toEqual({ missing: [], stale: [] })
  })

  it('lists and reads a completed run through dist/cli.js', async () => {
    const p = populatedProject()
    const listed = await spawnCollecting(p.root, [CLI_ENTRY, '--config', p.configPath, 'runs', 'list', '--json'])
    expect(listed.stderr).toBe('')
    expect(listed.code).toBe(0)
    expect((JSON.parse(listed.stdout) as { runId: string }[]).map((row) => row.runId)).toEqual([p.runId])
    const knowledge = await spawnCollecting(p.root, [CLI_ENTRY, '--config', p.configPath, 'runs', 'knowledge', p.runId, '--json'])
    expect(knowledge.code, knowledge.stderr).toBe(0)
    expect(JSON.parse(knowledge.stdout)).toMatchObject({ kind: 'ready', runId: p.runId })
    const missing = await spawnCollecting(p.root, [CLI_ENTRY, '--config', p.configPath, 'runs', 'overview', generateRunId()])
    expect(missing.code).toBe(1)
    expect(missing.stdout).toBe('')
  }, 60_000)
})
