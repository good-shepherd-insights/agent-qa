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
 * A line whose first non-whitespace characters open or continue a comment. Prose is not
 * code, and SPECIFIER_RE cannot tell them apart: its `from '…'` alternative matches an
 * ordinary English sentence that quotes a phrase after the word "from", which is how a doc
 * comment has now reddened this check twice — 404-07, and again in 406-06 on the sentence
 * distinguishing a row the filter hides from one that was never recorded.
 *
 * FULL-LINE ONLY, deliberately. A trailing comment after real code still scans, because the
 * import on that line is real. Skipping is safe in the direction that matters: a commented-out
 * import is not an import, so this can only remove false positives — it cannot hide a
 * specifier that any runtime would resolve.
 */
function isFullLineComment(text: string): boolean {
  const trimmed = text.trimStart()
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')
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
