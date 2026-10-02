// C432-NO-APPROVAL-PROMPTS: nothing agent-qa ships asks a yes/no question (Phase 432, D-01/D-14).
//
// WHAT IS SCANNED, AND WHY THREE UNIVERSES. A prompt can come back three ways: as source (a
// `question(...)` with a `[y/N]` literal), as a built string a person or agent actually receives
// (the CLI bundle, the MCP and dashboard-server bundles, the dashboard UI bundle), or as guidance
// that tells a reader to answer one (the source skills, their packaged copies and the committed
// capability catalogue). Each universe is listed by PATH RULE, never by a hand list of files:
//   - shipped source: every production `.ts`/`.tsx` under every package's `src/` (the 412 rule: no
//     `__tests__` segment, no `.test`/`.test-d` suffix), raw text, comments included — a source
//     comment that spells a prompt is re-spelled, not excused;
//   - built bundles: `cli/dist`, `mcp/dist`, `dashboard-server/dist` and the dashboard UI's
//     `dist/assets`, read as STRINGS (comments the bundler kept are blanked by the same lexer the
//     arch census uses), because a bundle is what reaches a person;
//   - guidance: `skills/**`, `packages/cli/skills/**` and `packages/cli/capability-catalog/*.json`.
// Setup inputs are not approvals (D-14): the two readline questions that ask for a value (the
// `auth-state` capture's Enter and `config`'s value entry) and the chat REPL's line reader are
// named below as a positive control, by file, never as a filter.
//
// EDGE-15 (PXH-SAFE-05/encoding). Every file is read as UTF-8, a byte-order mark is dropped, and
// lines split on CRLF as well as LF, so a CRLF or multi-byte file loses no witness; a control cell
// plants exactly that. The census only reads: a control cell proves every scanned file's bytes are
// unchanged by a census pass, so retained user text is never rewritten.
//
// Built output is read, so this file needs `pnpm build` first (the CLI's test task depends on it).

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const PACKAGES_DIR = fileURLToPath(new URL('../../../', import.meta.url))
const REPO_DIR = join(PACKAGES_DIR, '..')
const CLI_DIST = join(PACKAGES_DIR, 'cli/dist/cli.js')

type Halves = readonly [string, string]
const joined = (halves: Halves): string => halves[0] + halves[1]

// ---- the reader (EDGE-15) -------------------------------------------------------------------

/** UTF-8, BOM dropped, split on CRLF or LF: the one reader every universe goes through. */
function linesOf(path: string): string[] {
  const text = readFileSync(path, 'utf8')
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/u)
}

/** Comments blanked, strings kept — the arch census's lexer, restated for built JavaScript. */
function stringsOf(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  const templateDepths: number[] = []
  let depth = 0
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  const regexAllowed = (): boolean => {
    let k = out.length - 1
    while (k >= 0 && /\s/u.test(out[k]!)) k--
    if (k < 0) return true
    if ('(,=:[!&|?{};+-*%<>~^'.includes(out[k]!)) return true
    const word = /([A-Za-z_$][\w$]*)$/u.exec(out.slice(0, k + 1))
    return word !== null && ['return', 'typeof', 'case', 'yield', 'await', 'in', 'of', 'void'].includes(word[1]!)
  }
  while (i < n) {
    const c = text[i]!
    const d = text[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === '/' && regexAllowed()) {
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
          while (j < n && /[a-z]/iu.test(text[j]!)) j++
          out += text.slice(i, j)
          i = j
          continue
        }
      }
      if (c === "'") { state = 'single' } else if (c === '"') { state = 'double' } else if (c === '`') { state = 'template' }
      else if (c === '{') depth++
      else if (c === '}') {
        if (templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === depth) {
          templateDepths.pop()
          depth--
          state = 'template'
        } else depth--
      }
      out += c
      i++
      continue
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c } else out += ' '; i++; continue }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i++
      continue
    }
    if (state === 'single' || state === 'double') {
      if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
      if (c === (state === 'single' ? "'" : '"') || c === '\n') state = 'code'
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

// ---- the universes --------------------------------------------------------------------------

function walk(root: string, accept: (name: string) => boolean): string[] {
  const files: string[] = []
  const visit = (dir: string): void => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') visit(path)
      } else if (accept(entry.name)) files.push(path)
    }
  }
  visit(root)
  return files.sort()
}

const isProduction = (path: string): boolean =>
  !path.includes('/__tests__/') && !/\.test(-d)?\.tsx?$/u.test(path)

const PACKAGE_NAMES = readdirSync(PACKAGES_DIR).filter((name) => existsSync(join(PACKAGES_DIR, name, 'src')))

const SOURCES = PACKAGE_NAMES
  .flatMap((name) => walk(join(PACKAGES_DIR, name, 'src'), (file) => /\.tsx?$/u.test(file)))
  .filter(isProduction)

const BUNDLES = [
  ...['cli/dist', 'mcp/dist', 'dashboard-server/dist'].flatMap((dir) =>
    walk(join(PACKAGES_DIR, dir), (file) => /\.(c?js)$/u.test(file))),
  ...walk(join(PACKAGES_DIR, 'dashboard-ui/dist/assets'), (file) => file.endsWith('.js')),
]

const GUIDANCE = [
  ...walk(join(REPO_DIR, 'skills'), (file) => /\.(md|ya?ml|json|txt)$/u.test(file)),
  ...walk(join(PACKAGES_DIR, 'cli/skills'), (file) => /\.(md|ya?ml|json|txt)$/u.test(file)),
  ...walk(join(PACKAGES_DIR, 'cli/capability-catalog'), (file) => file.endsWith('.json')),
]

// ---- the needles ----------------------------------------------------------------------------

/** Every decision prompt and approval surface agent-qa shipped before 432 (research census). */
const PROMPT_NEEDLES: readonly (readonly [string, Halves])[] = [
  ['the two-answer y/N prompt', ['[y/', 'N]']],
  ['the default-yes prompt', ['[Y/', 'n]']],
  ['the three-answer chat prompt', ['[y/a', '/N]']],
  ['the parenthesised y/N prompt', ['(y/', 'N)']],
  ['the parenthesised default-yes prompt', ['(Y/', 'n)']],
  ['the terminal approval sentence', ['needs your ', 'approval']],
  ['the readline confirm question', ['Proceed with ', '${']],
  ['the bare proceed question', ['Proceed', '?']],
  ['the rollback confirmation', ['Apply this ', 'rollback']],
  ['the cache purge confirmation', ['Continue? (y', '/N)']],
  ['the typed purge confirmation', ['to confirm irreversible ', 'purge']],
  ['the purge confirmation mismatch code', ['confirmation-', 'mismatch']],
  ['the confirmation-required refusal code', ['confirmation-', 'required']],
  ['the dashboard run-confirm routes', ['/api/run-', 'confirm/']],
  ['the dashboard run-confirm dialog marker', ['data-run-confirm', '-dialog']],
  ['the dashboard mark approval marker', ['data-feedback', '-approval']],
  ['the dialog answer marker', ['data-confirm', '-answer']],
  ['the awaiting-approval state', ['awaiting', '-approval']],
  ['the MCP confirmation round input', ['confirmed: ', 'true']],
  ['the MCP elicitation call', ['elicit', 'Input']],
  ['the trust flag', ['--trust-', 'session']],
]

interface Hit {
  readonly file: string
  readonly line: number
  readonly text: string
}

/** Each file is read, and lexed, once per process: the bundles alone are tens of megabytes. */
const rawCache = new Map<string, string[]>()
const lexedCache = new Map<string, string[]>()
function rawLines(file: string): string[] {
  let lines = rawCache.get(file)
  if (lines === undefined) rawCache.set(file, lines = linesOf(file))
  return lines
}
function lexedLines(file: string): string[] {
  let lines = lexedCache.get(file)
  if (lines === undefined) lexedCache.set(file, lines = stringsOf(rawLines(file).join('\n')).split('\n'))
  return lines
}

function census(files: readonly string[], needle: string, lexed: boolean): Hit[] {
  return files.flatMap((file) => {
    const lines = lexed ? lexedLines(file) : rawLines(file)
    if (!lines.some((text) => text.includes(needle))) return []
    return lines.flatMap((text, index) =>
      text.includes(needle) ? [{ file: file.slice(REPO_DIR.length + 1), line: index + 1, text: text.trim().slice(0, 160) }] : [])
  })
}

const render = (hits: readonly Hit[]): string => hits.map((hit) => `${hit.file}:${hit.line}: ${hit.text}`).join('\n')

const roots: string[] = []
afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('C432-NO-APPROVAL-PROMPTS: no shipped source, bundle or guidance asks a yes/no question', () => {
  it('C432-NO-APPROVAL-PROMPTS: every universe reads real files (floors, not pins)', () => {
    expect(SOURCES.length, `shipped source: ${SOURCES.length} files`).toBeGreaterThan(1000)
    expect(BUNDLES.length, 'no built bundle was found; run pnpm build first').toBeGreaterThan(20)
    expect(BUNDLES.some((file) => file.endsWith('cli/dist/cli.js')), 'the CLI binary bundle').toBe(true)
    expect(BUNDLES.some((file) => file.includes('dashboard-ui/dist/assets/')), 'the dashboard UI bundle').toBe(true)
    expect(GUIDANCE.length, 'guidance').toBeGreaterThan(10)
    expect(GUIDANCE.some((file) => file.endsWith('capability-catalog.json'))).toBe(true)
  })

  it.each(PROMPT_NEEDLES)('C432-NO-APPROVAL-PROMPTS: no shipped source line spells %s', (_label, needle) => {
    const hits = census(SOURCES, joined(needle), false)
    expect(hits, `a prompt returned in source:\n${render(hits)}`).toEqual([])
  })

  it.each(PROMPT_NEEDLES)('C432-NO-APPROVAL-PROMPTS: no built bundle string spells %s', (_label, needle) => {
    const hits = census(BUNDLES, joined(needle), true)
    expect(hits, `a prompt returned in a bundle:\n${render(hits)}`).toEqual([])
  })

  it.each(PROMPT_NEEDLES)('C432-NO-APPROVAL-PROMPTS: no shipped guidance spells %s', (_label, needle) => {
    const hits = census(GUIDANCE, joined(needle), false)
    expect(hits, `a prompt returned in guidance:\n${render(hits)}`).toEqual([])
  })

  // Setup inputs are not approvals (D-14). A readline question survives at exactly two named input
  // sites, and neither asks for a decision.
  it('C432-NO-APPROVAL-PROMPTS: a readline question exists only at the two named value-input sites, and asks no y/n', () => {
    const question = joined(['.quest', 'ion('])
    const sites = census(SOURCES, question, false)
    expect(sites.map((hit) => hit.file).sort()).toEqual([
      'packages/cli/src/commands/auth-state.ts',
      'packages/cli/src/commands/config.ts',
    ])
    const readers = [...new Set(census(SOURCES, joined(['createInter', 'face(']), false).map((hit) => hit.file))].sort()
    expect(readers, 'a new terminal reader appeared').toEqual([
      'packages/cli/src/commands/auth-state.ts',
      'packages/cli/src/commands/chat.ts',
      'packages/cli/src/commands/config.ts',
    ])
    for (const file of readers) {
      const text = linesOf(join(REPO_DIR, file)).join('\n')
      expect(text, `${file} spells a decision prompt`).not.toMatch(/\[[yY]\/|\([yY]\/|y\/n/iu)
    }
  })

  it('C432-NO-APPROVAL-PROMPTS: the dashboard UI source opens no browser confirm dialog', () => {
    const ui = SOURCES.filter((file) => file.includes('/dashboard-ui/src/'))
    expect(ui.length).toBeGreaterThan(200)
    const hits = [
      ...census(ui, joined(['window.con', 'firm(']), false),
      ...ui.flatMap((file) => linesOf(file).flatMap((text, index) =>
        /(^|[^.\w])confirm\(/u.test(text) ? [{ file, line: index + 1, text: text.trim() }] : [])),
    ]
    expect(hits, `a confirm dialog returned:\n${render(hits)}`).toEqual([])
  })

  // The built binary is what a person runs: its help for every command that used to confirm, and for
  // the run door, declares no confirmation or trust option (D-14, typed purge included).
  it.each([
    [['cache', 'purge'], ['--for' + 'ce', '--y' + 'es']],
    [['knowledge', 'purge'], ['--conf' + 'irm', '--y' + 'es', '--for' + 'ce']],
    [['knowledge', 'rollback'], ['--y' + 'es', '--conf' + 'irm']],
    [['run'], ['--trust-' + 'session']],
    [['mcp'], ['--tok' + 'en', '--grant' + '-config-write']],
  ] as const)('C432-NO-APPROVAL-PROMPTS: the built `%s` help declares no confirmation option', (command, retired) => {
    const help = spawnSync(process.execPath, [CLI_DIST, ...command, '--help'], {
      cwd: tmpdir(),
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, NO_COLOR: '1' },
    })
    const text = `${help.stdout}${help.stderr}`
    expect(help.status, text).toBe(0)
    expect(text, 'non-vacuity: this is the real command help').toContain(`agent-qa ${command.join(' ')}`)
    for (const option of retired) expect(text, `${command.join(' ')} declares ${option}`).not.toContain(option)
  }, 90_000)
})

describe('EDGE-15: the census reads every encoding a shipped file can carry, and writes nothing', () => {
  it('C432-NO-APPROVAL-PROMPTS: a CRLF, BOM-led, multi-byte file keeps every witness on its own line', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-qa-432-42-encoding-'))
    roots.push(root)
    const prompt = joined(['[y/', 'N]'])
    const key = joined(['trust', 'Mode'])
    const path = join(root, 'crlf.ts')
    writeFileSync(path, `﻿// Ünïcödé ✓ — ${prompt}\r\nconst ключ = '${key}'\r\nconst ok = 'καλά'\r\n`, 'utf8')
    rawCache.delete(path)
    lexedCache.delete(path)
    expect(census([path], prompt, false).map((hit) => hit.line)).toEqual([1])
    expect(census([path], key, false).map((hit) => hit.line)).toEqual([2])
    // As a built bundle the comment line is blanked and the string line is kept.
    expect(census([path], prompt, true)).toEqual([])
    expect(census([path], key, true).map((hit) => hit.line)).toEqual([2])
    expect(linesOf(path)[0]!.startsWith('// Ünïcödé'), 'the BOM leaked into the first line').toBe(true)
  })

  it('C432-NO-APPROVAL-PROMPTS: a census pass leaves every scanned file byte-identical (retained user text is never rewritten)', () => {
    const digest = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
    const sample = [...SOURCES.slice(0, 200), ...BUNDLES.slice(0, 20), ...GUIDANCE]
    const before = sample.map(digest)
    for (const file of sample) { rawCache.delete(file); lexedCache.delete(file) }
    for (const [, needle] of PROMPT_NEEDLES) {
      census(sample, joined(needle), false)
      census(sample, joined(needle), true)
    }
    expect(sample.map(digest)).toEqual(before)
  })

  it('C432-NO-APPROVAL-PROMPTS: every needle is found when planted, so no needle is a typo', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-qa-432-42-planted-'))
    roots.push(root)
    for (const [label, needle] of PROMPT_NEEDLES) {
      const path = join(root, 'planted.js')
      writeFileSync(path, `const untouched = 1\nconst planted = \`${joined(needle)}\`\n// tail\n`)
      rawCache.delete(path)
      lexedCache.delete(path)
      expect(census([path], joined(needle), false).map((hit) => hit.line), label).toEqual([2])
      expect(census([path], joined(needle), true).map((hit) => hit.line), label).toEqual([2])
    }
  })
})
