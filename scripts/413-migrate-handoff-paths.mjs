#!/usr/bin/env node
// 413-migrate-handoff-paths.mjs — Phase 413 D-09 / ROOT-05 SC2.
//
// WHAT THIS DOES
//   Rewrites `run_links.handoffPath` in every committed corpus entry from the absolute
//   machine path the v50 seeder wrote (`<home>/…/demo/init/.agent-qa/runs/<slug>/handoff.json`)
//   to the config-relative form `.agent-qa/runs/<slug>/handoff.json` — the shape the
//   fixture at packages/eval/src/labels/__tests__/corpus-entry.test.ts:23 already uses.
//   `schemaVersion` stays 1: Phase 414 (ROOT-06/ROOT-08) owns the v2 bump that forbids
//   absolute paths in the schema itself.
//
// WHY IT BYPASSES FsCommittedRootStore
//   The committed root is write-once (371 D-17): byte-identical re-seeding is a no-op and
//   differing bytes are a typed refusal, never an overwrite. 371 D-17 names exactly one
//   sanctioned way to change already-committed measurement bytes — a reviewed git change.
//   This one-shot script IS that reviewed change. Routing it through the store would either
//   be refused (write-conflict) or would require teaching the store to overwrite, which is
//   the invariant the store exists to hold.
//
// SAFETY
//   Before writing any file, the unmodified parsed document is re-serialised with the
//   inlined canonical serializer and compared byte-for-byte against the file on disk. A
//   mismatch means this script's serializer is not `committedFileText`, so it refuses the
//   file and exits 2 rather than write bytes the seeder would not have written.
//
// USAGE
//   node scripts/413-migrate-handoff-paths.mjs            # rewrite; prints "rewritten N, unchanged M"
//   node scripts/413-migrate-handoff-paths.mjs --check    # write nothing; exit 1 while any absolute path remains
//   node scripts/413-migrate-handoff-paths.mjs --root DIR # point at another agent-qa-eval root
//
// EXIT CODES ARE READ FROM THE PROCESS: 0 clean, 1 absolute paths remain (--check), 2 refusal.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKIP_DIRS = new Set(['blobs'])
const ABSOLUTE_PATH = /^(\/|\\|[A-Za-z]:[\\/])/
/** The config-relative base: runsRoot = resolve(configDir, '.agent-qa', 'runs') (F4). */
const RELATIVE_RUNS_PREFIX = '.agent-qa/runs/'

/** Inlined mirror of schema/src/determinism/canonical-json.ts `canonicalValue` — a plain
 *  ESM file under scripts/ must run with no build, so it cannot import a workspace dist. */
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

/** Inlined mirror of `committedFileText`. */
function committedFileText(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`
}

function parseArgs(argv) {
  const args = { check: false, root: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--check') args.check = true
    else if (arg === '--root') {
      index += 1
      args.root = argv[index]
      if (args.root === undefined) {
        console.error('--root requires a directory argument')
        process.exit(2)
      }
    } else {
      console.error(`unknown argument: ${arg}`)
      process.exit(2)
    }
  }
  return args
}

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

function main() {
  const args = parseArgs(process.argv.slice(2))
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const evalRoot = args.root ?? join(scriptDir, '..', '..', 'demo', 'init', 'agent-qa-eval')
  const corpusDir = join(evalRoot, 'corpus')

  const files = walkJsonFiles(corpusDir, []).sort()
  let rewritten = 0
  let unchanged = 0
  const stillAbsolute = []

  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      console.error(`REFUSED ${file}: not valid JSON (${String(error)})`)
      process.exit(2)
    }

    const links = parsed?.run_links
    const current = links?.handoffPath
    if (typeof current !== 'string' || !ABSOLUTE_PATH.test(current)) {
      unchanged += 1
      continue
    }

    if (args.check) {
      stillAbsolute.push(file)
      continue
    }

    if (typeof links.runSlug !== 'string' || links.runSlug === '') {
      console.error(`REFUSED ${file}: run_links.runSlug is missing, cannot build a relative path`)
      process.exit(2)
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

    links.handoffPath = `${RELATIVE_RUNS_PREFIX}${links.runSlug}/handoff.json`
    writeFileSync(file, committedFileText(parsed))
    rewritten += 1
  }

  if (args.check) {
    for (const file of stillAbsolute) console.error(`ABSOLUTE ${file}`)
    if (stillAbsolute.length > 0) {
      console.error(`--check: ${stillAbsolute.length} corpus entr${stillAbsolute.length === 1 ? 'y' : 'ies'} still carry an absolute handoffPath`)
      process.exit(1)
    }
    console.log(`--check: clean (${files.length} entries scanned)`)
    process.exit(0)
  }

  console.log(`rewritten ${rewritten}, unchanged ${unchanged}`)
  process.exit(0)
}

main()
