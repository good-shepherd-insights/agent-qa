#!/usr/bin/env bash
#
# 394-refinement-mutation.sh — the acceptance bar for D-17, D-18 and D-19 (394-09), and for refine
# working on the WRITTEN test (re-spelled 2026-10-02 by 432-44 onto the shared engine; D-06/D-07).
#
# WHAT THIS PROVES, and why a green suite does not prove it. The cells passing say a refinement
# round happened, a procedure reached a prompt as words, and a weak name was refused. They do NOT
# say those suites would CATCH the implementations the three decisions forbid — and each of the
# three forbidden implementations is a change of a few tokens that reads as an improvement. A
# detector's acceptance bar is the implementation it must go RED on, never the suite it passes.
#
#   K1  the refinement round GATED inside `refineDraft` — skipped when the first retrieval returned facts.
#   K2  the refinement round GATED at the loop's call site — the layer `refine.test.ts` cannot see.
#   L1  a lone weak match BOUND — `none.closestSuggestion` promoted to a binding (D-19's silent guess).
#   M1  the record id RENDERED — the served procedure's address put into the prompt.
#
# K IS TWO LEGS, AND THAT IS THE FINDING: the trigger heuristic D-18 rules out can be written at either
# layer, and the two are caught by different files.
#
# CARRIED BY 432-44 (432-MUTATION-MAP.md: "proposal refinement -> written-target refinement and
# stale-digest refusal in 432-08"). Before phase 432 a refined draft went back to the inbox as a
# proposal a person accepted. D-06 writes it: `authoring.draft.edit` edits the written test itself,
# over the bytes it read, and answers where the file now is. Two legs hold that:
#
#   S1  the edit is written over the file WITHOUT the digest it read — a file that moved on is then
#       overwritten, or (for a file the guard sees) refused for the wrong reason
#   S2  a REFUSED write still claims the file — the answer points the verify arm at a test this call
#       did not write, instead of at the staged copy
#
# A GREEN SUITE UNDER ANY MUTATION IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a
# load failure, a different selected count or a red outside a leg's list (a differential that reds on
# collateral has shown the corpus is fragile, not that it catches what it forbids).
#
# Engine (arrival proof, counted selection, byte-exact restoration, the closing forced build and the
# positive controls): scripts/423-mutation-engine.cjs. Subjects and suites are all in
# `packages/agent/src`, which vitest resolves from source.
#
# USAGE
#   bash agent-qa/scripts/394-refinement-mutation.sh   # from the super-repository root
#   bash scripts/394-refinement-mutation.sh            # from the agent-qa root
#
# KNOBS — REFINEMENT_MUTATION_SELFTEST (the knob this script always had)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# REFINEMENT_MUTATION_LEG=<id> runs one leg; REFINEMENT_MUTATION_LIST=1 prints the inventory and exits.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const REFINE_T = 'src/authoring/__tests__/refine.test.ts'
const BINDING_T = 'src/authoring/__tests__/entity-binding.test.ts'
const PROCEDURE_T = 'src/authoring/__tests__/procedure-anchor.test.ts'
const EDIT_T = 'src/functions/__tests__/authoring-draft-edit.test.ts'

// Counts measured from a fresh Vitest JSON report of exactly these files (2026-10-02, 432-44).
const instruments = {
  refine: { pkg: 'packages/agent', files: [REFINE_T], typecheck: false, count: 11 },
  binding: { pkg: 'packages/agent', files: [BINDING_T], typecheck: false, count: 7 },
  procedure: { pkg: 'packages/agent', files: [PROCEDURE_T], typecheck: false, count: 5 },
  edit: { pkg: 'packages/agent', files: [EDIT_T], typecheck: false, count: 14 },
}

const edit = (from, to) => ({ from, to })
const refine = name => cell('refine', REFINE_T, name)
const binding = name => cell('binding', BINDING_T, name)
const procedure = name => cell('procedure', PROCEDURE_T, name)
const draftEdit = name => cell('edit', EDIT_T, name)

const WRITTEN_OVER_READ = draftEdit('C432-TEST-REFINE-WRITTEN: writes the edited draft over the file it read, guarded by its digest')
const CHANGED_REFUSED = draftEdit('C432-TEST-REFINE-WRITTEN: a file that changed since it was read is refused, and says so')
const FAILED_REPORTED = draftEdit('C432-TEST-REFINE-WRITTEN: a write that failed is reported failed, never executed')

const legs = [
  {
    id: 'K1', claim: 'ROUND-UNCONDITIONAL-IN-REFINE', instrument: 'refine', subject: 'packages/agent/src/authoring/refine.ts',
    // The trigger heuristic, written the way somebody would actually write it: after the retrieval,
    // as an early return that looks like an economy rather than a policy.
    operation: 'the refinement round is skipped when the first retrieval already returned facts',
    edits: [edit('  const request = buildTieredPrompt({\n    agent_context: AUTHORING_REFINE_AGENT_CONTEXT,',
      "  if (brief.facts.length > 0) return { kind: 'no-op', draft, thoughts: '' }\n\n  const request = buildTieredPrompt({\n    agent_context: AUTHORING_REFINE_AGENT_CONTEXT,")],
    reds: [refine('runs even when the FIRST retrieval already returned facts')],
    // Every cell that observes the round HAPPENING (the fixture brief is populated for all of them);
    // the three that never reach the model call stay green.
    allowed: [refine('is pinned at exactly one round, so the loop shape stays deterministic'),
      refine('shows the model the draft it is refining, not a fresh authoring brief alone'),
      refine('hands the parsed patch set to the CST applier port and continues with what it staged'),
      refine('keeps the draft when the emission is not JSON at all'),
      refine('keeps the draft when the emission is JSON that is not a patch set'),
      refine('keeps the draft when the applier REFUSES the patch set — the region fence reaching this round'),
      refine('keeps the draft when the patched document no longer parses')],
    greens: [refine('keys the second retrieval on the draft own steps and name'),
      refine('exports the query builder so the claim is checkable without reconstructing a prompt'),
      refine('accepts an EMPTY patch array as a valid outcome, and stages nothing for it')],
  },
  {
    id: 'K2', claim: 'ROUND-UNCONDITIONAL-AT-CALL-SITE', instrument: 'procedure', subject: 'packages/agent/src/authoring/loop.ts',
    operation: 'the refinement round is skipped at the loop call site, keyed on the stage-1 brief',
    edits: [edit('  const refinement = await refineDraft(compiled, input, deps)',
      "  const refinement = brief.procedures.length > 0 || brief.facts.length > 0\n    ? { kind: 'no-op' as const, draft: compiled, thoughts: '' }\n    : await refineDraft(compiled, input, deps)")],
    reds: [procedure('shows both stage-3 calls the vocabulary and neither of them the address')],
    allowed: [],
    greens: [procedure('renders NO record id, and that is structural rather than filtered'),
      procedure('writes bytes that contain no record identifier')],
  },
  {
    id: 'L1', claim: 'WEAK-MATCH-REFUSED', instrument: 'binding', subject: 'packages/agent/src/authoring/entity-binding.ts',
    operation: 'a lone weak match is bound instead of refused',
    edits: [edit("      case 'none':\n",
      "      case 'none':\n        if (resolution.closestSuggestion !== undefined) {\n          bindings.push({ name, source: 'resolver', ref: resolution.closestSuggestion })\n          break\n        }\n")],
    reds: [binding('does not promote closestSuggestion to a binding')],
    // The whole-set cell uses the same lone weak fixture to show a refusal is not partial.
    allowed: [binding('refuses the WHOLE set when one name of several cannot be bound')],
    // `resolved` still binds and `ambiguous` still refuses under the forbidden implementation.
    greens: [binding('binds a resolved descriptor and carries the identity its store reported'),
      binding('refuses with the candidate identities on the error, not merely with a message')],
  },
  {
    id: 'M1', claim: 'NO-RECORD-ID-RENDERED', instrument: 'procedure', subject: 'packages/agent/src/authoring/brief-blocks.ts',
    // `procedureStepVocabulary` has no id in scope, so the leak is written at the call site.
    operation: "the served procedure's record id is rendered into the prompt",
    edits: [edit('      (procedure) => `PROCEDURE: ${procedureStepVocabulary(procedure.flowAnchor)}`,',
      "      (procedure) => 'PROCEDURE: [' + String(procedure.id) + '] ' + procedureStepVocabulary(procedure.flowAnchor),")],
    reds: [procedure('renders NO record id, and that is structural rather than filtered')],
    // Every cell that scans the rendered knowledge block for the address.
    allowed: [procedure('renders the flow anchor own words in the knowledge block'),
      procedure('shows both stage-3 calls the vocabulary and neither of them the address')],
    greens: [procedure('writes bytes that contain no record identifier')],
  },
  {
    id: 'S1', claim: 'REFINE-WRITE-GUARDED-BY-DIGEST', instrument: 'edit', subject: 'packages/agent/src/functions/ops/authoring-draft-edit.ts',
    operation: 'the edit is written over the file without the digest it read',
    edits: [edit('      targetPath: identity.filePath,\n      sourceDigest: resolution.draft.contentDigest,\n    })\n',
      '      targetPath: identity.filePath,\n    })\n')],
    reds: [WRITTEN_OVER_READ],
    allowed: [],
    greens: [CHANGED_REFUSED, FAILED_REPORTED],
  },
  {
    id: 'S2', claim: 'REFINE-REFUSAL-NOT-CLAIMED', instrument: 'edit', subject: 'packages/agent/src/functions/ops/authoring-draft-edit.ts',
    operation: 'a refused write still points the answer at the file it did not write',
    edits: [edit('    const draftRef = written.kind === \'written\'\n      ? { ...stagedRef, filePath: written.filePath }\n      : stagedRef\n',
      '    const draftRef = { ...stagedRef, filePath: identity.filePath }\n')],
    reds: [CHANGED_REFUSED],
    allowed: [],
    greens: [WRITTEN_OVER_READ],
  },
]

runGate({
  slug: '394-refinement-mutation', envPrefix: 'REFINEMENT_MUTATION',
  instruments, legs, expectedLegs: 6, explicitIds: true, parseCheck: true, banner: 'REFINEMENT_MUTATION_OK',
})
NODE
