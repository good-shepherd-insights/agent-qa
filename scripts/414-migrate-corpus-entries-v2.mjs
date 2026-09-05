#!/usr/bin/env node
// 414-migrate-corpus-entries-v2.mjs — Phase 414 D-02 / D-03 / D-04 / D-05 / D-06 / D-07 / D-08 / D-13.
//
// WHAT THIS DOES
//   Rewrites every committed corpus entry from schemaVersion 1 to schemaVersion 2:
//     - `split` is assigned from the product's committed partition manifest with the
//       PARTITION_VERSION 1 bucket recipe (D-05/D-07/D-08);
//     - `heldOutVisibility` is present exactly when the entry is held-out (D-21);
//     - `run_links` is reduced to `{ runId, runSlug }` — the path field is DROPPED (D-13);
//     - `captured_at` and `targetEnvironment` are stamped only where they are DERIVABLE,
//       and omitted entirely otherwise; neither is ever fabricated (D-04).
//   A product with entries and no manifest gets one minted (32 random bytes as the salt,
//   the operator's REQUIRED fractions, partitionVersion 1) and written canonically (D-06).
//   `--backfill` writes the D-02 run-exclusion records for the growth campaign's excluded
//   legs; it may run beside the migration or alone.
//
// WHY IT BYPASSES FsCommittedRootStore
//   The committed root is write-once (371 D-17): byte-identical re-seeding is a no-op and
//   differing bytes are a typed refusal, never an overwrite. 371 D-17 names exactly one
//   sanctioned way to change already-committed measurement bytes — a reviewed git change.
//   This one-shot script IS that reviewed change. Routing it through the store would either
//   be refused (write-conflict) or would require teaching the store to overwrite, which is
//   the invariant the store exists to hold.
//
//   It is a plain ESM file under scripts/ and must run with no build, so it imports NO
//   workspace package (the 413 D-09 precedent). The canonical serializer, the digest and
//   the bucket recipe are inlined; `--selfcheck` is what keeps the inlined copies honest
//   against the SAME known-answer vectors packages/eval pins for `assignSplit`.
//
// SAFETY
//   Before writing any entry file, the unmodified parsed document is re-serialised with the
//   inlined canonical serializer and compared byte-for-byte against the file on disk. A
//   mismatch means this script's serializer is not `committedFileText`, so it refuses the
//   file and exits 2 rather than write bytes the seeder would not have written. `--check`
//   never writes. Every fraction is read in ONE function (`resolveFractionsFor`), so
//   D-07's "there is no default fraction" is a one-function audit.
//
// USAGE
//   node scripts/414-migrate-corpus-entries-v2.mjs --selfcheck
//       Prove the inlined digest, the bucket arithmetic and the fraction resolver. No IO.
//   node scripts/414-migrate-corpus-entries-v2.mjs --check [--root DIR]
//       Write nothing. Exit 1 while any schemaVersion 1 entry remains or any product with
//       entries lacks a partition manifest.
//   node scripts/414-migrate-corpus-entries-v2.mjs \
//       --held-out-fraction 0.2 --private-fraction 0.5 [--target-environments '{"p":"local"}']
//       Migrate, minting one manifest per unpartitioned product from ONE fraction pair.
//   node scripts/414-migrate-corpus-entries-v2.mjs \
//       --fractions '{"apple-maps":{"heldOutFraction":0.2,"privateFraction":0.5}}'
//       The per-product form. Giving both forms is a refusal.
//   node scripts/414-migrate-corpus-entries-v2.mjs --backfill demo/acceptance/413/campaign-manifest.json \
//       --deletion-commits '{"r_slug":{"deletionCommit":"0a2b6f87","entriesRemoved":4}}'
//       Write the D-02 exclusion records. Alone (no fraction form) this touches corpus/ not at all.
//
//   FLAGS
//     --root DIR                 the agent-qa-eval root         (default ../../demo/init/agent-qa-eval)
//     --runs-root DIR            the machine-local runs root    (default ../../demo/init/.agent-qa/runs)
//     --held-out-fraction F      share leaving `natural`; strictly inside (0, 1). NO DEFAULT.
//     --private-fraction P       share OF the held-out portion that is private; (0, 1). NO DEFAULT.
//     --fractions JSON           product -> { heldOutFraction, privateFraction }. Excludes the pair above.
//     --target-environments JSON product -> 'shared' | 'local'. Absent product => key omitted.
//     --backfill PATH            campaign manifest whose `excluded: true` legs become exclusion records
//     --deletion-commits JSON    runSlug -> { deletionCommit?, entriesRemoved }
//     --check                    read-only
//     --selfcheck                known-answer vectors + resolver refusals
//
// EXIT CODES ARE READ FROM THE PROCESS: 0 clean, 1 --check found v1 entries or unpartitioned
// products, 2 refusal.

import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP_DIRS = new Set(['blobs'])
/** Mirror of packages/eval/src/labels/split-assignment.ts `PARTITION_VERSION`. */
const PARTITION_VERSION = 1
/** Mirror of `BUCKET_BITS`: the first 13 hex characters of the digest, read as an integer. */
const BUCKET_BITS = 52
const LOWER_HEX_64 = /^[0-9a-f]{64}$/
const TARGET_ENVIRONMENTS = new Set(['shared', 'local'])
/** The tier whose members are self-heal pair members and therefore exempt from bucketing (D-08). */
const PAIR_MEMBER_TIER = 'near-gold'

/** Known-answer vectors — the SAME literals packages/eval/src/labels/__tests__/split-assignment.test.ts pins. */
const ZERO_SALT = '0'.repeat(64)
const VECTOR_A_ID = 'r_swiper-tele-modern-modal-orias-ope-junto-spot-loir-rist/test-00-step-05-d03-leaf'
const VECTOR_A_DIGEST = '203dd7161ce0b7de6123ae9ff0d65ea52983cf20c3a2e6fb9175c3af93bd257a'
const VECTOR_A_PREFIX = '203dd7161ce0b'
const VECTOR_B_ID = 'run---checkout-suite-42/test-00-step-00-d00-leaf'
const VECTOR_B_DIGEST = 'd386f3949d0da917eedc86e9dc40a6b5e784c2c63fbc3c74f5d296223ad5ede8'
const VECTOR_B_PREFIX = 'd386f3949d0da'
/** The RFC 6234 empty-string vector: proves the digest itself, independent of any salt. */
const EMPTY_DIGEST = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** Inlined mirror of schema/src/determinism/canonical-json.ts `canonicalValue`. */
function canonicalValue(input) {
  if (Array.isArray(input)) return input.map(canonicalValue)
  if (input === null || typeof input !== 'object') return input

  const source = input
  const sorted = {}
  for (const key of Object.keys(source).sort()) {
    sorted[key] = canonicalValue(source[key])
  }
  return sorted
}

/** Inlined mirror of `committedFileText`: canonical keys, 2-space indent, trailing newline. */
function committedFileText(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`
}

/** Inlined mirror of schema's pure-JS `sha256hex` — same recipe, node's digest. */
function sha256hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** Inlined mirror of `bucketOf`: the 52-bit bucket for one cassette under one salt. */
function bucketOf(saltHex, cassetteId) {
  return Number.parseInt(sha256hex(saltHex + cassetteId).slice(0, 13), 16)
}

/**
 * Inlined mirror of `assignSplit`. A pair member is natural regardless of its hash (D-08);
 * otherwise `bucket >= heldOutThreshold` is natural, and a held-out bucket is private iff it
 * falls under the nested `heldOutFraction * privateFraction` threshold.
 */
function assignSplit(input) {
  if (!LOWER_HEX_64.test(input.saltHex)) {
    refuse(`partition salt must be 64 lowercase hex characters (got ${input.saltHex.length} chars)`)
  }
  if (!isFraction(input.heldOutFraction)) refuse(`heldOutFraction out of range: ${input.heldOutFraction}`)
  if (!isFraction(input.privateFraction)) refuse(`privateFraction out of range: ${input.privateFraction}`)

  if (input.isPairMember) return { split: 'natural' }

  const bucket = bucketOf(input.saltHex, input.cassetteId)
  const heldOutThreshold = Math.round(input.heldOutFraction * 2 ** BUCKET_BITS)
  if (bucket >= heldOutThreshold) return { split: 'natural' }

  const privateThreshold = Math.round(
    input.heldOutFraction * input.privateFraction * 2 ** BUCKET_BITS,
  )
  return {
    split: 'held-out',
    heldOutVisibility: bucket < privateThreshold ? 'private' : 'shared',
  }
}

/** Epoch milliseconds -> the ISO datetime the v2 schema admits. */
function isoOf(endedAt) {
  return new Date(endedAt).toISOString()
}

function isFraction(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1
}

function refuse(message) {
  console.error(`REFUSED ${message}`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// The ONE place a fraction is read (D-07)
// ---------------------------------------------------------------------------

/**
 * Resolve the fraction pair for one product from whichever form the operator supplied.
 * Returns `{ ok: true, heldOutFraction, privateFraction }` or a TYPED refusal:
 *   both-forms      both the scalar pair and the map were given
 *   none-supplied   neither form was given, and a partition needs fractions
 *   missing-product the map has no entry for this product
 *   out-of-range    a value is not a finite number strictly inside (0, 1)
 * No default exists here and none may ever be added: a threshold is chosen only after the
 * floor is measured (D-07 standing law).
 */
function resolveFractionsFor(product, args) {
  const scalarSupplied = args.heldOutFraction !== undefined || args.privateFraction !== undefined
  const mapSupplied = args.fractions !== undefined

  if (scalarSupplied && mapSupplied) {
    return {
      ok: false,
      refusal: 'both-forms',
      message: 'fractions: give --held-out-fraction/--private-fraction OR --fractions, not both',
    }
  }

  if (!scalarSupplied && !mapSupplied) {
    return {
      ok: false,
      refusal: 'none-supplied',
      message:
        `fractions: product ${product} needs a partition and no fraction was supplied; ` +
        'pass --held-out-fraction/--private-fraction or --fractions (there is no default)',
    }
  }

  if (scalarSupplied) {
    const heldOutFraction = args.heldOutFraction
    const privateFraction = args.privateFraction
    if (!isFraction(heldOutFraction) || !isFraction(privateFraction)) {
      return {
        ok: false,
        refusal: 'out-of-range',
        message:
          `fractions: --held-out-fraction ${heldOutFraction} / --private-fraction ${privateFraction} ` +
          'must both be finite and strictly inside (0, 1)',
      }
    }
    return { ok: true, heldOutFraction, privateFraction }
  }

  const entry = args.fractions[product]
  if (entry === undefined || entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return {
      ok: false,
      refusal: 'missing-product',
      message: `fractions: --fractions has no entry for product ${product}`,
    }
  }

  const heldOutFraction = entry.heldOutFraction
  const privateFraction = entry.privateFraction
  if (!isFraction(heldOutFraction) || !isFraction(privateFraction)) {
    return {
      ok: false,
      refusal: 'out-of-range',
      message:
        `fractions: --fractions.${product} heldOutFraction ${heldOutFraction} / ` +
        `privateFraction ${privateFraction} must both be finite and strictly inside (0, 1)`,
    }
  }
  return { ok: true, heldOutFraction, privateFraction }
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (value === undefined) {
    console.error(`${flag} requires an argument`)
    process.exit(2)
  }
  return value
}

function parseJsonFlag(raw, flag) {
  try {
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.error(`${flag} must be a JSON object`)
      process.exit(2)
    }
    return parsed
  } catch (error) {
    console.error(`${flag} is not valid JSON (${String(error)})`)
    process.exit(2)
  }
}

function parseArgs(argv) {
  const args = {
    check: false,
    selfcheck: false,
    root: undefined,
    runsRoot: undefined,
    heldOutFraction: undefined,
    privateFraction: undefined,
    fractions: undefined,
    targetEnvironments: undefined,
    backfill: undefined,
    deletionCommits: undefined,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') args.check = true
    else if (arg === '--selfcheck') args.selfcheck = true
    else if (arg === '--root') {
      index += 1
      args.root = requireValue(argv, index, '--root')
    } else if (arg === '--runs-root') {
      index += 1
      args.runsRoot = requireValue(argv, index, '--runs-root')
    } else if (arg === '--held-out-fraction') {
      index += 1
      args.heldOutFraction = Number(requireValue(argv, index, '--held-out-fraction'))
    } else if (arg === '--private-fraction') {
      index += 1
      args.privateFraction = Number(requireValue(argv, index, '--private-fraction'))
    } else if (arg === '--fractions') {
      index += 1
      args.fractions = parseJsonFlag(requireValue(argv, index, '--fractions'), '--fractions')
    } else if (arg === '--target-environments') {
      index += 1
      args.targetEnvironments = parseJsonFlag(
        requireValue(argv, index, '--target-environments'),
        '--target-environments',
      )
      for (const [product, value] of Object.entries(args.targetEnvironments)) {
        if (!TARGET_ENVIRONMENTS.has(value)) {
          console.error(
            `--target-environments.${product} must be 'shared' or 'local' (got ${JSON.stringify(value)})`,
          )
          process.exit(2)
        }
      }
    } else if (arg === '--backfill') {
      index += 1
      args.backfill = requireValue(argv, index, '--backfill')
    } else if (arg === '--deletion-commits') {
      index += 1
      args.deletionCommits = parseJsonFlag(
        requireValue(argv, index, '--deletion-commits'),
        '--deletion-commits',
      )
    } else {
      console.error(`unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

// ---------------------------------------------------------------------------
// Selfcheck
// ---------------------------------------------------------------------------

function runSelfcheck() {
  const failures = []
  const expect = (label, actual, expected) => {
    if (actual !== expected) {
      failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  }

  expect('vector A digest', sha256hex(ZERO_SALT + VECTOR_A_ID), VECTOR_A_DIGEST)
  expect('vector A prefix', VECTOR_A_DIGEST.slice(0, 13), VECTOR_A_PREFIX)
  expect('vector A bucket', bucketOf(ZERO_SALT, VECTOR_A_ID), Number.parseInt(VECTOR_A_PREFIX, 16))
  expect('vector B digest', sha256hex(ZERO_SALT + VECTOR_B_ID), VECTOR_B_DIGEST)
  expect('vector B prefix', VECTOR_B_DIGEST.slice(0, 13), VECTOR_B_PREFIX)
  expect('vector B bucket', bucketOf(ZERO_SALT, VECTOR_B_ID), Number.parseInt(VECTOR_B_PREFIX, 16))
  expect('empty-string digest', sha256hex(''), EMPTY_DIGEST)
  // The bucket space is pinned by LITERAL here: widening it is a change of PARTITION_VERSION
  // and a named migration of a committed corpus, never a silent re-partition.
  expect('bucket space', 2 ** BUCKET_BITS, 2 ** 52)
  expect('threshold arithmetic', Math.round(0.5 * 2 ** BUCKET_BITS), 2 ** 51)

  // D-08: a pair member is natural even under a salt/fraction pair that would hold it out.
  expect(
    'pair member exempt from bucketing',
    assignSplit({
      saltHex: ZERO_SALT,
      heldOutFraction: 0.99,
      privateFraction: 0.99,
      cassetteId: VECTOR_A_ID,
      isPairMember: true,
    }).split,
    'natural',
  )
  expect(
    'non-pair member under the same parameters is held out',
    assignSplit({
      saltHex: ZERO_SALT,
      heldOutFraction: 0.99,
      privateFraction: 0.99,
      cassetteId: VECTOR_A_ID,
      isPairMember: false,
    }).split,
    'held-out',
  )

  // The fraction resolver: two accept paths, four typed refusals.
  const scalarArgs = { heldOutFraction: 0.25, privateFraction: 0.5 }
  const scalar = resolveFractionsFor('any-product', scalarArgs)
  expect('resolver scalar accepts', scalar.ok === true, true)
  expect('resolver scalar heldOutFraction', scalar.heldOutFraction, 0.25)
  expect('resolver scalar privateFraction', scalar.privateFraction, 0.5)

  const mapArgs = {
    fractions: {
      'product-one': { heldOutFraction: 0.3, privateFraction: 0.4 },
      'product-two': { heldOutFraction: 0.2, privateFraction: 0.6 },
    },
  }
  const mapped = resolveFractionsFor('product-two', mapArgs)
  expect('resolver map accepts', mapped.ok === true, true)
  expect('resolver map heldOutFraction', mapped.heldOutFraction, 0.2)
  expect('resolver map privateFraction', mapped.privateFraction, 0.6)

  expect(
    'resolver refuses both forms',
    resolveFractionsFor('product-one', { ...scalarArgs, ...mapArgs }).refusal,
    'both-forms',
  )
  expect(
    'resolver refuses a product absent from the map',
    resolveFractionsFor('product-three', mapArgs).refusal,
    'missing-product',
  )
  expect(
    'resolver refuses a scalar heldOutFraction of 0',
    resolveFractionsFor('p', { heldOutFraction: 0, privateFraction: 0.5 }).refusal,
    'out-of-range',
  )
  expect(
    'resolver refuses a scalar privateFraction of 1',
    resolveFractionsFor('p', { heldOutFraction: 0.5, privateFraction: 1 }).refusal,
    'out-of-range',
  )
  expect(
    'resolver refuses a NaN in the map',
    resolveFractionsFor('p', {
      fractions: { p: { heldOutFraction: Number.NaN, privateFraction: 0.5 } },
    }).refusal,
    'out-of-range',
  )
  expect('resolver refuses neither form', resolveFractionsFor('p', {}).refusal, 'none-supplied')

  if (failures.length > 0) {
    for (const failure of failures) console.error(`SELFCHECK ${failure}`)
    console.error(`selfcheck failed: ${failures.length} mismatch(es)`)
    process.exit(2)
  }
  console.log('selfcheck ok')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Root walking
// ---------------------------------------------------------------------------

function walkJsonFiles(dir, found) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      walkJsonFiles(join(dir, entry.name), found)
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      found.push(join(dir, entry.name))
    }
  }
  return found
}

function readJson(file, what) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    refuse(`${file}: ${what} could not be read (${String(error)})`)
  }
  try {
    return JSON.parse(text)
  } catch (error) {
    refuse(`${file}: ${what} is not valid JSON (${String(error)})`)
  }
}

/** Group corpus files by the product directory directly under `corpus/`. */
function groupByProduct(corpusDir, files) {
  const byProduct = new Map()
  for (const file of files) {
    const segments = relative(corpusDir, file).split(sep)
    if (segments.length < 2) refuse(`${file}: corpus entry is not under a product directory`)
    const product = segments[0]
    const list = byProduct.get(product)
    if (list === undefined) byProduct.set(product, [file])
    else list.push(file)
  }
  return byProduct
}

/** Load and validate every `contracts/partition-<product>.json` in the root. */
function loadManifests(contractsDir) {
  const manifests = new Map()
  let entries
  try {
    entries = readdirSync(contractsDir, { withFileTypes: true })
  } catch {
    return manifests
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const matched = /^partition-(.+)\.json$/.exec(entry.name)
    if (matched === null) continue
    const file = join(contractsDir, entry.name)
    const parsed = readJson(file, 'partition manifest')
    if (parsed.schemaVersion !== 1) refuse(`${file}: partition manifest schemaVersion must be 1`)
    if (parsed.partitionVersion !== PARTITION_VERSION) {
      refuse(`${file}: partitionVersion must be ${PARTITION_VERSION}`)
    }
    if (parsed.product !== matched[1]) {
      refuse(`${file}: product ${JSON.stringify(parsed.product)} does not match its filename`)
    }
    if (typeof parsed.salt !== 'string' || !LOWER_HEX_64.test(parsed.salt)) {
      refuse(`${file}: salt must be exactly 64 lowercase hexadecimal characters`)
    }
    if (!isFraction(parsed.heldOutFraction) || !isFraction(parsed.privateFraction)) {
      refuse(`${file}: heldOutFraction and privateFraction must be strictly inside (0, 1)`)
    }
    manifests.set(parsed.product, { manifest: parsed, file })
  }
  return manifests
}

function countExclusions(exclusionsDir) {
  return walkJsonFiles(exclusionsDir, []).length
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.selfcheck) runSelfcheck()

  if (args.backfill !== undefined) {
    console.error('--backfill is not implemented yet (414-09 Task 2)')
    process.exit(2)
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const evalRoot = args.root ?? join(scriptDir, '..', '..', 'demo', 'init', 'agent-qa-eval')
  const runsRoot = args.runsRoot ?? join(scriptDir, '..', '..', 'demo', 'init', '.agent-qa', 'runs')
  const corpusDir = join(evalRoot, 'corpus')
  const contractsDir = join(evalRoot, 'contracts')
  const labelsDir = join(evalRoot, 'labels')
  const exclusionsDir = join(evalRoot, 'exclusions')

  const files = walkJsonFiles(corpusDir, []).sort()
  const byProduct = groupByProduct(corpusDir, files)
  const products = [...byProduct.keys()].sort()
  const manifests = loadManifests(contractsDir)
  const fractionFormSupplied =
    args.heldOutFraction !== undefined ||
    args.privateFraction !== undefined ||
    args.fractions !== undefined

  if (args.check) {
    let v1Remaining = 0
    let alreadyV2 = 0
    const unpartitioned = []
    for (const product of products) {
      if (!manifests.has(product)) {
        unpartitioned.push(product)
        // A malformed fraction form must be caught by the read-only pass too.
        if (fractionFormSupplied) {
          const resolved = resolveFractionsFor(product, args)
          if (!resolved.ok) refuse(resolved.message)
        }
      }
      for (const file of byProduct.get(product)) {
        const parsed = readJson(file, 'corpus entry')
        if (parsed.schemaVersion === 1) v1Remaining += 1
        else if (parsed.schemaVersion === 2) alreadyV2 += 1
        else refuse(`${file}: schemaVersion must be 1 or 2 (got ${JSON.stringify(parsed.schemaVersion)})`)
      }
    }
    const exclusions = countExclusions(exclusionsDir)
    console.log(
      `${v1Remaining} entries at schemaVersion 1 remain; ${unpartitioned.length} products unpartitioned`,
    )
    console.log(`alreadyV2 ${alreadyV2}; exclusions ${exclusions}`)
    if (unpartitioned.length > 0) console.log(`unpartitioned: ${unpartitioned.join(', ')}`)
    if (v1Remaining > 0 || unpartitioned.length > 0) process.exit(1)
    console.log('check ok')
    process.exit(0)
  }

  // Resolution phase — nothing is written until every product resolves (so a refusal
  // leaves the root byte-identical).
  const refusals = []
  const plans = []
  for (const product of products) {
    const existing = manifests.get(product)
    if (existing !== undefined) {
      if (fractionFormSupplied) {
        const resolved = resolveFractionsFor(product, args)
        if (!resolved.ok) {
          // A product already carrying a manifest need not appear in the map.
          if (resolved.refusal !== 'missing-product') refusals.push(resolved.message)
        } else if (
          resolved.heldOutFraction !== existing.manifest.heldOutFraction ||
          resolved.privateFraction !== existing.manifest.privateFraction
        ) {
          refusals.push(
            `${existing.file}: supplied fractions (heldOutFraction ${resolved.heldOutFraction}, ` +
              `privateFraction ${resolved.privateFraction}) disagree with the committed manifest ` +
              `(heldOutFraction ${existing.manifest.heldOutFraction}, privateFraction ` +
              `${existing.manifest.privateFraction}); a committed partition is not re-parameterised`,
          )
        }
      }
      plans.push({ product, manifest: existing.manifest, file: existing.file, minted: false })
      continue
    }

    const resolved = resolveFractionsFor(product, args)
    if (!resolved.ok) {
      refusals.push(resolved.message)
      continue
    }
    plans.push({
      product,
      manifest: {
        schemaVersion: 1,
        partitionVersion: PARTITION_VERSION,
        product,
        salt: randomBytes(32).toString('hex'),
        heldOutFraction: resolved.heldOutFraction,
        privateFraction: resolved.privateFraction,
      },
      file: join(contractsDir, `partition-${product}.json`),
      minted: true,
    })
  }

  if (refusals.length > 0) {
    for (const message of refusals) console.error(`REFUSED ${message}`)
    process.exit(2)
  }

  // Write phase.
  const totals = {
    entries: 0,
    natural: 0,
    heldOutShared: 0,
    heldOutPrivate: 0,
    pairForcedNatural: 0,
    alreadyV2: 0,
    capturedAtStamped: 0,
    capturedAtOmitted: 0,
    targetEnvironmentStamped: 0,
    targetEnvironmentOmitted: 0,
    manifestsMinted: 0,
    rewritten: 0,
  }

  for (const plan of plans) {
    if (plan.minted) {
      mkdirSync(contractsDir, { recursive: true })
      writeFileSync(plan.file, committedFileText(plan.manifest))
      totals.manifestsMinted += 1
    }

    const stats = {
      entries: 0,
      natural: 0,
      heldOutShared: 0,
      heldOutPrivate: 0,
      pairForcedNatural: 0,
      alreadyV2: 0,
      capturedAtStamped: 0,
      capturedAtOmitted: 0,
      targetEnvironmentStamped: 0,
      targetEnvironmentOmitted: 0,
    }
    const targetEnvironment = args.targetEnvironments?.[plan.product]

    for (const file of byProduct.get(plan.product)) {
      const text = readFileSync(file, 'utf8')
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        refuse(`${file}: not valid JSON (${String(error)})`)
      }

      // Round-trip assertion: prove this serializer reproduces the committed bytes exactly
      // before writing anything.
      if (committedFileText(parsed) !== text) {
        console.error(
          `REFUSED ${file}: re-serialising the unmodified document does not reproduce the file bytes; ` +
            'refusing to write bytes that do not match committedFileText',
        )
        process.exit(2)
      }

      stats.entries += 1
      if (parsed.schemaVersion === 2) {
        stats.alreadyV2 += 1
        continue
      }
      if (parsed.schemaVersion !== 1) {
        refuse(`${file}: schemaVersion must be 1 or 2 (got ${JSON.stringify(parsed.schemaVersion)})`)
      }

      const cassetteId = parsed.cassetteId
      const runId = parsed.run_links?.runId
      const runSlug = parsed.run_links?.runSlug
      if (typeof cassetteId !== 'string' || cassetteId === '') refuse(`${file}: cassetteId is missing`)
      if (typeof runId !== 'string' || runId === '') refuse(`${file}: run_links.runId is missing`)
      if (typeof runSlug !== 'string' || runSlug === '') refuse(`${file}: run_links.runSlug is missing`)

      const labelFile = join(labelsDir, relative(corpusDir, file))
      if (!existsSync(labelFile)) {
        refuse(
          `${file}: no label record at ${labelFile}; every committed entry has one and the ` +
            'pair exemption cannot be decided without it',
        )
      }
      const label = readJson(labelFile, 'label record')
      const isPairMember = label?.label?.tier === PAIR_MEMBER_TIER

      const assignment = assignSplit({
        saltHex: plan.manifest.salt,
        heldOutFraction: plan.manifest.heldOutFraction,
        privateFraction: plan.manifest.privateFraction,
        cassetteId,
        isPairMember,
      })

      let capturedAt
      const handoffFile = join(runsRoot, runSlug, 'handoff.json')
      if (existsSync(handoffFile)) {
        const handoff = readJson(handoffFile, 'handoff')
        if (typeof handoff?.endedAt === 'number' && Number.isFinite(handoff.endedAt)) {
          capturedAt = isoOf(handoff.endedAt)
        }
      }

      const v2 = {
        schemaVersion: 2,
        cassetteId,
        product: parsed.product,
        split: assignment.split,
        ...(assignment.split === 'held-out'
          ? { heldOutVisibility: assignment.heldOutVisibility }
          : {}),
        captured_at_ordinal: parsed.captured_at_ordinal,
        run_links: { runId, runSlug },
        receiptDigest: parsed.receiptDigest,
        ...(capturedAt === undefined ? {} : { captured_at: capturedAt }),
        ...(targetEnvironment === undefined ? {} : { targetEnvironment }),
      }

      writeFileSync(file, committedFileText(v2))

      if (assignment.split === 'natural') {
        stats.natural += 1
        if (isPairMember) stats.pairForcedNatural += 1
      } else if (assignment.heldOutVisibility === 'private') stats.heldOutPrivate += 1
      else stats.heldOutShared += 1

      if (capturedAt === undefined) stats.capturedAtOmitted += 1
      else stats.capturedAtStamped += 1
      if (targetEnvironment === undefined) stats.targetEnvironmentOmitted += 1
      else stats.targetEnvironmentStamped += 1
      totals.rewritten += 1
    }

    for (const key of Object.keys(stats)) totals[key] += stats[key]

    console.log(
      `${plan.product}: entries ${stats.entries}, natural ${stats.natural}, ` +
        `heldOutShared ${stats.heldOutShared}, heldOutPrivate ${stats.heldOutPrivate}, ` +
        `pairForcedNatural ${stats.pairForcedNatural}, alreadyV2 ${stats.alreadyV2}`,
    )
    console.log(
      `  capturedAtStamped ${stats.capturedAtStamped}/omitted ${stats.capturedAtOmitted}; ` +
        `targetEnvironmentStamped ${stats.targetEnvironmentStamped}/omitted ${stats.targetEnvironmentOmitted}`,
    )
    console.log(
      `  manifest ${plan.file} salt sha256 ${sha256hex(plan.manifest.salt)} ` +
        `heldOutFraction ${plan.manifest.heldOutFraction} privateFraction ${plan.manifest.privateFraction} ` +
        `partitionVersion ${plan.manifest.partitionVersion}${plan.minted ? ' (minted)' : ''}`,
    )
  }

  console.log(
    `totals: entries ${totals.entries}, rewritten ${totals.rewritten}, alreadyV2 ${totals.alreadyV2}, ` +
      `natural ${totals.natural}, heldOutShared ${totals.heldOutShared}, ` +
      `heldOutPrivate ${totals.heldOutPrivate}, pairForcedNatural ${totals.pairForcedNatural}, ` +
      `manifestsMinted ${totals.manifestsMinted}`,
  )
  process.exit(0)
}

main()
