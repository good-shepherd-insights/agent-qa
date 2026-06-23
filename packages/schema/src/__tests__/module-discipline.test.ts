import { globSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourceFiles = globSync('src/**/*.ts', { cwd: pkgRoot })
  .filter(file => !file.includes('__tests__'))
  .map(file => join(pkgRoot, file))

describe('module discipline', () => {
  it('uses extension-less import specifiers', () => {
    const offenders: string[] = []

    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\bfrom\s+['"](\.[^'"]+\.js)['"]/g)) {
        offenders.push(`${file}: ${match[1]}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('contains no runtime IO or side-effect APIs', () => {
    const bannedPatterns = [
      /\bfs\./,
      /\brequire\(/,
      /process\.(env|exit|cwd)/,
      /\bfetch\(/,
      /child_process/,
      /globalThis\./,
      /\bTextEncoder\b/,
      /\bcrypto\b/,
      /\bnew Date\b|\bDate\.(now|UTC|parse)\b/,
      /\bMath\.random\b/,
    ]
    const offenders: string[] = []

    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8')
      for (const bannedPattern of bannedPatterns) {
        if (bannedPattern.test(source)) {
          offenders.push(`${file}: ${bannedPattern}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })
})
