// C441-PROOF (441 D-22, D-30): what `ask` and `chat` send, write and print outside a run carries
// `[secret:<name>]` for each declared value and never the value. 441-13 adds the run leg.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, join, relative, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { resolveAuthStatePaths } from '@vostride/agent-qa-core'
import { afterAll, describe, expect, it } from 'vitest'

import {
  recordedDoorProject,
  spawnCliRun,
  type CliRunOutcome,
  type RecordedDoorProject,
} from './433-door-fixture.js'
import { POPULATED_TARGET_NAME, type RecordedStubRequest } from './populated-run-fixture.js'
import { cleanupTempRoots, driveChatSpawned, type SpawnOutcome } from './spawned-chat.js'

const CELL_BUDGET_MS = 300_000

const SHORT = 'q^7'
const LONG = 'Lx~9^aZ4-proof441-long-declared-value-0123456789'
const SHORT_MARKER = '[secret:SHORT_441]'
const LONG_MARKER = '[secret:LONG_441]'
const RAW = [SHORT, LONG] as const
const MARKERS = [SHORT_MARKER, LONG_MARKER] as const
const SECRETS_FILE = '.env.secrets.local'

const FREE_FORM_UTTERANCE = `keep ${SHORT} and ${LONG} in mind`
const ECHO_UTTERANCE = `/fn knowledge.record.show ${JSON.stringify({ recordId: `${SHORT} ${LONG}` })}`

// D-21 media, the runs/<id>/blobs/ image documents, and the D-18 JSON paths blanked in handoff.json.
const EXCLUDED = {
  mediaExtensions: ['.png', '.jpg', '.jpeg', '.webp', '.webm', '.mp4', '.zip'],
  blobDirectory: /(^|\/)runs\/[^/]+\/blobs\//u,
  D18_PATHS: ['stepText', 'plannedAction', 'interpolatedVariables'],
} as const

afterAll(() => {
  cleanupTempRoots()
})

type HitClass = 'text' | 'sqlite' | 'handoff' | 'undecodable'

interface ScanHit {
  readonly path: string
  readonly class: HitClass
  readonly raw: string
}

interface ScanExclusions {
  readonly files: readonly string[]
}

const SQLITE_HEADER = 'SQLite format 3\u0000'
const SQLITE_SIDECARS = ['-wal', '-shm', '-journal']

function filesUnder(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...filesUnder(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function sqliteText(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    const cells: string[] = []
    for (const { name } of tables) {
      for (const row of db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()) {
        for (const value of Object.values(row as Record<string, unknown>)) {
          if (typeof value === 'string') cells.push(value)
        }
      }
    }
    return cells.join('\n')
  } finally {
    db.close()
  }
}

function blankD18(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(blankD18)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [
    key,
    (EXCLUDED.D18_PATHS as readonly string[]).includes(key) ? null : blankD18(member),
  ]))
}

function scanRoot(root: string, raw: readonly string[], exclusions: ScanExclusions): ScanHit[] {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const hits: ScanHit[] = []
  for (const path of filesUnder(root)) {
    const rel = relative(root, path).split(sep).join('/')
    if (exclusions.files.includes(path)) continue
    if (EXCLUDED.mediaExtensions.some((ext) => path.toLowerCase().endsWith(ext))) continue
    if (EXCLUDED.blobDirectory.test(rel)) continue
    const sidecarOf = SQLITE_SIDECARS.find((suffix) => path.endsWith(suffix))
    if (sidecarOf !== undefined && existsSync(path.slice(0, -sidecarOf.length))) continue
    const bytes = readFileSync(path)
    let text: string
    let kind: HitClass
    if (bytes.subarray(0, SQLITE_HEADER.length).toString('latin1') === SQLITE_HEADER) {
      text = sqliteText(path)
      kind = 'sqlite'
    } else {
      try {
        text = decoder.decode(bytes)
      } catch {
        hits.push({ path: rel, class: 'undecodable', raw: '<not UTF-8>' })
        continue
      }
      kind = 'text'
      if (basename(path) === 'handoff.json') {
        text = JSON.stringify(blankD18(JSON.parse(text)))
        kind = 'handoff'
      }
    }
    for (const value of raw) {
      if (text.includes(value)) hits.push({ path: rel, class: kind, raw: value })
    }
  }
  return hits
}

interface SessionEvent {
  readonly kind?: string
}

function sessionEvents(agentQaRoot: string): SessionEvent[] {
  const dir = join(agentQaRoot, 'sessions')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name.endsWith('.jsonl')).flatMap((name) =>
    readFileSync(join(dir, name), 'utf8').split('\n').filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as SessionEvent))
}

type PresenceClass = 'user_message' | 'clause_receipt'

function presence(agentQaRoot: string, marker: string): Record<PresenceClass, boolean> {
  const events = sessionEvents(agentQaRoot)
  const holds = (kind: PresenceClass): boolean =>
    events.filter((event) => event.kind === kind).some((event) => JSON.stringify(event).includes(marker))
  return { user_message: holds('user_message'), clause_receipt: holds('clause_receipt') }
}

function transcript(outcome: CliRunOutcome | SpawnOutcome): string {
  const code = 'status' in outcome ? outcome.status : outcome.code
  return `exit ${String(code)}\n--- stdout ---\n${outcome.stdout}\n--- stderr ---\n${outcome.stderr}`
}

function declare(root: string): string {
  const path = join(root, SECRETS_FILE)
  writeFileSync(path, `SHORT_441=${SHORT}\nLONG_441=${LONG}\n`, 'utf8')
  return path
}

interface ChatModelStub {
  readonly baseUrl: string
  readonly requests: readonly { readonly status: number; readonly fullBody: string }[]
  close(): Promise<void>
}

// Answers every chat-completions request 200 with prose and no tool call, recording each body whole.
async function startChatModelStub(): Promise<ChatModelStub> {
  const requests: { status: number; fullBody: string }[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => { raw += chunk })
    req.on('end', () => {
      const served = req.method === 'POST' && (req.url ?? '').startsWith('/v1/chat/completions')
      requests.push({ status: served ? 200 : 404, fullBody: raw })
      if (!served) {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-441',
        object: 'chat.completion',
        created: 0,
        model: 'stub-441',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Noted.' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }))
    })
  })
  await new Promise<void>((settle) => { server.listen(0, '127.0.0.1', settle) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new TypeError('the chat stub bound no port')
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}/v1`,
    requests,
    close: () => new Promise<void>((settle) => { server.close(() => settle()) }),
  }
}

function pointChatModelAt(project: RecordedDoorProject, baseUrl: string): void {
  const config = JSON.parse(readFileSync(project.configPath, 'utf8')) as {
    registry: { llms: { baseURL: string }[] }
  }
  for (const llm of config.registry.llms) llm.baseURL = baseUrl
  writeFileSync(project.configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

function wholeBodies(requests: readonly RecordedStubRequest[]): string[] {
  return requests.map((request) => {
    if (request.fullBody === undefined) throw new Error('the stub recorded a request without its whole body')
    return request.fullBody
  })
}

describe('C441-PROOF', () => {
  it('ask masks both declared values in what it writes and prints', async () => {
    const project = await recordedDoorProject('441-ask', { fullBodies: true })
    try {
      const secretsPath = declare(project.root)
      const freeForm = await spawnCliRun(project, ['ask', FREE_FORM_UTTERANCE])
      const echo = await spawnCliRun(project, ['ask', ECHO_UTTERANCE])

      expect(echo.status, transcript(echo)).toBe(0)
      expect(freeForm.status, transcript(freeForm)).toBe(1)
      expect(freeForm.stderr, transcript(freeForm)).toContain('Ask error [fail-closed]')

      for (const body of wholeBodies(project.model.requests)) {
        for (const value of RAW) expect(body.includes(value), `a model request carried ${value}`).toBe(false)
      }

      const events = sessionEvents(project.agentQaRoot)
      expect(events.filter((event) => event.kind === 'user_message')).toHaveLength(2)
      for (const marker of MARKERS) {
        expect(presence(project.agentQaRoot, marker), marker).toEqual({ user_message: true, clause_receipt: true })
      }

      const stdout = `${freeForm.stdout}\n${echo.stdout}`
      const stderr = `${freeForm.stderr}\n${echo.stderr}`
      for (const marker of MARKERS) expect(stdout, marker).toContain(marker)
      for (const value of RAW) {
        expect(stdout.includes(value), `stdout carried ${value}`).toBe(false)
        expect(stderr.includes(value), `stderr carried ${value}`).toBe(false)
      }

      expect(scanRoot(project.root, RAW, { files: [secretsPath] })).toEqual([])
    } finally {
      await project.close()
    }
  }, CELL_BUDGET_MS)

  it('ask refuses at start when the secrets file cannot be read', async () => {
    const project = await recordedDoorProject('441-ask-refusal', { fullBodies: true })
    try {
      const secretsPath = join(project.root, SECRETS_FILE)
      rmSync(secretsPath)
      const outcome = await spawnCliRun(project, ['ask', 'status'])

      expect(outcome.status, transcript(outcome)).toBe(1)
      expect(outcome.stderr).toContain(`Error: Secrets file not found: ${secretsPath}`)
      expect(outcome.stderr).toContain('Create the file before running tests. It may be empty, but it must exist.')
      expect(project.model.requests).toEqual([])
      expect(existsSync(join(project.agentQaRoot, 'sessions'))).toBe(false)
    } finally {
      await project.close()
    }
  }, CELL_BUDGET_MS)

  it('chat masks both declared values in every model request, the transcript and the terminal', async () => {
    const project = await recordedDoorProject('441-chat', { fullBodies: true })
    const stub = await startChatModelStub()
    try {
      const secretsPath = declare(project.root)
      pointChatModelAt(project, stub.baseUrl)
      const outcome = await driveChatSpawned(
        project.root,
        project.configPath,
        `${FREE_FORM_UTTERANCE}\n${ECHO_UTTERANCE}`,
      )

      expect(outcome.code, transcript(outcome)).toBe(0)
      expect(project.model.requests).toEqual([])
      expect(stub.requests.length, transcript(outcome)).toBeGreaterThan(0)
      const bodies = stub.requests.map((request) => request.fullBody)
      for (const body of bodies) {
        for (const value of RAW) expect(body.includes(value), `a model request carried ${value}`).toBe(false)
      }
      for (const marker of MARKERS) expect(bodies.join('\n'), marker).toContain(marker)

      for (const marker of MARKERS) {
        expect(presence(project.agentQaRoot, marker), marker).toEqual({ user_message: true, clause_receipt: true })
      }

      for (const marker of MARKERS) expect(outcome.stdout, marker).toContain(marker)
      for (const value of RAW) {
        expect(outcome.stdout.includes(value), `stdout carried ${value}`).toBe(false)
        expect(outcome.stderr.includes(value), `stderr carried ${value}`).toBe(false)
      }

      expect(scanRoot(project.root, RAW, { files: [secretsPath] })).toEqual([])
    } finally {
      await stub.close()
      await project.close()
    }
  }, CELL_BUDGET_MS)

  it('chat refuses at start when the secrets file cannot be read', async () => {
    const project = await recordedDoorProject('441-chat-refusal', { fullBodies: true })
    const stub = await startChatModelStub()
    try {
      pointChatModelAt(project, stub.baseUrl)
      const secretsPath = join(project.root, SECRETS_FILE)
      rmSync(secretsPath)
      const outcome = await driveChatSpawned(project.root, project.configPath, 'status')

      expect(outcome.code, transcript(outcome)).toBe(1)
      expect(outcome.stderr).toContain(`Error: Secrets file not found: ${secretsPath}`)
      expect(outcome.stderr).toContain('Create the file before running tests. It may be empty, but it must exist.')
      expect(stub.requests).toEqual([])
      expect(project.model.requests).toEqual([])
      expect(existsSync(join(project.agentQaRoot, 'sessions'))).toBe(false)
    } finally {
      await stub.close()
      await project.close()
    }
  }, CELL_BUDGET_MS)
})

// C441-NOTHING-ELSE (441 D-23, D-03): only declared values are masked, and nothing is blocked.
const TWIN_VALUES = [
  'qa@example.com',
  'cookie-441-value',
  'pw-env-441',
  'envfile-441',
  '4242 4242 4242 4242',
  'AKIAIOSFODNN7EXAMPLE',
  'Bearer abc123def456ghi789',
] as const
const TWIN_TEXT = TWIN_VALUES.join(' | ')
const TWIN_ENV = { AGENT_QA_X_PASSWORD: 'pw-env-441' }

function echoOf(text: string): string {
  return `/fn knowledge.record.show ${JSON.stringify({ recordId: text })}`
}

function sessionKinds(agentQaRoot: string, kind: string): string {
  return sessionEvents(agentQaRoot).filter((event) => event.kind === kind).map((event) => JSON.stringify(event)).join('\n')
}

function twinProject(project: RecordedDoorProject, secrets: string): void {
  writeFileSync(join(project.root, SECRETS_FILE), secrets, 'utf8')
  writeFileSync(join(project.root, '.env'), 'ENV_ONLY_441=envfile-441\n', 'utf8')
  const paths = resolveAuthStatePaths({
    configDir: dirname(project.configPath),
    targetName: POPULATED_TARGET_NAME,
    stateName: 'twin-441',
    platform: 'web',
  })
  mkdirSync(paths.targetDir, { recursive: true })
  writeFileSync(paths.payloadPath, `${JSON.stringify({
    cookies: [{
      name: 'session', value: 'cookie-441-value', domain: '127.0.0.1', path: '/',
      expires: -1, httpOnly: false, secure: false, sameSite: 'Lax',
    }],
    origins: [],
  })}\n`, 'utf8')
}

describe('C441-NOTHING-ELSE', () => {
  it('ask and chat leave every undeclared value unchanged and block nothing', async () => {
    const project = await recordedDoorProject('441-twin', { fullBodies: true })
    const stub = await startChatModelStub()
    try {
      twinProject(project, `SHORT_441=${SHORT}\n`)
      pointChatModelAt(project, stub.baseUrl)

      const chat = await driveChatSpawned(project.root, project.configPath, TWIN_TEXT, TWIN_ENV)
      expect(chat.code, transcript(chat)).toBe(0)
      expect(stub.requests.length, transcript(chat)).toBeGreaterThan(0)
      const bodies = stub.requests.map((request) => request.fullBody).join('\n')
      const chatMessages = sessionKinds(project.agentQaRoot, 'user_message')
      for (const value of TWIN_VALUES) {
        expect(bodies, value).toContain(value)
        expect(chatMessages, value).toContain(value)
      }
      rmSync(join(project.agentQaRoot, 'sessions'), { recursive: true, force: true })

      const beforeAsk = stub.requests.length
      const ask = await spawnCliRun(project, ['ask', echoOf(TWIN_TEXT)], { env: TWIN_ENV })
      expect(ask.status, transcript(ask)).toBe(0)
      const askMessages = sessionKinds(project.agentQaRoot, 'user_message')
      const askReceipts = sessionKinds(project.agentQaRoot, 'clause_receipt')
      for (const value of TWIN_VALUES) {
        expect(askMessages, value).toContain(value)
        expect(askReceipts, value).toContain(value)
        expect(ask.stdout, value).toContain(value)
        for (const request of stub.requests.slice(beforeAsk)) expect(request.fullBody, value).toContain(value)
      }

      expect(project.model.requests).toEqual([])
      for (const request of stub.requests) expect(request.status).toBe(200)
    } finally {
      await stub.close()
      await project.close()
    }
  }, CELL_BUDGET_MS)

  it('an empty secrets file changes nothing, and encoded or case-changed forms of a declared value are not masked', async () => {
    const project = await recordedDoorProject('441-twin-forms', { fullBodies: true })
    const stub = await startChatModelStub()
    try {
      twinProject(project, '')
      pointChatModelAt(project, stub.baseUrl)

      const chat = await driveChatSpawned(project.root, project.configPath, TWIN_TEXT, TWIN_ENV)
      const ask = await spawnCliRun(project, ['ask', echoOf(TWIN_TEXT)], { env: TWIN_ENV })
      expect(chat.code, transcript(chat)).toBe(0)
      expect(ask.status, transcript(ask)).toBe(0)
      const bodies = stub.requests.map((request) => request.fullBody).join('\n')
      const session = sessionKinds(project.agentQaRoot, 'user_message')
      for (const value of TWIN_VALUES) {
        expect(bodies, value).toContain(value)
        expect(session, value).toContain(value)
      }

      writeFileSync(join(project.root, SECRETS_FILE), `SHORT_441=${SHORT}\n`, 'utf8')
      rmSync(join(project.agentQaRoot, 'sessions'), { recursive: true, force: true })
      const before = stub.requests.length
      const forms = `Q^7 q%5E7 ${SHORT}`
      const chatForms = await driveChatSpawned(project.root, project.configPath, forms)
      expect(chatForms.code, transcript(chatForms)).toBe(0)
      const formBodies = stub.requests.slice(before).map((request) => request.fullBody)
      expect(formBodies.length, transcript(chatForms)).toBeGreaterThan(0)
      const formBody = formBodies.join('\n')
      expect(formBody).toContain('Q^7')
      expect(formBody).toContain('q%5E7')
      expect(formBody).toContain(SHORT_MARKER)
      expect(formBody.includes(SHORT)).toBe(false)
      rmSync(join(project.agentQaRoot, 'sessions'), { recursive: true, force: true })

      const askForms = await spawnCliRun(project, ['ask', echoOf(forms)])
      expect(askForms.status, transcript(askForms)).toBe(0)
      const askSession = sessionEvents(project.agentQaRoot).map((event) => JSON.stringify(event)).join('\n')
      expect(askSession).toContain('Q^7')
      expect(askSession).toContain('q%5E7')
      expect(askSession).toContain(SHORT_MARKER)
      expect(askSession.includes(SHORT)).toBe(false)

      expect(project.model.requests).toEqual([])
      for (const request of stub.requests) expect(request.status).toBe(200)
    } finally {
      await stub.close()
      await project.close()
    }
  }, CELL_BUDGET_MS)
})
