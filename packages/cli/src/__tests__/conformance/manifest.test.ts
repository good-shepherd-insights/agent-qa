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

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { V1_TOOL_MIGRATION_MAP } from '@vostride/agent-qa-mcp'
import {
  AgentManifestSchema,
  AgentManifestTokenRefSchema,
  CatalogMigrationArmSchema,
  canonicalJson,
  type CapabilityCatalog,
  type CatalogOpRow,
} from '@vostride/agent-qa-schema'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { loadCapabilityCatalog } from '../../capability-catalog/loader.js'
import { buildAgentManifest } from '../../capability-catalog/manifest.js'
import { CLI_FUNCTION_CALLER } from '../../composition/local-agent-host.js'
import { DEFAULT_MCP_SCOPES } from '../../composition/mcp-token-resolution.js'
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
      // 2026-08-27 (405-05 D-12/D-13): a FIFTH member, in sort position, and a deliberate one.
      // `runs.artifact` requires a `sha` constrained to 64 lowercase hex, and the derivation will
      // not guess at a regular-expression `pattern` — which is right: an invented sha would be a
      // documented example call that resolves to nothing, teaching a reader a request the store
      // can only answer `blob_absent` for. The honest catalog entry is the explicit absence.
      'runs.artifact',
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

describe('the agent manifest (D-16, XPLN-01)', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  /**
   * A real project on disk, and the ONE place a token entry is declared in this file.
   *
   * The declared credential is what makes the refs-only cell a measurement rather than a shape
   * assertion: without an entry there is no name to find and no value to fail to find.
   */
  const fixtureProject = (label: string, tokenEnvVar?: string): string => {
    const root = mkdtempSync(join(tmpdir(), `agent-qa-398-08-${label}-`))
    roots.push(root)
    writeFileSync(
      join(root, 'agent-qa.config.yaml'),
      `${JSON.stringify(
        {
          workspace: {
            testMatch: ['tests/**/*.yaml'],
            testPathIgnore: [],
            suiteMatch: ['suites/**/*.suite.yaml'],
            hooksFile: 'hooks.yaml',
            envFile: '.env',
            secretsFile: '.env.secrets.local',
          },
          use: { mobile: { appState: 'preserve' } },
          ...(tokenEnvVar === undefined
            ? {}
            : {
                services: {
                  mcp: {
                    tokens: [{ name: 'ci', tokenEnvVar, scopes: ['read'] }],
                  },
                },
              }),
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    return root
  }

  it('IS the committed catalog: rows and migration map, through the ONE loader', async () => {
    // SC-1's "the same manifest" clause, as a comparison rather than a sentence. Both sides read
    // the committed artifact through `loadCapabilityCatalog`, which is exactly the claim — the
    // manifest is a LOAD, so a consumer that got its rows from the manifest and a consumer that got
    // them from the catalog cannot be looking at two different capability sets.
    const manifest = await buildAgentManifest({
      configPath: join(fixtureProject('identity'), 'agent-qa.config.yaml'),
    })
    const catalog = loadCapabilityCatalog(CATALOG_PATH)

    expect(manifest.rows, 'the manifest and the committed catalog disagree about the rows')
      .toEqual(catalog.rows)
    expect(
      manifest.migrationMap,
      'the manifest and the committed catalog disagree about the migration map',
    ).toEqual(catalog.migrationMap)
    // The vacuity floor: two empty sides agree perfectly and prove nothing.
    expect(manifest.rows.length, 'the manifest carried no rows').toBeGreaterThan(0)
    expect(manifest.migrationMap.length, 'the manifest carried no migration entries')
      .toBeGreaterThan(0)
  })

  it('emits EVERY row, unfiltered — it documents, it does not grant (D-16, P1)', async () => {
    // THE PROHIBITION, MEASURED. The failure this refuses is a manifest that quietly applied the
    // visibility law a second time: rows would vanish for reasons no cell states, and the two
    // places the law lived would agree until one of them was improved. `config-write` ops are the
    // sharpest case — they are exactly what the D-07 default grant WITHHOLDS, so a manifest that
    // filtered by the default scope set would drop them.
    const manifest = await buildAgentManifest({
      configPath: join(fixtureProject('unfiltered'), 'agent-qa.config.yaml'),
    })
    const withheld = manifest.rows.filter(
      (row): row is CatalogOpRow =>
        row.kind === 'op'
        && row.requiredScopes.some((scope) => !manifest.posture.defaultScopes.includes(scope)),
    )
    expect(
      withheld.length,
      'the manifest lists no capability outside the local default grant — either the grant widened '
      + 'or the manifest has started filtering, and only one of those is allowed',
    ).toBeGreaterThan(0)
    // …and the note a reader gets says so, in the document rather than in a source file.
    expect(manifest.$note.join(' ')).toContain('NOT A GRANT LIST')
  })

  it('reports a declared credential by env-ref NAME and never by value (T-398-17, 395 D-11)',
    async () => {
    // THE REFS-ONLY LAW, DRIVEN OVER A REAL SECRET. A cell that only asserted the shape of the
    // posture would pass against a manifest that also carried the value in some field nobody
    // thought to look at, so what is asserted is the ABSENCE OF THE BYTES from the whole
    // serialized document — the surface a person actually reads.
    const sentinel = 'sk-398-08-sentinel-2b41c9d7e5f60a83'
    const tokenEnvVar = 'AGENT_QA_398_08_SENTINEL_TOKEN'
    const configPath = join(fixtureProject('refs-only', tokenEnvVar), 'agent-qa.config.yaml')

    const previous = process.env[tokenEnvVar]
    process.env[tokenEnvVar] = sentinel
    try {
      const manifest = await buildAgentManifest({ configPath })

      // THE CONTROL ON THE CONTROL, FIRST. The sentinel must still be readable at the moment the
      // manifest was built, or its absence below is a property of an unset variable rather than of
      // this product. (Measured 2026-08-17: written first as a `.then()` with a synchronous
      // `finally`, this line caught the restore firing BEFORE the build — the absence assertion
      // was vacuous and said nothing about it.)
      expect(process.env[tokenEnvVar], 'the sentinel was not set during the build').toBe(sentinel)

      const serialized = JSON.stringify(manifest, null, 2)

      // The NAME is present — without this the absence below is satisfied by a manifest that
      // reported nothing at all, which is the vacuous way to pass a "no secret" assertion.
      expect(
        manifest.posture.tokenEnvRefs,
        'the manifest did not report the declared credential at all',
      ).toEqual([{ name: 'ci', tokenEnvVar, scopes: ['read'] }])
      expect(serialized, 'the env-ref NAME is missing from the serialized manifest')
        .toContain(tokenEnvVar)

      // …and the VALUE is nowhere in it. The environment variable was SET while the manifest was
      // built, so any path from a declared name to its contents would have had one.
      expect(
        serialized.includes(sentinel),
        'the serialized manifest contains the token VALUE — a declared credential reached the '
        + 'document that documents it',
      ).toBe(false)
    } finally {
      if (previous === undefined) delete process.env[tokenEnvVar]
      else process.env[tokenEnvVar] = previous
    }
  })

  it('refuses a token ref carrying a value, rather than passing one through', () => {
    // THE STRUCTURAL HALF of the law above: `AgentManifestTokenRefSchema` is `.strict()`, so a
    // member a value could occupy cannot be added by accident — it stops parsing. Driven with the
    // input somebody in a hurry would write.
    const refused = AgentManifestTokenRefSchema.safeParse({
      name: 'ci',
      tokenEnvVar: 'AGENT_QA_TOKEN',
      scopes: ['read'],
      token: 'sk-live-nobody-should-be-able-to-write-this',
    })
    expect(refused.success, 'a token ref carrying a value parsed').toBe(false)
    // …and the same object without it is accepted, so the refusal is about the extra member.
    expect(
      AgentManifestTokenRefSchema.safeParse({
        name: 'ci', tokenEnvVar: 'AGENT_QA_TOKEN', scopes: ['read'],
      }).success,
    ).toBe(true)
  })

  it('reads the shipped default grant and safe-mode state rather than restating them', async () => {
    // The posture's two derived facts, tied to the constants that mint them. A literal scope list
    // in `manifest.ts` would be right on the day it was written and silently wrong the day a
    // seventh scope landed — 396 D-07's set is DERIVED by exclusion for exactly that reason.
    const manifest = await buildAgentManifest({
      configPath: join(fixtureProject('posture'), 'agent-qa.config.yaml'),
    })
    expect(manifest.posture.defaultScopes, 'the manifest\'s default grant is not the shipped one')
      .toEqual([...DEFAULT_MCP_SCOPES])
    expect(manifest.posture.defaultScopes, 'the local default grant withholds nothing')
      .not.toContain('config-write')
    expect(manifest.posture.safeMode, 'the manifest\'s safe-mode state is not the composed one')
      .toBe(CLI_FUNCTION_CALLER.safeMode)
    expect(manifest.posture.configuration, 'a resolvable config was reported unresolved')
      .toBe('resolved')
  })

  it('tells a directory that is not a project yet from one whose config will not read', async () => {
    // `init --agent` is what an agent runs BEFORE there is a project — that is what `init` is for —
    // so neither state below may be an error, and neither may be reported as `resolved` with no
    // credentials, which reads as "this workspace declares none" about a workspace nobody could
    // read. The two are told apart by whether the FILE IS THERE, so the classification never comes
    // from an exception's message: the message quotes the file, and the file is where credentials
    // are declared.
    const bare = mkdtempSync(join(tmpdir(), 'agent-qa-398-08-bare-'))
    roots.push(bare)
    const absent = await buildAgentManifest({ configPath: join(bare, 'agent-qa.config.yaml') })
    expect(absent.posture.configuration, 'a directory with no config did not report `absent`')
      .toBe('absent')
    expect(absent.posture.tokenEnvRefs, 'a directory with no config reported credentials')
      .toEqual([])
    // The capability half is workspace-independent and must still be whole.
    expect(absent.rows.length, 'a directory with no config produced no rows').toBeGreaterThan(0)

    // …and a config that IS there and does not validate is the OTHER answer. `init` is the wrong
    // advice for this one, which is why it must not share an arm with the case above.
    const broken = mkdtempSync(join(tmpdir(), 'agent-qa-398-08-broken-'))
    roots.push(broken)
    const brokenPath = join(broken, 'agent-qa.config.yaml')
    writeFileSync(brokenPath, '{ "workspace": { "testMatch": 17 } }\n', 'utf8')
    const unresolved = await buildAgentManifest({ configPath: brokenPath })
    expect(unresolved.posture.configuration, 'an unreadable config did not report `unresolved`')
      .toBe('unresolved')
    expect(unresolved.posture.tokenEnvRefs, 'an unreadable config reported credentials').toEqual([])
    // The refusal carries no text out of the file it refused, which is the whole reason the arm is
    // a bare enum member.
    expect(JSON.stringify(unresolved)).not.toContain('testMatch')
  })

  it('parses against the published manifest contract, so no consumer defends against its shape',
    async () => {
      const manifest = await buildAgentManifest({
        configPath: join(fixtureProject('contract'), 'agent-qa.config.yaml'),
      })
      const parsed = AgentManifestSchema.safeParse(JSON.parse(JSON.stringify(manifest)) as unknown)
      expect(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.')))
        .toEqual([])
    })

  it('is idempotent: two builds are the same document', async () => {
    // A READ, and reads repeat. If two consecutive builds could differ, every cell above would be
    // measuring one draw from a distribution — and the anchor in `parity-anchors.test.ts`, which
    // compares a build here against one in another process, would be measuring two.
    const configPath = join(fixtureProject('idempotent'), 'agent-qa.config.yaml')
    const first = await buildAgentManifest({ configPath })
    const second = await buildAgentManifest({ configPath })
    expect(canonicalJson(second), 'two consecutive manifest builds differ')
      .toBe(canonicalJson(first))
  })
})
