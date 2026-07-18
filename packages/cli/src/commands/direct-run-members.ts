import type { ParsedTestBinding } from '@vostride/agent-qa-core'
import type { RunMemberDescriptor } from '@vostride/agent-qa-runner'

export interface DirectRunMembers {
  members: RunMemberDescriptor[]
  digestMembers: Array<{ testFileContent: string }>
}

/**
 * Build direct-run descriptors from parser-minted bindings without re-deriving source identity.
 * `filePath` is REQUIRED since 381-01: ABRF-02 stable test identity is the source file plus test
 * identity, so every downstream handoff and projection must copy the binding path verbatim.
 */
export function buildDirectRunMembers(bindings: ParsedTestBinding[]): DirectRunMembers {
  return {
    members: bindings.map(({ test, filePath }, testIndex) => ({
      testId: (test as any)['test-id'] ?? test.name,
      testIndex,
      name: test.name,
      // NO failFastGroup — the single-test path runs all members then aggregates.
      filePath,
      totalSteps: test.steps.length,
    })),
    digestMembers: bindings.map(({ fileContent }) => ({ testFileContent: fileContent })),
  }
}
