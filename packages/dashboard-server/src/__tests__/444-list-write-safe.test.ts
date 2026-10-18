import { EventEmitter } from 'node:events'
import { constants, existsSync, readFileSync, statSync } from 'node:fs'
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveWorkspacePaths, type ResolvedWorkspacePaths } from '@vostride/agent-qa-core'
import { generateTestId } from '@vostride/agent-qa-ids'

import { DashboardDatabase } from '../db/database.js'
import type { ExecutionBackend } from '../execution/execution-backend.js'
import { startServer } from '../server/server.js'
import { SuiteFileManager } from '../tests/suite-file-manager.js'
import { TestFileManager } from '../tests/test-file-manager.js'

// 2026-10-18 (444-33, D-65): reading the test or suite list never damages a file or a save racing it.

class IdleBackend extends EventEmitter {
  execute = (): void => undefined
  kill = (): boolean => false
  killAll = (): void => undefined
  getActiveExecutions = (): [] => []
}

type Kind = 'test' | 'suite'
type Answer = { status: number; body: any }
type Workspace = { dir: string; configPath: string; paths: ResolvedWorkspacePaths }

let root: string
const started: Array<{ close: () => void }> = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'agent-qa-444-list-write-safe-'))
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(async () => {
  while (started.length > 0) started.pop()?.close()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

function posixOnly(): void {
  if (process.platform === 'win32') throw new Error('POSIX file modes, symlinks and rename required; never skip')
}

async function workspace(name: string): Promise<Workspace> {
  const dir = join(root, name)
  await mkdir(join(dir, 'tests'), { recursive: true })
  await mkdir(join(dir, 'suites'), { recursive: true })
  const configPath = join(dir, 'agent-qa.config.yaml')
  await writeFile(configPath, 'testDir: tests\n')
  const paths = resolveWorkspacePaths({
    config: {
      workspace: {
        testMatch: ['tests/*.yaml'],
        suiteMatch: ['suites/*.suite.yaml'],
        hooksFile: 'hooks.yaml',
        envFile: '.env',
        secretsFile: '.env.secrets.local',
      },
      knowledge: { dir: 'agent-qa-knowledge', commitArtifacts: 'none' },
    },
    configPath,
  })
  return { dir, configPath, paths }
}

async function startDashboard(ws: Workspace): Promise<string> {
  const handle = await startServer({
    declaredSecretMask: (text) => text,
    db: new DashboardDatabase({ dbPath: join(ws.dir, 'runs.db') }),
    port: 0,
    configPath: ws.configPath,
    workspacePaths: ws.paths,
    executionBackend: new IdleBackend() as unknown as ExecutionBackend,
  })
  started.push(handle)
  return `http://127.0.0.1:${String((handle.server.address() as AddressInfo).port)}`
}

async function answer(response: Response): Promise<Answer> {
  const type = response.headers.get('content-type') ?? ''
  return { status: response.status, body: type.includes('application/json') ? await response.json() : await response.text() }
}

async function read(url: string): Promise<Answer> {
  return answer(await fetch(url))
}

async function send(url: string, method: 'POST' | 'PUT', payload: unknown): Promise<Answer> {
  return answer(await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }))
}

function rowsOf(reply: Answer, key: 'files' | 'tests' | 'suites'): Array<Record<string, any>> {
  const rows = reply.body !== null && typeof reply.body === 'object' ? reply.body[key] : undefined
  return Array.isArray(rows) ? rows : []
}

const idField = (kind: Kind): 'testId' | 'suiteId' => (kind === 'test' ? 'testId' : 'suiteId')

function splitIdLine(text: string, kind: Kind): { id: string | null; rest: string; idLines: number } {
  const newline = text.indexOf('\n')
  const first = newline === -1 ? text : text.slice(0, newline)
  const match = first.match(kind === 'test' ? /^test-id: (\S+)$/ : /^suite-id: (\S+)$/)
  const idLines = (text.match(kind === 'test' ? /^test-id:/gm : /^suite-id:/gm) ?? []).length
  return { id: match ? match[1] : null, rest: match ? text.slice(newline + 1) : text, idLines }
}

function oneIdOver(text: string, body: string, kind: Kind): string | null {
  const split = splitIdLine(text, kind)
  return split.id !== null && split.idLines === 1 && split.rest === body ? split.id : null
}

function describeFile(text: string | null, kind: Kind): string {
  if (text === null) return 'absent'
  const split = splitIdLine(text, kind)
  return `${String(text.length)} bytes, ${String(split.idLines)} id lines, first line ${JSON.stringify(text.slice(0, 48))}`
}

function filler(head: string, bytes: number, tag: string): string {
  const lines = [head]
  let size = head.length
  for (let index = 0; size < bytes; index++) {
    const line = `# ${tag} filler line ${String(index)} keeps this file large enough to be written in many chunks\n`
    lines.push(line)
    size += line.length
  }
  return lines.join('')
}

function smallTest(index: number): string {
  const steps = Array.from(
    { length: 12 },
    (_, step) => `  - step ${String(step)} of test ${String(index)} clicks the checkout button and checks the total\n`,
  )
  return `name: Test ${String(index)}\nsteps:\n${steps.join('')}`
}

function smallSuite(index: number): string {
  const notes = Array.from(
    { length: 12 },
    (_, note) => `# suite ${String(index)} note ${String(note)}: the nightly checkout suite runs against staging\n`,
  )
  return `name: Suite ${String(index)}\ntests: []\n${notes.join('')}`
}

const bigTest = (name: string, bytes: number): string =>
  filler(`name: ${name}\ntarget: web\nsteps:\n  - Open the ${name} page\n`, bytes, name)
const bigSuite = (name: string, bytes: number): string => filler(`name: ${name}\ntests: []\n`, bytes, name)

async function tmpFilesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true })
  return entries.filter((entry) => entry.endsWith('.tmp')).sort()
}

const pad = (index: number): string => String(index).padStart(3, '0')
const SAVE_BYTES = 950_000

describe('C444-LIST-WRITE-SAFE', () => {
  it('the Tests and Suites page reads sent together leave every id-less file whole under one id line, and every listed id opens', async () => {
    const lost: string[] = []
    const mismatched: string[] = []
    const unopened: string[] = []

    for (let round = 0; round < 5; round++) {
      const ws = await workspace(`round-${String(round)}`)
      const files: Array<{ kind: Kind; path: string; body: string }> = []
      for (let index = 0; index < 20; index++) {
        files.push({ kind: 'test', path: `tests/t${pad(index)}.yaml`, body: smallTest(index) })
        files.push({ kind: 'suite', path: `suites/s${pad(index)}.suite.yaml`, body: smallSuite(index) })
      }
      for (const file of files) await writeFile(join(ws.dir, file.path), file.body)
      const origin = await startDashboard(ws)

      const [testSummaries, testList, suiteSummaries, suiteList] = await Promise.all([
        read(`${origin}/api/analytics/test-summaries`),
        read(`${origin}/api/tests`),
        read(`${origin}/api/analytics/suite-summaries`),
        read(`${origin}/api/suites`),
      ])
      const replies = {
        test: { list: rowsOf(testList, 'files'), summaries: rowsOf(testSummaries, 'tests') },
        suite: { list: rowsOf(suiteList, 'files'), summaries: rowsOf(suiteSummaries, 'suites') },
      }
      const named = [
        ['GET /api/analytics/test-summaries', testSummaries, replies.test.summaries, 'test'],
        ['GET /api/tests', testList, replies.test.list, 'test'],
        ['GET /api/analytics/suite-summaries', suiteSummaries, replies.suite.summaries, 'suite'],
        ['GET /api/suites', suiteList, replies.suite.list, 'suite'],
      ] as const
      for (const [label, reply, rows, kind] of named) {
        expect(reply.status, `round ${String(round)}: ${label}`).toBe(200)
        expect(
          rows.map((row) => row.path).sort(),
          `round ${String(round)}: ${label} names all 20 files of its kind`,
        ).toEqual(files.filter((file) => file.kind === kind).map((file) => file.path).sort())
      }

      for (const file of files) {
        const disk = await readFile(join(ws.dir, file.path), 'utf-8')
        if (oneIdOver(disk, file.body, file.kind) === null) {
          lost.push(`round ${String(round)}: ${file.path} (${describeFile(disk, file.kind)})`)
        }
        const onDisk = splitIdLine(disk, file.kind).id
        const field = idField(file.kind)
        const listed = replies[file.kind].list.find((row) => row.path === file.path)?.[field] ?? null
        const summarized = replies[file.kind].summaries.find((row) => row.path === file.path)?.[field] ?? null
        if (listed !== onDisk || summarized !== onDisk) {
          mismatched.push(
            `round ${String(round)}: ${file.path} disk ${String(onDisk)} list ${String(listed)} summary ${String(summarized)}`,
          )
        }
        for (const id of new Set([listed, summarized])) {
          if (id === null) {
            unopened.push(`round ${String(round)}: ${file.path} listed with no id`)
            continue
          }
          const route = file.kind === 'test' ? 'tests' : 'suites'
          const opened = await read(`${origin}/api/${route}/${encodeURIComponent(id)}`)
          if (opened.status !== 200 || opened.body?.path !== file.path) {
            unopened.push(`round ${String(round)}: ${file.path} ${id} answered ${String(opened.status)}`)
          }
        }
      }
    }

    expect(
      { lost, mismatched, unopened },
      'every id-less file keeps its body under one id line, the answers name the id on disk, and every listed id opens',
    ).toEqual({ lost: [], mismatched: [], unopened: [] })
  })

  it('two list calls at once on one manager name the same id for each file, and the file holds one id line', async () => {
    // (a) the test manager, with a file that is only whitespace
    const a = await workspace('a')
    const testBodies = new Map<string, string>()
    for (let index = 0; index < 10; index++) testBodies.set(`tests/t${pad(index)}.yaml`, smallTest(index))
    testBodies.set('tests/blank.yaml', '  \n\t\n')
    for (const [path, body] of testBodies) await writeFile(join(a.dir, path), body)
    const tests = new TestFileManager(a.paths)
    const [firstTests, secondTests] = await Promise.all([tests.list(), tests.list()])
    expect(
      Object.fromEntries(secondTests.map((file) => [file.path, file.testId])),
      '(a) both test listings name the same id for each path',
    ).toEqual(Object.fromEntries(firstTests.map((file) => [file.path, file.testId])))
    expect(secondTests.map((file) => file.path), '(a) in the same order').toEqual(firstTests.map((file) => file.path))
    expect(firstTests.map((file) => file.path).sort(), '(a) every test file is listed').toEqual([...testBodies.keys()].sort())
    const modified = firstTests.map((file) => file.modified)
    expect(modified, '(a) newest modified first, as one list() gives').toEqual([...modified].sort().reverse())
    for (const file of firstTests) {
      expect(file.testId, `(a) ${file.path} is listed with an id`).not.toBeNull()
      const disk = await readFile(join(a.dir, file.path), 'utf-8')
      expect(oneIdOver(disk, testBodies.get(file.path)!, 'test'), `(a) ${file.path}: ${describeFile(disk, 'test')}`).toBe(
        file.testId,
      )
    }
    expect(await readFile(join(a.dir, 'tests/blank.yaml'), 'utf-8'), '(a) the whitespace survives byte for byte').toBe(
      `test-id: ${firstTests.find((file) => file.path === 'tests/blank.yaml')!.testId!}\n  \n\t\n`,
    )

    // (b) the suite manager
    const b = await workspace('b')
    const suiteBodies = new Map<string, string>()
    for (let index = 0; index < 10; index++) suiteBodies.set(`suites/s${pad(index)}.suite.yaml`, smallSuite(index))
    for (const [path, body] of suiteBodies) await writeFile(join(b.dir, path), body)
    const suites = new SuiteFileManager(b.paths, new TestFileManager(b.paths))
    const [firstSuites, secondSuites] = await Promise.all([suites.list(), suites.list()])
    expect(
      Object.fromEntries(secondSuites.map((file) => [file.path, file.suiteId])),
      '(b) both suite listings name the same id for each path',
    ).toEqual(Object.fromEntries(firstSuites.map((file) => [file.path, file.suiteId])))
    expect(secondSuites.map((file) => file.path), '(b) in the same order').toEqual(firstSuites.map((file) => file.path))
    expect(firstSuites.map((file) => file.path).sort(), '(b) every suite file is listed').toEqual(
      [...suiteBodies.keys()].sort(),
    )
    for (const file of firstSuites) {
      expect(file.suiteId, `(b) ${file.path} is listed with an id`).not.toBeNull()
      const disk = await readFile(join(b.dir, file.path), 'utf-8')
      expect(oneIdOver(disk, suiteBodies.get(file.path)!, 'suite'), `(b) ${file.path}: ${describeFile(disk, 'suite')}`).toBe(
        file.suiteId,
      )
    }

    // (c) a suite resolving its tests beside the test list, on the managers server.ts builds
    const c = await workspace('c')
    const cBodies = new Map<string, string>()
    for (let index = 0; index < 10; index++) cBodies.set(`tests/t${pad(index)}.yaml`, smallTest(index))
    for (const [path, body] of cBodies) await writeFile(join(c.dir, path), body)
    const cTests = new TestFileManager(c.paths)
    const cSuites = new SuiteFileManager(c.paths, cTests)
    const suiteContent = [
      'name: Every test',
      'target: web',
      'tests:',
      ...[...cBodies.keys()].flatMap((path) => [`  - test: ${path}`, `    id: ${generateTestId()}`]),
      '',
    ].join('\n')
    const [validation, cListing] = await Promise.all([cSuites.validate(suiteContent), cTests.list()])
    expect(validation, '(c) the suite naming every test validates').toEqual({ valid: true, errors: [] })
    for (const [path, body] of cBodies) {
      const disk = await readFile(join(c.dir, path), 'utf-8')
      const listed = cListing.find((file) => file.path === path)?.testId ?? null
      expect(listed, `(c) ${path} is listed with an id`).not.toBeNull()
      expect(oneIdOver(disk, body, 'test'), `(c) ${path}: ${describeFile(disk, 'test')}`).toBe(listed)
    }

    // (d) two list calls end to end: the second writes nothing
    const d = await workspace('d')
    const dBodies = new Map<string, string>()
    for (let index = 0; index < 10; index++) dBodies.set(`tests/t${pad(index)}.yaml`, smallTest(index))
    for (const [path, body] of dBodies) await writeFile(join(d.dir, path), body)
    const before = new Map<string, bigint>()
    for (const path of dBodies.keys()) before.set(path, (await stat(join(d.dir, path), { bigint: true })).mtimeNs)
    const dTests = new TestFileManager(d.paths)
    const snapshot = new Map<string, { ino: bigint; mtimeNs: bigint; bytes: string }>()
    const [dFirst, dSecond] = await dTests.list().then(async (first) => {
      for (const path of dBodies.keys()) {
        const s = statSync(join(d.dir, path), { bigint: true })
        snapshot.set(path, { ino: s.ino, mtimeNs: s.mtimeNs, bytes: readFileSync(join(d.dir, path), 'utf-8') })
      }
      return [first, await dTests.list()] as const
    })
    expect(
      Object.fromEntries(dSecond.map((file) => [file.path, file.testId])),
      '(d) the second list names the ids the first wrote',
    ).toEqual(Object.fromEntries(dFirst.map((file) => [file.path, file.testId])))
    for (const [path, body] of dBodies) {
      const s = await stat(join(d.dir, path), { bigint: true })
      const bytes = await readFile(join(d.dir, path), 'utf-8')
      const was = snapshot.get(path)!
      expect({ ino: s.ino, bytes }, `(d) ${path} is as the first list left it`).toEqual({ ino: was.ino, bytes: was.bytes })
      expect(oneIdOver(bytes, body, 'test'), `(d) ${path} holds one id line over its body`).toBe(
        dFirst.find((file) => file.path === path)?.testId,
      )
      expect(was.mtimeNs > before.get(path)!, `(d) the mint moved ${path}'s mtime`).toBe(true)
    }

    // (e) a workspace with no test or suite files
    const e = await workspace('e')
    const eTests = new TestFileManager(e.paths)
    const eSuites = new SuiteFileManager(e.paths, eTests)
    const listing = async (): Promise<string[]> => (await readdir(e.dir, { recursive: true })).sort()
    const eBefore = await listing()
    expect(await Promise.all([eTests.list(), eTests.list(), eSuites.list(), eSuites.list()]), '(e) at once').toEqual([
      [],
      [],
      [],
      [],
    ])
    const oneAfterAnother = [await eTests.list(), await eTests.list(), await eSuites.list(), await eSuites.list()]
    expect(oneAfterAnother, '(e) one after another').toEqual([[], [], [], []])
    expect(await listing(), '(e) nothing is written').toEqual(eBefore)
  })

  it('a reader during an id write never sees an empty or partial file', async () => {
    posixOnly()
    const ws = await workspace('reader')
    const files: Array<{ kind: Kind; path: string; body: string }> = []
    for (let index = 0; index < 4; index++) {
      files.push({ kind: 'test', path: `tests/big${String(index)}.yaml`, body: bigTest(`Big test ${String(index)}`, 3_000_000) })
      files.push({
        kind: 'suite',
        path: `suites/big${String(index)}.suite.yaml`,
        body: bigSuite(`Big suite ${String(index)}`, 3_000_000),
      })
    }
    for (const file of files) await writeFile(join(ws.dir, file.path), file.body)
    const tests = new TestFileManager(ws.paths)
    const suites = new SuiteFileManager(ws.paths, tests)

    let settled = false
    const partial: string[] = []
    let partialCount = 0
    const readsInFlight = new Map<string, number>()
    const lists = Promise.all([tests.list(), suites.list()]).finally(() => {
      settled = true
    })
    const readers = files.map(async (file) => {
      while (!settled) {
        readsInFlight.set(file.path, (readsInFlight.get(file.path) ?? 0) + 1)
        const text = await readFile(join(ws.dir, file.path), 'utf-8')
        if (text !== file.body && oneIdOver(text, file.body, file.kind) === null) {
          partialCount++
          if (partial.length < 40) partial.push(`${file.path}: ${String(text.length)} bytes`)
        }
      }
    })
    await lists
    await Promise.all(readers)

    expect({ partialCount, partial }, 'no read was neither the whole body nor one id line over it').toEqual({
      partialCount: 0,
      partial: [],
    })
    for (const file of files) {
      expect(readsInFlight.get(file.path) ?? 0, `${file.path} was read while the lists ran`).toBeGreaterThan(0)
      const disk = await readFile(join(ws.dir, file.path), 'utf-8')
      expect(oneIdOver(disk, file.body, file.kind), `${file.path}: ${describeFile(disk, file.kind)}`).not.toBeNull()
    }
    expect(await tmpFilesUnder(ws.dir), 'no temp file is left').toEqual([])
  })

  it('an id write goes through a symlink to its target and keeps the file mode, and a file it may not write keeps its bytes and gets no id', async () => {
    posixOnly()
    const ws = await workspace('link-mode')
    await mkdir(join(ws.dir, 'real'))
    const bodies = {
      test: { locked: bigTest('Locked', 2_000), private: bigTest('Private', 2_000), linked: bigTest('Linked', 2_000) },
      suite: { locked: bigSuite('Locked', 2_000), private: bigSuite('Private', 2_000), linked: bigSuite('Linked', 2_000) },
    }
    const where = {
      test: { locked: 'tests/locked.yaml', private: 'tests/private.yaml', linked: 'tests/linked.yaml', real: 'real/linked.yaml' },
      suite: {
        locked: 'suites/locked.suite.yaml',
        private: 'suites/private.suite.yaml',
        linked: 'suites/linked.suite.yaml',
        real: 'real/linked.suite.yaml',
      },
    }
    const kinds: Kind[] = ['test', 'suite']
    const writable = new Map<Kind, boolean>()
    for (const kind of kinds) {
      await writeFile(join(ws.dir, where[kind].locked), bodies[kind].locked)
      await chmod(join(ws.dir, where[kind].locked), 0o444)
      await writeFile(join(ws.dir, where[kind].private), bodies[kind].private)
      await chmod(join(ws.dir, where[kind].private), 0o640)
      await writeFile(join(ws.dir, where[kind].real), bodies[kind].linked)
      await symlink(`../${where[kind].real}`, join(ws.dir, where[kind].linked))
      writable.set(
        kind,
        await access(join(ws.dir, where[kind].locked), constants.W_OK).then(
          () => true,
          () => false,
        ),
      )
    }

    const tests = new TestFileManager(ws.paths)
    const suites = new SuiteFileManager(ws.paths, tests)
    const [testListing, suiteListing] = await Promise.all([tests.list(), suites.list()])
    const listedId = (kind: Kind, path: string): string | null => {
      const rows: Array<{ path: string; testId?: string | null; suiteId?: string | null }> =
        kind === 'test' ? testListing : suiteListing
      const row = rows.find((candidate) => candidate.path === path)
      expect(row, `${path} is listed`).toBeDefined()
      return (kind === 'test' ? row!.testId : row!.suiteId) ?? null
    }

    // (1) the read-only files
    for (const kind of kinds) {
      const path = where[kind].locked
      const disk = await readFile(join(ws.dir, path), 'utf-8')
      const mode = (await stat(join(ws.dir, path))).mode & 0o777
      if (!writable.get(kind)) {
        expect(disk, `(1) ${path}, which this process may not write, keeps its bytes`).toBe(bodies[kind].locked)
        expect(mode, `(1) ${path} keeps mode 0o444`).toBe(0o444)
        expect(listedId(kind, path), `(1) ${path}, which this process may not write, is listed with no id`).toBeNull()
      } else {
        expect(oneIdOver(disk, bodies[kind].locked, kind), `(1) ${path}: ${describeFile(disk, kind)}`).toBe(
          listedId(kind, path),
        )
        expect(mode, `(1) ${path} keeps mode 0o444`).toBe(0o444)
      }
    }

    // (2) the symlinks
    for (const kind of kinds) {
      const link = join(ws.dir, where[kind].linked)
      expect((await lstat(link)).isSymbolicLink(), `(2) ${where[kind].linked} is still a symlink`).toBe(true)
      expect(await readlink(link), `(2) ${where[kind].linked} keeps its link text`).toBe(`../${where[kind].real}`)
      const disk = await readFile(join(ws.dir, where[kind].real), 'utf-8')
      const id = listedId(kind, where[kind].linked)
      expect(id, `(2) ${where[kind].linked} is listed with an id`).not.toBeNull()
      expect(oneIdOver(disk, bodies[kind].linked, kind), `(2) ${where[kind].real}: ${describeFile(disk, kind)}`).toBe(id)
    }
    expect((await readdir(join(ws.dir, 'real'))).sort(), '(2) real/ holds only the two link targets').toEqual([
      'linked.suite.yaml',
      'linked.yaml',
    ])

    // (3) the 0o640 files
    for (const kind of kinds) {
      const path = where[kind].private
      expect((await stat(join(ws.dir, path))).mode & 0o777, `(3) ${path} keeps mode 0o640`).toBe(0o640)
      const disk = await readFile(join(ws.dir, path), 'utf-8')
      const id = listedId(kind, path)
      expect(id, `(3) ${path} is listed with an id`).not.toBeNull()
      expect(oneIdOver(disk, bodies[kind].private, kind), `(3) ${path}: ${describeFile(disk, kind)}`).toBe(id)
    }

    // (4) no temp file
    expect(await tmpFilesUnder(ws.dir), '(4) no temp file is left').toEqual([])
  })

  it('a save sent with the list reads keeps exactly the saved body under one id line, a delete stays deleted, and no reader sees a partial file', async () => {
    posixOnly()
    const KEPT = 'tests/kept.yaml'
    const BARE = 'tests/bare.yaml'
    const FRESH = 'tests/fresh.yaml'
    const endStates: Array<Record<string, string>> = []
    const keptMisnamed: string[] = []
    const lastMisnamed: string[] = []
    const partial: string[] = []
    let partialCount = 0

    // (h) the editor's saves over HTTP, sent with the page's list reads
    for (let round = 0; round < 5; round++) {
      const ws = await workspace(`save-${String(round)}`)
      const keptId = generateTestId()
      const keptOld = `test-id: ${keptId}\n${bigTest('Kept old', SAVE_BYTES)}`
      const bareOld = bigTest('Bare old', SAVE_BYTES)
      await writeFile(join(ws.dir, KEPT), keptOld)
      await writeFile(join(ws.dir, BARE), bareOld)
      const origin = await startDashboard(ws)

      const savedBody = (id: string, name: string) => `test-id: ${id}\n${bigTest(name, SAVE_BYTES)}`
      const bareId = generateTestId()
      const freshId = generateTestId()
      const saved: Record<string, { id: string; body: string }> = {
        [KEPT]: { id: keptId, body: savedBody(keptId, 'Kept saved') },
        [BARE]: { id: bareId, body: savedBody(bareId, 'Bare saved') },
        [FRESH]: { id: freshId, body: savedBody(freshId, 'Fresh saved') },
      }
      const allowed: Record<string, (text: string | null) => boolean> = {
        [KEPT]: (text) => text === keptOld || text === saved[KEPT].body,
        [BARE]: (text) => text === bareOld || (text !== null && oneIdOver(text, bareOld, 'test') !== null) || text === saved[BARE].body,
        [FRESH]: (text) => text === null || text === saved[FRESH].body,
      }

      let saving = true
      const roundPartial: string[] = []
      const readers = [KEPT, BARE, FRESH].map(async (path) => {
        while (saving) {
          let text: string | null
          try {
            text = await readFile(join(ws.dir, path), 'utf-8')
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
            text = null
          }
          if (!allowed[path](text)) {
            partialCount++
            if (roundPartial.length < 12) roundPartial.push(`round ${String(round)}: ${path} ${describeFile(text, 'test')}`)
          }
        }
      })
      const listReads = (async () => {
        const replies: Array<[string, Answer]> = []
        while (saving) {
          const [list, summaries] = await Promise.all([read(`${origin}/api/tests`), read(`${origin}/api/analytics/test-summaries`)])
          replies.push(['GET /api/tests', list], ['GET /api/analytics/test-summaries', summaries])
        }
        return replies
      })()
      const saves = await Promise.all([
        send(`${origin}/api/tests/${encodeURIComponent(keptId)}`, 'PUT', { content: saved[KEPT].body }),
        send(`${origin}/api/tests`, 'POST', { path: BARE, content: saved[BARE].body }),
        send(`${origin}/api/tests`, 'POST', { path: FRESH, content: saved[FRESH].body }),
      ]).finally(() => {
        saving = false
      })
      const replies = await listReads
      await Promise.all(readers)
      partial.push(...roundPartial)

      expect(
        saves.map((reply) => reply.status),
        `round ${String(round)}: the saves answered ${JSON.stringify(saves.map((reply) => reply.body))}`,
      ).toEqual([200, 201, 201])

      for (const [label, reply] of replies) {
        const rows = rowsOf(reply, label === 'GET /api/tests' ? 'files' : 'tests')
        const kept = rows.find((row) => row.path === KEPT)
        if (reply.status !== 200 || kept?.testId !== keptId) {
          keptMisnamed.push(`round ${String(round)}: ${label} (${String(reply.status)}) named ${String(kept?.testId)}`)
        }
      }
      const last = await read(`${origin}/api/tests`)
      const lastRows = rowsOf(last, 'files')
      const state: Record<string, string> = {}
      for (const path of [KEPT, BARE, FRESH]) {
        const disk = existsSync(join(ws.dir, path)) ? await readFile(join(ws.dir, path), 'utf-8') : null
        state[path] = disk === saved[path].body ? 'saved' : describeFile(disk, 'test')
        const named = lastRows.find((row) => row.path === path)?.testId
        if (named !== saved[path].id) lastMisnamed.push(`round ${String(round)}: ${path} named ${String(named)}`)
      }
      endStates.push(state)
    }

    expect(endStates, '(h) each file holds exactly its saved body after every round').toEqual(
      Array.from({ length: 5 }, () => ({ [KEPT]: 'saved', [BARE]: 'saved', [FRESH]: 'saved' })),
    )
    expect(keptMisnamed, "(h) every list answer during the race named kept's id").toEqual([])
    expect(lastMisnamed, "(h) the last answer names each file's saved id").toEqual([])
    expect({ partialCount, partial }, '(h) no raw read saw a partial file').toEqual({ partialCount: 0, partial: [] })

    // (m) an id-less save and a delete beside list(), on both managers
    for (const kind of ['test', 'suite'] as const) {
      const ws = await workspace(`managers-${kind}`)
      const bare = kind === 'test' ? BARE : 'suites/bare.suite.yaml'
      const gone = kind === 'test' ? 'tests/gone.yaml' : 'suites/gone.suite.yaml'
      const make = kind === 'test' ? bigTest : bigSuite
      await writeFile(join(ws.dir, bare), make('Bare old', SAVE_BYTES))
      await writeFile(join(ws.dir, gone), make('Gone', 2_000))
      const tests = new TestFileManager(ws.paths)
      const manager = kind === 'test' ? tests : new SuiteFileManager(ws.paths, tests)
      const newBody = make('Bare new', SAVE_BYTES)
      await Promise.all([manager.write(bare, newBody), manager.delete(gone), manager.list(), manager.list()])
      const lastListing: Array<{ path: string; testId?: string | null; suiteId?: string | null }> = await manager.list()
      const disk = await readFile(join(ws.dir, bare), 'utf-8')
      const id = oneIdOver(disk, newBody, kind)
      expect(id, `(m) ${bare} holds one id line over the new body: ${describeFile(disk, kind)}`).not.toBeNull()
      const row = lastListing.find((candidate) => candidate.path === bare)
      expect(kind === 'test' ? row?.testId : row?.suiteId, `(m) the last ${kind} list names ${bare}'s id`).toBe(id)
      expect(existsSync(join(ws.dir, gone)), `(m) ${gone} stays deleted`).toBe(false)
      expect(await tmpFilesUnder(ws.dir), `(m) no temp file is left in the ${kind} workspace`).toEqual([])
    }
  })
})
