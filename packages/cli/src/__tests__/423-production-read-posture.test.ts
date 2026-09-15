// 423 Gap 1: runs.evidence over the production composition. No test installs a masking resolver;
// every read below reaches its masking context only through the host's own cold read scope.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { invokeFunction } from '@vostride/agent-qa-agent'
import type { LocalAgentHost } from '@vostride/agent-qa-agent-local'
import { DashboardDatabase, createDashboardRunDetailReader } from '@vostride/agent-qa-dashboard'
import { generateRunId } from '@vostride/agent-qa-ids'
import { FsEvidenceArtifactStore } from '@vostride/agent-qa-runner-local'
import { getActiveMaskingContext } from '@vostride/agent-qa-safety'
import { maskedMarker } from '@vostride/agent-qa-schema'

import { CLI_FUNCTION_CALLER, composeCliLocalAgent } from '../composition/local-agent-host.js'

const SECRET = 'synthetic-production-secret-423'
const MARKER = maskedMarker('secret')

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

// Every dispatch appends the gate's audit row, and SQLite rewrites its shared-memory read index on
// any read; neither is a byte the read itself produced, so both stay outside the tree proof.
const DISPATCH_BOOKKEEPING = new Set(['execution_audit.jsonl', 'dashboard.db-shm'])

function fixtureBytes(root: string): unknown {
  return readdirSync(root, { withFileTypes: true }).filter(entry => !DISPATCH_BOOKKEEPING.has(entry.name))
    .map(entry => [entry.name,
      entry.isDirectory() ? fixtureBytes(join(root, entry.name)) : readFileSync(join(root, entry.name), 'hex')])
}

const networkDocument = {
  schemaVersion: 1 as const, kind: 'network' as const, records: [
    {
      url: 'https://app.test/api/orders', method: 'POST', status: 200,
      requestHeaders: { 'content-type': 'application/json', 'x-request-id': 'req-423' },
      responseHeaders: { 'content-type': 'application/json', 'x-trace': SECRET },
      body: 'recorded body', startTime: 1, endTime: 2,
    },
    {
      url: 'https://app.test/api/health', method: 'GET', status: 204,
      requestHeaders: {}, responseHeaders: {}, startTime: 3, endTime: 4,
    },
  ],
}

function productionFixture() {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-423-production-read-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const configPath = join(root, 'agent-qa.config.yaml')
  const agentQaRoot = join(root, '.agent-qa')
  const secretsFile = join(root, '.env.secrets.local')
  writeFileSync(configPath, JSON.stringify({
    workspace: { testMatch: ['tests/**/*.yaml'], suiteMatch: ['suites/**/*.yaml'],
      hooksFile: 'hooks.yaml', envFile: '.env', secretsFile: '.env.secrets.local' },
    knowledge: { dir: 'agent-qa-knowledge', commitArtifacts: 'none' },
    registry: { llms: [{ name: 'unused', provider: 'openai-compatible', model: 'unused',
      baseURL: 'http://127.0.0.1:1/v1' }],
      targets: { local: { platform: 'web', url: 'http://127.0.0.1:1' } } },
    use: { llm: 'unused', mobile: { appState: 'preserve' } },
  }))
  writeFileSync(secretsFile, `SESSION=${SECRET}\n`)
  mkdirSync(agentQaRoot, { recursive: true })

  const runId = generateRunId()
  const db = new DashboardDatabase({ dbPath: join(agentQaRoot, 'dashboard.db') })
  cleanups.push(() => db.close())
  const networkRef = new FsEvidenceArtifactStore({ root: agentQaRoot, runId }).persistEvidenceDocument(networkDocument)
  db.insertRun({
    id: runId, name: 'Production read posture', status: 'passed', duration: 1,
    startedAt: new Date(0).toISOString(), endedAt: new Date(1).toISOString(),
  })
  db.upsertRunMember({ runId, testIndex: 0, name: 'Production member', totalSteps: 1, outcome: 'passed' })
  db.insertRunStep({
    runId, testIndex: 0, stepIndex: 0, stepText: 'Submit the order',
    cacheStatus: 'miss', verifierVerdict: null, selfHealOccurred: false, briefDigest: '', status: 'passed',
    evidence: {
      console: { kind: 'console', state: 'absent', reason: 'empty' },
      network: { kind: 'network', state: 'present', ref: networkRef as never, counts: { total: 2, failed: 0, errored: 0 } },
      a11y: { kind: 'a11y', state: 'absent', reason: 'unsupported' },
      variables: { kind: 'variables', state: 'present', counts: { count: 2 } },
    },
    variableSnapshot: {
      first: { value: 'plain-first', source: 'inline' },
      second: { value: SECRET, source: 'env' },
    },
  })

  const host: LocalAgentHost = composeCliLocalAgent({
    configPath, agentQaRoot, runDetail: createDashboardRunDetailReader(db),
  })
  cleanups.push(() => host.close())
  const read = async (kind: 'network' | 'variables') => {
    expect(getActiveMaskingContext()).toBeUndefined()
    const result = await invokeFunction(host.registry, 'runs.evidence',
      { runId, testIndex: 0, stepIndex: 0, kind }, CLI_FUNCTION_CALLER)
    expect(getActiveMaskingContext()).toBeUndefined()
    return result as { outcome: string; code?: string }
  }
  return { root, configPath, agentQaRoot, secretsFile, runId, db, host, networkRef, read }
}

describe('423 production read posture', () => {
  it('COLD-EVIDENCE-HOST reads multi-key network and variables evidence readable with the declared secret masked', async () => {
    const f = productionFixture()
    const before = fixtureBytes(f.root)

    const network = await f.read('network') as unknown as {
      outcome: string
      code?: string
      document: { records: { url: string; requestHeaders: Record<string, string>; responseHeaders: Record<string, string> }[] }
    }
    expect({ outcome: network.outcome, code: network.code }).toEqual({ outcome: 'ready', code: undefined })
    const records = network.document.records
    expect(records.map(record => record.url)).toEqual(networkDocument.records.map(record => record.url))
    expect(records[0]!.requestHeaders).toEqual({ 'content-type': 'application/json', 'x-request-id': 'req-423' })
    expect(Object.keys(records[0]!.requestHeaders)).toEqual(['content-type', 'x-request-id'])
    expect(Object.keys(records[0]!.responseHeaders)).toEqual(['content-type', 'x-trace'])
    expect(records[0]!.responseHeaders['content-type']).toBe('application/json')
    expect(records[0]!.responseHeaders['x-trace']).toBe(MARKER)
    expect(records[1]!.requestHeaders).toEqual({})
    expect(records[1]!.responseHeaders).toEqual({})
    expect(JSON.stringify(network)).not.toContain(SECRET)

    const variables = await f.read('variables') as unknown as {
      outcome: string
      code?: string
      document: { records: Record<string, { value: string; source: string }> }
    }
    expect({ outcome: variables.outcome, code: variables.code }).toEqual({ outcome: 'ready', code: undefined })
    expect(Object.keys(variables.document.records)).toEqual(['first', 'second'])
    expect(variables.document.records.first).toEqual({ value: 'plain-first', source: 'inline' })
    expect(variables.document.records.second).toEqual({ value: MARKER, source: 'env' })
    expect(JSON.stringify(variables)).not.toContain(SECRET)

    expect(await f.read('network')).toEqual(network)
    expect(await f.read('variables')).toEqual(variables)
    expect(fixtureBytes(f.root)).toEqual(before)
    expect(readFileSync(join(f.agentQaRoot, 'execution_audit.jsonl'), 'utf8')).not.toContain(SECRET)
  })
})
