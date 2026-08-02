// A source scanner for op-file claims (Phase 387 plan 06).
//
// Not a test file (the suite collects `*.test.ts`) and not production code either: it is the
// shared half of acceptance criteria that two test files state.
//
// WHY IT IS NOT `grep`. Three rounds of agents in this repo have watched `grep` return no
// stdout for a pattern demonstrably present in these files, and a scan that silently matches
// nothing is a check that passes forever. Everything here reads bytes with `node:fs` and does
// its own splitting, so "the file was read and had N statements" is itself assertable.
//
// WHY STATEMENTS AND NOT LINES. Every claim below is about what the code DOES, and a doc
// comment that explains why a mechanism is absent necessarily names that mechanism. A scanner
// over raw text would flag the explanation and force the explanation to be deleted — which is
// how a codebase loses the reasoning that makes its rules survivable. Comments are stripped
// first, and the inverse control asserts prose naming every forbidden term is NOT flagged.

import { readFileSync } from 'node:fs'

/** Strip block and line comments and string literals, leaving executable text. */
export function executableSource(source: string): string {
  let out = ''
  let index = 0
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template'
  let mode: Mode = 'code'

  while (index < source.length) {
    const two = source.slice(index, index + 2)
    const one = source[index]!

    if (mode === 'code') {
      if (two === '//') { mode = 'line'; index += 2; continue }
      if (two === '/*') { mode = 'block'; index += 2; continue }
      if (one === "'") { mode = 'single'; out += ' '; index += 1; continue }
      if (one === '"') { mode = 'double'; out += ' '; index += 1; continue }
      if (one === '`') { mode = 'template'; out += ' '; index += 1; continue }
      out += one
      index += 1
      continue
    }
    if (mode === 'line') {
      if (one === '\n') { mode = 'code'; out += '\n' }
      index += 1
      continue
    }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; index += 2; continue }
      if (one === '\n') out += '\n'
      index += 1
      continue
    }
    // Inside a string literal. Escapes are skipped whole so `\'` does not close it.
    if (one === '\\') { index += 2; continue }
    if (
      (mode === 'single' && one === "'")
      || (mode === 'double' && one === '"')
      || (mode === 'template' && one === '`')
    ) { mode = 'code' }
    index += 1
  }

  return out
}

export interface SourceScan {
  /** Executable statements, comment- and literal-free, blank lines dropped. */
  readonly statements: readonly string[]
  /** Which forbidden terms appear in executable text, with the statement that carries each. */
  readonly hits: readonly string[]
}

/**
 * Scan text for a forbidden vocabulary.
 *
 * String LITERALS are stripped along with comments, deliberately. An op declares its id and its
 * risk name as literals, and a term appearing inside one is a name, not a call — the claim
 * these scans make is about what the code reaches for, and `'knowledge.records.inspect'` reaches
 * for nothing.
 */
export function scanText(text: string, forbidden: readonly string[]): SourceScan {
  const statements = executableSource(text)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

  const hits: string[] = []
  for (const term of forbidden) {
    for (const statement of statements) {
      if (statement.includes(term)) hits.push(`${term} :: ${statement}`)
    }
  }
  return { statements, hits }
}

export function scanFile(path: string, forbidden: readonly string[]): SourceScan {
  return scanText(readFileSync(path, 'utf8'), forbidden)
}
