import { readFileSync } from 'node:fs'

import { parseTestFile } from '@vostride/agent-qa-core'
import type { AuthoringTestRef } from '@vostride/agent-qa-knowledge-local'

/**
 * Discover the consumer repository's authored test universe without crossing D-16's content wall.
 * YAML is read only for core parsing; returned values contain stable file/name identities and no
 * test body, steps, or other content. Unreadable and parse-error files are omitted atomically.
 */
export function discoverAuthoringKnownTests(
  testFilePaths: readonly string[],
): AuthoringTestRef[] {
  const refs: AuthoringTestRef[] = []
  for (const filePath of testFilePaths) {
    try {
      const parsed = parseTestFile(readFileSync(filePath, 'utf8'), filePath)
      if (parsed.errors.length > 0) continue
      refs.push(...parsed.tests.map((test) => ({ filePath, testName: test.name })))
    } catch {
      // Discovery is advisory: one unreadable or malformed file cannot block the authoring port.
    }
  }
  return refs
}
