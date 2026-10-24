// FLOOR-03 SC3: the eval package.json diff adds none; pin every runtime dependency key.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('keeps exactly the five existing eval runtime dependencies (FLOOR-03)', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
  ) as { dependencies: Record<string, string> }
  expect(Object.keys(manifest.dependencies).sort()).toEqual([
    '@vostride/agent-qa-runner',
    '@vostride/agent-qa-safety',
    '@vostride/agent-qa-schema',
    'ai',
    'zod',
  ])
})
