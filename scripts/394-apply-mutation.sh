#!/usr/bin/env bash
#
# 394-apply-mutation.sh — the acceptance bar for the final-test write and T-394-43's credential gate
# (394-10; re-spelled 2026-10-02 by 432-44 for D-06 and D-07: agent-qa makes no git commits).
#
# WHAT THIS PROVED, AND WHAT IT PROVES NOW. Before phase 432 an accepted test draft became ONE commit
# of ONE file (D-06 of 394), and this script required `one-commit-apply.test.ts` to catch the three
# implementations that quietly break that: a repository-wide dirty check (M), a staging pathspec
# dropped for `git add --all` (N1) and a commit pathspec dropped (N2). 432-16 deleted the one-commit
# apply: a final authored test is written straight to its target by `publishAuthoredTest`, with no
# git, no stage and no commit, and a dirty tree or a directory with no repository is ordinary (D-07).
# The same three implementations are now three ways git comes BACK into that writer, and each must
# red the cell that pins its absence:
#
#   M1  the writer refuses a dirty working tree                -> writes into a dirty, partly staged tree
#   N1  the writer stages its target (`git add -- <path>`)       -> writes the draft and makes no commit
#   N2  the writer commits its target (`git commit -- <path>`)   -> writes into a dirty, partly staged tree
#   N3  the product commit invocation returns in the host        -> C432-RETURN-A78 (the census row)
#
# N1 IS STILL THE STAGING LEG AND N2 THE COMMIT LEG, AND THEY ARE STILL TWO. A `git commit -- <path>`
# builds its tree from the named path and HEAD, so it needs no `git add` for a tracked target; the
# staging leg moves the index of a NEW target, the commit leg moves HEAD over a TRACKED one. Each has
# its own catcher, measured.
#
# THE CREDENTIAL GATE LEGS ARE UNCHANGED (O, P, Q). The screen and its family set survive phase 432:
#   O1  the credential gate UNWIRED   — the screen still exists; the loop stops calling it.
#   P1  a credential family DELETED   — the set SHRINKS by one.
#   Q1  `injectionShape` ADDED        — the set GROWS by one.
# P AND Q ARE A PAIR AND NEITHER ALONE IS THE CONTROL: the set can neither shrink nor grow unnoticed.
# O IS THE 394-09 TWO-LAYER LESSON: the cells that call the screen directly cannot see an unwired
# loop, so the cells that DRIVE the loop must red.
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a
# load failure, a different selected count or a red outside a leg's list.
#
# Engine (arrival proof, counted selection, byte-exact restoration, the closing forced build and the
# positive controls): scripts/423-mutation-engine.cjs. The writer and its suites are all in
# `packages/cli/src`, and the gate and its suite in `packages/agent/src`, which vitest resolves from
# source; the census reads the built workspace (`dist: true`).
#
# USAGE
#   bash agent-qa/scripts/394-apply-mutation.sh   # from the super-repository root
#   bash scripts/394-apply-mutation.sh            # from the agent-qa root
#
# KNOBS — APPLY_MUTATION_SELFTEST (the knob this script always had)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# APPLY_MUTATION_LEG=<id> runs one leg; APPLY_MUTATION_LIST=1 prints the inventory and exits.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const HOST_SRC = 'packages/cli/src/composition/local-agent-host.ts'
const LOOP_SRC = 'packages/agent/src/authoring/loop.ts'
const APPLY_T = 'src/__tests__/one-commit-apply.test.ts'
const NO_GIT_T = 'src/__tests__/432-no-git.test.ts'
const GATE_T = 'src/authoring/__tests__/secret-guardrail.test.ts'
const CENSUS_T = 'src/__tests__/432-approval-permission-deleted.test.ts'

// Counts measured from a fresh Vitest JSON report of exactly these files (2026-10-02, 432-44).
const instruments = {
  publish: { pkg: 'packages/cli', files: [APPLY_T, NO_GIT_T], typecheck: false, count: 20, env: { VITEST_MAX_WORKERS: '1' } },
  gate: { pkg: 'packages/agent', files: [GATE_T], typecheck: false, count: 13 },
  census: { pkg: 'packages/arch', files: [CENSUS_T], typecheck: false, count: 100, dist: true },
}

const edit = (from, to) => ({ from, to })
const apply = name => cell('publish', APPLY_T, name)
const noGit = name => cell('publish', NO_GIT_T, name)
const gate = name => cell('gate', GATE_T, name)
const census = (name, message) => cell('census', CENSUS_T, name, 1, message)

const NO_COMMIT = apply('writes the draft to its target and makes no commit')
const DIRTY_TREE = apply('writes into a dirty, partly staged tree and stages nothing')
const NO_REPO = apply('writes with no repository at all, because it never asks git anything')
const DIGEST_MATCH = apply('applies when the sourceDigest still matches the target on disk')
const THREE_LEAVE_GIT = noGit('C432-NO-GIT-COMMIT: a config change, a mark fix and an authored test leave HEAD, the index and the history alone; git status shows each edit')
const THREE_IN_DIRTY = noGit("C432-NO-GIT-COMMIT: the same three land in a dirty tree, keeping the person's own uncommitted edit, and nothing is staged")
const THREE_NO_REPO = noGit('C432-NO-GIT-COMMIT: the same three land in a directory with no repository, and none is created')

/** Git returns to the direct writer: the import, then one statement at the given anchor. */
const GIT_IMPORT = edit("import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'\n",
  "import { spawnSync as gitSpawnLeg394 } from 'node:child_process'\nimport { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'\n")
const AFTER_WRITE = "    writeTarget(absoluteTarget, draftBytes)\n  } catch (error) {\n    return refused('write-failed', errorText(error))\n  }\n"
const afterWrite = statement => edit(AFTER_WRITE, `${AFTER_WRITE}${statement}`)

const legs = [
  {
    id: 'M1', claim: 'NO-DIRTY-TREE-REFUSAL', instrument: 'publish', subject: HOST_SRC,
    operation: 'the writer refuses whenever the working tree has any uncommitted change',
    edits: [GIT_IMPORT, edit('  const foundDigest = existing === undefined\n',
      "  const dirtyTreeLeg394 = gitSpawnLeg394('git', ['status', '--porcelain'], { cwd: configDir, encoding: 'utf8' })\n"
      + "  if (dirtyTreeLeg394.status === 0 && dirtyTreeLeg394.stdout.trim() !== '') {\n"
      + "    return refused('write-failed', 'the working tree has uncommitted changes')\n  }\n"
      + '  const foundDigest = existing === undefined\n')],
    reds: [DIRTY_TREE],
    // The project-level cells publish their test after a config change has already dirtied the tree.
    allowed: [THREE_LEAVE_GIT, THREE_IN_DIRTY],
    greens: [NO_COMMIT, NO_REPO, DIGEST_MATCH, THREE_NO_REPO],
  },
  {
    id: 'N1', claim: 'NOTHING-STAGED', instrument: 'publish', subject: HOST_SRC,
    operation: 'the writer stages its target after the write',
    edits: [GIT_IMPORT, afterWrite("  gitSpawnLeg394('git', ['add', '--', identityPath], { cwd: configDir })\n")],
    reds: [NO_COMMIT],
    // Every cell that reads the index after a publication sees the staged target.
    allowed: [DIRTY_TREE, THREE_LEAVE_GIT, THREE_IN_DIRTY],
    greens: [NO_REPO, DIGEST_MATCH, THREE_NO_REPO],
  },
  {
    id: 'N2', claim: 'NO-COMMIT', instrument: 'publish', subject: HOST_SRC,
    operation: 'the writer commits its target after the write',
    edits: [GIT_IMPORT, afterWrite("  gitSpawnLeg394('git', ['commit', '--quiet', '-m', `agent-qa: ${identityPath}`, '--', identityPath], { cwd: configDir })\n")],
    // Only a TRACKED target can be committed without staging, and only this cell publishes over one
    // while it watches HEAD; a new target's commit fails and moves nothing.
    reds: [DIRTY_TREE],
    allowed: [],
    greens: [NO_COMMIT, NO_REPO, DIGEST_MATCH, THREE_LEAVE_GIT, THREE_IN_DIRTY, THREE_NO_REPO],
  },
  {
    id: 'N3', claim: 'C432-RETURN-A78', instrument: 'census', subject: HOST_SRC,
    operation: 'the product commit invocation returns in the host, behind an injected subprocess',
    edits: [edit('export const CLI_FUNCTION_CALLER: FunctionCaller = {',
      'export function commitPublishedFile(\n  cwd: string,\n  filePath: string,\n'
      + '  spawn: (command: string, args: readonly string[], options: { readonly cwd: string }) => unknown,\n'
      + '): unknown {\n'
      + "  return spawn('git', ['commit', '-m', `Agent-QA-Proposal: ${filePath}`, '--', filePath], { cwd })\n"
      + '}\n\nexport const CLI_FUNCTION_CALLER: FunctionCaller = {')],
    reds: [census('C432-RETURN-A78', "A78: the product git commit returned ('commit')")],
    allowed: [],
    greens: [census('UNIVERSE-FLOORS'), census('LEXER-CONTROL'), census('PLANTED-POSITIVE'), census('SELF-MATCH')],
  },
  {
    id: 'O1', claim: 'CREDENTIAL-GATE-WIRED', instrument: 'gate', subject: LOOP_SRC,
    operation: 'the credential gate is unwired from the loop',
    edits: [edit('\n  screenDraftForCredentials(draft)\n', '\n')],
    // Every cell that DRIVES the loop reds; the cells that call the screen directly cannot see it.
    reds: [...['awsKey', 'creditCard', 'pemKey', 'bearer', 'apiKey'].map(family =>
      gate(`refuses a draft whose step carries a ${family} literal, naming that family`)),
    gate('refuses a credential in the test NAME too, and says so instead of naming a step')],
    allowed: [],
    greens: [gate('excludes injectionShape and email, read off the exported constant itself'),
      gate('never repeats the matched value, nor any run of it longer than four characters')],
  },
  {
    id: 'P1', claim: 'CREDENTIAL-SET-SHRINK', instrument: 'gate', subject: LOOP_SRC,
    operation: 'a credential family is deleted from the set',
    edits: [edit("\n  'pemKey',\n", '\n')],
    reds: [gate('refuses a draft whose step carries a pemKey literal, naming that family')],
    // The whole-set membership cell and the n-gram cell iterate the same family corpus.
    allowed: [gate('excludes injectionShape and email, read off the exported constant itself'),
      gate('never repeats the matched value, nor any run of it longer than four characters')],
    greens: [gate('accepts an instruction-override string even though injectionShape FIRES on it')],
  },
  {
    id: 'Q1', claim: 'CREDENTIAL-SET-GROWTH', instrument: 'gate', subject: LOOP_SRC,
    operation: 'injectionShape is added to the credential set',
    edits: [edit("\n  'apiKey',\n] as const", "\n  'apiKey',\n  'injectionShape',\n] as const")],
    reds: [gate('accepts an instruction-override string even though injectionShape FIRES on it'),
      gate('excludes injectionShape and email, read off the exported constant itself')],
    allowed: [],
    greens: [gate('refuses a draft whose step carries a pemKey literal, naming that family')],
  },
]

runGate({
  slug: '394-apply-mutation', envPrefix: 'APPLY_MUTATION',
  instruments, legs, expectedLegs: 7, explicitIds: true, parseCheck: true, banner: 'APPLY_MUTATION_OK',
})
NODE
