import { existsSync, globSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { join } from 'node:path'

export const SPECIFIER_RE =
  /\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\.resolve\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g

export const NODE_BUILTINS = new Set(
  builtinModules.flatMap(moduleName => [moduleName, `node:${moduleName}`]),
)

export interface SpecifierHit {
  specifier: string
  file: string
  line: number
}

export type ClassifiedSpecifier =
  | { kind: 'relative' }
  | { kind: 'node'; bare: string }
  | { kind: 'internal'; pkgName: string }
  | { kind: 'external'; pkgName: string }

/**
 * A line that is comment FOR ITS WHOLE LENGTH. Prose is not code, and SPECIFIER_RE cannot tell
 * them apart: its `from '…'` alternative matches an ordinary English sentence that quotes a
 * phrase after the word "from", which is how a doc comment has now reddened this check twice —
 * 404-07, and again in 406-06 on the sentence distinguishing a row the filter hides from one
 * that was never recorded.
 *
 * WHAT THIS IS AND IS NOT SAFE FOR (WR-02, measured 2026-08-29, phase 406 review). The first cut
 * of this predicate tested only how a line STARTS, and its doc block claimed that "this can only
 * remove false positives — it cannot hide a specifier that any runtime would resolve". THAT WAS
 * FALSE, and unmeasured. Run over the shipped function, both of these returned zero hits:
 *
 *   /* eslint-disable import/order *\/ import { readFileSync } from 'node:fs'
 *   /* a comment
 *   *\/ import { join } from 'node:path'
 *
 * Both are imports any runtime resolves, and `validate:arch` is a load-bearing firewall —
 * `packages/agent` is `storageNeutral` and the whole `node:` namespace is forbidden to it — so a
 * forbidden import could ride past the check, introduced by an edit that looks like adding a lint
 * pragma. Hence the rule below: a line that OPENS or CONTINUES a block comment counts as a
 * comment only when the block does not CLOSE and hand the rest of the line back to code. A
 * trailing comment after real code still scans, because the import on that line is real.
 *
 * RESIDUAL, named rather than implied. State is not tracked across lines: a multi-line `/* … *\/`
 * body whose interior lines do NOT begin with `*` is still scanned as code, so the prose false
 * positive this heuristic exists to suppress can still recur in that shape. Closing it needs a
 * real block-comment state machine over the file, not a per-line test.
 */
function isFullLineComment(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.startsWith('//')) {
    return true
  }
  if (trimmed.startsWith('/*') || trimmed.startsWith('*')) {
    return !trimmed.includes('*/') || trimmed.endsWith('*/')
  }
  return false
}

export function specifiersInSource(source: string, file: string): SpecifierHit[] {
  const hits: SpecifierHit[] = []
  const lines = source.split('\n')

  lines.forEach((text, index) => {
    if (isFullLineComment(text)) {
      return
    }

    for (const match of text.matchAll(SPECIFIER_RE)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]
      if (specifier) {
        hits.push({ specifier, file, line: index + 1 })
      }
    }
  })

  return hits
}

export function extractSpecifiers(absFile: string): SpecifierHit[] {
  return specifiersInSource(readFileSync(absFile, 'utf8'), absFile)
}

export function classifySpecifier(specifier: string): ClassifiedSpecifier {
  if (specifier.startsWith('.') || specifier.startsWith('@/')) {
    return { kind: 'relative' }
  }

  const bare = specifier.replace(/^node:/, '').split('/')[0] ?? specifier
  if (NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(bare)) {
    return { kind: 'node', bare }
  }

  if (specifier.startsWith('@vostride/agent-qa-')) {
    return { kind: 'internal', pkgName: specifier.split('/').slice(0, 2).join('/') }
  }

  if (specifier.startsWith('@')) {
    return { kind: 'external', pkgName: specifier.split('/').slice(0, 2).join('/') }
  }

  return { kind: 'external', pkgName: bare }
}

export function sourceFilesFor(packageDir: string, repoRoot: string): string[] {
  const packageRoot = join(repoRoot, packageDir)
  if (!existsSync(join(packageRoot, 'src'))) {
    return []
  }

  return globSync('src/**/*.{ts,tsx,css,mjs,cjs,js}', { cwd: packageRoot })
    .filter(file => !file.includes('__tests__'))
    .filter(file => !file.includes('ownership-contract'))
    .sort()
    .map(file => join(packageRoot, file))
}

export function configFilesFor(packageDir: string, repoRoot: string): string[] {
  const packageRoot = join(repoRoot, packageDir)
  if (!existsSync(packageRoot)) {
    return []
  }

  return globSync('*.config.{ts,mts,cts,mjs,cjs,js}', { cwd: packageRoot })
    .sort()
    .map(file => join(packageRoot, file))
}
