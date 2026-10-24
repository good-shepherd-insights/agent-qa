import { describe, expect, it } from 'vitest'

import type { OwnershipContract } from '../../contract-types.js'
import type { SpecifierHit } from '../extract-specifiers.js'
import {
  EVAL_LOCAL_MAIN_ENTRY,
  EVAL_LOCAL_MAIN_ENTRY_ALLOWLIST,
  EVAL_LOCAL_PACKAGE_DIR,
  EVAL_LOCAL_READER_ENTRY,
  findEvalLocalAllowanceUnusedOffenders,
  findEvalLocalMainEntryOffenders,
} from '../eval-local-reader-carveout.js'

/** Spelled through the shipped allowance, so a widening cannot leave these cells stale. */
const ALLOWED_PREFIX = EVAL_LOCAL_MAIN_ENTRY_ALLOWLIST[0]
const CLI_COMPOSITION_ROOT = `${ALLOWED_PREFIX}src/eval-session-composition.ts`
const CLI_EVAL_COMMAND = `${ALLOWED_PREFIX}src/commands/eval.ts`
/** The proposer Phase 422 will give a corpus port — the file this rule exists ahead of. */
const PROPOSER_FILE = 'packages/agent-local/src/composition/compose-local-agent.ts'

function fixtureHit(specifier: string, file: string, line = 1): SpecifierHit {
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

describe('eval-local-reader-carveout — the proposer port rule (414 D-20)', () => {
  it('names file and line when a proposer package reaches the gate-side main entry', () => {
    const offenders = findEvalLocalMainEntryOffenders(
      fixtureContract('packages/agent-local'),
      [fixtureHit(EVAL_LOCAL_MAIN_ENTRY, PROPOSER_FILE, 12)],
    )

    expect(Array.isArray(offenders)).toBe(true)
    expect(offenders).toHaveLength(1)
    // Asserted as substrings, not as a closed set: this is the message a reviewer reads at 2am,
    // and pinning it whole would make every wording edit a test edit.
    expect(offenders[0]).toContain('eval-local-reader-carveout: ')
    expect(offenders[0]).toContain(`${PROPOSER_FILE}:12`)
    expect(offenders[0]).toContain('/reader')
  })

  it('allows every file under the allowance prefix, not one pinned file', () => {
    // The CLI composition root names the entry on four lines, two of them type re-exports, and
    // `commands/eval.ts` is the kind of sibling that joins it next. A single-file pin would pass
    // today and RED on a refactor that changed nothing architectural.
    expect(findEvalLocalMainEntryOffenders(
      fixtureContract('packages/cli'),
      [
        fixtureHit(EVAL_LOCAL_MAIN_ENTRY, CLI_COMPOSITION_ROOT, 76),
        fixtureHit(EVAL_LOCAL_MAIN_ENTRY, CLI_EVAL_COMMAND, 4),
      ],
    )).toEqual([])
  })

  it('never treats the /reader subpath as an offender, from any package', () => {
    expect(findEvalLocalMainEntryOffenders(
      fixtureContract('packages/agent-local'),
      [fixtureHit(EVAL_LOCAL_READER_ENTRY, PROPOSER_FILE, 12)],
    )).toEqual([])
  })

  it('says nothing about eval-local\'s own package', () => {
    // Its files reach their siblings relatively; a hit spelled through the package name there is
    // eval-local talking to itself, which the gate/proposer split has no opinion about.
    expect(findEvalLocalMainEntryOffenders(
      fixtureContract(EVAL_LOCAL_PACKAGE_DIR),
      [
        fixtureHit(EVAL_LOCAL_MAIN_ENTRY, `${EVAL_LOCAL_PACKAGE_DIR}/src/index.ts`, 3),
        fixtureHit(EVAL_LOCAL_MAIN_ENTRY, `${EVAL_LOCAL_PACKAGE_DIR}/src/reader.ts`, 9),
      ],
    )).toEqual([])
  })

  it('reports an allowance that no file uses, and stays quiet once one or more do', () => {
    for (const hits of [
      [],
      [
        fixtureHit(EVAL_LOCAL_READER_ENTRY, PROPOSER_FILE, 12),
        fixtureHit('@vostride/agent-qa-schema', CLI_COMPOSITION_ROOT, 95),
        // Outside the prefix — an offender by direction 1, and no evidence for direction 2.
        fixtureHit(EVAL_LOCAL_MAIN_ENTRY, PROPOSER_FILE, 14),
      ],
    ]) {
      const offenders = findEvalLocalAllowanceUnusedOffenders(hits)
      expect(Array.isArray(offenders)).toBe(true)
      expect(offenders).toHaveLength(1)
      expect(offenders[0]).toContain('eval-local-reader-carveout: ')
      expect(offenders[0]).toContain('used by no file')
      expect(offenders[0]).toContain(ALLOWED_PREFIX)
    }

    // One importer is the state today. Several are fine too — the allowance is a directory of
    // composition files, so unlike the knowledge writer rule there is no singleton arm.
    expect(findEvalLocalAllowanceUnusedOffenders([
      fixtureHit(EVAL_LOCAL_MAIN_ENTRY, CLI_COMPOSITION_ROOT, 76),
    ])).toEqual([])
    expect(findEvalLocalAllowanceUnusedOffenders([
      fixtureHit(EVAL_LOCAL_MAIN_ENTRY, CLI_COMPOSITION_ROOT, 76),
      fixtureHit(EVAL_LOCAL_MAIN_ENTRY, CLI_EVAL_COMMAND, 4),
    ])).toEqual([])
  })

  it('reaches packages the reader carve-out was never scanned over', () => {
    // Pitfall 9b: `READER_CARVEOUT_SCANNED_DIRS` is ['packages/cli', 'packages/agent-local'], so a
    // rule scoped to it would pass forever while knowledge-local held the gate-side entry.
    const offenders = findEvalLocalMainEntryOffenders(
      fixtureContract('packages/knowledge-local'),
      [fixtureHit(EVAL_LOCAL_MAIN_ENTRY, 'packages/knowledge-local/src/index.ts', 7)],
    )

    expect(offenders).toHaveLength(1)
    expect(offenders[0]).toContain('packages/knowledge-local/src/index.ts:7')
  })
})
