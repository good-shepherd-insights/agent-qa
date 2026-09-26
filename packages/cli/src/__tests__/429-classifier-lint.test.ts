import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// D-18: the CLI and the dashboard classify a failed provider call through the one shared module.
// Plan 10 adds the connect route's source to this cell.
const here = dirname(fileURLToPath(import.meta.url))
const SOURCES = [
  { name: 'agent-qa auth test', path: join(here, '..', 'commands', 'auth.ts') },
  {
    name: 'dashboard routes',
    path: join(here, '..', '..', '..', 'dashboard-server', 'src', 'server', 'routes.ts'),
  },
] as const

const LOCAL_CLASSIFIER_LITERAL = 'auth|unauthorized|401'

describe('one provider-error classifier (429-08)', () => {
  it('CLASSIFIER-ONE-MODULE: each surface imports the shared classifier and spells none of its own', () => {
    for (const { name, path } of SOURCES) {
      const source = readFileSync(path, 'utf8')
      const imports = source.match(/^import[\s\S]*?from '([^']+)'/gmu) ?? []
      expect(source.length, `the witness: ${name} was read`).toBeGreaterThan(0)
      expect(imports.length, `the witness: the scan found ${name}'s imports`).toBeGreaterThan(0)

      const sharedImport = imports.find((statement) =>
        /from '@vostride\/agent-qa-schema'$/u.test(statement)
        && /\bclassifyProviderError\b/u.test(statement)
        && !/^import type /u.test(statement))
      expect(sharedImport, `${name} imports classifyProviderError from the schema`).toBeDefined()
      expect(source.includes(LOCAL_CLASSIFIER_LITERAL), `${name} holds no local classifier`).toBe(false)
    }
  })
})
