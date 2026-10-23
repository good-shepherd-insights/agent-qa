import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const demoRoot = fileURLToPath(new URL('../../../../../demo/', import.meta.url))
const CASSETTES_ROOT = join(demoRoot, 'init', 'agent-qa-eval', 'cassettes')
const SUPER_REPOSITORY_LAYOUT = existsSync(join(demoRoot, 'init'))

// The super-repository's eval cassettes are data outside agent-qa: they keep the run-evidence
// stamps they were recorded with, which this build does not read, so no sweep runs over them.
const CASSETTE_SWEEP_SKIP_REASON = SUPER_REPOSITORY_LAYOUT
  ? "the super-repository's eval cassettes keep the run-evidence stamps they were recorded with, "
    + 'which this build does not read, so the committed cassette proof sweep was NOT run.'
  : `agent-qa is not checked out inside the super-repository (no ${join(demoRoot, 'init')}): `
    + "the committed cassette proof sweep (the super-repository's eval cassettes, part of the "
    + 'model gate removed by V2-REL-02) was NOT run.'

describe('415 D-07 — committed populated-brief reconstruction', () => {
  it('415 D-07 — layout: names why the committed cassette sweep did or did not run', () => {
    const layout = CASSETTE_SWEEP_SKIP_REASON
    process.stderr.write(`\n[415 committed briefs] ${layout}\n`)
    if (SUPER_REPOSITORY_LAYOUT) expect(existsSync(CASSETTES_ROOT), CASSETTES_ROOT).toBe(true)
  })
})
