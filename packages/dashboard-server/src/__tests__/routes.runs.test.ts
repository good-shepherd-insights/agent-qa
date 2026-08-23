import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { IncomingMessage, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeEach } from 'vitest'

import { createRouter, RESPONSE_SAFE_RUN_READ_METHODS } from '../server/routes.js'

interface MockRun {
  id: string
  name: string
  filePath: string | null
  status: string
  duration: number
  attributes: Record<string, string>
  tags: string[] | null
  environment: string | null
  metadata: Record<string, unknown> | null
  startedAt: string | null
  endedAt: string | null
  source: string
  videoPath: string | null
  failureSummary: string | null
  errorLog: string | null
  memoryLog: string | null
  testId: string | null
  suiteId: string | null
  platform: string
  testFileContent: string | null
  modelName: string | null
  llmProvider: string | null
  parallel: boolean
  parentRunId: string | null
  attemptNumber: number
  retryCount: number
  maxRetries: number
  createdAt: string
}

function createMockDatabase() {
  const runs: MockRun[] = []
  const artifacts = new Map<string, {
    runId: string
    kind: string
    schemaVersion: number
    payload: Record<string, unknown>
    finalizedAt: string | null
    createdAt: string
    updatedAt: string
  }>()

  function filterRuns(filters: Record<string, unknown> = {}): MockRun[] {
    const {
      status,
      name,
      tag,
      from,
      to,
      source,
      platform,
      limit,
      offset,
      attributePredicates,
    } = filters

    let filtered = runs.filter((run) => run.parentRunId === null)

    if (typeof status === 'string') {
      filtered = filtered.filter((run) => run.status === status)
    }
    if (typeof name === 'string') {
      filtered = filtered.filter((run) => run.name.includes(name) || run.id.includes(name))
    }
    if (typeof tag === 'string') {
      filtered = filtered.filter((run) => run.tags?.includes(tag))
    }
    if (typeof from === 'string') {
      filtered = filtered.filter((run) => run.startedAt !== null && run.startedAt >= from)
    }
    if (typeof to === 'string') {
      filtered = filtered.filter((run) => run.startedAt !== null && run.startedAt <= to)
    }
    if (typeof source === 'string') {
      filtered = filtered.filter((run) => run.source === source)
    }
    if (typeof platform === 'string') {
      filtered = filtered.filter((run) => run.platform === platform)
    }
    if (Array.isArray(attributePredicates)) {
      filtered = filtered.filter((run) =>
        attributePredicates.every((predicate) => {
          const value = run.attributes[predicate.key]
          if (typeof value !== 'string') return false
          if (predicate.mode === 'regex') return new RegExp(predicate.value).test(value)
          return value === predicate.value
        }),
      )
    }

    const start = typeof offset === 'number' ? offset : 0
    const end = typeof limit === 'number' ? start + limit : undefined
    return filtered.slice(start, end)
  }

  function collectAttributeEntries(key?: string, q?: string) {
    return runs.flatMap((run) => Object.entries(run.attributes))
      .filter(([entryKey, value]) => (!key || entryKey === key) && (!q || value.includes(q) || entryKey.includes(q)))
  }

  return {
    insertRun(run: Partial<MockRun>) {
      const id = run.id ?? randomUUID()
      runs.push({
        id,
        name: run.name ?? 'Unnamed Run',
        filePath: run.filePath ?? null,
        status: run.status ?? 'passed',
        duration: run.duration ?? 0,
        attributes: run.attributes ?? {},
        tags: run.tags ?? null,
        environment: run.environment ?? null,
        metadata: run.metadata ?? null,
        startedAt: run.startedAt ?? '2026-04-18T00:00:00Z',
        endedAt: run.endedAt ?? '2026-04-18T00:00:05Z',
        source: run.source ?? 'dashboard',
        videoPath: run.videoPath ?? null,
        failureSummary: run.failureSummary ?? null,
        errorLog: run.errorLog ?? null,
        memoryLog: run.memoryLog ?? null,
        testId: run.testId ?? null,
        suiteId: run.suiteId ?? null,
        platform: run.platform ?? 'web',
        testFileContent: run.testFileContent ?? null,
        modelName: run.modelName ?? null,
        llmProvider: run.llmProvider ?? null,
        parallel: run.parallel ?? false,
        parentRunId: run.parentRunId ?? null,
        attemptNumber: run.attemptNumber ?? 1,
        retryCount: run.retryCount ?? 0,
        maxRetries: run.maxRetries ?? 0,
        createdAt: run.createdAt ?? '2026-04-18T00:00:00Z',
      })
      return id
    },
    getRuns(filters: Record<string, unknown> = {}) {
      return filterRuns(filters)
    },
    getRun(id: string) {
      return runs.find((run) => run.id === id)
    },
    getRunsByParent(parentRunId: string) {
      return runs.filter((run) => run.parentRunId === parentRunId)
    },
    getPendingRuns() {
      return runs.filter((run) => run.status === 'pending')
    },
    getNextPendingRun() {
      return runs.find((run) => run.status === 'pending')
    },
    getSteps() {
      return []
    },
    getRunsByTestName(name: string) {
      return runs.filter((run) => run.name === name)
    },
    getRunsByTestNameCount(name: string) {
      return runs.filter((run) => run.name === name).length
    },
    getTestTrends() {
      return []
    },
    getRunsBySuiteId(suiteId: string) {
      return runs.filter((run) => run.suiteId === suiteId)
    },
    getRunsBySuiteIdCount(suiteId: string) {
      return runs.filter((run) => run.suiteId === suiteId).length
    },
    getSuiteTrends() {
      return []
    },
    listRunAttributeKeys(opts: { limit?: number; q?: string } = {}) {
      const counts = new Map<string, number>()
      for (const [key] of collectAttributeEntries(undefined, opts.q)) {
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return [...counts.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
        .slice(0, opts.limit ?? 50)
    },
    listRunAttributeValues(key: string, opts: { limit?: number; q?: string } = {}) {
      const counts = new Map<string, number>()
      for (const [, value] of collectAttributeEntries(key, opts.q)) {
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
      return [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
        .slice(0, opts.limit ?? 50)
    },
    insertRunArtifact(input: { runId: string; kind: string; payload?: Record<string, unknown> }) {
      const artifact = {
        runId: input.runId,
        kind: input.kind,
        schemaVersion: 1,
        payload: { schemaVersion: 1, ...(input.payload ?? {}) },
        finalizedAt: null,
        createdAt: '2026-04-18T00:00:00Z',
        updatedAt: '2026-04-18T00:00:00Z',
      }
      artifacts.set(input.runId, artifact)
      return artifact
    },
    getRunArtifactBundle(runId: string) {
      return {
        artifact: artifacts.get(runId) ?? null,
        children: runs
          .filter((run) => run.parentRunId === runId)
          .map((run) => ({ run, artifact: artifacts.get(run.id) ?? null })),
      }
    },
    close() {},
  }
}

interface MockResponse {
  status: number
  headers: Record<string, string>
  body: string
}

function createMockRequest(
  url: string,
  options: { method?: string; headers?: IncomingHttpHeaders; body?: string } = {},
): IncomingMessage {
  const req = new IncomingMessage(new Socket())
  req.method = options.method ?? 'GET'
  req.url = url
  req.headers = options.headers ?? {}

  process.nextTick(() => {
    if (options.body) {
      req.push(Buffer.from(options.body))
    }
    req.push(null)
  })

  return req
}

async function invokeRoute(
  router: ReturnType<typeof createRouter>,
  url: string,
  options: { method?: string; headers?: IncomingHttpHeaders; body?: string } = {},
): Promise<MockResponse> {
  return await new Promise((resolve, reject) => {
    const req = createMockRequest(url, options)
    const headers = new Map<string, string>()
    let status = 200
    let body = ''

    const res = {
      writeHead(statusCode: number, head?: Record<string, string>) {
        status = statusCode
        if (head) {
          for (const [key, value] of Object.entries(head)) {
            headers.set(key.toLowerCase(), value)
          }
        }
        return this
      },
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value)
      },
      getHeader(name: string) {
        return headers.get(name.toLowerCase())
      },
      write(chunk: string | Buffer) {
        body += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk
        return true
      },
      end(chunk?: string | Buffer) {
        if (chunk) {
          body += Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : chunk
        }
        resolve({
          status,
          headers: Object.fromEntries(headers),
          body,
        })
      },
    } as unknown as ServerResponse

    try {
      router(req, res)
    } catch (error) {
      reject(error)
    }
  })
}

function createQueueRouter(db: ReturnType<typeof createMockDatabase>) {
  const enqueued: Array<Record<string, unknown>> = []
  const jobQueue = {
    enqueue(input: Record<string, unknown>) {
      enqueued.push(input)
      return `queued-${enqueued.length}`
    },
    getConcurrency() {
      return 1
    },
    getActiveCount() {
      return 0
    },
  }
  return {
    enqueued,
    router: createRouter({
      db: db as never,
      jobQueue: jobQueue as never,
    }),
  }
}

async function postJson(
  router: ReturnType<typeof createRouter>,
  path: string,
  body: Record<string, unknown>,
): Promise<MockResponse> {
  return invokeRoute(router, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST run enqueue trigger attributes', () => {
  let db: ReturnType<typeof createMockDatabase>

  beforeEach(() => {
    db = createMockDatabase()
  })

  it('keeps dashboard-triggered runs labeled as dashboard by default', async () => {
    const { router, enqueued } = createQueueRouter(db)

    const res = await postJson(router, '/api/runs/trigger', {})

    expect(res.status).toBe(202)
    expect(enqueued[0].attributes).toMatchObject({
      'agent-qa.trigger': 'dashboard',
      'agent-qa.runner': 'local',
    })
  })

  it('keeps external queue API runs labeled as api', async () => {
    const { router, enqueued } = createQueueRouter(db)

    const res = await postJson(router, '/api/queue/enqueue', { name: 'API Run' })

    expect(res.status).toBe(202)
    expect(enqueued[0].attributes).toMatchObject({
      'agent-qa.trigger': 'api',
      'agent-qa.runner': 'local',
    })
  })

  it('labels MCP-triggered dashboard enqueue requests as mcp without copying raw payload fields', async () => {
    const { router, enqueued } = createQueueRouter(db)

    const res = await postJson(router, '/api/runs/trigger', {
      triggerSource: 'mcp',
      file: undefined,
      prompt: 'do not copy me',
      attributes: { 'agent-qa.trigger': 'evil', email: 'user@example.com' },
    })

    expect(res.status).toBe(202)
    expect(enqueued[0].attributes).toEqual({
      'agent-qa.trigger': 'mcp',
      'agent-qa.runner': 'local',
    })
  })

  it('rejects unsupported dashboard trigger sources deterministically', async () => {
    const { router, enqueued } = createQueueRouter(db)

    const res = await postJson(router, '/api/runs/trigger', { triggerSource: 'extension' })

    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toContain('triggerSource')
    expect(enqueued).toHaveLength(0)
  })
})

describe('GET /api/runs route contract', () => {
  let db: ReturnType<typeof createMockDatabase>
  let router: ReturnType<typeof createRouter>

  beforeEach(() => {
    db = createMockDatabase()
    router = createRouter(db as never)
  })

  it('enriches test runs with targetName and filters by target', async () => {
    db.insertRun({
      id: 'run-web',
      name: 'Web Login',
      status: 'passed',
      platform: 'web',
      testFileContent: ['name: Web Login', 'target: hn-staging', 'steps: []'].join('\n'),
    })
    db.insertRun({
      id: 'run-android',
      name: 'Android Login',
      status: 'passed',
      platform: 'android',
      testFileContent: ['name: Android Login', 'target: mobile-staging', 'steps: []'].join('\n'),
    })

    const filteredRes = await invokeRoute(router, '/api/runs?target=hn-staging')
    expect(filteredRes.status).toBe(200)

    const filteredData = JSON.parse(filteredRes.body) as {
      runs: Array<{ id: string; targetName: string | null; destination?: string | null }>
      total: number
    }

    expect(filteredData.total).toBe(1)
    expect(filteredData.runs).toHaveLength(1)
    expect(filteredData.runs[0]).toMatchObject({
      id: 'run-web',
      targetName: 'hn-staging',
    })
    expect(filteredData.runs[0]).not.toHaveProperty('destination')
  })

  it('does not filter by legacy destination query parameters', async () => {
    db.insertRun({
      id: 'run-local',
      name: 'Local Run',
      metadata: { runDestination: 'Local' },
      testFileContent: ['name: Local Run', 'target: hn-staging', 'steps: []'].join('\n'),
    })
    db.insertRun({
      id: 'run-remote',
      name: 'Remote Run',
      metadata: { runDestination: 'BrowserStack' },
      testFileContent: ['name: Remote Run', 'target: hn-staging', 'steps: []'].join('\n'),
    })

    const res = await invokeRoute(router, '/api/runs?destination=browserstack')
    expect(res.status).toBe(200)

    const data = JSON.parse(res.body) as {
      runs: Array<{ id: string; destination?: string | null }>
      total: number
    }

    expect(data.total).toBe(2)
    expect(data.runs.map((run) => run.id).sort()).toEqual(['run-local', 'run-remote'])
    expect(data.runs.every((run) => !('destination' in run))).toBe(true)
  })

  it('does not filter by legacy source query parameters', async () => {
    db.insertRun({ id: 'run-cli', name: 'CLI Run', source: 'cli' })
    db.insertRun({ id: 'run-dashboard', name: 'Dashboard Run', source: 'dashboard' })

    const res = await invokeRoute(router, '/api/runs?source=dashboard')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as { runs: Array<{ id: string }>; total: number }
    expect(data.total).toBe(2)
    expect(data.runs.map((run) => run.id).sort()).toEqual(['run-cli', 'run-dashboard'])
  })

  it('filters runs by exact attribute bracket parameters', async () => {
    db.insertRun({
      id: 'run-main',
      name: 'Main Branch',
      attributes: { 'git.branch': 'phase223-main' },
    })
    db.insertRun({
      id: 'run-dev',
      name: 'Dev Branch',
      attributes: { 'git.branch': 'dev' },
    })

    const res = await invokeRoute(router, '/api/runs?attributes[git.branch]=phase223-main')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as { runs: Array<{ id: string }>; total: number }
    expect(data.total).toBe(1)
    expect(data.runs[0].id).toBe('run-main')
  })

  it('filters runs by regex attribute bracket parameters', async () => {
    db.insertRun({
      id: 'run-phase',
      name: 'Phase Branch',
      attributes: { 'git.branch': 'phase223-main' },
    })
    db.insertRun({
      id: 'run-main',
      name: 'Main Branch',
      attributes: { 'git.branch': 'main' },
    })
    db.insertRun({
      id: 'run-dev',
      name: 'Dev Branch',
      attributes: { 'git.branch': 'dev' },
    })

    const res = await invokeRoute(router, '/api/runs?attributes[git.branch][regex]=^(phase223-main|main)$')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as { runs: Array<{ id: string }>; total: number }
    expect(data.total).toBe(2)
    expect(data.runs.map((run) => run.id).sort()).toEqual(['run-main', 'run-phase'])
  })

  it('rejects invalid attribute regex filters', async () => {
    const res = await invokeRoute(router, '/api/runs?attributes[git.branch][regex]=(')
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toContain('Invalid attribute regex')
  })

  it('suggests run attribute keys and values with counts', async () => {
    db.insertRun({
      id: 'run-a',
      name: 'Run A',
      attributes: { 'git.branch': 'phase223-main', 'user.email': 'CI' },
    })
    db.insertRun({
      id: 'run-b',
      name: 'Run B',
      attributes: { 'git.branch': 'phase223-main' },
    })
    db.insertRun({
      id: 'run-c',
      name: 'Run C',
      attributes: { 'git.branch': 'main' },
    })

    const keysRes = await invokeRoute(router, '/api/runs/attributes/keys?q=git&limit=50')
    expect(keysRes.status).toBe(200)
    expect(JSON.parse(keysRes.body).keys).toEqual([{ key: 'git.branch', count: 3 }])

    const valuesRes = await invokeRoute(router, '/api/runs/attributes/values?key=git.branch&q=phase&limit=50')
    expect(valuesRes.status).toBe(200)
    expect(JSON.parse(valuesRes.body).values).toEqual([{ value: 'phase223-main', count: 2 }])
  })

  it('enriches suite parent rows and child rows with the same target contract', async () => {
    db.insertRun({
      id: 'suite-run',
      name: 'Checkout Suite',
      suiteId: 'checkout-suite',
      platform: 'web',
    })
    db.insertRun({
      id: 'suite-child-1',
      parentRunId: 'suite-run',
      suiteId: 'checkout-suite',
      name: 'Child 1',
      platform: 'web',
      metadata: { runDestination: 'Local' },
      testFileContent: ['name: Child 1', 'target: sample-target', 'steps: []'].join('\n'),
    })
    db.insertRun({
      id: 'suite-child-2',
      parentRunId: 'suite-run',
      suiteId: 'checkout-suite',
      name: 'Child 2',
      platform: 'web',
      metadata: { runDestination: 'Local' },
      testFileContent: ['name: Child 2', 'target: sample-target', 'steps: []'].join('\n'),
    })

    const res = await invokeRoute(router, '/api/runs')
    expect(res.status).toBe(200)

    const data = JSON.parse(res.body) as {
      runs: Array<{
        id: string
        targetName: string | null
        tests?: Array<{ id: string; targetName: string | null }>
      }>
      total: number
    }

    expect(data.total).toBe(1)
    expect(data.runs[0]).toMatchObject({
      id: 'suite-run',
      targetName: 'sample-target',
      tests: [
        expect.objectContaining({ id: 'suite-child-1', targetName: 'sample-target' }),
        expect.objectContaining({ id: 'suite-child-2', targetName: 'sample-target' }),
      ],
    })
  })

  it('paginates top-level parent runs only and does not count child suite rows toward total', async () => {
    for (let index = 0; index < 55; index += 1) {
      db.insertRun({
        id: `parent-${index}`,
        name: `Parent ${index}`,
        testFileContent: [`name: Parent ${index}`, `target: target-${index}`, 'steps: []'].join('\n'),
      })
    }
    db.insertRun({
      id: 'child-a',
      parentRunId: 'parent-0',
      name: 'Nested Child',
      testFileContent: ['name: Nested Child', 'target: target-0', 'steps: []'].join('\n'),
    })

    const res = await invokeRoute(router, '/api/runs')
    expect(res.status).toBe(200)

    const data = JSON.parse(res.body) as {
      runs: Array<{ id: string }>
      total: number
    }

    expect(data.runs).toHaveLength(50)
    expect(data.total).toBe(55)
  })

  it('returns a quiet null targetName when no parseable target snapshot exists', async () => {
    db.insertRun({
      id: 'no-target',
      name: 'Untargeted Run',
      testFileContent: 'name: Untargeted Run\nsteps: []\n',
    })

    const res = await invokeRoute(router, '/api/runs')
    expect(res.status).toBe(200)

    const data = JSON.parse(res.body) as {
      runs: Array<{ id: string; targetName: string | null }>
      total: number
    }

    expect(data.total).toBe(1)
    expect(data.runs[0]).toMatchObject({
      id: 'no-target',
      targetName: null,
    })
  })

  it('matches the existing name filter against run ids', async () => {
    db.insertRun({
      id: 'r_able-baker-charlie-delta-echo-foxtrot-golf-hotel-india-juliet',
      name: 'Visible Name Only',
      status: 'passed',
    })
    db.insertRun({
      id: 'r_other-run-id-that-should-not-match-query-value',
      name: 'Another Run',
      status: 'passed',
    })

    const res = await invokeRoute(
      router,
      '/api/runs?name=r_able-baker-charlie-delta-echo-foxtrot-golf-hotel-india-juliet',
    )
    expect(res.status).toBe(200)

    const data = JSON.parse(res.body) as { runs: Array<{ id: string; name: string }>; total: number }
    expect(data.total).toBe(1)
    expect(data.runs).toHaveLength(1)
    expect(data.runs[0]).toMatchObject({
      id: 'r_able-baker-charlie-delta-echo-foxtrot-golf-hotel-india-juliet',
      name: 'Visible Name Only',
    })
  })

  it('returns persisted run artifacts without reading source files', async () => {
    db.insertRun({
      id: 'run-artifact',
      name: 'Artifact Run',
      testFileContent: 'name: stale current content',
    })
    db.insertRunArtifact({
      runId: 'run-artifact',
      kind: 'test',
      payload: {
        config: { rawConfigContent: 'registry: {}', envFile: { content: 'TOKEN=abc', variables: { TOKEN: 'abc' }, path: '.env' } },
        source: { kind: 'test', name: 'Artifact Run', rawYaml: 'name: original artifact content' },
        memory: { log: { added: 1, confirmed: 0, deprecated: 0, deleted: 0, errors: [], curatorDuration: 1, deltas: [] } },
      },
    })

    const res = await invokeRoute(router, '/api/runs/run-artifact/artifact')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as {
      artifact: { payload: { config: any; source: any; memory: any } }
      missingSections: string[]
    }

    expect(data.artifact.payload.config.envFile.content).toBe('TOKEN=abc')
    expect(data.artifact.payload.source.rawYaml).toBe('name: original artifact content')
    expect(data.missingSections).toEqual([])
  })

  it('sanitizes secrets metadata and secret placeholders in artifact API responses', async () => {
    const rawSecret = 'phase222-raw-secret-SHOULD-NOT-PERSIST-4f03b7'
    db.insertRun({
      id: 'run-secret-artifact',
      name: 'Secret Artifact Run',
    })
    db.insertRunArtifact({
      runId: 'run-secret-artifact',
      kind: 'test',
      payload: {
        config: {
          secretsFile: {
            path: '.secrets.local',
            status: 'loaded',
            count: 1,
            variables: { loginPassword: rawSecret },
            content: `loginPassword=${rawSecret}`,
          },
        },
        source: {
          kind: 'test',
          name: 'Secret Artifact Run',
          rawYaml: 'steps:\n  - Fill password with {{secret:loginPassword}}',
          resolvedDefinition: {
            steps: ['Fill password with {{secret:loginPassword}}'],
          },
        },
      },
    })

    const res = await invokeRoute(router, '/api/runs/run-secret-artifact/artifact')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as {
      artifact: { payload: { config: any; source: any } }
    }
    const serialized = JSON.stringify(data)

    expect(serialized).not.toContain(rawSecret)
    expect(JSON.stringify(data.artifact.payload.config)).not.toContain('loginPassword')
    expect(data.artifact.payload.config.secretsFile).toEqual({
      path: '.secrets.local',
      status: 'loaded',
      count: 1,
    })
    expect(data.artifact.payload.source.rawYaml).toContain('[secret:loginPassword]')
    expect(data.artifact.payload.source.resolvedDefinition.steps[0]).toContain('[secret:loginPassword]')
  })

  it('does not call test or suite file managers when reading artifacts', async () => {
    db.insertRun({ id: 'run-db-only', name: 'DB Only Run' })
    db.insertRunArtifact({
      runId: 'run-db-only',
      kind: 'test',
      payload: {
        config: { rawConfigContent: 'registry: {}' },
        source: { kind: 'test', name: 'DB Only Run', rawYaml: 'name: preserved' },
        memory: { log: { added: 0, confirmed: 0, deprecated: 0, deleted: 0, errors: [], curatorDuration: 0, deltas: [] } },
      },
    })
    const throwIfCalled = () => {
      throw new Error('artifact route should not read live files')
    }
    const dbOnlyRouter = createRouter({
      db: db as never,
      testFileManager: { read: throwIfCalled, findByTestId: throwIfCalled, list: throwIfCalled } as never,
      suiteFileManager: { read: throwIfCalled, findBySuiteId: throwIfCalled, list: throwIfCalled } as never,
    })

    const res = await invokeRoute(dbOnlyRouter, '/api/runs/run-db-only/artifact')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as { artifact: { payload: { source: { rawYaml: string } } } }
    expect(data.artifact.payload.source.rawYaml).toBe('name: preserved')
  })

  it('returns suite parent artifact children and missing artifact sections', async () => {
    db.insertRun({ id: 'suite-run', name: 'Suite', source: 'suite' })
    db.insertRun({ id: 'suite-child', name: 'Child', parentRunId: 'suite-run', source: 'suite' })
    db.insertRunArtifact({
      runId: 'suite-run',
      kind: 'suite-parent',
      payload: {
        source: { kind: 'suite', members: [{ index: 0, childRunId: 'suite-child' }] },
      },
    })

    const res = await invokeRoute(router, '/api/runs/suite-run/artifact')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as {
      children: Array<{ run: { id: string }; artifact: null }>
      missingSections: string[]
    }

    expect(data.children).toHaveLength(1)
    expect(data.children[0].run.id).toBe('suite-child')
    expect(data.children[0].artifact).toBeNull()
    expect(data.missingSections).toEqual(['config'])
  })

  it('returns artifact missing when the run has no artifact row', async () => {
    db.insertRun({ id: 'run-no-artifact', name: 'No Artifact' })

    const res = await invokeRoute(router, '/api/runs/run-no-artifact/artifact')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as { artifact: null; missingSections: string[] }
    expect(data.artifact).toBeNull()
    expect(data.missingSections).toEqual(['artifact'])
  })

  it('returns 404 for nonexistent run artifacts', async () => {
    const res = await invokeRoute(router, '/api/runs/missing/artifact')
    expect(res.status).toBe(404)
    expect(JSON.parse(res.body)).toEqual({ error: 'Run not found' })
  })
})

// ---- CR-02: the confirm scope stops leaving on the read path (401-18) ---------------------------
//
// `POST /api/runs/trigger` persists the triggering browser's confirm scope into `runs.metadata` so
// the QUEUE can address that browser when the run finally starts. Every run-reading endpoint then
// served the whole row through `json()`, which writes `Access-Control-Allow-Origin: *` — so any page
// a person had open could read the scope out of a run they never triggered.
//
// THE STRIP IS ON THE RESPONSE PATH, NEVER IN `mapRunRow`. The queue consumer reads `confirmScope`
// off the persisted row; a strip at the DB→row choke point would delete the feature rather than
// close the leak. `run-trigger-confirm.test.ts` holds the cell proving the feature survived.

const LEAKED_SCOPE = 'run-trigger:cr02-leaked-scope-3f19b2'
/** A metadata key nobody has invented yet — the allowlist's fail-closed proof. */
const FUTURE_FIELD_VALUE = 'cr02-a-field-added-next-phase-8ac41d'

function seedScopedRun(
  db: ReturnType<typeof createMockDatabase>,
  overrides: Partial<Parameters<ReturnType<typeof createMockDatabase>['insertRun']>[0]> = {},
): string {
  return db.insertRun({
    name: 'Scoped Run',
    metadata: {
      args: ['/w/tests/scoped.yaml'],
      confirmScope: LEAKED_SCOPE,
      laterField: FUTURE_FIELD_VALUE,
    },
    ...overrides,
  })
}

describe('CR-02 — no run-reading response hands out the confirm scope', () => {
  let db: ReturnType<typeof createMockDatabase>
  let router: ReturnType<typeof createRouter>

  beforeEach(() => {
    db = createMockDatabase()
    router = createRouter(db as never)
  })

  it('DOOR 1 — GET /api/runs (the list) carries no confirm scope', async () => {
    seedScopedRun(db, { id: 'run-list' })
    const res = await invokeRoute(router, '/api/runs')
    expect(res.status).toBe(200)
    expect(res.body).not.toContain(LEAKED_SCOPE)
    expect(res.body).not.toContain(FUTURE_FIELD_VALUE)
    // The row really was served — an empty list would satisfy the assertion above.
    expect((JSON.parse(res.body) as { runs: unknown[] }).runs).toHaveLength(1)
  })

  it('DOOR 1 (nested) — the list’s suite `tests` array carries none EITHER', async () => {
    seedScopedRun(db, { id: 'run-suite-parent', suiteId: 'suite-a' })
    seedScopedRun(db, { id: 'run-suite-child', suiteId: 'suite-a', parentRunId: 'run-suite-parent' })
    const res = await invokeRoute(router, '/api/runs')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as {
      runs: Array<{ id: string; metadata: Record<string, unknown> | null; tests?: Array<{ id: string; metadata: Record<string, unknown> | null }> }>
    }
    // ASSERTED ON THE CHILD ITSELF, not on the parent's serialization: one assertion covering both
    // would let a strip that only reached the top level pass.
    const parent = data.runs.find((run) => run.id === 'run-suite-parent')
    expect(parent?.tests?.map((test) => test.id)).toEqual(['run-suite-child'])
    expect(parent?.tests?.[0]?.metadata).not.toHaveProperty('confirmScope')
    expect(res.body).not.toContain(LEAKED_SCOPE)
  })

  it('DOOR 2 — GET /api/runs/:id (the detail) carries none, in `run`, `attempts` and `tests`', async () => {
    seedScopedRun(db, { id: 'run-detail', suiteId: 'suite-b' })
    seedScopedRun(db, { id: 'run-detail-child', suiteId: 'suite-b', parentRunId: 'run-detail' })
    const res = await invokeRoute(router, '/api/runs/run-detail')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as {
      run: { metadata: Record<string, unknown> | null }
      attempts: Array<{ id: string; metadata: Record<string, unknown> | null }>
      tests: Array<{ id: string; metadata: Record<string, unknown> | null }>
    }
    expect(data.run.metadata).not.toHaveProperty('confirmScope')
    expect(data.attempts).toHaveLength(1)
    expect(data.attempts[0]!.metadata).not.toHaveProperty('confirmScope')
    expect(data.tests[0]!.metadata).not.toHaveProperty('confirmScope')
    expect(res.body).not.toContain(LEAKED_SCOPE)
  })

  it('DOOR 3 — GET /api/runs/:id/artifact carries none, in `run`, in `children[].run` AND in the artifact PAYLOAD', async () => {
    // THE SEVENTH DOOR (G-401-18-CR01). The 401-18 version of this cell seeded
    // `db.insertRunArtifact({ runId, kind: 'test' })` — an artifact with NO PAYLOAD — so its
    // `not.toContain(LEAKED_SCOPE)` was structurally incapable of failing on the very field its
    // name claims. The payload below is shaped the way the PRODUCTION WRITER shapes it
    // (`job-queue.ts:75-78`: `metadata: { ...opts.metadata, attributes }`), which is the only way
    // this cell can be about the door that leaked rather than about an empty object.
    seedScopedRun(db, { id: 'run-artifact-scope' })
    seedScopedRun(db, { id: 'run-artifact-child', parentRunId: 'run-artifact-scope' })
    const writerShapedPayload = {
      runtime: { platform: 'web', queued: true },
      source: { name: 'Scoped Run', filePath: '/w/tests/scoped.yaml', loadStatus: 'queued' },
      metadata: {
        args: ['/w/tests/scoped.yaml'],
        confirmScope: LEAKED_SCOPE,
        laterField: FUTURE_FIELD_VALUE,
        attributes: { 'ci.provider': 'local' },
      },
    }
    db.insertRunArtifact({ runId: 'run-artifact-scope', kind: 'test', payload: writerShapedPayload })
    db.insertRunArtifact({ runId: 'run-artifact-child', kind: 'test', payload: writerShapedPayload })
    const res = await invokeRoute(router, '/api/runs/run-artifact-scope/artifact')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as {
      run: { metadata: Record<string, unknown> | null }
      artifact: { payload: Record<string, unknown> } | null
      children: Array<{
        run: { id: string; metadata: Record<string, unknown> | null }
        artifact: { payload: Record<string, unknown> } | null
      }>
    }
    expect(data.run.metadata).not.toHaveProperty('confirmScope')
    expect(data.children).toHaveLength(1)
    expect(data.children[0]!.run.metadata).not.toHaveProperty('confirmScope')

    // THE PAYLOAD REALLY WAS SERVED before anything is claimed about what it does not contain.
    expect(data.artifact, 'the artifact door served no artifact — the cell would be vacuous').not.toBeNull()
    const served = data.artifact!.payload['metadata'] as Record<string, unknown>
    expect(served, 'the served payload carried no `metadata` object').toBeDefined()
    expect(served).not.toHaveProperty('confirmScope')
    expect(served).not.toHaveProperty('laterField')
    // AN ALLOWLIST APPLIED TO THE CLIENT OBJECT, NOT A DELETE OF THE FIELD: `attributes` is minted
    // by the queue beside the client's keys and the run-detail drawer reads it.
    expect(served['attributes']).toEqual({ 'ci.provider': 'local' })
    expect(served['args']).toEqual(['/w/tests/scoped.yaml'])

    // The child artifact goes through the same sanitizer at its own call site.
    const childServed = data.children[0]!.artifact!.payload['metadata'] as Record<string, unknown>
    expect(childServed).not.toHaveProperty('confirmScope')

    expect(res.body).not.toContain(LEAKED_SCOPE)
    expect(res.body).not.toContain(FUTURE_FIELD_VALUE)
  })

  it('DOOR 4 — GET /api/queue/status carries none, in `pending`, `running` and `recent`', async () => {
    seedScopedRun(db, { id: 'run-pending', status: 'pending' })
    seedScopedRun(db, { id: 'run-running', status: 'running' })
    seedScopedRun(db, { id: 'run-done', status: 'passed' })
    const { router: queueRouter } = createQueueRouter(db)
    const res = await invokeRoute(queueRouter, '/api/queue/status?completed=true')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as {
      pending: { jobs: Array<{ metadata: Record<string, unknown> | null }> }
      running: { jobs: Array<{ metadata: Record<string, unknown> | null }> }
      recent: Array<{ metadata: Record<string, unknown> | null }>
    }
    expect(data.pending.jobs).toHaveLength(1)
    expect(data.running.jobs).toHaveLength(1)
    expect(data.recent).toHaveLength(1)
    expect(data.pending.jobs[0]!.metadata).not.toHaveProperty('confirmScope')
    expect(data.running.jobs[0]!.metadata).not.toHaveProperty('confirmScope')
    expect(data.recent[0]!.metadata).not.toHaveProperty('confirmScope')
    expect(res.body).not.toContain(LEAKED_SCOPE)
  })

  it('DOOR 5 — GET /api/analytics/tests/:name carries none', async () => {
    seedScopedRun(db, { id: 'run-analytics-test', name: 'Checkout' })
    const res = await invokeRoute(router, '/api/analytics/tests/Checkout')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as { runs: Array<{ metadata: Record<string, unknown> | null }> }
    expect(data.runs).toHaveLength(1)
    expect(data.runs[0]!.metadata).not.toHaveProperty('confirmScope')
    expect(res.body).not.toContain(LEAKED_SCOPE)
  })

  it('DOOR 6 — GET /api/analytics/suites/:suiteId carries none', async () => {
    seedScopedRun(db, { id: 'run-analytics-suite', suiteId: 'suite-checkout' })
    const suiteRouter = createRouter({
      db: db as never,
      suiteFileManager: {
        findBySuiteId: async (suiteId: string) => ({ suiteId, name: 'Checkout Suite' }),
      } as never,
    })
    const res = await invokeRoute(suiteRouter, '/api/analytics/suites/suite-checkout')
    expect(res.status).toBe(200)
    const data = JSON.parse(res.body) as { runs: Array<{ metadata: Record<string, unknown> | null }> }
    expect(data.runs).toHaveLength(1)
    expect(data.runs[0]!.metadata).not.toHaveProperty('confirmScope')
    expect(res.body).not.toContain(LEAKED_SCOPE)
  })

  it('THE ALLOWLIST FAILS CLOSED — a metadata field invented later does not leave either', async () => {
    // The shape decision, measured. A keyed removal of `confirmScope` would pass every cell above
    // and still be one `metadata.x = <secret>` away from the same defect; this is the cell that
    // tells the two shapes apart.
    seedScopedRun(db, { id: 'run-future-field' })
    const res = await invokeRoute(router, '/api/runs/run-future-field')
    expect(res.status).toBe(200)
    expect(res.body).not.toContain(FUTURE_FIELD_VALUE)
    expect(JSON.parse(res.body).run.metadata).not.toHaveProperty('laterField')
  })

  it('A RUN WITH ONLY PUBLISHABLE METADATA IS SERIALIZED UNCHANGED — the no-op control', async () => {
    const publishable = {
      args: ['/w/tests/plain.yaml'],
      isSuite: true,
      timeout: 60_000,
      timeoutSource: 'config',
      timeoutBaseMs: 50_000,
      timeoutBufferMs: 10_000,
      suiteIndex: 2,
      farmSessionUrl: 'https://farm.example/session/9',
      runDevice: 'chromium (remote)',
    }
    db.insertRun({ id: 'run-plain', name: 'Plain Run', metadata: publishable })
    const res = await invokeRoute(router, '/api/runs/run-plain')
    expect(res.status).toBe(200)
    expect((JSON.parse(res.body) as { run: { metadata: unknown } }).run.metadata).toEqual(publishable)
  })

  it('A RUN WITH NO METADATA AT ALL IS SERIALIZED UNCHANGED — `null` stays `null`', async () => {
    db.insertRun({ id: 'run-null-meta', name: 'No Metadata' })
    const res = await invokeRoute(router, '/api/runs/run-null-meta')
    expect(res.status).toBe(200)
    expect((JSON.parse(res.body) as { run: { metadata: unknown } }).run.metadata).toBeNull()
  })
})

describe('CR-02 — the read-path census cannot rot', () => {
  /**
   * EVERY PUBLIC `DashboardDatabase` METHOD THAT HANDS OUT A RUN ROW must be wrapped by the
   * router's response-safe projection, or a door reading through it leaks again.
   *
   * THE PREDICATE, STATED: parse `database.ts` into method signature blocks — a line at class-member
   * indentation opening a parameter list, joined forwards until the line that opens the body — and
   * keep the PUBLIC READS (`get…`) whose return annotation names `RunRow`, `RunArtifactBundle`
   * (whose `children` each carry a run row) or `RunArtifactRow` (whose `payload.metadata` is the
   * caller's own object). That is a scan of the producer, not a transcription of the doors this
   * plan happened to find.
   *
   * WIDENED IN 401-23, AND THE WIDENING IS THE FINDING. Its 401-18 form keyed on
   * `RunRow|RunArtifactBundle` alone, which `getRunArtifact(runId): RunArtifactRow | null`
   * structurally cannot match — so the census asserted SET EQUALITY, passed, and was blind to the
   * one door that was leaking. The live-surface predicate below now contradicts the narrow form, so
   * the scan is widened to the annotation that names an artifact row, and restricted to `get…` so
   * that `stageRunArtifact`/`finalizeRunArtifact` — writes that echo the row they just wrote — do
   * not become "reads" by the accident of their return type.
   *
   * SET EQUALITY, NOT CONTAINMENT, so a method DROPPED from the wrapper reds here as loudly as one
   * added to the db — a census that only checks one direction is blind to its own narrowing.
   */
  it('PREDICATE A (the producer) — the wrapper covers exactly the run reads the database declares', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'database.ts'),
      'utf8',
    )
    const lines = source.split('\n')
    const declared = new Set<string>()
    for (let index = 0; index < lines.length; index++) {
      const opening = /^ {2}(private |protected |static )?([a-zA-Z_$][\w$]*)\s*\(/.exec(lines[index]!)
      if (!opening) continue
      let signature = lines[index]!
      let cursor = index
      while (!signature.trimEnd().endsWith('{') && cursor + 1 < lines.length && cursor - index < 12) {
        cursor++
        signature += ` ${lines[cursor]!.trim()}`
      }
      if (!/\)\s*:\s*[^{]*\b(RunRow|RunArtifactBundle|RunArtifactRow)\b/.test(signature)) continue
      if (opening[1] !== undefined) continue
      if (!/^get/.test(opening[2]!)) continue
      declared.add(opening[2]!)
    }
    expect(declared.size, 'the signature scan found nothing — the predicate has rotted').toBeGreaterThan(3)
    expect([...declared].sort()).toEqual([...RESPONSE_SAFE_RUN_READ_METHODS].sort())
  })

  /**
   * PREDICATE B — THE WRAPPER'S OWN LIVE METHOD SURFACE (401-23, WR-08).
   *
   * A DIFFERENT AXIS, NOT A SECOND SPELLING OF PREDICATE A. Predicate A reads a SOURCE FILE and
   * believes what an annotation says; this one ranges the OBJECT the router will actually be handed
   * and asks what it can call. That is the axis on which 401-18's census was blind: no annotation
   * names a `payload` sub-object, and a method attached at runtime or inherited from a prototype
   * has no annotation at all. Neither predicate can certify itself with the other's evidence.
   *
   * DRIVEN BY MUTATION, WHICH IS THE ONLY BAR THAT MEANS ANYTHING HERE: a run-named read is PLANTED
   * on the database and the cell asserts construction throws NAMING it — then the plant is removed
   * and the same database constructs cleanly. A cell that only asserted the clean case would pass
   * against a wrapper with no assertion in it at all.
   */
  it('PREDICATE B (the live surface) — an unaccounted run-named read makes the wrapper throw at construction', () => {
    const clean = createMockDatabase()
    expect(() => createRouter(clean as never), 'the shipped database surface must construct').not.toThrow()

    const planted = createMockDatabase() as unknown as Record<string, unknown>
    planted['getRunsByAttribute'] = () => []
    let thrown: unknown
    try {
      createRouter(planted as never)
    } catch (error) {
      thrown = error
    }
    expect(thrown, 'a run-reading method absent from both sets passed through the prototype').toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('getRunsByAttribute')
    expect((thrown as Error).message).toContain('RESPONSE_SAFE_RUN_READ_METHODS')

    // AND IT FINDS ONE REACHED THROUGH THE PROTOTYPE, not merely one hung on the instance — the
    // exact shape `Object.create(db, {…})` used to forward silently.
    const inherited = Object.create({ getRunSecretsRaw: () => null }) as Record<string, unknown>
    Object.assign(inherited, createMockDatabase())
    expect(() => createRouter(inherited as never)).toThrow(/getRunSecretsRaw/)
  })

  /**
   * The `RUN_READS_WITHOUT_ROWS` justification that is a CLAIM ABOUT THIS ROUTER, pinned.
   *
   * `stageRunArtifact` and `finalizeRunArtifact` are excused because they echo a row to the WRITER
   * that supplied it and this router never calls them. That is a fact about `routes.ts`, and facts
   * about a file rot — so it is asserted rather than asserted-in-a-comment.
   */
  it('the excused artifact mutators are not reachable from the router at all', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'routes.ts'),
      'utf8',
    )
    for (const mutator of ['stageRunArtifact', 'finalizeRunArtifact']) {
      expect(
        source.includes(`db.${mutator}(`),
        `${mutator} is excused from the wrapper because this router never calls it — it now does`,
      ).toBe(false)
    }
  })
})
