import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { chainJobIdsForRun, invokeFunction } from '@vostride/agent-qa-agent'
import {
  buildRunMaskingContext, composeLocalAgent, DIGEST_JOB_ID_SOURCE,
  resolveMaskingHostKey, writeMaskingDigests,
} from '@vostride/agent-qa-agent-local'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { generateRunId, generateTestId } from '@vostride/agent-qa-ids'
import { resolveAuthStatePaths, writeAuthStateFiles } from '@vostride/agent-qa-core'
import { HANDOFF_FILE, RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import {
  CURRENT_HANDOFF_SCHEMA_VERSION, CurationSnapshotSchema, maskedMarker, sha256hex,
} from '@vostride/agent-qa-schema'
import type { CurationSnapshot, PostProcessingStatus } from '@vostride/agent-qa-schema'
import { getActiveAuditSink, getActiveExecutionContext, getActiveMaskingContext } from '@vostride/agent-qa-safety'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import type { MaskingContext } from '@vostride/agent-qa-schema'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent, createColdReadMaskingSources } from '../local-agent-host.js'
import { createDisplayUnmasker } from '../display-unmask.js'
import { resolveConfig } from '../../config.js'

const roots: string[] = []
const hosts: LocalAgentHost[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function storeOf(values: Record<string, string>) {
  return { forEachSecret(cb: (name: string, value: string) => void) {
    for (const [name, value] of Object.entries(values)) cb(name, value)
  } }
}

function project() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-423-cold-read-'))
  roots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  const agentQaRoot = join(root, '.agent-qa')
  const secretFile = join(root, '.env.secrets.local')
  const config = {
    workspace: { testMatch: ['tests/**/*.yaml'], suiteMatch: ['suites/**/*.yaml'],
      hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: '.env.secrets.local' },
    knowledge: { dir: 'agent-qa-knowledge', commitArtifacts: 'none' },
    registry: { llms: [{ name: 'unused', provider: 'openai-compatible', model: 'unused',
      baseURL: 'http://127.0.0.1:1/v1' }],
      targets: { local: { platform: 'web', url: 'http://127.0.0.1:1' } } },
    use: { llm: 'unused', mobile: { appState: 'preserve' } },
  }
  writeFileSync(configPath, JSON.stringify(config))
  writeFileSync(secretFile, '')
  return { root, configPath, agentQaRoot, secretFile, config, runId: generateRunId() }
}

function snapshot(runId: string, evidenceTokens = [sha256hex('first-event'), sha256hex('second-event')]) {
  return CurationSnapshotSchema.parse({
    schemaVersion: 1,
    rows: [{ recordId: 'confirmed-record', bucket: 'confirmed',
      changes: evidenceTokens.map((evidenceToken, index) => ({ bucket: 'confirmed', change: {
        schemaVersion: 1, recordId: 'confirmed-record', change: 'confirmed', atOrdinal: 1,
        evidenceToken, sourceRunId: runId,
        observationId: index === 0 ? `${runId}:test0:step0` : `knowledge-port:${sha256hex('port-event')}`,
      } })),
    }],
    breakdown: { added: 0, confirmed: 1, superseded: 0, deprecated: 0, proposed: 0 },
  })
}

async function publish(p: ReturnType<typeof project>, completed?: CurationSnapshot) {
  await resolveConfig({ configPath: p.configPath, loadAuthPlugins: false })
  const writer = composeLocalAgent({
    agentQaRoot: p.agentQaRoot,
    mintQuarantineIdentityPath: path => path,
    config: { getMasked: async () => ({ schemaVersion: 1, configPath: p.configPath, entries: [] }) },
    knowledgeRoot: () => join(p.root, 'agent-qa-knowledge'),
    model: () => ({ modelId: 'never-called', generate: async () => { throw new Error('unexpected model') } }),
    postRun: { candidateProse: 'masker-active', curateRun: async () => ({
      curated: 7, deprecated: 3, complete: true,
      ...(completed === undefined ? {} : { snapshot: completed }),
    }) },
  })
  hosts.push(writer)
  const jobs = await writer.jobs()
  const fence = await jobs.store.adoptEpoch(1)
  const ids = chainJobIdsForRun(p.runId, DIGEST_JOB_ID_SOURCE)
  await jobs.queue.enqueue('curate-memory', { runId: p.runId }, `${ids.analyzeRun}->curate-memory`)
  expect(await jobs.queue.runNextJob({ fence })).toMatchObject({ ran: true, disposition: 'completed' })
  await writer.close()
  hosts.splice(hosts.indexOf(writer), 1)
  const runDir = join(p.agentQaRoot, RUNS_SUBDIR, slugBranch(p.runId))
  mkdirSync(runDir, { recursive: true })
  writeFileSync(join(runDir, HANDOFF_FILE), JSON.stringify({
    schemaVersion: CURRENT_HANDOFF_SCHEMA_VERSION, runId: p.runId,
    scope: { tier: 'product', key: 'cold-read' }, buildOrdinal: 1,
    executionContext: 'local-headless', aggregateVerdict: 'passed',
    configDigests: { suiteConfigDigest: 'suite', testConfigDigest: 'test' },
    startedAt: 1, endedAt: 2, tests: [],
  }))
}

function cold(p: ReturnType<typeof project>, retained: () => Iterable<ReturnType<typeof storeOf>> = () => []) {
  const input = { agentQaRoot: p.agentQaRoot, configPath: p.configPath, maskingSecretStores: retained }
  const host = composeCliLocalAgent(input)
  hosts.push(host)
  vi.spyOn(host, 'jobs').mockImplementation(async () => { throw new Error('cold read opened jobs') })
  return {
    host,
    read: () => invokeFunction(
      host.registry, 'runs.postprocessing', { runId: p.runId }, CLI_FUNCTION_CALLER,
    ) as Promise<PostProcessingStatus>,
  }
}

describe('Wave 18 cold read masking recovery', () => {
  it('COLD-AUTH masks configured single and suite auth-only values while preserving two checkpoint events', async () => {
    const p = project()
    const testId = generateTestId()
    mkdirSync(join(p.root, 'tests'))
    mkdirSync(join(p.root, 'suites'))
    writeFileSync(join(p.root, 'tests', 'auth.yaml'), JSON.stringify({
      'test-id': testId, name: 'Auth read', target: 'local', steps: ['Inspect page'],
      use: { authState: 'single-session' },
    }))
    const suiteTestId = generateTestId()
    writeFileSync(join(p.root, 'tests', 'suite-member.yaml'), JSON.stringify({
      'test-id': suiteTestId, name: 'Suite member', target: 'local', steps: ['Inspect page'],
    }))
    writeFileSync(join(p.root, 'suites', 'auth.yaml'), JSON.stringify({
      name: 'Auth suite', target: 'local', tests: [{ test: '../tests/suite-member.yaml', id: suiteTestId }],
      use: { authState: 'suite-session' },
    }))
    const single = 'synthetic-single-cookie-value'
    const suite = 'synthetic-suite-storage-value'
    for (const [stateName, payload] of [
      ['single-session', { cookies: [{ name: 'session', value: single }], origins: [] }],
      ['suite-session', { cookies: [], origins: [{ origin: 'http://127.0.0.1:1',
        localStorage: [{ name: 'token', value: suite }] }] }],
    ] as const) {
      await writeAuthStateFiles(resolveAuthStatePaths({ configDir: p.root,
        targetName: 'local', stateName, target: { platform: 'web' } }), {
        payload, metadata: { version: 1, kind: 'web', target: 'local', name: stateName,
          capturedAt: '2026-09-14T00:00:00.000Z' },
      })
    }
    await publish(p, snapshot(p.runId, [`first ${single}`, `second ${suite}`]))
    const read = cold(p)
    const result = await read.read()
    expect(result.curationSnapshot!.rows[0]!.changes.map(row => row.change.evidenceToken))
      .toEqual([`first ${maskedMarker('secret')}`, `second ${maskedMarker('secret')}`])
    expect(result.curationSnapshot!.rows[0]!.changes).toHaveLength(2)
    await expect(invokeFunction(read.host.registry, 'runs.knowledge', { runId: p.runId }, CLI_FUNCTION_CALLER))
      .resolves.toMatchObject({ kind: 'ready', curation: { status: 'done' } })
    expect(read.host.jobs).not.toHaveBeenCalled()
  })

  it('COLD-TWO-EVENTS reads one confirmed record with both actual checkpoint events intact', async () => {
    const p = project()
    const recorded = snapshot(p.runId)
    await publish(p, recorded)
    expect(getActiveMaskingContext()).toBeUndefined()
    const read = cold(p)
    await expect(read.read()).resolves.toMatchObject({ curationSnapshot: recorded })
    expect(read.host.jobs).not.toHaveBeenCalled()
    expect(getActiveMaskingContext()).toBeUndefined()
  })

  it('COLD-KNOWLEDGE keeps the nested checkpoint read successful on the same cold registry', async () => {
    const p = project()
    await publish(p, snapshot(p.runId))
    const read = cold(p)
    await expect(invokeFunction(read.host.registry, 'runs.knowledge', { runId: p.runId }, CLI_FUNCTION_CALLER))
      .resolves.toMatchObject({ kind: 'ready', curation: { status: 'done' } })
    expect(read.host.jobs).not.toHaveBeenCalled()
  })

  it('COLD-ROTATION preserves historical tokens while newly masked text cannot restore through their indices', async () => {
    const p = project()
    const historical = 'historical-retained-value'
    const current = 'current-configured-value'
    const old = buildRunMaskingContext({ secretStore: storeOf({ OLD: historical }), env: {} })
    writeMaskingDigests({ root: p.agentQaRoot, runId: p.runId, key: resolveMaskingHostKey(p.agentQaRoot),
      entries: old.snapshotRegistered().map(({ placeholder, value }) => ({ placeholder, value })) })
    old.dispose()
    writeFileSync(p.secretFile, `CURRENT=${current}\n`)
    const original = `historical <SECRET_0> fresh ${current}`
    await publish(p, snapshot(p.runId, [original]))
    const read = cold(p, () => [storeOf({ OLD: historical })])
    const result = await read.read()
    const token = result.curationSnapshot!.rows[0]!.changes[0]!.change.evidenceToken!
    expect(token).toBe(`historical <SECRET_0> fresh ${maskedMarker('secret')}`)
    const display = createDisplayUnmasker({ agentQaRoot: p.agentQaRoot,
      secretStores: () => [storeOf({ CURRENT: current, OLD: historical })], env: () => ({}),
      authStatePayloads: () => [] })
    expect(display(token, { runId: p.runId })).toBe(`historical ${historical} fresh ${maskedMarker('secret')}`)
  })

  it('COLD-HISTORICAL retains absent snapshot and missing-directory behavior with unavailable sources', async () => {
    const p = project()
    rmSync(p.secretFile)
    const read = cold(p)
    expect(await read.read()).not.toHaveProperty('curationSnapshot')
    expect(existsSync(join(p.agentQaRoot, 'agent-jobs.db'))).toBe(false)
    expect(existsSync(join(p.agentQaRoot, 'job-checkpoints'))).toBe(false)
    await publish(p)
    expect(await read.read()).not.toHaveProperty('curationSnapshot')
  })

  it('COLD-SOURCES rereads configured, retained and sensitive environment seeds without mutating stores', async () => {
    const p = project()
    const configured = 'configured-first-value'
    const rotated = 'configured-second-value'
    const retained = { TOKEN: 'retained-runtime-value' }
    const envValue = 'environment-sensitive-value'
    vi.stubEnv('COLD_READ_TEST_TOKEN', envValue)
    writeFileSync(p.secretFile, `CURRENT=${configured}\n`)
    const store = storeOf(retained)
    const sources = createColdReadMaskingSources(p.configPath, () => [store])
    expect((await sources())?.secretStores).toEqual([store])
    expect(existsSync(p.agentQaRoot)).toBe(false)
    const text = [configured, rotated, retained.TOKEN, envValue, 'ordinary-event'].join(' / ')
    await publish(p, snapshot(p.runId, [text]))
    const read = cold(p, () => [store])
    const token = async () => (await read.read()).curationSnapshot!.rows[0]!.changes[0]!.change.evidenceToken
    const marker = maskedMarker('secret')
    expect(await token()).toBe([marker, rotated, marker, marker, 'ordinary-event'].join(' / '))
    writeFileSync(p.secretFile, `CURRENT=${rotated}\n`)
    retained.TOKEN = configured
    expect(await token()).toBe([marker, marker, 'retained-runtime-value', marker, 'ordinary-event'].join(' / '))
    const values: string[] = []
    store.forEachSecret((_name, value) => { values.push(value) })
    expect(values).toEqual([configured])
    expect((await sources())?.secretsContent).toBe(`CURRENT=${rotated}\n`)
  })

  it.each(['missing', 'invalid', 'unreadable'] as const)('COLD-SOURCE-REFUSAL %s sources retain the existing fail-closed context', async kind => {
    const p = project()
    await publish(p, snapshot(p.runId))
    if (kind === 'missing') rmSync(p.secretFile)
    if (kind === 'invalid') writeFileSync(p.secretFile, 'INVALID-NAME=synthetic-value\n')
    if (kind === 'unreadable') { rmSync(p.secretFile); mkdirSync(p.secretFile) }
    const read = cold(p)
    await expect(read.read()).rejects.toMatchObject({
      name: 'ZodError', issues: [{ code: 'custom', path: ['curationSnapshot'],
        message: 'The recorded curation snapshot cannot be projected safely.' }],
    })
    expect(getActiveMaskingContext()).toBeUndefined()
  })

  it('COLD-COLLISION refuses genuinely masked duplicate events without deleting history', async () => {
    const p = project()
    const first = 'first-sensitive-event'
    const second = 'second-sensitive-event'
    const recorded = snapshot(p.runId, [first, second])
    // Only the evidence distinguishes these historical identities.
    recorded.rows[0]!.changes[1]!.change.observationId = recorded.rows[0]!.changes[0]!.change.observationId
    writeFileSync(p.secretFile, `FIRST=${first}\nSECOND=${second}\n`)
    await publish(p, recorded)
    await expect(cold(p).read()).rejects.toMatchObject({
      name: 'ZodError', issues: [{ code: 'custom', path: ['curationSnapshot'],
        message: 'The recorded curation snapshot cannot be projected safely.' }],
    })
    expect(recorded.rows[0]!.changes).toHaveLength(2)
    expect(getActiveMaskingContext()).toBeUndefined()
  })

  it('COLD-LIFETIME preserves execution/audit authority and disposes only its own context after await', async () => {
    const p = project()
    const secret = 'lifetime-sensitive-value'
    writeFileSync(p.secretFile, `VALUE=${secret}\n`)
    await publish(p, snapshot(p.runId, [secret]))
    const read = cold(p)
    const sink = { appendExecutionAudit() {}, appendGuardrailAudit() {} }
    let active: MaskingContext | undefined
    const original = CurationSnapshotSchema.safeParse.bind(CurationSnapshotSchema)
    vi.spyOn(CurationSnapshotSchema, 'safeParse').mockImplementation((...args) => {
      active = getActiveMaskingContext()
      expect(getActiveExecutionContext()).toBe('ci')
      expect(getActiveAuditSink()).toBe(sink)
      return original(...args)
    })
    await runSafetyScope({ executionContext: 'ci', auditSink: sink }, async () => {
      await read.read()
      expect(getActiveMaskingContext()).toBeUndefined()
      expect(getActiveExecutionContext()).toBe('ci')
      expect(getActiveAuditSink()).toBe(sink)
    })
    expect(active).toBeDefined()
    // The wrapper's underlying registrations have been disposed; retained host stores were not.
    expect(active!.mask(secret)).toBe(secret)
  })

  it('COLD-ACTIVE keeps an existing run masker and skips unavailable cold sources', async () => {
    const p = project()
    const secret = 'active-context-value'
    await publish(p, snapshot(p.runId, [secret]))
    rmSync(p.secretFile)
    const context = buildRunMaskingContext({ secretStore: storeOf({ VALUE: secret }), env: {} })
    const read = cold(p)
    try {
      await runSafetyScope({ maskingContext: context }, async () => {
        const result = await read.read()
        expect(result.curationSnapshot!.rows[0]!.changes[0]!.change.evidenceToken).toBe('<SECRET_0>')
        expect(getActiveMaskingContext()).toBe(context)
      })
      expect(context.mask(secret)).toBe('<SECRET_0>')
    } finally { context.dispose() }
  })
})
