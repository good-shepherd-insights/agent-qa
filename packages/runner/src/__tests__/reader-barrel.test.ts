import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const barrelPath = join(pkgRoot, 'src', 'index.ts')

const bannedWriteSymbolPatterns = [
  /\bDelta\b/,
  /\bcommit\b/,
  /\bpromote\b/,
  /\bpromotion\b/,
  /\badd\b/,
  /\bconfirm\b/,
  /\bsupersede\b/,
  /\bdeprecate\b/,
]

describe('reader barrel', () => {
  it('exports KnowledgeHintReader without knowledge-write symbols', () => {
    const source = readFileSync(barrelPath, 'utf8')
    const offenders: string[] = []

    for (const bannedPattern of bannedWriteSymbolPatterns) {
      if (bannedPattern.test(source)) {
        offenders.push(`${barrelPath}: ${bannedPattern}`)
      }
    }

    expect(source).toContain('KnowledgeHintReader')
    expect(offenders).toEqual([])
  })
})
