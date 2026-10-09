/**
 * THE MOBILE INPUT CENSUS (Phase 437, V2-EXEC-05/06; D-01, D-05, D-11, D-12, D-14, D-19).
 *
 * Phase 437 removed a second toggle reading, the success-shaped skipped tap, the WebView
 * value-writing script and its synthetic Enter, keyboard typing through key events and the
 * native-to-keyboard fall-through. Each cell here REDs if one of them returns, with no mutation
 * driver, following the 436 census: comments are blanked by the same lexer (page scripts are
 * read from the TypeScript AST, so a comment never counts), every needle is assembled from two
 * halves at run time, each cell scans only the region it guards, and C437-SELF-MATCH proves
 * this file spells none of them. C437-NO-FIXTURES reads agent-qa's own index only (434 D-14).
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const PACKAGES_DIR = fileURLToPath(new URL('../../../', import.meta.url))
const REPO_ROOT = resolve(PACKAGES_DIR, '..')
const THIS_FILE = fileURLToPath(import.meta.url)
const OWN = 'arch/src/__tests__/437-mobile-input-census.test.ts'

// ---------------------------------------------------------------------------------------------
// The lexer (the 432 and 436 censuses'): comments out, everything else in
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

/** Every string a file builds, with `+` chains of literals joined, read from the AST. */
function scriptsOf(name: string, text: string): string[] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const isPlus = (node: ts.Node | undefined): boolean =>
    node !== undefined && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken
  const leaves = (node: ts.Node): string[] => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
    if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
    if (isPlus(node)) {
      const binary = node as ts.BinaryExpression
      return [...leaves(binary.left), ...leaves(binary.right)]
    }
    if (ts.isParenthesizedExpression(node)) return leaves(node.expression)
    return []
  }
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (!isPlus(node.parent)) {
      const parts = leaves(node)
      if (parts.length > 0) out.push(parts.join(''))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
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
    cached = codeOf(bytesOf(file))
    codeCache.set(file, cached)
  }
  return cached
}

function scanned(regions: readonly string[]): string[] {
  return [...new Set(regions.flatMap(filesOf))]
}

function everyProductionRegion(): string[] {
  return readdirSync(PACKAGES_DIR)
    .filter((name) => existsSync(join(PACKAGES_DIR, name, 'src')))
    .map((name) => `${name}/src/`)
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length

/** Matches of a global pattern over each file's whole code, so a literal may span lines. */
function spanHits(files: readonly string[], pattern: RegExp, source: (file: string) => string = code): string[] {
  return files.flatMap((file) => {
    const text = source(file)
    return [...text.matchAll(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`))]
      .map((m) => `${file}:${lineAt(text, m.index)}: ${m[0].replace(/\s+/g, ' ').slice(0, 160)}`)
  })
}

// ---------------------------------------------------------------------------------------------
// The needles, every one assembled from two halves
// ---------------------------------------------------------------------------------------------

type Halves = readonly [string, string]
const joined = (halves: Halves): string => halves[0] + halves[1]
const rx = (halves: Halves, flags = ''): RegExp => new RegExp(joined(halves), flags)

const TOGGLE_HOME = 'schema/src/screen/toggle.ts'
const CLASSIFIER: Halves = ['isToggle', 'Element']
const ROLE_SET: Halves = ['TOGGLE', '_ROLES']
const CLASSIFIER_READERS = [
  'runner/src/compound/idempotency.ts',
  'core/src/mobile/xml-parser.ts',
  'runner/src/screen-builder.ts',
] as const
const RUNNER = 'runner/src/'
const LOOP = 'runner/src/loop/'
const LOOP_INDEX = 'runner/src/loop/index.ts'
const ANDROID = 'android/src/'
const ANDROID_ADAPTER = 'android/src/adapter.ts'

const CLASSIFIER_DECLARATION: Halves = ['\\b(?:function\\s+|(?:const|let|var)\\s+)is\\w*Tog', 'gle\\w*\\b']
const ROLE_SET_DECLARATION: Halves = ['\\b(?:const|let|var)\\s+\\w*TOGGLE_', 'ROLES\\b']
const ROLE_LITERAL: Halves = ["['\"](?:switch|checkbox|", "radio)['\"]"]
const SET_LITERAL: Halves = ['\\bnew\\s+Set\\s*(?:<[^>]*>)?\\(\\s*\\[', '([^\\]]*)\\]']
const ARRAY_OF_ROLES: Halves = [
  "\\[\\s*['\"](?:switch|checkbox|radio)['\"]\\s*,\\s*['\"](?:switch|checkbox|radio)['\"]",
  "\\s*,\\s*['\"](?:switch|checkbox|radio)['\"]\\s*\\]",
]

const SUCCESS_NOOP_PATTERNS: readonly Halves[] = [
  ['\\bsuccess\\s*:\\s*true\\b[^}]*?\\bidempotent', 'Noop\\b'],
  ['\\bidempotent', 'Noop\\b[^{]*?\\bsuccess\\s*:\\s*true\\b'],
]
const SUCCESS_NOOP_NEEDLES: readonly Halves[] = [['{ success: true, metadata: { idempot', 'entNoop } }']]
const NOOP_CONTROL: Halves = ['metadata: { idempotentNoop: { ...idempotentNoop, input', 'Sent: false } }']

const SCRIPT_WRITE_PATTERNS: readonly Halves[] = [
  ['\\.(?:value|innerText|textContent|inner', 'HTML)\\s*=(?!=)'],
  ['setAttribute\\(\\s*["\']val', 'ue["\']'],
  ['getOwnPropertyDescriptor\\([^)]*["\']val', 'ue["\']'],
  ['execCommand\\(\\s*["\']insert', 'Text'],
]
const SCRIPT_WRITE_NEEDLES: readonly Halves[] = [['el.val', 'ue = prior + text'], ['el.val', 'ue = text']]

const SYNTHETIC_KEY_PATTERNS: readonly Halves[] = [
  ['\\bnew\\s+(?:Keyboard|Input|Composition)', 'Event\\s*\\('],
  ['\\bdispatch', 'Event\\s*\\('],
  ['\\binitKey(?:board)?', 'Event\\b'],
  ['["\'](?:keydown|keyup|key', 'press)["\']'],
]
const SYNTHETIC_KEY_NEEDLES: readonly Halves[] = [['new Keyboard', 'Event('], ['Keyboard', 'Event']]

const KEYS_TYPING_PATTERN: Halves = ['\\.keys\\(\\s*\\[?[^)\\]]*\\b', 'text\\b']
const KEYS_TYPING_NEEDLES: readonly Halves[] = [['driver.keys([action.te', 'xt])']]

const FALLBACK_NEEDLES: readonly Halves[] = [['fall through to last', ' resort'], ['Last resort — type via', ' keyboard']]
const FILL_CASE: Halves = ["case 'fi", "ll': {"]
const NEXT_CASE: Halves = ["case 'nativeSe", "lect'"]
const FILL_PATHS: readonly Halves[] = [['this.fillNative', 'Compound('], ['this.fillKeyboard', 'Path('], ['this.fillWebView', 'Compound(']]
const INPUT_PATH_METHODS = [
  'fillNativeCompound',
  'fillKeyboardPath',
  'fillWebViewCompound',
  'clearNativeOrKeyboard',
  'clearWebViewField',
] as const
const CATCH_BLOCK: Halves = ['\\}\\s*catch\\s*(?:\\([^)]*\\))?\\s*\\{', '([^{}]*)\\}']

const APP_PACKAGE: Halves = ['\\.(?:apk|aab|apks|xapk|i', 'pa)$']
const PHASE_TOKEN: Halves = ['(?:^|[^0-9A-Za-z])43', '7(?:[^0-9A-Za-z]|$)']
const PHASE_TEST: Halves = ['^packages/[^/]+/src/(?:[^/]+/)*__tests__/43', '7-[^/]+\\.test\\.tsx?$']

const DASHBOARD_UI = 'dashboard-ui/src/'
const OUTCOME_UNIONS = [
  { file: 'runner/src/result.ts', start: ['export interface SubAction', 'Trace {'], end: ['export interface Step', 'Trace'] },
  { file: 'dashboard-server/src/live-editor/types.ts', start: ['export interface LiveSubAction', 'Data {'], end: ['\n', '}'] },
  { file: 'dashboard-ui/src/hooks/use-live-editor.ts', start: ['export interface LiveSub', 'Action {'], end: ['\n', '}'] },
] as const satisfies readonly { file: string; start: Halves; end: Halves }[]
const LEGACY_TRACE = 'runner/src/loop/evidence.ts'
const LEGACY_PROJECTOR: Halves = ['export function projectLegacy', 'Trace(']
const RESULT_MEMBER: Halves = ['\\bresult\\s*:\\s*([^\\n]*', ')']
const NO_INPUT_WORD: Halves = ["['\"]no-in", "put['\"]"]
const NO_INPUT_READER: Halves = ['readIdempotentNoop', 'Meta(']
const SUCCESS_FLAG: Halves = ['\\.succ', 'ess\\b']
const SUB_ACTION_TYPE: Halves = ['\\b(?:LiveSubAction|RunDetailSub', 'Action)\\b']
const SUCCESS_READS: readonly Halves[] = [
  ["\\.result\\s*===\\s*['\"]succ", "ess['\"]"],
  ['\\.result\\.succ', 'ess\\b'],
  ["\\bcase\\s+['\"]succ", "ess['\"]\\s*:"],
]
const BINARY_NEEDLES: readonly Halves[] = [
  ["subAction.result === 'succ", "ess' ? 'text-emerald-500' : 'text-red-500'"],
  ['result: sub.result.succ', "ess ? 'success' : 'failure'"],
]

// ---------------------------------------------------------------------------------------------
// Structural readers
// ---------------------------------------------------------------------------------------------

function regionBetween(text: string, start: string, end: string): string | undefined {
  const from = text.indexOf(start)
  if (from < 0) return undefined
  const to = text.indexOf(end, from + start.length)
  return to < 0 ? undefined : text.slice(from, to)
}

function methodBody(text: string, name: string): string | undefined {
  const start = new RegExp(`\\n  (?:private |public |protected )?async ${name}\\(`).exec(text)
  if (start === null) return undefined
  const rest = text.slice(start.index + 1)
  const next = /\n  (?:private|public|protected|async|static|get|set)\b/.exec(rest)
  return next === null ? rest : rest.slice(0, next.index)
}

/** Catch blocks in a method that do not end the path by returning: a fall-through to another path. */
function fallThroughCatches(text: string, name: string): string[] {
  const body = methodBody(text, name)
  if (body === undefined) return [`${name} is not declared`]
  return [...body.matchAll(rx(CATCH_BLOCK, 'g'))]
    .filter((m) => !/^\s*return\b/.test(m[1]!))
    .map((m) => `${name}: catch { ${m[1]!.replace(/\s+/g, ' ').trim()} }`)
}

/** Set literals made only of toggle roles, at least two of them: a second role-based classifier. */
function roleSetLiterals(text: string): string[] {
  const roleLiteral = new RegExp(`^${joined(ROLE_LITERAL)}$`)
  return [...text.matchAll(rx(SET_LITERAL, 'g'))]
    .filter((m) => {
      const members = [...m[1]!.matchAll(/'[^']*'|"[^"]*"/g)].map((r) => r[0])
      return members.length >= 2 && members.every((member) => roleLiteral.test(member))
    })
    .map((m) => m[0].replace(/\s+/g, ' '))
}

function oneClassifierOffenders(files: readonly string[]): string[] {
  const offenders: string[] = []
  const declarations = spanHits(files, rx(CLASSIFIER_DECLARATION))
  const declaredHome = declarations.filter((hit) => hit.startsWith(`${TOGGLE_HOME}:`))
  if (declaredHome.length !== 1 || declarations.length !== 1) {
    offenders.push(`classifier declarations (expected exactly one, in ${TOGGLE_HOME}):\n${declarations.join('\n')}`)
  }
  const roleSets = spanHits(files, rx(ROLE_SET_DECLARATION))
  if (roleSets.length !== 1 || !roleSets[0]!.startsWith(`${TOGGLE_HOME}:`)) {
    offenders.push(`role set declarations (expected exactly one, in ${TOGGLE_HOME}):\n${roleSets.join('\n')}`)
  }
  const roleLiterals = files.flatMap((file) => roleSetLiterals(code(file)).map((literal) => `${file}: ${literal}`))
  if (roleLiterals.length !== 1 || !roleLiterals[0]!.startsWith(`${TOGGLE_HOME}:`)) {
    offenders.push(`toggle-role Set literals (expected exactly one, in ${TOGGLE_HOME}):\n${roleLiterals.join('\n')}`)
  }
  const roleArrays = spanHits(files.filter((file) => file !== TOGGLE_HOME), rx(ARRAY_OF_ROLES))
  if (roleArrays.length > 0) offenders.push(`a toggle-role array outside ${TOGGLE_HOME}:\n${roleArrays.join('\n')}`)
  return offenders
}

function readerOffenders(file: string): string[] {
  const text = code(file)
  const name = joined(CLASSIFIER)
  const imported = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*'@vostride/agent-qa-schema'`).test(text)
  const called = text.split(`${name}(`).length - 1
  return [
    ...(imported ? [] : [`${file} does not import the classifier from the schema package`]),
    ...(called > 0 ? [] : [`${file} never calls the classifier`]),
  ]
}

function scriptOffenders(files: readonly string[], patterns: readonly Halves[]): string[] {
  return files.flatMap((file) =>
    scriptsOf(file, bytesOf(file)).flatMap((script) =>
      patterns.filter((pattern) => rx(pattern).test(script))
        .map((pattern) => `${file}: a page script matches /${joined(pattern)}/: ${script.slice(0, 160)}`)))
}

function trackedFiles(): string[] {
  const top = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  expect(resolve(top), 'git answered for a repository other than agent-qa').toBe(REPO_ROOT)
  return execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((path) => path.length > 0)
}

function fixtureOffenders(paths: readonly string[]): string[] {
  const appPackage = rx(APP_PACKAGE, 'i')
  const phaseToken = rx(PHASE_TOKEN)
  const phaseTest = rx(PHASE_TEST)
  return [
    ...paths.filter((path) => appPackage.test(path)).map((path) => `an app package is tracked: ${path}`),
    ...paths.filter((path) => phaseToken.test(path) && !phaseTest.test(path))
      .map((path) => `a tracked path outside the 437 test files names the phase: ${path}`),
  ]
}

/** The `result:` member of a region, with its line in the whole text. */
function resultMember(text: string, start: Halves, end: Halves): { line: number; value: string } | undefined {
  const region = regionBetween(text, joined(start), joined(end))
  if (region === undefined) return undefined
  const m = rx(RESULT_MEMBER).exec(region)
  return m === null ? undefined : { line: lineAt(text, text.indexOf(region) + m.index), value: m[1]!.trim() }
}

/** An outcome initializer that never names no-input, or reads the success flag before it does. */
function readsSuccessFirst(initializer: string): boolean {
  const noInput = initializer.search(rx(NO_INPUT_WORD))
  const success = initializer.search(rx(SUCCESS_FLAG))
  return noInput < 0 || (success >= 0 && success < noInput)
}

function successReadLines(text: string): number[] {
  return SUCCESS_READS.flatMap((pattern) => [...text.matchAll(rx(pattern, 'g'))].map((m) => lineAt(text, m.index)))
    .sort((a, b) => a - b)
}

/** A sub-action reader that words or colours an outcome by success alone: no no-input branch. */
function binaryReaderOffense(file: string, text: string): string | undefined {
  if (!rx(SUB_ACTION_TYPE).test(text)) return undefined
  const reads = successReadLines(text)
  if (reads.length === 0) return undefined
  if (rx(NO_INPUT_WORD).test(text) || text.includes(joined(NO_INPUT_READER))) return undefined
  return `${file}:${reads.join(',')}: reads a sub-action's success with no no-input branch`
}

// ---------------------------------------------------------------------------------------------
// The cells
// ---------------------------------------------------------------------------------------------

describe('C437-CENSUS — the mobile input census (437 D-01, D-05, D-11, D-12, D-14, D-19)', () => {
  it('C437-UNIVERSE-FLOORS: every region reads real code, so no cell can pass over an empty scan', () => {
    for (const region of [RUNNER, LOOP, ANDROID, 'schema/src/', 'core/src/']) {
      expect(filesOf(region).length, `${region} scanned nothing`).toBeGreaterThan(3)
    }
    for (const file of [TOGGLE_HOME, LOOP_INDEX, ANDROID_ADAPTER, ...CLASSIFIER_READERS]) {
      expect(existsSync(join(PACKAGES_DIR, file)), `${file} is missing`).toBe(true)
    }
    expect(scanned(everyProductionRegion()).length).toBeGreaterThan(1000)
    expect(scriptsOf(ANDROID_ADAPTER, bytesOf(ANDROID_ADAPTER)).length, 'the adapter yields no strings').toBeGreaterThan(50)
  })

  it('C437-ONE-CLASSIFIER: the toggle classifier and its role set are declared once, in the schema, and its readers import it', () => {
    const offenders = oneClassifierOffenders(scanned(everyProductionRegion()))
    expect(offenders, offenders.join('\n\n')).toEqual([])
    const readers = CLASSIFIER_READERS.flatMap(readerOffenders)
    expect(readers, readers.join('\n')).toEqual([])
    expect(code(TOGGLE_HOME)).toContain(`export const ${joined(ROLE_SET)}`)
    expect(code(TOGGLE_HOME)).toContain(`export function ${joined(CLASSIFIER)}(`)
  })

  it('C437-NO-SUCCESS-NOOP: no runner result pairs a true success with the idempotent no-op', () => {
    const files = scanned([RUNNER])
    for (const pattern of SUCCESS_NOOP_PATTERNS) {
      const hits = spanHits(files, rx(pattern))
      expect.soft(hits, `a success-shaped skipped tap returned:\n${hits.join('\n')}`).toEqual([])
    }
    for (const needle of SUCCESS_NOOP_NEEDLES) {
      const hits = spanHits(files, new RegExp(joined(needle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      expect.soft(hits, `the pre-437 no-op literal returned:\n${hits.join('\n')}`).toEqual([])
    }
    expect(code(LOOP_INDEX).replace(/\s+/g, ' '), 'the loop no longer mints the no-input no-op, so this scan is stale')
      .toContain(joined(NOOP_CONTROL))
  })

  it('C437-NO-SCRIPT-WRITE: no Android page script assigns a field value', () => {
    const offenders = scriptOffenders(scanned([ANDROID]), SCRIPT_WRITE_PATTERNS)
    expect(offenders, offenders.join('\n')).toEqual([])
    for (const needle of SCRIPT_WRITE_NEEDLES) {
      expect.soft(bytesOf(ANDROID_ADAPTER).includes(joined(needle)), `the adapter spells ${joined(needle)}`).toBe(false)
    }
  })

  it('C437-NO-SYNTHETIC-KEY: no Android page script constructs or dispatches a key event', () => {
    const offenders = scriptOffenders(scanned([ANDROID]), SYNTHETIC_KEY_PATTERNS)
    expect(offenders, offenders.join('\n')).toEqual([])
    for (const needle of SYNTHETIC_KEY_NEEDLES) {
      const hits = scanned([ANDROID]).filter((file) => code(file).includes(joined(needle)))
      expect.soft(hits, `${joined(needle)} returned in ${hits.join(', ')}`).toEqual([])
    }
  })

  it('C437-NO-KEYS-TYPING: the Android adapter never types fill text through key events', () => {
    const hits = spanHits(scanned([ANDROID]), rx(KEYS_TYPING_PATTERN))
    expect(hits, `fill text reaches the key-event call:\n${hits.join('\n')}`).toEqual([])
    for (const needle of KEYS_TYPING_NEEDLES) {
      expect.soft(code(ANDROID_ADAPTER).includes(joined(needle)), `the adapter spells ${joined(needle)}`).toBe(false)
    }
    expect(code(ANDROID_ADAPTER), 'the keyboard path no longer types through mobile: type, so this scan is stale')
      .toContain("execute('mobile: type', { text: action.text })")
  })

  it('C437-NO-PATH-FALLBACK: the fill dispatch picks one input path, and no path falls through to another on a failure', () => {
    const adapter = code(ANDROID_ADAPTER)
    const dispatch = regionBetween(adapter, joined(FILL_CASE), joined(NEXT_CASE))
    expect(dispatch, 'the fill dispatch region is not found').toBeDefined()
    expect(dispatch!, 'the fill dispatch catches an error').not.toMatch(/\bcatch\b/)
    expect(dispatch!, 'the fill dispatch has a try block').not.toMatch(/\btry\b/)
    for (const path of FILL_PATHS) {
      expect(dispatch!.split(joined(path)).length - 1, `the fill dispatch calls ${joined(path)} other than once`).toBe(1)
    }
    const fallThrough = INPUT_PATH_METHODS.flatMap((name) => fallThroughCatches(adapter, name))
    expect(fallThrough, `an input path continues after a failure:\n${fallThrough.join('\n')}`).toEqual([])
    for (const needle of FALLBACK_NEEDLES) {
      expect.soft(bytesOf(ANDROID_ADAPTER).includes(joined(needle)), `the adapter spells ${joined(needle)}`).toBe(false)
    }
  })

  it('C437-NO-FIXTURES: agent-qa tracks no app package and no 437 path outside the 437 test files', () => {
    const paths = trackedFiles()
    expect(paths.length, 'git ls-files listed too little').toBeGreaterThan(1000)
    expect(paths, 'no 437 test file is tracked, so the phase-token rule reads nothing')
      .toContain(joined(['packages/runner/src/loop/__tests__/43', '7-toggle-loop.test.ts']))
    const offenders = fixtureOffenders(paths)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('C437-NO-INPUT-REACHES-LIVE: every sub-action outcome a dashboard surface reads can say no input sent', () => {
    for (const union of OUTCOME_UNIONS) {
      const member = existsSync(join(PACKAGES_DIR, union.file)) ? resultMember(code(union.file), union.start, union.end) : undefined
      expect(member, `${union.file}: the ${joined(union.start)} result member is not found`).toBeDefined()
      if (member === undefined) continue
      expect.soft(rx(NO_INPUT_WORD).test(member.value), `${union.file}:${member.line}: result: ${member.value} has no no-input`)
        .toBe(true)
    }

    const legacy = existsSync(join(PACKAGES_DIR, LEGACY_TRACE))
      ? resultMember(code(LEGACY_TRACE), LEGACY_PROJECTOR, ['\n', '}\n'])
      : undefined
    expect(legacy, `${LEGACY_TRACE}: the ${joined(LEGACY_PROJECTOR)} result initializer is not found`).toBeDefined()
    if (legacy !== undefined) {
      expect.soft(readsSuccessFirst(legacy.value), `${LEGACY_TRACE}:${legacy.line}: result: ${legacy.value} reads success before no-input`)
        .toBe(false)
    }

    const files = scanned([DASHBOARD_UI])
    expect(files.length, `${DASHBOARD_UI} scanned nothing`).toBeGreaterThan(100)
    const typed = files.filter((file) => rx(SUB_ACTION_TYPE).test(code(file)))
    expect(typed.length, 'too few dashboard-ui files name a sub-action type').toBeGreaterThanOrEqual(10)
    const readers = typed.filter((file) => successReadLines(code(file)).length > 0)
    expect(readers.length, 'too few dashboard-ui files read a sub-action success').toBeGreaterThanOrEqual(5)
    const offenders = readers.flatMap((file) => binaryReaderOffense(file, code(file)) ?? [])
    expect.soft(offenders, `a dashboard surface outcome is success-or-failure only:\n${offenders.join('\n')}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// Controls: the planted pre-437 shapes and this file
// ---------------------------------------------------------------------------------------------

describe('C437-CENSUS instruments', () => {
  it('C437-PLANTED-POSITIVE: every removed shape is found when planted as code, and none as a comment', () => {
    const noop = joined(['execResult = { success: true, metadata: { idempot', 'entNoop } }'])
    for (const pattern of SUCCESS_NOOP_PATTERNS.slice(0, 1)) {
      expect(rx(pattern).test(codeOf(noop))).toBe(true)
      expect(rx(pattern).test(codeOf(`// ${noop}`))).toBe(false)
    }
    const reversed = joined(['{ metadata: { idempot', 'entNoop }, success: true }'])
    expect(rx(SUCCESS_NOOP_PATTERNS[1]!).test(reversed)).toBe(true)
    expect(SUCCESS_NOOP_PATTERNS.some((p) => rx(p).test(joined(['{ success: false, metadata: { idempot', 'entNoop: {} } }'])))).toBe(false)

    const writeScript = [
      "const s = 'var el = document.activeElement;'\n  + 'if (append) { el.val",
      "ue = prior + text; } else { el.val",
      "ue = text; }'",
    ].join('')
    const keyScript = ["const k = 'el.dispat", 'chEvent(new Keyboard', 'Event("key', 'down", {key:"Enter", bubbles:true}));\''].join('')
    const plantedScripts = (text: string, patterns: readonly Halves[]): number =>
      scriptsOf('planted.ts', text).filter((script) => patterns.some((p) => rx(p).test(script))).length
    expect(plantedScripts(writeScript, SCRIPT_WRITE_PATTERNS)).toBe(1)
    expect(plantedScripts(keyScript, SYNTHETIC_KEY_PATTERNS)).toBe(1)
    expect(plantedScripts(`/* ${writeScript} */\n// ${keyScript}`, [...SCRIPT_WRITE_PATTERNS, ...SYNTHETIC_KEY_PATTERNS])).toBe(0)
    expect(plantedScripts("const r = 'var v = a.value; return v === null ? null : v;'", SCRIPT_WRITE_PATTERNS)).toBe(0)

    const keys = rx(KEYS_TYPING_PATTERN)
    expect(keys.test(joined(KEYS_TYPING_NEEDLES[0]!))).toBe(true)
    expect(keys.test(joined(['await driver.keys(action.te', "xt.split(''))"]))).toBe(true)
    expect(keys.test("await driver.keys(['Control', 'a'])")).toBe(false)
    expect(keys.test("await driver.keys(focus.multiline ? ['Control', 'End'] : ['End'])")).toBe(false)
    expect(keys.test('await driver.keys([mapped])')).toBe(false)

    const oldFill = codeOf([
      'class A {',
      '  private async fillNativeCompound(el: unknown) {',
      '    try {',
      '      await el.setValue(text)',
      '    } catch {',
      `      // ${joined(FALLBACK_NEEDLES[0]!)}`,
      '    }',
      '    await driver.keys([action.te' + 'xt])',
      '  }',
      '}',
    ].join('\n'))
    expect(fallThroughCatches(oldFill, 'fillNativeCompound')).toHaveLength(1)
    const newFill = codeOf('class A {\n  private async fillNativeCompound(el: unknown) {\n    try {\n      await el.setValue(text)\n    } catch {\n      return this.interruptedFill()\n    }\n  }\n}')
    expect(fallThroughCatches(newFill, 'fillNativeCompound')).toEqual([])

    expect(roleSetLiterals(joined(["const SECOND = new Set(['switch', 'check", "box'])"]))).toHaveLength(1)
    expect(roleSetLiterals("const ROLES = new Set<string>(['button', 'link', 'tab'])")).toEqual([])
    expect(roleSetLiterals(joined(["const INTERACTIVE = new Set(['button', 'switch', 'check", "box', 'radio'])"]))).toEqual([])
    expect(rx(CLASSIFIER_DECLARATION).test(joined(['export function isTog', 'gleNode(el) {']))).toBe(true)
    expect(rx(CLASSIFIER_DECLARATION).test(joined(['const isAndroidTog', 'gle = (n) => n.checkable']))).toBe(true)
    expect(rx(CLASSIFIER_DECLARATION).test(`if (${joined(CLASSIFIER)}(element)) return`)).toBe(false)
    expect(rx(ARRAY_OF_ROLES).test(joined(["['radio', 'switch', 'check", "box'].includes(role)"]))).toBe(true)

    expect(fixtureOffenders([
      'packages/runner/src/loop/__tests__/437-toggle-loop.test.ts',
      'test-fixtures/x/9358de439afede726fc24b80662e5be4ce73b04b12a7c437b0fed29e4bdc72f6.json',
    ])).toEqual([])
    expect(fixtureOffenders([
      joined(['fixtures/43', '7/answer-key.json']),
      joined(['apps/probe-43', '7.apk']),
      joined(['ios/Probe.i', 'pa']),
    ])).toHaveLength(4)

    const liveMention = "import type { LiveSubAction } from '@/hooks/use-live-editor'\n"
    const detailSpan = liveMention + joined(BINARY_NEEDLES[0]!).replace(/^/, 'const tone = ')
    expect(binaryReaderOffense('planted.tsx', codeOf(detailSpan))).toBeDefined()
    expect(binaryReaderOffense('planted.tsx', codeOf(`${liveMention}// ${detailSpan.slice(liveMention.length)}`))).toBeUndefined()
    expect(binaryReaderOffense('planted.tsx', codeOf(detailSpan.replace('const tone = ', "const tone = subAction.result === 'no-input' ? 'text-muted-foreground' : "))))
      .toBeUndefined()
    const caseLabel = liveMention + joined(["function Icon({ result }: { result: LiveSubAction['result'] }) {\n  switch (result) {\n    case 'succ", "ess':\n      return 1\n  }\n}"])
    expect(binaryReaderOffense('planted.tsx', codeOf(caseLabel))).toBeDefined()
    expect(binaryReaderOffense('planted.tsx', codeOf(caseLabel.replace('switch (result) {', "switch (result) {\n    case 'no-input':\n      return 0"))))
      .toBeUndefined()
    expect(binaryReaderOffense('planted.tsx', codeOf(joined(BINARY_NEEDLES[0]!)))).toBeUndefined()

    const projector = (initializer: string): string =>
      `${liveMention}${joined(LEGACY_PROJECTOR)}evidence: StepEvidence): SubActionTrace[] {\n  return evidence.subActions.map((sub, index) => ({\n    index,\n    ${initializer},\n  }))\n}\n`
    const legacy = projector(joined(BINARY_NEEDLES[1]!))
    const planted = resultMember(codeOf(legacy), LEGACY_PROJECTOR, ['\n', '}\n'])
    expect(planted !== undefined && readsSuccessFirst(planted.value)).toBe(true)
    expect(binaryReaderOffense('planted.ts', codeOf(legacy))).toBeDefined()
    expect(resultMember(codeOf(`/* ${legacy} */`), LEGACY_PROJECTOR, ['\n', '}\n'])).toBeUndefined()
    expect(binaryReaderOffense('planted.ts', codeOf(`/* ${legacy} */`))).toBeUndefined()
    const fixed = resultMember(codeOf(projector(joined(BINARY_NEEDLES[1]!).replace('result: ', "result: noInput ? 'no-input' : "))), LEGACY_PROJECTOR, ['\n', '}\n'])
    expect(fixed !== undefined && readsSuccessFirst(fixed.value)).toBe(false)
    const late = resultMember(codeOf(projector(joined(BINARY_NEEDLES[1]!).replace("'failure'", "noInput ? 'no-input' : 'failure'"))), LEGACY_PROJECTOR, ['\n', '}\n'])
    expect(late !== undefined && readsSuccessFirst(late.value)).toBe(true)
  })

  it('C437-SELF-MATCH: this file spells none of the needles it assembles, and lies outside every region it scans', () => {
    const own = readFileSync(THIS_FILE).toString('utf8')
    expect(existsSync(join(PACKAGES_DIR, OWN)), 'the self path is wrong').toBe(true)
    const needles = [
      ...SUCCESS_NOOP_NEEDLES,
      ...SCRIPT_WRITE_NEEDLES,
      ...SYNTHETIC_KEY_NEEDLES,
      ...KEYS_TYPING_NEEDLES,
      ...FALLBACK_NEEDLES,
      ...BINARY_NEEDLES,
      NOOP_CONTROL,
    ].map(joined)
    const spelled = needles.filter((needle) => own.includes(needle))
    expect(spelled, `this file spells what it forbids: ${spelled.join(', ')}`).toEqual([])
    const patterns = [
      ...SUCCESS_NOOP_PATTERNS,
      ...SCRIPT_WRITE_PATTERNS,
      ...SYNTHETIC_KEY_PATTERNS,
      KEYS_TYPING_PATTERN,
      CLASSIFIER_DECLARATION,
      ARRAY_OF_ROLES,
      ...SUCCESS_READS,
    ]
    const ownCode = codeOf(own)
    const matched = patterns.filter((pattern) => rx(pattern).test(ownCode)).map(joined)
    expect(matched, `this file's code matches a pattern it forbids: ${matched.join(', ')}`).toEqual([])
    const regions = scanned([RUNNER, ANDROID, ...everyProductionRegion()])
    expect(regions, 'this census file is inside a region it scans').not.toContain(OWN)
    expect(regions.filter((file) => file.includes('/__tests__/')), 'a test file was scanned').toEqual([])
  })
})
