/**
 * THE ONE-RECORD CENSUS (Phase 443, V2-RUN-02 / SC2; D-11, D-12, D-16, D-25).
 *
 * Phase 443 gave every door one run record: one builder in the run command constructs the
 * dashboard ingest, every drive call passes the record that builder made, and no door composes a
 * second run path. The run-id inputs the old correlation read are gone. Each cell here REDs if one
 * of those returns, following the 442 census: comments are blanked by the same lexer, every needle
 * is assembled from two halves at run time, production source only (no `__tests__`, no `dist`),
 * and the self-match cell proves this file spells none of them. Function bodies and call options
 * are read through the TypeScript AST.
 *
 * FORMER SITES AND WHAT REPLACED EACH (cell in brackets)
 *
 *   cli/src/commands/dashboard.ts, the queue    its own ingest and bus member -> the queue row's
 *   entry's ingest                              attributes lent to the run's record (443-05)
 *                                               [the bridge has no member of its own]
 *   cli/src/commands/run.ts, the run command's  a per-path ingest builder on each of the two
 *   two ingest builders                         paths -> the one builder, opened after the
 *                                               refusal (443-05, 443-08) [the ingest only inside
 *                                               the builder; every drive call passes its record]
 *   cli/src/daemon/host.ts, the no-record rule  a daemon run wrote no row -> the daemon builds a
 *                                               record per run (443-06) [every drive call]
 *   the environment correlation                 a suite-queue id, a parent-run id and the ingest's
 *                                               correlation input -> the run's own id only (443-04,
 *                                               443-09) [C443-ENV-RETIRED]
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const PACKAGES_DIR = fileURLToPath(new URL('../../../', import.meta.url))
const REPO_ROOT = join(PACKAGES_DIR, '..')
const THIS_FILE = fileURLToPath(import.meta.url)
const OWN = 'arch/src/__tests__/443-one-record-census.test.ts'

// ---------------------------------------------------------------------------------------------
// The lexer (the 432 to 442 censuses'): comments out, everything else in
// ---------------------------------------------------------------------------------------------

function regexAllowed(out: string): boolean {
  let k = out.length - 1
  while (k >= 0 && /\s/.test(out[k]!)) k--
  if (k < 0) return true
  if ('(,=:[!&|?{};+-*%<>~^'.includes(out[k]!)) return true
  const word = /([A-Za-z_$][\w$]*)$/.exec(out.slice(0, k + 1))
  return word !== null
    && ['return', 'typeof', 'case', 'yield', 'await', 'in', 'of', 'void', 'delete'].includes(word[1]!)
}

function codeOf(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  const templateDepths: number[] = []
  let depth = 0
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  while (i < n) {
    const c = text[i]!
    const d = text[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === '/' && regexAllowed(out)) {
        let j = i + 1
        let inClass = false
        while (j < n && text[j] !== '\n') {
          const ch = text[j]
          if (ch === '\\') { j += 2; continue }
          if (ch === '[') inClass = true
          else if (ch === ']') inClass = false
          else if (ch === '/' && !inClass) break
          j++
        }
        if (j < n && text[j] === '/') {
          j++
          while (j < n && /[a-z]/i.test(text[j]!)) j++
          out += text.slice(i, j)
          i = j
          continue
        }
      }
      if (c === "'") { state = 'single'; out += c; i++; continue }
      if (c === '"') { state = 'double'; out += c; i++; continue }
      if (c === '`') { state = 'template'; out += c; i++; continue }
      if (c === '{') { depth++; out += c; i++; continue }
      if (c === '}') {
        if (templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === depth) {
          templateDepths.pop()
          depth--
          state = 'template'
          out += c
          i++
          continue
        }
        depth--
        out += c
        i++
        continue
      }
      out += c
      i++
      continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c } else out += ' '
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i++
      continue
    }
    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"'
      if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
      if (c === quote || c === '\n') state = 'code'
      out += c
      i++
      continue
    }
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
    if (c === '`') { state = 'code'; out += c; i++; continue }
    if (c === '$' && d === '{') { depth++; templateDepths.push(depth); state = 'code'; out += '${'; i += 2; continue }
    out += c
    i++
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// The universes: production source by the 412 path rule, read as bytes
// ---------------------------------------------------------------------------------------------

function listTree(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    if (!existsSync(join(PACKAGES_DIR, dir))) return
    for (const entry of readdirSync(join(PACKAGES_DIR, dir), { withFileTypes: true })) {
      const child = `${dir}${entry.name}`
      if (entry.isDirectory()) walk(`${child}/`)
      else if (/\.tsx?$/.test(entry.name)) files.push(child)
    }
  }
  walk(root)
  return files.sort()
}

const isProduction = (file: string): boolean =>
  !file.includes('/__tests__/') && !/\.test(-d)?\.tsx?$/.test(file)

function filesOf(region: string): string[] {
  if (region.endsWith('/')) return listTree(region).filter(isProduction)
  return existsSync(join(PACKAGES_DIR, region)) ? [region] : []
}

const bytesOf = (file: string): string => readFileSync(join(PACKAGES_DIR, file)).toString('utf8')

const codeCache = new Map<string, string>()
function code(file: string): string {
  let cached = codeCache.get(file)
  if (cached === undefined) {
    cached = existsSync(join(PACKAGES_DIR, file)) ? codeOf(bytesOf(file)) : ''
    codeCache.set(file, cached)
  }
  return cached
}

function scanned(regions: readonly string[]): string[] {
  return [...new Set(regions.flatMap(filesOf))]
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length

// Every file, any extension, under the repository root: the retired-name universe is not only
// TypeScript (the scripts are shell, Python and ES modules).
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '__tests__'])
function listAll(dir: string): string[] {
  const files: string[] = []
  const walk = (at: string): void => {
    if (!existsSync(join(REPO_ROOT, at))) return
    for (const entry of readdirSync(join(REPO_ROOT, at), { withFileTypes: true })) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      const child = `${at}${entry.name}`
      if (entry.isDirectory()) walk(`${child}/`)
      else if (entry.isFile() && !/\.test(-d)?\.[cm]?[jt]sx?$/.test(entry.name)) files.push(child)
    }
  }
  walk(dir)
  return files.sort()
}

function retiredUniverse(): string[] {
  const packageSources = readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => listAll(`packages/${entry.name}/src/`))
  return [...packageSources, ...listAll('scripts/')]
}

// ---------------------------------------------------------------------------------------------
// The needles, every one assembled from two halves
// ---------------------------------------------------------------------------------------------

type Halves = readonly [string, string]
const joined = (halves: Halves): string => halves[0] + halves[1]
const cat = (...parts: string[]): string => parts.join('')

const INGEST: Halves = ['createDashboardRun', 'Ingest']
const DRIVE: Halves = ['runInProcess', 'CliRun']
const CORE: Halves = ['createRunInvocation', 'Core']
const MEMBER: Halves = ['subscri', 'bers']
const BUILDER: Halves = ['createRun', 'Record']
const DB_CLASS: Halves = ['Dashboard', 'Database']
const OWNERSHIP: Halves = ['composeRun', 'Ownership']
const BRIDGE_DOOR: Halves = ['createDashboard', 'RunDoor']
const RETIRED: readonly Halves[] = [
  ['AGENT_QA_SUITE_', 'QUEUE_ID'],
  ['AGENT_QA_PARENT_', 'RUN_ID'],
  ['DashboardRunIngestCorrel', 'ationEnv'],
  ['correlat', 'ionEnv'],
  ['suiteQue', 'ueId'],
  ['readDashboardCorrel', 'ationEnv'],
]

const CLI = 'cli/src/'
const RUN_TS = 'cli/src/commands/run.ts'
const DASHBOARD_TS = 'cli/src/commands/dashboard.ts'
const LOCAL_HOST = 'cli/src/composition/local-agent-host.ts'
const DAEMON_HOST = 'cli/src/daemon/host.ts'
const DRIVE_FILE = 'cli/src/composition/in-process-run-execution.ts'
const DOOR_FILES = [RUN_TS, DASHBOARD_TS, LOCAL_HOST, DAEMON_HOST, DRIVE_FILE]
const DRIVE_CALLS: readonly string[] = [RUN_TS, RUN_TS, LOCAL_HOST, DAEMON_HOST, DRIVE_FILE].sort()

// ---------------------------------------------------------------------------------------------
// The AST reads
// ---------------------------------------------------------------------------------------------

interface Source { readonly file: string; readonly text: string }

const astCache = new Map<string, ts.SourceFile>()
function ast(source: Source): ts.SourceFile {
  const key = `${source.file}\u0000${source.text.length}\u0000${source.text.slice(0, 64)}`
  let cached = astCache.get(key)
  if (cached === undefined || cached.text !== source.text) {
    const kind = source.file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    cached = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true, kind)
    astCache.set(key, cached)
  }
  return cached
}

function each(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => each(child, visit))
}

function unwrap(node: ts.Expression): ts.Expression {
  let at = node
  while (
    ts.isParenthesizedExpression(at) || ts.isAsExpression(at) || ts.isNonNullExpression(at)
    || ts.isTypeAssertionExpression(at) || ts.isSatisfiesExpression(at) || ts.isAwaitExpression(at)
  ) at = at.expression
  return at
}

function calleeName(call: ts.CallExpression | ts.NewExpression): string | undefined {
  const callee = unwrap(call.expression)
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return undefined
}

function callsOf(source: Source, name: Halves): ts.CallExpression[] {
  const found: ts.CallExpression[] = []
  each(ast(source), (node) => {
    if (ts.isCallExpression(node) && calleeName(node) === joined(name)) found.push(node)
  })
  return found
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  let at = node.parent
  while (at !== undefined && !ts.isFunctionLike(at)) at = at.parent
  return at
}

const lineOf = (node: ts.Node): number =>
  node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1

function namedFunction(source: Source, name: Halves): ts.FunctionDeclaration | undefined {
  let found: ts.FunctionDeclaration | undefined
  each(ast(source), (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === joined(name)) found ??= node
  })
  return found
}

function propertyNamed(options: ts.Expression | undefined, name: string): ts.ObjectLiteralElementLike | undefined {
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return undefined
  return options.properties.find((property) => property.name !== undefined
    && ts.isIdentifier(property.name) && property.name.text === name)
}

// ---------------------------------------------------------------------------------------------
// The predicates
// ---------------------------------------------------------------------------------------------

const acquiresIngest = (text: string): boolean =>
  new RegExp(`\\b${joined(INGEST)}\\b`).test(codeOf(text))

function ingestOffenses(sources: readonly Source[]): string[] {
  const offenses: string[] = []
  for (const source of sources) {
    if (source.file !== RUN_TS && acquiresIngest(source.text)) {
      offenses.push(`${source.file}: acquires the ingest outside ${RUN_TS}`)
    }
  }
  const run = sources.find((source) => source.file === RUN_TS)
  if (run === undefined) return [...offenses, `${RUN_TS} was not scanned`]
  const builder = namedFunction(run, BUILDER)
  if (builder?.body === undefined) return [...offenses, `${RUN_TS} declares no ${joined(BUILDER)}`]
  const calls = callsOf(run, INGEST)
  if (calls.length !== 1) offenses.push(`${RUN_TS}: ${calls.length} ingest constructions, not one`)
  for (const call of calls) {
    const inside = call.getStart() >= builder.body.getStart() && call.getEnd() <= builder.body.getEnd()
    if (!inside) offenses.push(`${RUN_TS}:${lineOf(call)}: an ingest construction outside ${joined(BUILDER)}`)
  }
  return offenses
}

interface DriveSite { readonly file: string; readonly line: number; readonly problems: readonly string[] }

function builtRecordsIn(fn: ts.SignatureDeclaration): string[] {
  const names: string[] = []
  each(fn, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || node.initializer === undefined) return
    if (enclosingFunction(node) !== fn) return
    const value = unwrap(node.initializer)
    if (ts.isCallExpression(value) && calleeName(value) === joined(BUILDER)) names.push(node.name.text)
  })
  return names
}

function driveSites(source: Source): DriveSite[] {
  return callsOf(source, DRIVE).map((call) => {
    const problems: string[] = []
    const property = propertyNamed(call.arguments[0], 'runRecord')
    const bound = property === undefined
      ? undefined
      : ts.isShorthandPropertyAssignment(property)
        ? property.name.text
        : ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)
          ? property.initializer.text
          : undefined
    if (property === undefined) problems.push('its options name no runRecord')
    const fn = enclosingFunction(call)
    const built = fn === undefined ? [] : builtRecordsIn(fn)
    if (built.length === 0) problems.push(`its function names no ${joined(BUILDER)}(`)
    if (bound === undefined || !built.includes(bound)) {
      problems.push(`its runRecord is not a ${joined(BUILDER)} result of the same function`)
    }
    return { file: source.file, line: lineOf(call), problems }
  })
}

interface HandleSite { readonly file: string; readonly line: number; readonly owned: boolean }

function handleSites(source: Source): HandleSite[] {
  const sites: HandleSite[] = []
  each(ast(source), (node) => {
    if (!ts.isNewExpression(node) || calleeName(node) !== joined(DB_CLASS)) return
    const owner = propertyNamed(node.arguments?.[0], 'runOwnership')
    const value = owner !== undefined && ts.isPropertyAssignment(owner) ? unwrap(owner.initializer) : undefined
    const owned = value !== undefined && ts.isCallExpression(value)
      && calleeName(value) === joined(OWNERSHIP) && value.arguments.length === 0
    sites.push({ file: source.file, line: lineOf(node), owned })
  })
  return sites
}

const retiredHits = (file: string, text: string): string[] => RETIRED.flatMap((halves) => {
  const needle = joined(halves)
  const at = text.indexOf(needle)
  return at < 0 ? [] : [`${file}:${lineAt(text, at)}: ${needle}`]
})

const sourcesOf = (files: readonly string[]): Source[] =>
  files.map((file) => ({ file, text: bytesOf(file) }))

// ---------------------------------------------------------------------------------------------
// The cells
// ---------------------------------------------------------------------------------------------

describe('C443-ONE-RECORD', () => {
  it('the CLI constructs the ingest only inside createRunRecord', () => {
    const files = scanned([CLI])
    expect(files.length, `${CLI} scanned nothing`).toBeGreaterThan(100)
    for (const file of DOOR_FILES) expect(files, `${file} is not scanned`).toContain(file)
    const offenses = ingestOffenses(sourcesOf(files))
    expect(offenses.join(' | '), 'ingest constructions outside the one builder').toBe('')
  })

  it('every drive call passes a record from the one builder, and the scan saw every door', () => {
    const sites = sourcesOf(scanned([CLI])).flatMap(driveSites)
    expect(sites.length, 'the scan found fewer drive calls than the doors that make one').toBeGreaterThanOrEqual(5)
    expect(sites.map((site) => site.file).sort().join(', '), 'the drive call sites').toBe(DRIVE_CALLS.join(', '))
    const problems = sites.flatMap((site) => site.problems.map((problem) => `${site.file}:${site.line}: ${problem}`))
    expect(problems.join(' | '), 'drive calls without a record from the one builder').toBe('')
  })

  it('no door gains a new execution path', () => {
    const regions = readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${entry.name}/src/`)
    const files = scanned(regions)
    expect(files.length, 'the packages scanned nothing').toBeGreaterThan(500)
    expect(files, `${DRIVE_FILE} is not scanned`).toContain(DRIVE_FILE)
    const sites = sourcesOf(files).flatMap((source) => callsOf(source, CORE)
      .map((call) => `${source.file}:${lineOf(call)}`))
    expect(sites.join(' | ').replace(/:\d+$/, ''), 'the places the invocation core is composed').toBe(DRIVE_FILE)
  })

  it('every runs.db handle the CLI opens names its owner', () => {
    const sites = sourcesOf(scanned([CLI])).flatMap(handleSites)
    expect(sites.length, 'the scan found fewer runs.db handles than the CLI opens').toBeGreaterThanOrEqual(3)
    expect([...new Set(sites.map((site) => site.file))].sort().join(', '), 'the files that open runs.db').toBe(`${DASHBOARD_TS}, ${RUN_TS}`)
    const ownerless = sites.filter((site) => !site.owned).map((site) => `${site.file}:${site.line}`)
    expect(ownerless.join(', '), `handles without runOwnership: ${joined(OWNERSHIP)}()`).toBe('')
  })

  it('the dashboard bridge has no subscriber member of its own', () => {
    const door = namedFunction({ file: DASHBOARD_TS, text: bytesOf(DASHBOARD_TS) }, BRIDGE_DOOR)
    expect(door?.body, `${DASHBOARD_TS} declares no ${joined(BRIDGE_DOOR)}`).toBeDefined()
    const body = codeOf(door!.body!.getText())
    expect(body, 'the bridge lends no record').toMatch(/\brunBridge\b[\s\S]*\brecord\s*:/)
    const members = [...body.matchAll(new RegExp(`\\b${joined(MEMBER)}\\b`, 'g'))]
      .map((match) => `${DASHBOARD_TS}:${lineOf(door!.body!) + lineAt(body, match.index) - 1}`)
    expect(members.join(', '), 'the bridge declares a member').toBe('')
  })

  it('the predicate sees every acquisition form and ignores prose', () => {
    const name = joined(INGEST)
    const forms = [
      `import { ${name} } from '@vostride/agent-qa-dashboard'\n`,
      `const { ${name} } = await import('@vostride/agent-qa-dashboard')\n`,
      `const ingest = dashboard.${name}({ db, runId })\n`,
      `const ingest = ${name}({ db, runId })\n`,
    ]
    for (const form of forms) expect(acquiresIngest(form), form).toBe(true)
    expect(acquiresIngest(`// the queue entry used to call ${name} itself\n`)).toBe(false)
    expect(acquiresIngest(`/* ${name}({ db }) */\nconst kept = 'http://x'\n`)).toBe(false)

    const root = mkdtempSync(join(tmpdir(), 'c443-one-record-'))
    try {
      const plantedHost = join(root, 'local-agent-host.ts')
      writeFileSync(plantedHost, `${bytesOf(LOCAL_HOST)}\nconst planted = dashboard.${name}({ db, runId })\n`)
      const plantedRun = join(root, 'run.ts')
      writeFileSync(plantedRun, `${bytesOf(RUN_TS)}\nexport function planted(db: never) { return dashboard.${name}({ db }) }\n`)
      const real = sourcesOf(scanned([CLI]))
      const withHost = real.map((source) => source.file === LOCAL_HOST
        ? { file: LOCAL_HOST, text: readFileSync(plantedHost, 'utf8') }
        : source)
      expect(ingestOffenses(withHost)).toEqual([`${LOCAL_HOST}: acquires the ingest outside ${RUN_TS}`])
      const withRun = real.map((source) => source.file === RUN_TS
        ? { file: RUN_TS, text: readFileSync(plantedRun, 'utf8') }
        : source)
      const runOffenses = ingestOffenses(withRun)
      expect(runOffenses[0], runOffenses.join(' | ')).toBe(`${RUN_TS}: 2 ingest constructions, not one`)
      expect(runOffenses[1], runOffenses.join(' | ')).toMatch(/: an ingest construction outside /)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }

    const drive = joined(DRIVE)
    const builder = joined(BUILDER)
    const planted = cat(
      'async function door() {\n',
      `  const record = ${builder}({ attributes, warn })\n`,
      `  await (${drive} as typeof Drive)({ inputs, runRecord: record }, request)\n`,
      `  await ${drive}({ inputs }, request)\n`,
      '}\n',
      'async function other() {\n',
      `  await ${drive}({ inputs, runRecord }, request)\n`,
      '}\n',
    )
    const sites = driveSites({ file: 'planted.ts', text: planted })
    expect(sites.map((site) => `${site.line}: ${site.problems.join('; ')}`)).toEqual([
      '3: ',
      `4: its options name no runRecord; its runRecord is not a ${builder} result of the same function`,
      `7: its function names no ${builder}(; its runRecord is not a ${builder} result of the same function`,
    ])
    expect(driveSites({ file: 'planted.ts', text: `// await ${drive}({ inputs }, request)\n` })).toEqual([])

    const handles = handleSites({
      file: 'planted.ts',
      text: cat(
        `new ${joined(DB_CLASS)}({ dbPath, runOwnership: ${joined(OWNERSHIP)}() })\n`,
        `new dashboard.${joined(DB_CLASS)}({ dbPath })\n`,
      ),
    })
    expect(handles.map((site) => site.owned)).toEqual([true, false])
  })

  it('this file spells none of its needles and scans no test or built file', () => {
    const own = readFileSync(THIS_FILE).toString('utf8')
    expect(existsSync(join(PACKAGES_DIR, OWN)), 'the self path is wrong').toBe(true)
    const needles = [INGEST, DRIVE, CORE, MEMBER, ...RETIRED].map(joined)
    const spelled = needles.filter((needle) => own.toLowerCase().includes(needle.toLowerCase()))
    expect(spelled.join(', '), 'needles this file spells whole').toBe('')
    const cli = scanned([CLI])
    expect(cli, 'this census file is inside a region it scans').not.toContain(OWN)
    const retired = retiredUniverse()
    expect(retired, 'this census file is in the retired-name universe').not.toContain(`packages/${OWN}`)
    for (const files of [cli, retired]) {
      expect(files.filter((file) => file.includes('/__tests__/') || /\.test(-d)?\./.test(file)).join(', '), 'test files scanned').toBe('')
      expect(files.filter((file) => file.includes('/dist/')).join(', '), 'built files scanned').toBe('')
    }
  })
})

describe('C443-ENV-RETIRED', () => {
  it('no production source or script names a retired run-id input', () => {
    const files = retiredUniverse()
    const sources = files.filter((file) => file.startsWith('packages/'))
    const scripts = files.filter((file) => file.startsWith('scripts/'))
    expect(sources.length, 'the package sources scanned nothing').toBeGreaterThan(500)
    expect(scripts.length, 'the scripts scanned nothing').toBeGreaterThan(15)
    for (const file of [
      `packages/${RUN_TS}`,
      'packages/dashboard-server/src/reporter/dashboard-subscriber.ts',
      'packages/dashboard-ui/src/lib/api.ts',
      'scripts/401-11-capture-parity.mjs',
    ]) expect(files, `${file} is not scanned`).toContain(file)
    expect(retiredHits('planted.mjs', `delete process.env.${joined(RETIRED[0]!)}\n`)).toHaveLength(1)
    const hits = files.flatMap((file) => retiredHits(file, readFileSync(join(REPO_ROOT, file)).toString('utf8')))
    expect(hits.join(' | '), 'retired run-id inputs named').toBe('')
  })
})
