// The manifest legs: the projected migration map, the derived example calls, and `init --agent`
// (Phase 398 plan 08 — XPLN-01 / XPLN-03, D-08 / D-14 / D-16).
//
// WHAT THIS FILE IS FOR. Plan 01 made the catalog one committed artifact. This plan makes it the
// WHOLE answer: the migration map projected in beside the rows, an example call derived per op, and
// one non-interactive read — `agent-qa init --agent` — that hands an external agent all of it plus
// this workspace's posture. The claim SC-1 makes is that those are the same bytes, and the cells
// below are what turn that claim into a measurement.
//
// WHERE EACH CELL POINTS, AND WHY IT MATTERS. The census cells here read the LIVE mint, exactly as
// plan 01's six censuses do, and that is a deliberate division of labour rather than a convenience:
// ONE cell in this directory owns "committed versus live" (the freshness leg in `catalog.test.ts`,
// which byte-compares the whole document including these two new sections), and every other cell
// asserts a property of what the producer produces. Two cells owning the same comparison would mean
// a stale artifact reds twice and says two different things, and — the reason that matters here —
// the regen script's refuse-while-red gate allows exactly ONE red by name. A census cell that read
// the committed file would make the artifact unregenerable the moment the producer legitimately
// changed, which is the one state the script exists to let a person out of.
//
// THE MANIFEST CELLS ARE THE EXCEPTION, and they are the exception on purpose: `buildAgentManifest`
// LOADS the committed artifact, so a manifest cell that read a live mint would be measuring a
// second recipe rather than the shipped read path.

import { V1_TOOL_MIGRATION_MAP } from '@vostride/agent-qa-mcp'
import {
  CatalogMigrationArmSchema,
  canonicalJson,
  type CapabilityCatalog,
  type CatalogOpRow,
} from '@vostride/agent-qa-schema'
import { beforeAll, describe, expect, it } from 'vitest'

import { loadCapabilityCatalog } from '../../capability-catalog/loader.js'
import {
  CATALOG_PATH,
  CATALOG_REGEN_INSTRUCTION,
  catalogExampleCallOf,
  capabilityCatalogFromRoot,
} from './catalog.js'

// ---- The projected migration map (D-14) --------------------------------------------------------

describe('the catalog\'s migration map projection (D-14, XPLN-03)', () => {
  let live: CapabilityCatalog

  beforeAll(async () => {
    live = await capabilityCatalogFromRoot()
  })

  it('projects exactly the shipped map, in both directions', () => {
    // THE COMPLETE-SET LAW, applied to the pair D-14 names. One direction alone is the failure
    // this shape prevents twice over: a projection that carried every source entry could still
    // carry an invented one, and a projection every one of whose entries came from the source
    // could still be missing twenty of them.
    const projected = live.migrationMap.map((entry) => entry.v1Name).sort()
    const source = V1_TOOL_MIGRATION_MAP.map((entry) => entry.v1Name).sort()

    const missing = source.filter((name) => !projected.includes(name))
    const stray = projected.filter((name) => !source.includes(name))
    expect(missing, 'the shipped migration map carries v1 names the catalog does not project')
      .toEqual([])
    expect(stray, 'the catalog projects v1 names the shipped migration map does not carry')
      .toEqual([])
    // …and the set equality behind the two named lists, so a cancelling pair (one dropped, one
    // invented) cannot pass by making both lists non-empty in a way nobody reads.
    expect(projected, 'the projection and the source disagree about the v1 name set')
      .toEqual(source)
  })

  it('projects every field of every entry VERBATIM, never a re-worded one', () => {
    // The member set above says WHICH names travelled; this says the entry a caller reads is the
    // entry the adjudication ruled. A projection free to re-word a `route` is a second place the
    // product answers a v1 caller, and the two would agree until somebody improved one of them.
    const bySource = new Map(V1_TOOL_MIGRATION_MAP.map((entry) => [entry.v1Name, entry]))
    const drifted: string[] = []
    for (const projected of live.migrationMap) {
      const source = bySource.get(projected.v1Name)
      if (source === undefined) continue
      // Through the ONE canonical serializer, so an absent key and an `undefined` value are the
      // same fact and field order cannot make two equal entries look different.
      if (canonicalJson(projected) !== canonicalJson({ ...source })) {
        drifted.push(
          `${projected.v1Name}: the catalog projects ${canonicalJson(projected)}, the shipped map `
          + `declares ${canonicalJson({ ...source })}`,
        )
      }
    }
    expect(drifted, 'projected migration entries disagree with the shipped map').toEqual([])
    // The comparison above is vacuous over an empty projection, so the denominator is asserted.
    expect(live.migrationMap.length, 'the catalog projected no migration entries at all')
      .toBe(V1_TOOL_MIGRATION_MAP.length)
    expect(live.migrationCount, 'the catalog\'s own migration count disagrees with its entries')
      .toBe(live.migrationMap.length)
  })

  it('sorts the projection by v1 name, so a re-ordered source is a zero-line diff', () => {
    const names = live.migrationMap.map((entry) => entry.v1Name)
    expect(names, 'the projected migration map is not sorted by v1 name').toEqual([...names].sort())
  })

  it('lands in the COMMITTED artifact, entry for entry, as the shipped map declares it', () => {
    // THE ARTIFACT ITSELF, not the mint that would produce it. Every cell above measures the
    // producer; this one measures the bytes a shipped install reads, through the ONE loader — the
    // difference being that a producer improved in a branch nobody regenerated is invisible to all
    // of them and visible to this.
    //
    // IT IS A COMMITTED-ARTIFACT CELL, and the regen script's gate knows it by name: a legitimate
    // change to the shipped map REDs this and the freshness leg together, and the whole point of
    // the one writer is that a person can then regenerate. See ALLOWED_RED in
    // `scripts/398-regen-catalog.sh`.
    const committed = loadCapabilityCatalog(CATALOG_PATH)
    const projected = committed.migrationMap.map((entry) => entry.v1Name).sort()
    const source = V1_TOOL_MIGRATION_MAP.map((entry) => entry.v1Name).sort()

    expect(
      source.filter((name) => !projected.includes(name)),
      `the committed catalog projects no entry for these v1 names — ${CATALOG_REGEN_INSTRUCTION}`,
    ).toEqual([])
    expect(
      projected.filter((name) => !source.includes(name)),
      `the committed catalog projects v1 names the shipped map does not carry — `
      + CATALOG_REGEN_INSTRUCTION,
    ).toEqual([])
    expect(
      canonicalJson(committed.migrationMap),
      `the committed catalog's migration entries disagree with the shipped map — `
      + CATALOG_REGEN_INSTRUCTION,
    ).toBe(canonicalJson(live.migrationMap))
    expect(committed.migrationCount, 'the committed migration count disagrees with its entries')
      .toBe(committed.migrationMap.length)
  })

  it('spells exactly the arms the shipped map uses — no member here that nothing carries', () => {
    // THE TIE ON THE SECOND SPELLING. `CatalogMigrationArmSchema` restates `V1MigrationArm`
    // because a DTO package may not import a surface package. The COMPILE side of the tie is the
    // producer's projection function (an arm minted in `mcp` and missing here does not typecheck);
    // this is the other side — an arm written here that the shipped map does not carry is a
    // vocabulary the catalog offers a reader and the product never uses.
    const declared = [...CatalogMigrationArmSchema.options].sort()
    const carried = [...new Set(V1_TOOL_MIGRATION_MAP.map((entry) => entry.arm))].sort()
    expect(declared, 'the catalog\'s arm vocabulary and the shipped map\'s arms disagree')
      .toEqual(carried)
  })
})

// ---- The derived example calls (spec §3.3, D-08) -----------------------------------------------

describe('the catalog\'s example calls (D-08)', () => {
  let live: CapabilityCatalog

  beforeAll(async () => {
    live = await capabilityCatalogFromRoot()
  })

  const opRows = (): readonly CatalogOpRow[] =>
    live.rows.filter((row): row is CatalogOpRow => row.kind === 'op')

  it('re-derives byte-identically from each row\'s OWN params — produced, never authored', () => {
    // The whole of D-08 for this column, as one comparison: every example in the artifact is what
    // the pure derivation answers when handed that row's params and nothing else. A hand-written
    // example — however good — cannot survive this cell, which is the point.
    const drifted: string[] = []
    for (const row of opRows()) {
      const derived = catalogExampleCallOf(row.params, row.id)
      const carried = {
        exampleCall: row.exampleCall,
        ...(row.exampleCallAbsentReason === undefined
          ? {}
          : { exampleCallAbsentReason: row.exampleCallAbsentReason }),
      }
      if (canonicalJson(derived) !== canonicalJson(carried)) {
        drifted.push(
          `${row.id}: the row carries ${canonicalJson(carried)}, its params derive `
          + `${canonicalJson(derived)}`,
        )
      }
    }
    expect(drifted, 'catalog example calls disagree with what their own params derive').toEqual([])
    expect(opRows().length, 'the catalog produced no op rows to derive examples from')
      .toBeGreaterThan(0)
  })

  it('states an example or a reason there is none — never a silent blank', () => {
    // The presence rule for the third state, asserted rather than refined (the discriminated-union
    // constraint plan 01 documented). An absent example WITHOUT a reason is the silent blank D-07
    // refused for doc paths, one column over.
    // THE DENOMINATOR FIRST. Both filters below select on `exampleCall === null`, and a row that
    // carries no such KEY at all satisfies neither — so without this line a catalog that had
    // simply never grown the column would pass every assertion in this cell. The cast is what
    // lets the question be ASKED: the DTO makes the column required, so the compiler narrows the
    // check away, and the fact being guarded here is a runtime one about produced rows.
    const columnless = opRows()
      .filter((row) => !('exampleCall' in (row as unknown as Record<string, unknown>)))
      .map((row) => row.id)
    expect(columnless, 'op rows carry no exampleCall column at all').toEqual([])

    const unexplained = opRows()
      .filter((row) => row.exampleCall === null && row.exampleCallAbsentReason === undefined)
      .map((row) => row.id)
    const overExplained = opRows()
      .filter((row) => row.exampleCall !== null && row.exampleCallAbsentReason !== undefined)
      .map((row) => row.id)
    expect(unexplained, 'op rows carry no example call and no reason there is none').toEqual([])
    expect(overExplained, 'op rows carry both an example call and a reason there is none')
      .toEqual([])
  })

  it('names every key an example carries in the row\'s own required set', () => {
    // A derived example that invented a key would be teaching an argument the contract refuses,
    // which is exactly the failure this column exists to avoid rather than to introduce.
    const invented: string[] = []
    for (const row of opRows()) {
      if (row.exampleCall === null) continue
      const required = Array.isArray(row.params.required) ? row.params.required as string[] : []
      for (const key of Object.keys(row.exampleCall.arguments)) {
        if (!required.includes(key)) invented.push(`${row.id}.${key}`)
      }
      // …and every required key IS present, or the example is a call the contract would refuse
      // for the opposite reason.
      for (const key of required) {
        if (!(key in row.exampleCall.arguments)) invented.push(`${row.id}.${key} (missing)`)
      }
    }
    expect(invented, 'derived example calls disagree with their row\'s required property set')
      .toEqual([])
  })

  it('refuses on exactly the pinned constructs, and shows an example everywhere else', () => {
    // THE ABSENCE ARM IS A PINNED CLOSED SET, not an escape hatch. Without this cell a derivation
    // that quietly started refusing everything would leave a catalog of forty-one explicit
    // absences and every other cell above green.
    const absent = opRows().filter((row) => row.exampleCall === null).map((row) => row.id).sort()
    expect(
      absent,
      'the set of ops with no derivable example moved. Every member is an op whose required '
      + 'params carry a construct the derivation will not guess at (today: a regular-expression '
      + '`pattern`). A new member is a deliberate decision, not a default.',
    ).toEqual([
      'knowledge.proposal.apply',
      'proposals.accept',
      'proposals.reject',
      'proposals.show',
    ])
    // The vacuity floor on the other side: most ops DO get an example, and a derivation that
    // returned `{}` for everything would satisfy every cell above this one.
    const withArguments = opRows().filter(
      (row) => row.exampleCall !== null && Object.keys(row.exampleCall.arguments).length > 0,
    )
    expect(withArguments.length, 'no op row carries an example call with any argument in it')
      .toBeGreaterThan(20)
  })

  it('derives each documented construct, driven over synthetic schemas', () => {
    // THE DERIVATION'S OWN BRANCHES, driven with input rather than asserted about. The registry's
    // real params exercise most of these, but "most" is not a list, and a branch nobody has seen
    // answer is a branch nobody has seen answer.
    const derive = (properties: Record<string, unknown>, required: readonly string[]): unknown =>
      catalogExampleCallOf(
        { type: 'object', additionalProperties: false, properties, required: [...required] },
        'control.398.08',
      )

    expect(derive({ name: { type: 'string' } }, ['name']))
      .toEqual({ exampleCall: { arguments: { name: '<NAME>' } } })
    expect(derive({ count: { type: 'integer', minimum: 0, maximum: 10 } }, ['count']))
      .toEqual({ exampleCall: { arguments: { count: 0 } } })
    expect(derive({ count: { type: 'integer', minimum: 3 } }, ['count']))
      .toEqual({ exampleCall: { arguments: { count: 3 } } })
    expect(derive({ count: { type: 'integer', exclusiveMinimum: 0 } }, ['count']))
      .toEqual({ exampleCall: { arguments: { count: 1 } } })
    expect(derive({ on: { type: 'boolean' } }, ['on']))
      .toEqual({ exampleCall: { arguments: { on: false } } })
    expect(derive({ kind: { type: 'string', enum: ['a', 'b'] } }, ['kind']))
      .toEqual({ exampleCall: { arguments: { kind: 'a' } } })
    expect(derive({ kind: { type: 'string', const: 'web' } }, ['kind']))
      .toEqual({ exampleCall: { arguments: { kind: 'web' } } })
    expect(derive({ tags: { type: 'array' } }, ['tags']))
      .toEqual({ exampleCall: { arguments: { tags: [] } } })
    expect(derive({}, []))
      .toEqual({ exampleCall: { arguments: {} } })
    expect(
      derive(
        {
          nested: {
            type: 'object',
            additionalProperties: false,
            properties: { inner: { type: 'string' } },
            required: ['inner'],
          },
        },
        ['nested'],
      ),
    ).toEqual({ exampleCall: { arguments: { nested: { inner: '<INNER>' } } } })

    // A DISCRIMINATED `oneOf` resolves to its first branch…
    expect(
      derive(
        {
          window: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: { scope: { type: 'string', const: 'session' }, ref: { type: 'string' } },
                required: ['scope', 'ref'],
              },
              {
                type: 'object',
                additionalProperties: false,
                properties: { scope: { type: 'string', const: 'all-time' } },
                required: ['scope'],
              },
            ],
          },
        },
        ['window'],
      ),
    ).toEqual({ exampleCall: { arguments: { window: { scope: 'session', ref: '<REF>' } } } })
  })

  it('refuses rather than guessing, on every construct it cannot satisfy', () => {
    // THE REFUSING BRANCHES, driven — the half a green suite never reaches. Each of these is a
    // shape where a placeholder would be a value the shipped contract REJECTS, and an example an
    // agent copies and gets refused for is worse than a column that says there is none.
    const derive = (properties: Record<string, unknown>, required: readonly string[]): {
      exampleCall: unknown
      exampleCallAbsentReason?: string
    } => catalogExampleCallOf(
      { type: 'object', additionalProperties: false, properties, required: [...required] },
      'control.398.08',
    )

    const refusal = (properties: Record<string, unknown>, required: readonly string[]): string => {
      const answer = derive(properties, required)
      expect(answer.exampleCall, `${canonicalJson(properties)} produced an example`).toBeNull()
      return answer.exampleCallAbsentReason ?? ''
    }

    // (a) A regular expression. The four real ops in the pinned set above are all this case.
    expect(refusal({ id: { type: 'string', pattern: '^prop_[a-z]+$' } }, ['id']))
      .toContain('^prop_[a-z]+$')
    // (b) A keyword the derivation has no rule for — the OPEN edge, refused by default rather
    //     than ignored. A schema keyword this derivation silently dropped would produce a value
    //     that looks right and is not.
    expect(refusal({ id: { type: 'string', format: 'uuid' } }, ['id'])).toContain('format')
    // (c) A `minLength` the placeholder cannot reach. `<ID>` is four characters; a contract asking
    //     for ten would refuse it.
    expect(refusal({ id: { type: 'string', minLength: 40 } }, ['id'])).toContain('minLength')
    // (d) An undiscriminated `oneOf`: branch 0's value may match branch 1 too, and a value that
    //     matches two branches of a `oneOf` is refused BECAUSE it matches two.
    expect(
      refusal(
        {
          either: {
            oneOf: [
              { type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } },
              { type: 'object', additionalProperties: false, properties: { b: { type: 'string' } } },
            ],
          },
        },
        ['either'],
      ),
    ).toContain('oneOf')
    // (e) A required property with no schema at all.
    expect(refusal({}, ['ghost'])).toContain('ghost')
    // (f) A bound pair no number satisfies.
    expect(refusal({ n: { type: 'integer', minimum: 5, maximum: 1 } }, ['n'])).toContain('maximum')
    // (g) An array that must carry elements — deriving one would need a value for a schema the
    //     derivation was not handed.
    expect(refusal({ tags: { type: 'array', minItems: 1 } }, ['tags'])).toContain('minItems')

    // …and the control on the control: the same shapes WITHOUT the refused construct derive.
    expect(derive({ id: { type: 'string' } }, ['id']).exampleCall)
      .toEqual({ arguments: { id: '<ID>' } })
  })
})

// ---- `init --agent` (D-16) ---------------------------------------------------------------------
//
// Task 2 adds the manifest cells below: manifest ≡ catalog through the ONE loader, the refs-only
// posture, and idempotence.
