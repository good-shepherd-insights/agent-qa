#!/usr/bin/env bash
#
# 395-apply-bytecompare-mutation.sh — the acceptance bar for the config writer's discipline (395-06;
# re-spelled 2026-10-02 by 432-44 onto the shared engine for D-05 and D-07).
#
# WHAT THIS PROVED, AND WHAT IT PROVES NOW. Before phase 432 a config change was a proposal a person
# accepted, and the accept committed it: the bytes a person read were compared with the bytes applied
# (D-19), a dirty proposal file got a human-first commit under the person's own name (D-05), the dirty
# scan covered the proposal's files only, a failed two-file apply put both files back, and a freshness
# re-check refused an apply over bytes that moved (D-18). 432-07/16 replaced the accept with the DIRECT
# config writer (`createConfigWritePort`): a field change merges in the dashboard manager's transaction
# and a whole-file publication is checked first (inside the workspace, not repeated, digest unchanged)
# and then written file by file, each over the digest it was built from; nothing runs git. The five
# legs are carried to that writer (432-MUTATION-MAP.md: "proposal accept bytes -> direct
# exact-byte/path/digest publication"):
#
#   A1  THE BYTE COMPARISON SEVERED. The whole-file pre-check still computes each file's digest and
#       still compares it; it just cannot fail. A publication over bytes that moved is then caught,
#       if at all, by the write's own re-check AFTER earlier files were written — not refused before
#       any write.
#   A2  THE PRODUCT COMMIT RETURNS. An applied field change is committed under agent-qa's name: the
#       repudiation shape D-05's human-first commit existed to prevent, now forbidden outright (D-07).
#   A3  THE DIRTY SCAN WIDENED TO THE PINNED CONFIG SET. A person's unrelated dirty `.gitignore` then
#       refuses a change to the config file — the over-reach that once swept that edit into a commit.
#   A4  THE PARTIAL-WRITE REPORT NARROWED. A publication interrupted part way forgets the files it
#       already wrote: the multi-file truth that replaced the multi-file rollback.
#   A5  THE FRESHNESS RE-CHECK SEVERED, AND NOTHING ELSE. A write its own in-transaction re-check
#       refuses is retried over whatever revision is on disk now, so a file that changed between the
#       pre-check and its turn to be written is overwritten. The control leg: whichever cells red
#       really depend on the write-time re-check, and the pre-check cells stay green.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a
# load failure, a different selected count or a red outside a leg's list.
#
# Engine (arrival proof, counted selection, byte-exact restoration, the closing forced build and the
# positive controls): scripts/423-mutation-engine.cjs. The writer and its suites are all in
# `packages/cli/src`, which vitest resolves from source.
#
# USAGE
#   bash agent-qa/scripts/395-apply-bytecompare-mutation.sh   # from the super-repository root
#   bash scripts/395-apply-bytecompare-mutation.sh            # from the agent-qa root
#
# KNOBS — CONFIG_WRITE_MUTATION_SELFTEST (was APPLY_MUTATION_SELFTEST, which 394-apply-mutation.sh
# also reads; the two scripts no longer share a knob)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# CONFIG_WRITE_MUTATION_LEG=A1..A5 runs one leg; CONFIG_WRITE_MUTATION_LIST=1 prints the inventory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const HOST_SRC = 'packages/cli/src/composition/local-agent-host.ts'
const TRACER_T = 'src/composition/__tests__/config-apply.test.ts'
const DISCIPLINE_T = 'src/composition/__tests__/config-apply-discipline.test.ts'
const DIRECT_T = 'src/composition/__tests__/432-direct-config.test.ts'

// Counts measured from a fresh Vitest JSON report of exactly these files (2026-10-02, 432-44).
const instruments = {
  config: { pkg: 'packages/cli', files: [TRACER_T, DISCIPLINE_T, DIRECT_T], typecheck: false, count: 47, env: { VITEST_MAX_WORKERS: '1' } },
}

const edit = (from, to) => ({ from, to })
const tracer = name => cell('config', TRACER_T, name)
const discipline = name => cell('config', DISCIPLINE_T, name)
const direct = name => cell('config', DIRECT_T, name)

const GIT_IMPORT = edit("import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'\n",
  "import { spawnSync as gitSpawnLeg395 } from 'node:child_process'\nimport { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'\n")
const FIELD_APPLY = '      const outcome = await (await dashboardConfigManager(absoluteConfigPath)).applyChanges(changes)\n'

const legs = [
  {
    id: 'A1', claim: 'PRE-CHECK-BYTE-COMPARISON', instrument: 'config', subject: HOST_SRC,
    operation: 'the whole-file digest comparison is still computed, and can no longer fail',
    edits: [edit('        if ((existing === undefined ? undefined : sha256hexBytes(existing)) !== file.baseDigest) {\n',
      '        if ((existing === undefined ? undefined : sha256hexBytes(existing)) !== file.baseDigest && files.length < 0) {\n')],
    reds: [tracer('(f) a whole-file publication over bytes that moved refuses before any write')],
    // Every refusal that must arrive BEFORE a write now arrives from the write's own re-check, as an
    // interruption instead of a refusal (measured: the stale pair, the dirty-file refusal, the named
    // recovery, and the direct writer's two pre-check cells).
    allowed: [discipline('(4) two publications racing over one file: the second refuses at the digest re-check'),
      discipline('(5) the stale refusal names the file and the fact, and the recovery it points at EXISTS'),
      discipline('(6) a refusal on a DIRTY file mutates nothing'),
      discipline("(7) the named recovery after a stale refusal lands on the human's bytes, not over them"),
      direct('a whole-file publication of the config built before a co-hosted change refuses and keeps that change'),
      direct('a stale digest, a file that appeared, an escaping path and a repeated path refuse before any write')],
    greens: [discipline('(8) a publication whose first write fails writes nothing, names what it did not write, and leaves the index alone'),
      direct('a file that changes during publication stops it, naming what was written and what was not')],
  },
  {
    id: 'A2', claim: 'NO-PRODUCT-COMMIT', instrument: 'config', subject: HOST_SRC,
    operation: "an applied field change is committed under agent-qa's name",
    edits: [GIT_IMPORT, edit("      if (outcome.kind === 'ok') {\n",
      "      if (outcome.kind === 'ok') {\n        gitSpawnLeg395('git', ['commit', '--quiet', '-m', 'agent-qa (proposed by chat)', '--', configIdentity], { cwd: configDir })\n")],
    reds: [discipline('(1) a dirty config file takes the change in place, and neither edit is committed')],
    // Every cell that counts commits or reads HEAD after an applied field change, and the host's
    // own no-spawn census (measured).
    allowed: [discipline('(2) dirty bytes in files the change does not touch stay uncommitted — including a CONFIG-SET member'),
      discipline("(7) the named recovery after a stale refusal lands on the human's bytes, not over them"),
      discipline('(9) a repeated change answers no-change and writes nothing more'),
      discipline('(11) C432-NO-CONFIG-UNDO-PORT: a change is undone with git restore, byte-exactly'),
      discipline('(12) an intervening human commit is what a restore returns to'),
      discipline('(13) a change after a restore needs no special case'),
      discipline('(15) at sub/dir the undo refuses unbound, and a restore of the configDir-relative member is exact'),
      discipline('(16) C432-NO-CONFIG-UNDO-PORT: the CLI host asks git nothing — no log, no show, no spawn'),
      discipline('(17) at sub/dir a dirty config file takes the change and nothing is committed'),
      discipline('a dirty config set member and unrelated staged content are valid; HEAD and the index do not move'),
      discipline('at sub/dir the direct writer publishes the configDir-relative member and commits nothing'),
      tracer('(a) writes the edit in the call, answering the diff of the bytes it read and filing nothing'),
      tracer('(c) repeating the same change answers no-change and writes nothing more'),
      tracer('(d) an out-of-band edit is kept: the change lands on the bytes on disk, not over them'),
      tracer('publishes the field edit byte-matched with its comments, files no proposal and makes no commit'),
      direct('a dirty config and unrelated staged content publish without moving HEAD or the index')],
    greens: [discipline('(3) a publication outside the workspace is refused, and nothing is written or committed')],
  },
  {
    id: 'A3', claim: 'NO-DIRTY-SCAN', instrument: 'config', subject: HOST_SRC,
    operation: "a dirty member of the pinned config set refuses a change to the config file",
    edits: [GIT_IMPORT, edit(FIELD_APPLY,
      "      const dirtySetLeg395 = gitSpawnLeg395('git', ['status', '--porcelain', '--', '.gitignore'], { cwd: configDir, encoding: 'utf8' })\n"
      + "      if (dirtySetLeg395.status === 0 && dirtySetLeg395.stdout.trim() !== '') {\n"
      + "        return { kind: 'refused', file: configIdentity, error: 'dirty-config-set' } as never\n      }\n"
      + FIELD_APPLY)],
    reds: [discipline('(2) dirty bytes in files the change does not touch stay uncommitted — including a CONFIG-SET member')],
    // The other dirty-set cell, and the host's own no-spawn census (measured).
    allowed: [discipline('a dirty config set member and unrelated staged content are valid; HEAD and the index do not move'),
      discipline('(16) C432-NO-CONFIG-UNDO-PORT: the CLI host asks git nothing — no log, no show, no spawn')],
    greens: [discipline('(1) a dirty config file takes the change in place, and neither edit is committed')],
  },
  {
    id: 'A4', claim: 'PARTIAL-WRITE-TRUTH', instrument: 'config', subject: HOST_SRC,
    operation: 'an interrupted publication forgets the files it already wrote',
    edits: [edit("            kind: 'interrupted',\n            written,\n            failed: { path: file.identity, reason: 'write-failed', message: errorText(error) },\n",
      "            kind: 'interrupted',\n            written: written.slice(written.length),\n            failed: { path: file.identity, reason: 'write-failed', message: errorText(error) },\n")],
    reds: [discipline('a two-file publication whose second write fails keeps the first, names both, and commits nothing')],
    allowed: [direct('a write that fails part way reports the files already written and invents nothing')],
    greens: [discipline('(8) a publication whose first write fails writes nothing, names what it did not write, and leaves the index alone')],
  },
  {
    id: 'A5', claim: 'WRITE-TIME-FRESHNESS', instrument: 'config', subject: HOST_SRC,
    operation: 'a write refused at its own re-check is retried over whatever revision is on disk now',
    edits: [edit('          replaced = await manager.replaceDocument(file.expected, file.bytes)\n',
      '          replaced = await manager.replaceDocument(file.expected, file.bytes)\n'
      + "          const staleRetryLeg395 = replaced as { readonly kind: string; readonly revision?: string }\n"
      + "          if (staleRetryLeg395.kind === 'refused' && staleRetryLeg395.revision !== undefined) {\n"
      + '            replaced = await manager.replaceDocument(staleRetryLeg395.revision, file.bytes)\n          }\n')],
    reds: [direct('a file that changes during publication stops it, naming what was written and what was not')],
    allowed: [],
    greens: [tracer('(f) a whole-file publication over bytes that moved refuses before any write')],
  },
]

runGate({
  slug: '395-apply-bytecompare-mutation', envPrefix: 'CONFIG_WRITE_MUTATION',
  instruments, legs, expectedLegs: 5, explicitIds: true, parseCheck: true, banner: 'CONFIG_WRITE_MUTATION_OK',
})
NODE
