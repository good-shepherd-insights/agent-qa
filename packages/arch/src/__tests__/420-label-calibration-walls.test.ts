import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))

describe('420 label calibration walls', () => {
  it('registers the calibration wall in validate:arch and its mutation entrypoint', () => {
    const { scripts } = JSON.parse(readFileSync(`${repoRoot}/package.json`, 'utf8'))
    expect(scripts['validate:arch'].split(/\s+/)).toContain(
      'src/__tests__/420-label-calibration-walls.test.ts',
    )
    expect(scripts['validate:label-mutation']).toBe('bash scripts/420-label-mutation.sh')
  })
})
