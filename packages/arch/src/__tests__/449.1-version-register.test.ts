/**
 * The schema version census.
 *
 * Every format agent-qa stamps into a document, record, envelope, token, file or database reads
 * one stamp, 2, and refuses, rebuilds or misses on any other. A writer that stamps another value,
 * or a reader that admits a second one, is a regression the compiler cannot see once a literal is
 * typed loosely, so this file holds the source to the register in ../version-register.ts: every
 * production version constant is registered at its value or excluded with a reason, and every
 * registered constant is still where the register says.
 *
 * Comments are blanked before any production file is matched, every needle is assembled from two
 * halves at run time so this file spells none of them, and the planted cells prove each scanner
 * fires on code and not on a comment. Everything read lies inside this repository.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  FIXTURE_STAMP_EXCLUSIONS,
  INLINE_STAMPS,
  JSON_STAMPS,
  VERSION_EXCLUSIONS,
  VERSION_REGISTER,
  type RegisteredVersion,
} from '../version-register.js'

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const THIS_FILE = fileURLToPath(import.meta.url)
const posix = (path: string): string => path.split(sep).join('/')
const OWN = posix(relative(REPO_ROOT, THIS_FILE))
const REGISTER_FILE = posix(relative(REPO_ROOT, fileURLToPath(new URL('../version-register.ts', import.meta.url))))
const ARCH_SOURCE = `${posix(relative(REPO_ROOT, fileURLToPath(new URL('../', import.meta.url))))}/`

// ---------------------------------------------------------------------------------------------
// The lexer: comments out, code and strings in
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
// The universe: production source of every package but this one, and the gate scripts
// ---------------------------------------------------------------------------------------------

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist'])

function listTree(root: string, keep: (file: string) => boolean): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    if (!existsSync(join(REPO_ROOT, dir))) return
    for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      const child = `${dir}${entry.name}`
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(`${child}/`)
      } else if (keep(child)) files.push(child)
    }
  }
  walk(root)
  return files.sort()
}

const isProduction = (file: string): boolean =>
  /\.tsx?$/.test(file) && !file.includes('/__tests__/') && !/\.test(-d)?\.tsx?$/.test(file)

const packageSources = (): string[] =>
  readdirSync(join(REPO_ROOT, 'packages'))
    .filter((name) => existsSync(join(REPO_ROOT, 'packages', name, 'src')))
    .map((name) => `packages/${name}/src/`)
    .sort()

function productionFiles(): string[] {
  return [
    ...packageSources().filter((root) => root !== ARCH_SOURCE).flatMap((root) => listTree(root, isProduction)),
    ...listTree('scripts/gate/', (file) => /^scripts\/gate\/[^/]+\.mjs$/.test(file)),
  ]
}

const bytesOf = (file: string): string => readFileSync(join(REPO_ROOT, file)).toString('utf8')

const codeCache = new Map<string, string>()
function code(file: string): string {
  let cached = codeCache.get(file)
  if (cached === undefined) {
    cached = existsSync(join(REPO_ROOT, file)) ? codeOf(bytesOf(file)) : ''
    codeCache.set(file, cached)
  }
  return cached
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length

// ---------------------------------------------------------------------------------------------
// The needles, every one assembled from two halves
// ---------------------------------------------------------------------------------------------

type Halves = readonly [string, string]
const joined = (halves: Halves): string => halves[0] + halves[1]
const cat = (...parts: string[]): string => parts.join('')
const rx = (halves: Halves, flags = ''): RegExp => new RegExp(joined(halves), flags)

/** `const NAME = <number or string literal>`, with an optional type and `as const`. */
const CONSTANT_DECLARATION: Halves = [
  '\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=\\n]+)?=\\s*(\\d+|\'[^\'\\n]*\'|"[^"\\n]*")',
  '(?:\\s+as\\s+const)?\\s*(?=;|$)',
]
const VERSION_NAME = /(^|_)VERSION$/

// ---------------------------------------------------------------------------------------------
// The scanners
// ---------------------------------------------------------------------------------------------

type Literal = number | string

interface ConstantHit {
  readonly file: string
  readonly line: number
  readonly name: string
  readonly value: Literal
}

const literalOf = (raw: string): Literal => (/^\d+$/.test(raw) ? Number(raw) : raw.slice(1, -1))

function versionConstants(file: string, text: string): ConstantHit[] {
  return [...text.matchAll(rx(CONSTANT_DECLARATION, 'gm'))]
    .filter((m) => VERSION_NAME.test(m[1]!))
    .map((m) => ({ file, line: lineAt(text, m.index), name: m[1]!, value: literalOf(m[2]!) }))
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

interface NamedSite {
  readonly site: string
  readonly name: string
  readonly row: RegisteredVersion
}

function registeredNames(): NamedSite[] {
  return VERSION_REGISTER.flatMap((row) => [
    ...(row.name === undefined ? [] : [{ site: row.site, name: row.name, row }]),
    ...(row.copies ?? [])
      .filter((copy) => IDENTIFIER.test(copy.spelling))
      .map((copy) => ({ site: copy.site, name: copy.spelling, row })),
  ])
}

function constantOffenders(hits: readonly ConstantHit[]): string[] {
  const named = registeredNames()
  return hits.flatMap((hit) => {
    const at = `${hit.file}:${hit.line}: ${hit.name} = ${JSON.stringify(hit.value)}`
    const registered = named.find((entry) => entry.site === hit.file && entry.name === hit.name)
    if (registered !== undefined) {
      return registered.row.value === hit.value ? [] : [`${at} is registered at ${JSON.stringify(registered.row.value)}`]
    }
    const excluded = VERSION_EXCLUSIONS.some((row) => row.site === hit.file && row.name === hit.name)
    return excluded ? [] : [`${at} is neither registered nor excluded`]
  })
}

// ---------------------------------------------------------------------------------------------
// The cells
// ---------------------------------------------------------------------------------------------

describe('schema version census', () => {
  it('every registered version is 2, every exclusion has a reason, and every register site exists', () => {
    expect(VERSION_REGISTER.length).toBeGreaterThan(60)
    const wrongValue = VERSION_REGISTER
      .filter((row) => row.value !== (row.field === 'token-prefix' ? 'v2' : 2))
      .map((row) => `${row.id}: ${JSON.stringify(row.value)}`)
    expect(wrongValue, 'a registered version is not 2').toEqual([])

    const ids = VERSION_REGISTER.map((row) => row.id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index), 'a register id repeats').toEqual([])
    const rules = new Set(['refuse', 'rebuild', 'miss', 'no-reader'])
    expect(VERSION_REGISTER.filter((row) => !rules.has(row.rule)).map((row) => row.id)).toEqual([])

    const sites = [
      ...VERSION_REGISTER.flatMap((row) => [row.site, ...(row.copies ?? []).map((copy) => copy.site)]),
      ...INLINE_STAMPS.map((row) => row.site),
      ...JSON_STAMPS.map((row) => row.file),
      ...FIXTURE_STAMP_EXCLUSIONS.map((row) => row.file),
      ...VERSION_EXCLUSIONS.map((row) => row.site),
    ]
    expect([...new Set(sites)].filter((site) => !existsSync(join(REPO_ROOT, site))), 'a register site is gone').toEqual([])

    const unexplained = VERSION_EXCLUSIONS
      .filter((row) => row.reason.trim() === '' || !bytesOf(row.site).includes(row.name))
      .map((row) => `${row.site}: ${row.name}`)
    expect(unexplained, 'an exclusion has no reason or no longer names its site').toEqual([])

    const strays = INLINE_STAMPS
      .filter((row) => !ids.includes(row.id) || row.literal !== 2 || row.count < 1)
      .map((row) => `${row.site}: ${row.id}`)
    expect(strays, 'an inline stamp names no format, or is not 2').toEqual([])
    expect(FIXTURE_STAMP_EXCLUSIONS.filter((row) => row.reason.trim() === '').map((row) => row.file)).toEqual([])
  })

  it('every production version constant is registered at its value or excluded, and every registered constant is found', () => {
    const files = productionFiles()
    expect(files.length).toBeGreaterThan(1200)
    const hits = files.flatMap((file) => versionConstants(file, code(file)))
    expect(hits.length).toBeGreaterThan(60)
    expect(constantOffenders(hits)).toEqual([])

    const missing = registeredNames()
      .filter((entry) => !hits.some((hit) => hit.file === entry.site && hit.name === entry.name && hit.value === entry.row.value))
      .map((entry) => `${entry.site}: ${entry.name} at ${JSON.stringify(entry.row.value)}`)
    expect(missing, 'a registered constant is not where the register says').toEqual([])
  })
})

describe('schema version census instruments', () => {
  it('a planted constant at 3 is found as code and not as a comment', () => {
    const planted = cat('export const PLANTED_SCHEMA_', 'VERSION = 3\n')
    expect(constantOffenders(versionConstants('planted.ts', codeOf(planted)))).toHaveLength(1)
    expect(constantOffenders(versionConstants('planted.ts', codeOf(`// ${planted}`)))).toEqual([])
    expect(constantOffenders(versionConstants('planted.ts', codeOf(`/* ${planted} */`)))).toEqual([])

    const handoff = VERSION_REGISTER.find((row) => row.id === 'completed-run-handoff')!
    const moved = `export const ${handoff.name} = 3\n`
    expect(constantOffenders(versionConstants(handoff.site, codeOf(moved)))).toEqual([
      `${handoff.site}:1: ${handoff.name} = 3 is registered at 2`,
    ])
    expect(constantOffenders(versionConstants(handoff.site, codeOf(`// ${moved}`)))).toEqual([])
  })
})
