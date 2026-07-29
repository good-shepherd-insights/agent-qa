import { describe, expect, it } from 'vitest'

import type { OwnershipContract } from '../../contract-types.js'
import type { SpecifierHit } from '../extract-specifiers.js'
import {
  findKnowledgeLocalWallOffenders,
  findReaderCarveoutOffenders,
  KNOWLEDGE_READER_FILES,
  KNOWLEDGE_WRITER_ALLOWLIST,
} from '../reader-carveout.js'

const MAIN_ENTRY = '@vostride/agent-qa-knowledge-local'
const READER_ENTRY = `${MAIN_ENTRY}/reader`
const RELOCATED_READER_FILE = KNOWLEDGE_READER_FILES[0]

function fixtureHit(
  specifier: string,
  file: string,
  line = 1,
): SpecifierHit {
  return { specifier, file, line }
}

function fixtureContract(packageDir: string): OwnershipContract {
  return {
    packageName: `@vostride/agent-qa-${packageDir.replace('packages/', '')}`,
    packageDir,
    packageClasses: ['providerNeutral'],
    allowedResponsibilities: [],
    forbiddenResponsibilities: [],
    externalDependencies: [],
    internalDependencies: [],
  }
}

describe('reader carve-out', () => {
  it('rejects the write-capable main entry outside the pinned writer allowlist', () => {
    expect(KNOWLEDGE_WRITER_ALLOWLIST).toEqual([
      'packages/cli/src/curation/',
      'packages/cli/src/commands/knowledge-maintain.ts',
    ])
    expect(findReaderCarveoutOffenders([
      fixtureHit(MAIN_ENTRY, 'packages/cli/src/commands/run.ts', 17),
    ])).toEqual([
      `reader-carveout: packages/cli/src/commands/run.ts:17 ⇏ ${MAIN_ENTRY} (main entry requires writer allowlist)`,
    ])
  })

  it('rejects non-reader knowledge-local imports from either pinned reader file', () => {
    // 2026-07-29 (Phase 385 plan 08, D-13): the first pinned reader file relocated with the run
    // composition. The path is spelled through the shipped pin rather than repeated here, so the
    // next relocation updates one place and this case cannot quietly start asserting about a file
    // the rule no longer knows.
    expect(findReaderCarveoutOffenders([
      fixtureHit(MAIN_ENTRY, RELOCATED_READER_FILE, 1),
      fixtureHit(`${MAIN_ENTRY}/index-reader`, 'packages/cli/src/commands/knowledge-read.ts', 7),
    ])).toEqual([
      `reader-carveout: ${RELOCATED_READER_FILE}:1 ⇏ ${MAIN_ENTRY} (reader file requires /reader)`,
      `reader-carveout: packages/cli/src/commands/knowledge-read.ts:7 ⇏ ${MAIN_ENTRY}/index-reader (reader file requires /reader)`,
    ])
  })

  it('accepts the pinned writer files and read-only reader imports', () => {
    expect(findReaderCarveoutOffenders([
      fixtureHit(MAIN_ENTRY, 'packages/cli/src/curation/curation-tail.ts'),
      fixtureHit(MAIN_ENTRY, 'packages/cli/src/curation/emit-candidates.ts'),
      fixtureHit(MAIN_ENTRY, 'packages/cli/src/commands/knowledge-maintain.ts'),
      fixtureHit(READER_ENTRY, RELOCATED_READER_FILE),
      fixtureHit(READER_ENTRY, 'packages/cli/src/commands/knowledge-read.ts'),
    ])).toEqual([])
  })
})

describe('knowledge-local negative package walls', () => {
  it.each([
    ['packages/eval', READER_ENTRY, 'replay-hermeticity'],
    ['packages/eval-local', `${MAIN_ENTRY}/deep/path`, 'replay-hermeticity'],
    ['packages/dashboard-server', MAIN_ENTRY, 'spawn-until-M5'],
    ['packages/runner', READER_ENTRY, 'port-type-only'],
  ])('rejects %s imports from every knowledge-local entry', (packageDir, specifier, rationale) => {
    const file = `${packageDir}/src/fixture.ts`
    expect(findKnowledgeLocalWallOffenders(
      fixtureContract(packageDir),
      [fixtureHit(specifier, file, 9)],
    )).toEqual([
      `knowledge-local-wall: ${packageDir} (${rationale}) ⇏ ${specifier} at ${file}:9`,
    ])
  })

  it('ignores knowledge-local imports in packages outside the negative walls', () => {
    expect(findKnowledgeLocalWallOffenders(
      fixtureContract('packages/cli'),
      [fixtureHit(MAIN_ENTRY, 'packages/cli/src/curation/curation-tail.ts')],
    )).toEqual([])
  })
})
