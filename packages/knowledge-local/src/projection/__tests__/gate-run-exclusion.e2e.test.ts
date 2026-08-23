// THE FROZEN INVK-06 CONSUMER CENSUS (Phase 401 plan 08 — D-15).
//
// WHAT A CENSUS IS FOR. INVK-06's sentence is "a gate run never counts toward flake counters or
// issue candidacy". That is a COMPLETE-SET claim, and a complete-set claim is only worth the
// discovery predicate underneath it. So this file does not transcribe a list from a plan: it
// re-derives the predicate against the live tree on every run, pins the answer, and FAILS when a
// consumer appears outside the pinned set — which is what makes a future reader of run outcomes
// arrive as a red cell rather than as a silent new member of the denominator.
//
// THE PREDICATE IS SELF-CHECKED BEFORE IT IS TRUSTED (the 398 lesson). A census whose scan misses
// the very file the exclusion lives in is red at rest and green in the report; every predicate
// below is first run against its own KNOWN members and required to find them.
//
// AND IT IS CLOSED TRANSITIVELY (the 401-11 lesson: a pinned export's body is not the code it
// runs). A marker-name grep is NOT sufficient here, and this census can prove it: the single
// largest consumer of the exclusion decision — `suite-fingerprints.ts`, which carries it into the
// fingerprint table — contains ZERO code references to either marker. It reads a member list
// somebody else already gated. A one-hop census would have reported clean and missed it. So the
// second predicate ranges the SUBSTRATE instead of the vocabulary: every producer of, and every
// writer into, the tables flake counting and issue candidacy are computed from.
//
// vitest does not typecheck `.test.ts`; `tsc --noEmit` is this file's only type authority.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** The repo root, found by walking up to the directory that holds `packages/`. */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let hops = 0; hops < 12; hops += 1) {
    try {
      if (statSync(join(dir, 'packages')).isDirectory() && statSync(join(dir, 'pnpm-workspace.yaml')).isFile()) {
        return dir
      }
    } catch {
      // keep walking
    }
    dir = dirname(dir)
  }
  throw new Error('the census could not locate the workspace root')
}

const ROOT = repoRoot()

// Every first-party, non-test `.ts` file under `packages/*/src`. The scan's whole universe.
function sourceFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules' || entry.name === 'dist') continue
        walk(full)
        continue
      }
      if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) found.push(full)
    }
  }
  for (const pkg of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue
    const src = join(ROOT, 'packages', pkg.name, 'src')
    try {
      if (statSync(src).isDirectory()) walk(src)
    } catch {
      // a package with no `src/`
    }
  }
  return found.sort()
}

/**
 * The lines of a file that are CODE, not prose.
 *
 * This repository documents heavily, and the exclusion is discussed in comments in files that
 * never touch it. A scan that counted prose would pin a set of paragraphs; what has to be pinned
 * is a set of behaviours.
 */
function codeLines(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return trimmed !== '' && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')
    })
}

function repoRelative(path: string): string {
  return relative(ROOT, path).split(sep).join('/')
}

/** Files with a CODE reference to one of `patterns`. */
function filesReferencing(patterns: readonly RegExp[]): string[] {
  return sourceFiles()
    .filter((path) => codeLines(path).some((line) => patterns.some((pattern) => pattern.test(line))))
    .map(repoRelative)
}

// ---- predicate 1: the marker vocabulary --------------------------------------------------------

// SUBSTRING, NOT WORD-BOUNDED, AND THE DIFFERENCE WAS MEASURED. `/\bgateRun\b/` drops five files
// whose only code references are `gateRuns`, `gateRunIds`, `gateRunHandoff`, `gateRunStartInput` —
// every one of them a real site in the marker's own chain. The self-check cell below caught nothing
// when the boundary form was used, because the five known members it interrogates all happen to
// spell the bare identifier: a narrowing that misses a member the self-check does not name is
// invisible to it. So the predicate over-includes on purpose. Over-inclusion costs a row in the
// classification table; under-inclusion silently drops a consumer, which is the failure this census
// exists to make impossible. The `NOT NARROWER` cell below pins that choice.
const MARKER_PATTERNS = [/gateRun/, /excludedFromOutcomes/] as const

/** The boundary form the census deliberately does NOT use. Kept so the choice stays measurable. */
const NARROWED_MARKER_PATTERNS = [/\bgateRun\b/, /\bexcludedFromOutcomes\b/] as const

/**
 * Every file naming a marker in code, classified (D-15).
 *
 * `role` is the census's answer for that file, and every discovered file MUST have one — the
 * "n in, n classified" self-check below is what stops a silent drop.
 *
 *  - `consumer` — reads the marker to decide what feeds flake counting or issue candidacy.
 *  - `carrier`  — moves the marker between representations (schema, handoff, queue payload, ack).
 *  - `producer` — mints the marker onto a request or a run.
 */
const MARKER_CENSUS: Readonly<Record<string, 'consumer' | 'carrier' | 'producer'>> = {
  // THE ONE EXCLUSION GATE. Everything the flake tables and the candidacy inputs are computed from
  // passes through this one `excluded ? [] : handoff.tests` line.
  'packages/knowledge-local/src/projection/run-outcomes.ts': 'consumer',

  // Carriers: the marker's representations, none of which decides anything with it.
  'packages/schema/src/functions/runs.ts': 'carrier',
  'packages/schema/src/handoff/completed-run-handoff.ts': 'carrier',
  'packages/schema/src/handoff/load-completed-run-handoff.ts': 'carrier',
  'packages/schema/src/job/analyze-run-payload.ts': 'carrier',
  'packages/schema/src/authoring/draft-receipt.ts': 'carrier',
  'packages/runner/src/run/ports.ts': 'carrier',
  'packages/runner/src/run/handoff-assembly.ts': 'carrier',
  'packages/agent/src/functions/ops/runs-start.ts': 'carrier',
  'packages/agent/src/functions/ops/runs-get.ts': 'carrier',
  'packages/agent/src/jobs/kinds.ts': 'carrier',
  'packages/cli/src/curation/post-run-tail.ts': 'carrier',
  'packages/cli/src/commands/run.ts': 'carrier',
  // 2026-08-23 (401-10): `packages/cli/src/composition/local-agent-host.ts` LEFT THIS CENSUS WITH
  // ITS SUBJECT. It was a carrier because `MARKER_FLAGS` translated the two markers into the child
  // flags `--gate-run` / `--excluded-from-outcomes` — the middle link 393 (WTST-06) had to add
  // before a gate run could reach a real CLI at all. D-01 deleted the child, so the table went with
  // it and the file names neither marker in code any more. REMOVED rather than relaxed: this census
  // is an equality between what the scan finds and what the register classifies, so a member the
  // tree no longer contains is a permanently red pin, not a stricter one. The chain it linked is
  // unbroken — `run-invocation-core.ts` below carries the markers onto the run in process, and
  // `run-invocation-core.test.ts` / `run-invocation-evidence.test.ts` assert the carriage.
  'packages/agent-local/src/composition/run-invocation-core.ts': 'carrier',

  // Producers: the sites that put the marker on a request in the first place.
  'packages/agent/src/authoring/stability-gates.ts': 'producer',
  'packages/agent/src/authoring/verify-draft.ts': 'producer',
  'packages/agent/src/authoring/repair.ts': 'producer',
  'packages/agent/src/authoring/loop.ts': 'producer',
  'packages/agent/src/functions/ops/authoring-draft-write.ts': 'producer',
  'packages/agent/src/functions/ops/authoring-verify-draft.ts': 'producer',
}

// ---- predicate 2: the outcome substrate (the transitive half) ----------------------------------

/**
 * The producers of, and the writers into, the tables INVK-06 is a claim about.
 *
 * Ranged by SYMBOL rather than by marker, because the consumer that matters most here never names
 * the marker at all. A new door that started writing `run_outcomes` or `suite_fingerprints` would
 * be invisible to predicate 1 and is caught by this one.
 */
const SUBSTRATE_PATTERNS = [
  /\bprojectRunOutcomes\b/,
  /\bapplyRunOutcomes\b/,
  /\bsuiteFingerprintDeltas\b/,
  /\bapplySuiteFingerprints\b/,
  /\bfoldSuiteFingerprints\b/,
  /\bfoldRunOutcomes\b/,
] as const

const SUBSTRATE_CENSUS: Readonly<Record<string, string>> = {
  'packages/knowledge-local/src/projection/run-outcomes.ts':
    'THE gate: `excluded ? [] : handoff.tests`, and both tables are written from its output',
  'packages/knowledge-local/src/projection/suite-fingerprints.ts':
    'the CARRIED decision — computes from an already-gated member list, and takes `excluded` as an argument on its standalone door',
  'packages/knowledge-local/src/index.ts':
    'the barrel — re-exports only; no call site',
  'packages/cli/src/curation/curation-tail.ts':
    'the post-run fold entry: hands the handoff to `foldRunOutcomes`, which gates it',
  'packages/agent-local/src/composition/compose-local-agent.ts':
    'publishes `foldRunOutcomes` as a curation capability — a pass-through with no call site of its own',
}

describe('the INVK-06 consumer census is frozen and self-checking (D-15)', () => {
  it('THE MARKER PREDICATE FINDS ITS OWN KNOWN MEMBERS before it is trusted', () => {
    // A predicate narrowed — to one package, to one directory, to a stricter word boundary — that
    // no longer sees the file the exclusion actually lives in must fail HERE, loudly, rather than
    // reporting a clean scan of nothing. These five are the chain's ends and its middle.
    const known = [
      'packages/knowledge-local/src/projection/run-outcomes.ts',
      'packages/runner/src/run/handoff-assembly.ts',
      'packages/schema/src/handoff/completed-run-handoff.ts',
      'packages/agent-local/src/composition/run-invocation-core.ts',
      'packages/agent/src/authoring/stability-gates.ts',
    ]
    for (const member of known) {
      const hits = codeLines(join(ROOT, member))
        .filter((line) => MARKER_PATTERNS.some((pattern) => pattern.test(line)))
      expect(hits.length, `${member} must be visible to the marker predicate`).toBeGreaterThan(0)
    }
    // And the universe it scans is a real one, not an empty walk.
    expect(sourceFiles().length).toBeGreaterThan(500)
  })

  it('THE PREDICATE IS NOT NARROWER THAN THE VOCABULARY — the boundary form drops real sites', () => {
    // Measured, not asserted from memory: the word-bounded form finds strictly fewer files, and
    // every file it drops is a real site in the marker's chain. This cell is what makes the
    // over-inclusive choice above a decision rather than an accident, and it reds if somebody
    // "tidies" the predicate into the boundary form.
    const broad = filesReferencing(MARKER_PATTERNS)
    const narrow = filesReferencing(NARROWED_MARKER_PATTERNS)
    const dropped = broad.filter((file) => !narrow.includes(file))

    expect(narrow.length).toBeLessThan(broad.length)
    expect(dropped.sort()).toEqual([
      'packages/agent/src/authoring/loop.ts',
      'packages/agent/src/authoring/verify-draft.ts',
      'packages/agent/src/functions/ops/authoring-draft-write.ts',
      'packages/agent/src/functions/ops/authoring-verify-draft.ts',
      'packages/schema/src/authoring/draft-receipt.ts',
    ])
  })

  it('THE MARKER SCAN EQUALS THE FROZEN CENSUS — n in, n classified, no silent drops', () => {
    const discovered = filesReferencing(MARKER_PATTERNS)
    const classified = Object.keys(MARKER_CENSUS).sort()

    expect(discovered.sort()).toEqual(classified)
    // The register's own arithmetic, stated rather than implied (the 394 no-silent-drop lesson).
    expect(discovered.length).toBe(Object.keys(MARKER_CENSUS).length)
  })

  it('EXACTLY ONE MARKER CONSUMER, and it is the one gate', () => {
    const consumers = Object.entries(MARKER_CENSUS)
      .filter(([, role]) => role === 'consumer')
      .map(([file]) => file)
    // A SECOND consumer would be the shape in which two readers could eventually disagree about the
    // same run — Pitfall 8, and the reason `projectRunOutcomes` states it is THE one gate.
    expect(consumers).toEqual(['packages/knowledge-local/src/projection/run-outcomes.ts'])
  })

  it('A MARKER GREP IS NOT A CENSUS — the carried consumer names neither marker in code', () => {
    // The census's own witness that predicate 1 is incomplete, and the reason predicate 2 exists.
    // `suite-fingerprints.ts` computes the fingerprint table from the gated member list and takes
    // the exclusion decision as an ARGUMENT on its standalone door; it mentions the marker only in
    // prose. A one-hop census would have reported clean with this file outside it.
    const carriedConsumer = 'packages/knowledge-local/src/projection/suite-fingerprints.ts'
    expect(filesReferencing(MARKER_PATTERNS)).not.toContain(carriedConsumer)
    expect(Object.keys(SUBSTRATE_CENSUS)).toContain(carriedConsumer)
    // It really is about the markers — the prose is there, only the code is not.
    expect(readFileSync(join(ROOT, carriedConsumer), 'utf8')).toContain('excludedFromOutcomes')
  })

  it('THE SUBSTRATE PREDICATE FINDS ITS OWN KNOWN MEMBERS before it is trusted', () => {
    for (const member of [
      'packages/knowledge-local/src/projection/run-outcomes.ts',
      'packages/knowledge-local/src/projection/suite-fingerprints.ts',
    ]) {
      const hits = codeLines(join(ROOT, member))
        .filter((line) => SUBSTRATE_PATTERNS.some((pattern) => pattern.test(line)))
      expect(hits.length, `${member} must be visible to the substrate predicate`).toBeGreaterThan(0)
    }
  })

  it('THE SUBSTRATE SCAN EQUALS THE FROZEN CENSUS — nothing writes these tables from outside', () => {
    // The transitive closure, mechanised: a new consumer either NAMES a marker (predicate 1) or
    // WRITES the substrate (this one). A door that did neither is not a consumer of run outcomes.
    expect(filesReferencing(SUBSTRATE_PATTERNS).sort())
      .toEqual(Object.keys(SUBSTRATE_CENSUS).sort())
  })
})
