import { readFileSync, readdirSync } from 'node:fs'
import { join as joinPath, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

import { routes } from '@/lib/routes'

describe('canonical dashboard routes', () => {
  it('keeps only the live top-level helpers', () => {
    expect(routes.runs).toBe('/runs')
    expect(routes.tests).toBe('/tests')
    expect(routes.testNew).toBe('/tests/new')
    expect(routes.hooks).toBe('/hooks')
    expect(routes.hookNew).toBe('/hooks/new')
    expect(routes.insights).toBe('/insights')
    expect(routes.config).toBe('/config')
  })

  it('does not expose stale analytics/trends helpers', () => {
    expect('analytics' in routes).toBe(false)
    expect('trends' in routes).toBe(false)
  })

  it('does not expose retired memory routes', () => {
    expect('memory' in routes).toBe(false)
    expect('memoryProduct' in routes).toBe(false)
  })
})

describe('hook route helpers', () => {
  it('hookView returns /hook/:id (singular)', () => {
    expect(routes.hookView('h_foo-bar')).toBe('/hook/h_foo-bar')
  })

  it('hookEdit returns /hook/:id/edit', () => {
    expect(routes.hookEdit('h_foo-bar')).toBe('/hook/h_foo-bar/edit')
  })

  it('hooks list remains plural and hookNew unchanged', () => {
    expect(routes.hooks).toBe('/hooks')
    expect(routes.hookNew).toBe('/hooks/new')
  })
})

describe('suite route helpers', () => {
  it('suiteView returns /suite/:suite-id (singular)', () => {
    expect(routes.suiteView('s_foo-bar')).toBe('/suite/s_foo-bar')
  })
  it('suiteEdit returns /suite/:suite-id/edit', () => {
    expect(routes.suiteEdit('s_foo-bar')).toBe('/suite/s_foo-bar/edit')
  })
  it('suites list remains plural and suiteNew unchanged', () => {
    expect(routes.suites).toBe('/suites')
    expect(routes.suiteNew).toBe('/suites/new')
  })
  it('does not percent-encode opaque suite ids', () => {
    expect(routes.suiteView('s_abc-def')).not.toContain('%')
  })
})

describe('config route helpers', () => {
  it('configItem returns canonical bucket/item query params', () => {
    expect(routes.configItem('registry', 'targets')).toBe('/config?bucket=registry&item=targets')
  })
})

// THE ARTIFACT HREF HAS EXACTLY ONE MINTER (405-06 · DETL-03, D-14 / 400-08).
//
// Every artifact the rebuilt page shows is addressed by a `{ id, sha }` ref that the projection
// carries — never by a URL a store wrote into a row. The href is MINTED here, from the run id and
// the sha, through the same total route map every other link comes from. The third cell below is
// the structural half of that law: it walks the source tree and asserts no OTHER file builds an
// artifact path, because a second minter is how a route rename becomes a 404 that only shows up in
// production.
//
// THE RUN ID IS ENCODED AND THE SHA IS NOT, and the asymmetry is deliberate. A run id is opaque
// and may carry a space or a slash. A sha is 64 hex characters that the STORE validates before any
// path use (`FsEvidenceArtifactStore`, 367) — encoding it would be a no-op on a well-formed sha and
// would corrupt a malformed one into something the server's refusal could no longer name, and
// case-folding it would change the content address itself.

describe('artifact route helper', () => {
  const SHA = 'a'.repeat(64)

  it('mints /api/runs/<encoded runId>/artifacts/<sha>', () => {
    expect(routes.runArtifact('r 1', SHA)).toBe(`/api/runs/r%201/artifacts/${SHA}`)
  })

  it('passes the sha through verbatim — never encoded, never re-cased', () => {
    const mixed = `${'A'.repeat(32)}${'f'.repeat(32)}`
    const href = routes.runArtifact('run_1', mixed)

    expect(href).toBe(`/api/runs/run_1/artifacts/${mixed}`)
    expect(href.endsWith(mixed)).toBe(true)
  })

  it('is the only artifact-href minter in the UI source tree', () => {
    // Concatenated so this assertion cannot satisfy the inventory by matching itself
    // (the `v1-retry-machinery-deleted.test.ts` idiom, restated in 405-03).
    const needle = '/artifacts' + '/'
    const srcRoot = resolvePath(fileURLToPath(new URL('../../', import.meta.url)))

    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = joinPath(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue
          walk(full)
          continue
        }
        if (!/\.tsx?$/.test(entry.name)) continue
        if (full.endsWith(`${sep}lib${sep}routes.ts`)) continue
        if (/\.test\.tsx?$/.test(entry.name)) continue
        if (readFileSync(full, 'utf8').includes(needle)) offenders.push(full.slice(srcRoot.length))
      }
    }
    walk(srcRoot)

    expect(offenders).toEqual([])
  })
})
