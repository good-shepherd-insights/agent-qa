#!/usr/bin/env bash
#
# 394-apply-rollback-mutation.sh — a FAILED final-test write leaves the person's file as it was, and
# both halves of the digest contract are bytes (Phase 394 gap round 1 · CR-05 · WTST-01, T-394-70;
# re-spelled 2026-10-02 by 432-44 for D-06 and D-07).
#
# WHAT THIS PROVED, AND WHAT IT PROVES NOW. Before phase 432 an accepted draft was written and
# committed by the one-commit apply, and a FAILED apply had to put back the worktree AND the index.
# Seven legs measured that rollback: the index half of the restore (T), a succeeded commit routed
# into the restore (V), nothing-to-commit named (N), the index capture inside the try (P), the write
# hoisted out of the try (W), and the two halves of the byte digest contract (U, U2). 432-16 deleted
# the apply and its git: the final-test writer `publishAuthoredTest` writes through a sibling temp,
# fsync and rename, answers `not-written` with the writer's own error on a failure, and never touches
# the index. There is no rollback any more because there is nothing to roll back — the ATOMIC WRITE is
# the restoration (432-MUTATION-MAP.md: "accepted-file failure rollback -> atomic writer failure
# restoration; no product Undo"). The legs, carried:
#
#   W1  (was W)    the atomic writer writes the target IN PLACE: a failing write is no longer refused
#                  before the person's bytes move                       -> the failed-write cell
#   W2  (was V, N) a failed write is answered as if nothing failed: the writer's error is swallowed
#                  and the call reports `written`                       -> the non-UTF-8 failed-write cell
#   T1  (was T, P) a failed write stages a DELETION of the person's committed test (P's own defect):
#                  the index no longer stands where they left it        -> the failed-write cell, by its index half
#   U1  (was U)    the CONSUMER reads the target through a UTF-8 round-trip
#   U2  (was U2)   the PRODUCER (`parseDraft`) hashes the decoding instead of the bytes
#
# U AND U2 ARE THE TWO HALVES OF ONE AGREEMENT, and every cell that states the agreement is red
# whichever half breaks it. U2 must red the one cell U cannot — `mints the digest over the file's RAW
# BYTES in the PRODUCER, with no apply in the reading` asks the producer a question no write is part of
# — which is its named RED; the shared agreement cells are each leg's allowed co-reds, by name.
#
# W1 AND T1 RED ONE CELL BY TWO DIFFERENT ASSERTIONS, AND EACH IS HELD TO ITS OWN: W1 changes the
# outcome (`written` where `not-written` was required), T1 leaves the outcome and the bytes alone and
# moves the index. Each names the assertion its RED must carry, so neither can stand in for the other.
#
# A GREEN SUITE UNDER A MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a load
# failure, a different selected count or a red outside a leg's list.
#
# Engine (arrival proof, counted selection, byte-exact restoration, the closing forced build and the
# positive controls): scripts/423-mutation-engine.cjs. The writer and its suite are both in
# `packages/cli/src`, which vitest resolves from source.
#
# USAGE
#   bash agent-qa/scripts/394-apply-rollback-mutation.sh    # from the super-repository root
#   bash scripts/394-apply-rollback-mutation.sh             # from the agent-qa root
#
# KNOBS — APPLY_ROLLBACK_SELFTEST (the knob this script always had; APPLY_ROLLBACK_SKIP_BUILD retired)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# APPLY_ROLLBACK_LEG=<id> runs one leg; APPLY_ROLLBACK_LIST=1 prints the inventory and exits.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const HOST_SRC = 'packages/cli/src/composition/local-agent-host.ts'
const APPLY_T = 'src/__tests__/one-commit-apply.test.ts'

// Counts measured from a fresh Vitest JSON report of exactly this file (2026-10-02, 432-44).
const instruments = {
  apply: { pkg: 'packages/cli', files: [APPLY_T], typecheck: false, count: 14, env: { VITEST_MAX_WORKERS: '1' } },
}

const edit = (from, to) => ({ from, to })
const apply = (name, message) => cell('apply', APPLY_T, name, 1, message)

const FAILED_WRITE = "a write that fails leaves the target's bytes, the index and the history untouched, and no temp behind"
const NON_UTF8_FAILED = 'leaves a non-UTF-8 target BYTE-IDENTICAL when the write fails'
const RAW_DIGEST = "digests the target's RAW BYTES, so a target that is not valid UTF-8 still matches the request"
const ACCEPTS_UNTOUCHED = 'ACCEPTS an untouched non-UTF-8 target whose sourceDigest came through parseDraft'
const PRODUCER_BYTES = "mints the digest over the file's RAW BYTES in the PRODUCER, with no apply in the reading"
const REFUSES_MOVED = "REFUSES by name when the target's bytes really changed between the parse and the apply"
const WRITES_NO_COMMIT = 'writes the draft to its target and makes no commit'
const DIGEST_MATCH = 'applies when the sourceDigest still matches the target on disk'

const legs = [
  {
    id: 'W1', claim: 'ATOMIC-WRITE', instrument: 'apply', subject: HOST_SRC,
    operation: 'the atomic writer writes the target in place instead of through a sibling temp and rename',
    edits: [edit('  const temp = `${path}.${process.pid}${DRAFT_TEMP_SUFFIX}`\n  try {\n',
      '  const temp = `${path}.${process.pid}${DRAFT_TEMP_SUFFIX}`\n  if (existsSync(path)) {\n    writeFileSync(path, contents)\n    return\n  }\n  try {\n')],
    // The outcome changes: a write the directory forbids for a NEW file succeeds over an existing one.
    reds: [apply(FAILED_WRITE, 'to match object')],
    allowed: [],
    greens: [apply(WRITES_NO_COMMIT), apply(DIGEST_MATCH), apply(NON_UTF8_FAILED)],
  },
  {
    id: 'W2', claim: 'FAILED-WRITE-NAMED', instrument: 'apply', subject: HOST_SRC,
    operation: "a failed write is answered as written: the writer's error is swallowed",
    edits: [edit("    writeTarget(absoluteTarget, draftBytes)\n  } catch (error) {\n    return refused('write-failed', errorText(error))\n  }\n",
      "    writeTarget(absoluteTarget, draftBytes)\n  } catch (error) {\n    void error\n  }\n")],
    reds: [apply(NON_UTF8_FAILED)],
    // The directory-forbidden write is the same failure, answered the same wrong way.
    allowed: [apply(FAILED_WRITE)],
    greens: [apply(WRITES_NO_COMMIT), apply(DIGEST_MATCH), apply(REFUSES_MOVED)],
  },
  {
    id: 'T1', claim: 'INDEX-UNTOUCHED-ON-FAILURE', instrument: 'apply', subject: HOST_SRC,
    // P's own defect: a failure path that stages a DELETION of the person's committed test.
    operation: "a failed write drops the target's index entry, staging a deletion of the person's test",
    edits: [
      edit("import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'\n",
        "import { spawnSync as gitSpawnLeg394 } from 'node:child_process'\nimport { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'\n"),
      edit("    writeTarget(absoluteTarget, draftBytes)\n  } catch (error) {\n    return refused('write-failed', errorText(error))\n  }\n",
        "    writeTarget(absoluteTarget, draftBytes)\n  } catch (error) {\n    gitSpawnLeg394('git', ['rm', '--cached', '--quiet', '--', identityPath], { cwd: configDir })\n    return refused('write-failed', errorText(error))\n  }\n"),
    ],
    // The outcome and the bytes hold; only the index half of the cell can see it.
    reds: [apply(FAILED_WRITE, 'to deeply equal')],
    allowed: [],
    greens: [apply(NON_UTF8_FAILED), apply(WRITES_NO_COMMIT), apply(DIGEST_MATCH)],
  },
  {
    id: 'U1', claim: 'CONSUMER-DIGEST-OVER-BYTES', instrument: 'apply', subject: HOST_SRC,
    operation: 'the writer reads the target through a UTF-8 decode and re-encode',
    edits: [edit('    return readFileSync(absolutePath)\n', "    return Buffer.from(readFileSync(absolutePath).toString('utf8'), 'utf8')\n")],
    reds: [apply(RAW_DIGEST)],
    // The other agreement cells state the same contract from the producer's side and the failure path.
    allowed: [apply(ACCEPTS_UNTOUCHED), apply(NON_UTF8_FAILED)],
    // A refusal cell must not be able to hide a broken accept arm.
    greens: [apply(REFUSES_MOVED), apply(PRODUCER_BYTES)],
  },
  {
    id: 'U2', claim: 'PRODUCER-DIGEST-OVER-BYTES', instrument: 'apply', subject: HOST_SRC,
    operation: "parseDraft hashes the decoding instead of the bytes (the arrangement 394-29 replaced)",
    edits: [edit("          contentDigest: createHash('sha256').update(bytes).digest('hex'),\n",
      "          contentDigest: createHash('sha256').update(content).digest('hex'),\n")],
    reds: [apply(PRODUCER_BYTES)],
    allowed: [apply(RAW_DIGEST), apply(ACCEPTS_UNTOUCHED), apply(NON_UTF8_FAILED)],
    greens: [apply(REFUSES_MOVED), apply(WRITES_NO_COMMIT)],
  },
]

runGate({
  slug: '394-apply-rollback-mutation', envPrefix: 'APPLY_ROLLBACK',
  instruments, legs, expectedLegs: 5, explicitIds: true, parseCheck: true, banner: 'APPLY_ROLLBACK_MUTATION_OK',
})
NODE
