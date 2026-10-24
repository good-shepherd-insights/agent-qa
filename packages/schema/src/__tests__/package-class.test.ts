import { globSync, readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ALLOWED_DEPS = new Set(['zod'])
const NODE_BUILTINS = new Set(builtinModules.flatMap(moduleName => [moduleName, `node:${moduleName}`]))
const FORBIDDEN_SUBSTRINGS = [
  'playwright',
  'appium',
  'xcuitest',
  'webdriverio',
  'better-sqlite3',
  'sqlite',
  'embedder',
  'transformers',
  'onnxruntime',
]

const sourceFiles = globSync('src/**/*.ts', { cwd: pkgRoot })
  .filter(file => !file.includes('__tests__'))
  .filter(file => !file.includes('ownership-contract'))
  .map(file => join(pkgRoot, file))

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [
    ...source.matchAll(
      /\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    ),
  ].map(match => match[1] ?? match[2] ?? match[3])
}

describe('package-class boundary', () => {
  it('imports no Node builtin, platform driver, storage, embedder, or disallowed package', () => {
    const violations: string[] = []

    for (const file of sourceFiles) {
      for (const specifier of importSpecifiers(file)) {
        const bareSpecifier = specifier.replace(/^node:/, '').split('/')[0]
        if (specifier.startsWith('.')) continue

        if (NODE_BUILTINS.has(specifier) || NODE_BUILTINS.has(bareSpecifier)) {
          violations.push(`${file}: node builtin ${specifier}`)
        }

        if (FORBIDDEN_SUBSTRINGS.some(forbidden => specifier.includes(forbidden))) {
          violations.push(`${file}: forbidden package ${specifier}`)
        }

        if (specifier.startsWith('@vostride/agent-qa-')) {
          violations.push(`${file}: disallowed first-party package ${specifier}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('declares only allow-listed runtime dependencies', () => {
    const packageJson = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const declared = Object.keys(packageJson.dependencies ?? {})

    expect(declared.filter(dependency => !ALLOWED_DEPS.has(dependency))).toEqual([])
  })
})
