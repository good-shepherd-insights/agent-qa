// The capability catalog's freshness and loader legs (Phase 398 plan 01 — XPLN-01, D-03).
//
// These legs JOIN the 397 conformance suite rather than standing beside it: they run in the same
// directory, under the same CI job, on every PR, and the regen script's refuse-while-red gate reads
// the whole directory's result. One suite, one denominator (397 D-10).
//
// WHAT THE FRESHNESS LEG IS. The committed artifact is a photograph of the live seams. The leg
// re-takes the photograph in memory and compares — and when they disagree it names WHICH ROW and
// WHICH FIELD, because "the catalog is stale" is not something a person can act on and
// "runs.digest.description moved" is.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CapabilityCatalogSchema,
  committedFileText,
  type CapabilityCatalog,
} from '@vostride/agent-qa-schema'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  CapabilityCatalogUnavailableError,
  CATALOG_REGEN_SCRIPT,
  loadCapabilityCatalog,
} from '../../capability-catalog/loader.js'
import {
  CATALOG_NOTE,
  CATALOG_PATH,
  CATALOG_REGEN_INSTRUCTION,
  capabilityCatalogFromRoot,
  capabilityCatalogText,
  catalogEmitRequested,
  catalogFindings,
  emitCatalogText,
} from './catalog.js'

/** This directory, so the source sweep below reads the files it names. */
const CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url))

describe('the capability catalog', () => {
  let live: CapabilityCatalog

  beforeAll(async () => {
    live = await capabilityCatalogFromRoot()
    // The PRINT the regen script lifts out. It happens here, once, off the same value the leg below
    // compares with — so the script cannot be handed a catalog the suite did not just measure.
    if (catalogEmitRequested()) emitCatalogText(capabilityCatalogText(live))
  })

  it('regenerates byte-identically from the live seams into the committed artifact (D-03)', () => {
    const committed = loadCapabilityCatalog(CATALOG_PATH)

    const findings = catalogFindings(live.rows, committed.rows)
    const named = findings.map((finding) => `${finding.kind}:${finding.key}.${finding.field}`)
    expect(
      named,
      `the committed capability catalog disagrees with the live tree:\n`
      + findings.map((finding) => `  - ${finding.message}`).join('\n'),
    ).toEqual([])

    // …and then the whole document, so the note, the count and the digest are pinned too. The
    // findings above are what a person READS; this is what makes the artifact byte-exact.
    expect(committed.$note, 'the committed note is not the produced one').toEqual([...CATALOG_NOTE])
    expect(committed.rowCount, 'the committed row count disagrees with its own rows')
      .toBe(committed.rows.length)
    expect(committed.rowsDigest, 'the committed digest disagrees with the live rows')
      .toBe(live.rowsDigest)
    expect(committedFileText(committed), 'the committed catalog is not canonically serialized')
      .toBe(capabilityCatalogText(live))
  })

  it('carries every capability the composition root declares, and nothing it does not', () => {
    // The vacuity floor, in the suite rather than only in the script: a freshness leg that agreed
    // because both sides were empty is the CI-shaped version of the failure the artifact prevents.
    const opRows = live.rows.filter((row) => row.kind === 'op')
    const aliasRows = live.rows.filter((row) => row.kind === 'alias')
    const skillRows = live.rows.filter((row) => row.kind === 'skill')
    expect(opRows.length, 'the catalog produced no op rows').toBeGreaterThan(0)
    expect(aliasRows.length, 'the catalog produced no alias rows').toBeGreaterThan(0)
    expect(skillRows.length, 'the catalog produced no skill rows').toBeGreaterThan(0)
    expect(live.rowCount, 'the catalog\'s own count sentence disagrees with its rows')
      .toBe(live.rows.length)
  })

  it('parses through the published contract, so no consumer has to defend against its shape', () => {
    const parsed = CapabilityCatalogSchema.safeParse(
      JSON.parse(capabilityCatalogText(live)) as unknown,
    )
    expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.')))
      .toEqual([])
  })
})

describe('the capability catalog loader', () => {
  it('fails loud on a missing artifact, naming the regen script (edge XPLN-01/empty)', () => {
    const absent = join(tmpdir(), 'agent-qa-398-no-such-catalog', 'capability-catalog.json')
    let thrown: unknown
    try {
      loadCapabilityCatalog(absent)
    } catch (error) {
      thrown = error
    }
    // A silently empty catalog would present a broken install as a product that knows nothing —
    // which is exactly what `explain`'s abstention arm looks like when it is working correctly.
    expect(thrown, 'a missing catalog loaded without complaint').toBeInstanceOf(
      CapabilityCatalogUnavailableError,
    )
    expect((thrown as Error).message).toContain(CATALOG_REGEN_SCRIPT)
    expect((thrown as Error).message).toContain(CATALOG_REGEN_INSTRUCTION)
  })

  it('fails loud on an unparseable artifact rather than reading past the damage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-qa-398-torn-'))
    try {
      const path = join(dir, 'capability-catalog.json')
      writeFileSync(path, '{ "rows": [', 'utf8')
      expect(() => loadCapabilityCatalog(path)).toThrow(CapabilityCatalogUnavailableError)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is never written from the suite: the only writer is the regen script (D-01)', () => {
    // THE PROHIBITION, AS SOURCE — the golden's own cell next door, applied to this artifact. The
    // sweep ranges every `.ts` file in this directory INCLUDING ONE ADDED TOMORROW, because "the
    // catalog must not be one keystroke from silently blessed" is a claim about what this directory
    // CAN do, not about what it happens to do today.
    const files = readdirSync(CONFORMANCE_DIR).filter((name) => name.endsWith('.ts'))
    expect(files.length, 'the conformance directory read back empty').toBeGreaterThan(4)

    // ASSEMBLED FROM FRAGMENTS, on the ledger sweep's precedent and for its reason: the sweep reads
    // its own file, so a forbidden token written out here is the sweep finding its own prohibition.
    const forbidden: readonly string[] = [
      ['writeFileSync(', 'CATALOG_PATH'].join(''),
      ['writeFile(', 'CATALOG_PATH'].join(''),
      ['appendFileSync(', 'CATALOG_PATH'].join(''),
    ]
    for (const file of files) {
      const code = readFileSync(join(CONFORMANCE_DIR, file), 'utf8')
      for (const token of forbidden) {
        expect(code, `${file} carries a path that could bless the catalog: ${token}`)
          .not.toContain(token)
      }
    }
    // …and the sweep is not vacuous: a fragment assembled wrong would leave it quietly searching
    // for a string that cannot occur.
    for (const token of forbidden) {
      expect(`prefix ${token} suffix`, `the sweep no longer recognises ${token}`).toContain(token)
    }
  })

  it('loads a PRODUCED zero-row catalog as a valid zero-row catalog (edge XPLN-01/empty)', () => {
    // PRODUCED, NOT LITERAL: the fixture goes out through the same canonical serializer the
    // committed artifact does and comes back through the same parser, so it is a document the
    // producer could actually emit. A hand-typed `{"rows":[]}` would prove only that the parser
    // accepts something nobody can generate.
    const dir = mkdtempSync(join(tmpdir(), 'agent-qa-398-empty-'))
    try {
      const path = join(dir, 'capability-catalog.json')
      const empty: CapabilityCatalog = {
        $note: [...CATALOG_NOTE],
        rowCount: 0,
        rowsDigest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        rows: [],
      }
      writeFileSync(path, committedFileText(empty), 'utf8')

      const loaded = loadCapabilityCatalog(path)
      expect(loaded.rows, 'a produced zero-row catalog did not load as zero rows').toEqual([])
      expect(loaded.rowCount).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
