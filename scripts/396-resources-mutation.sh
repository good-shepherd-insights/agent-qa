#!/usr/bin/env bash
#
# 396-resources-mutation.sh — the acceptance bar for D-13's entity Resource Templates (396-03; rebuilt
# 2026-10-02 by 432-45 on the shared 423 engine for D-12).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. `resources.test.ts` passing says the
# handler resolved a URI and registered five templates. It does NOT say those cells would CATCH the
# implementations D-13 forbids. Each leg is a simplification a reasonable person would write, and
# each must red its OWN named cell:
#
#   R1  the codec replaced by a LOCAL agentqa:// regex that splits segment from id — the second,
#       weaker reading of a caller-supplied string T-396-08 forbids.
#   R2  a sixth template planted in the derived list — the "derived, never restated" claim.
#   R3  CARRIED 2026-10-02 (432-45). This leg removed the D-05 visibility gate; 432-20 (D-12) shipped
#       exactly that removal. The claim is now its opposite — registration is a fact about the
#       composition, never the caller — so R3 plants a caller-scope gate BACK and must red
#       C432-RESOURCES-ALL-CALLERS.
#   R4  the masker severed where the card is masked (T-396-07, the success channel).
#   R5  the raw URI passed to the op as `ref` instead of the parsed canonical short-ID.
#   R6  maskText dropped from the OP-refusal path.
#   R7  maskText dropped from the URI-refusal path (first measured GREEN in 2026-08; the cell exists
#       because of that).
#   R8  NEW (432-45, D-12): a legacy declaration's scope list gates registration again.
#
# A GREEN SUITE UNDER ANY LEG IS A FAILURE OF THIS SCRIPT, NOT A PASS; so is a runner error, a load
# failure, a different selected count or a red without its named cell. Co-reds were measured by
# planting every leg once (432-45) and are listed per leg with the reason.
#
# NO DIST REBUILD: the subject (`packages/mcp/src/resources.ts`) and its suite live in the same package
# and vitest resolves the import from source.
#
# THE ONE-PARSER GREPS (unchanged in kind): resources.ts constructs or executes no pattern of its own,
# hand-parses no string, and calls the codec's `parseEntityUri` exactly once. R1 moves the first from
# 0 to 1 and the third from 1 to 0, so the greps discriminate.
#
# Engine, arrival proof, counted selection, byte-exact restoration and positive controls:
# scripts/423-mutation-engine.cjs.
#
# USAGE
#   bash agent-qa/scripts/396-resources-mutation.sh   # from the super-repository root
#   bash scripts/396-resources-mutation.sh            # from the agent-qa root
#
# KNOBS — RESOURCES_MUTATION_SELFTEST (the knob this script always had)
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal | SIGINT | SIGTERM | SIGHUP   own every subject, then interrupt; every byte is handed back
# RESOURCES_MUTATION_LEG=R1..R8 runs one leg; RESOURCES_MUTATION_LIST=1 prints the inventory.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ "${RESOURCES_MUTATION_LIST:-}" != "1" ]]; then
  SUBJECT=packages/mcp/src/resources.ts
  regexes="$(grep -cE 'new RegExp|RegExp\(|/\^agentqa|\.exec\(|\.match\(' "$SUBJECT" || true)"
  handrolled="$(grep -cE '\.split\(|\.slice\(|\.substring\(|\.indexOf\(|\.startsWith\(|\.endsWith\(|\.replace' "$SUBJECT" || true)"
  codec="$(grep -cE 'parseEntityUri\(' "$SUBJECT" || true)"
  [[ "$regexes" == "0" ]]    || { echo "FATAL: resources.ts constructs or executes a pattern of its own ($regexes)" >&2; exit 1; }
  [[ "$handrolled" == "0" ]] || { echo "FATAL: resources.ts hand-parses a string ($handrolled)" >&2; exit 1; }
  [[ "$codec" == "1" ]]      || { echo "FATAL: expected exactly one parseEntityUri call site, saw $codec" >&2; exit 1; }
  echo "one-parser greps: regex construction 0 · hand-parsing 0 · parseEntityUri call sites 1"
fi

exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const SUBJECT = 'packages/mcp/src/resources.ts'
const SUITE = 'src/__tests__/resources.test.ts'

// Count measured from a fresh Vitest JSON report of exactly this file (2026-10-02, 432-45).
const instruments = {
  resources: { pkg: 'packages/mcp', files: [SUITE], typecheck: false, count: 17 },
}

const edit = (from, to) => ({ from, to })
const res = (name, message) => cell('resources', SUITE, name, 1, message)

const DERIVED = res('the five templates are derived, not restated (D-13) > is exactly one template per entity kind, in the vocabulary order')
const LITERAL = res('the five templates are derived, not restated (D-13) > pins the five URI templates literally')
const DISTINCT = res('the five templates are derived, not restated (D-13) > names each template distinctly, so no registration overwrites another')
const ONCE = res('the read handler resolves through entities.get (D-13 · D-02) > calls entities.get once, with the parsed canonical short-ID as the ref')
const ANSWER = res('the read handler resolves through entities.get (D-13 · D-02) > answers the card as one JSON content, addressed by its canonical URI')
const MASK_CARD = res('the read handler resolves through entities.get (D-13 · D-02) > masks the card and hands the masker its RAW string leaves, never an escaped serialisation')
const MASK_REFUSAL = res('the read handler resolves through entities.get (D-13 · D-02) > masks an op refusal rather than letting it out verbatim')
const MASK_URI = res('the read handler resolves through entities.get (D-13 · D-02) > masks the echoed URI when the codec refuses it')
const DISAGREE = res('the codec is the only parser (D-13 · T-396-08) > refuses a URI whose segment and id disagree, without asking the op')
const UNKNOWN = res('the codec is the only parser (D-13 · T-396-08) > refuses an unknown segment and a malformed id the same way')
const TRAILING = res('the codec is the only parser (D-13 · T-396-08) > refuses a trailing path segment')
const REGISTERS_READ = res('registration is a fact about the composition, never the caller (432-20, D-12) > registers all five templates for a caller granted read')
const ALL_CALLERS = res('registration is a fact about the composition, never the caller (432-20, D-12) > C432-RESOURCES-ALL-CALLERS: registers the same five templates for every caller')
const LEGACY_SCOPES = res('registration is a fact about the composition, never the caller (432-20, D-12) > ignores any scope a legacy declaration might still carry')
const NO_ENTITIES = res('registration is a fact about the composition, never the caller (432-20, D-12) > registers nothing when the composition does not carry entities.get')
const SDK = res('a real v2 McpServer accepts this registration (the SDK cell) > registers all five templates on a real McpServer without adaptation')
const WIRED = res('the registered handler really crosses invokeFunction (the wiring cell) > routes the registered read through invokeFunction on entities.get')

const DECLARATION_FOUND = '  if (declaration === undefined) return []\n'

const legs = [
  {
    id: 'R1', claim: 'ONE-PARSER', instrument: 'resources', subject: SUBJECT,
    operation: 'the codec replaced by a local agentqa:// regex that splits segment from id',
    edits: [edit('    const parsed = parseEntityUri(uri.href)\n',
      '    const match = /^agentqa:\\/\\/([a-z]+)\\/([^/]+)$/u.exec(uri.href)\n'
      + '    const localSegment = match?.[1]\n'
      + '    const localKind = ENTITY_KINDS.find((c) => ENTITY_URI_SEGMENTS[c] === localSegment)\n'
      + '    const parsed =\n'
      + '      match === null || localKind === undefined\n'
      + '        ? undefined\n'
      + "        : { kind: localKind, shortId: match[2] ?? '' }\n")],
    reds: [DISAGREE],
    // The local regex accepts an id the codec refuses, so the op is asked about it (ONCE), the unknown
    // segment / malformed id cell sees the same, and a hostile URI never reaches the masked URI
    // refusal (measured 2026-10-02: the same four as 2026-08-16).
    allowed: [UNKNOWN, MASK_URI, ONCE],
    greens: [TRAILING, ANSWER, DERIVED, ALL_CALLERS, MASK_CARD, MASK_REFUSAL],
  },
  {
    id: 'R2', claim: 'DERIVED-NOT-RESTATED', instrument: 'resources', subject: SUBJECT,
    operation: 'a sixth template planted in the derived list',
    edits: [edit('  ENTITY_KINDS.map(templateFor)\n',
      '  ENTITY_KINDS.map(templateFor).concat([\n'
      + '    {\n'
      + "      kind: 'MEM',\n"
      + "      segment: 'note',\n"
      + "      name: 'agent_qa_entity_note',\n"
      + "      uriTemplate: 'agentqa://note/{id}',\n"
      + "      title: 'agent-qa note entity',\n"
      + "      description: 'The entity card for one note.',\n"
      + '    },\n'
      + '  ])\n')],
    reds: [DERIVED],
    // Every cell that counts the registered templates sees six (measured 2026-10-02).
    allowed: [LITERAL, REGISTERS_READ, ALL_CALLERS, LEGACY_SCOPES, SDK],
    greens: [DISTINCT, DISAGREE, MASK_CARD, ONCE],
  },
  {
    id: 'R3', claim: 'C432-RESOURCES-ALL-CALLERS', instrument: 'resources', subject: SUBJECT,
    operation: 'a caller-scope gate returns: only a caller holding read gets the templates',
    edits: [edit(DECLARATION_FOUND, DECLARATION_FOUND
      + "  if ((deps.caller as { readonly grantedScopes?: readonly string[] }).grantedScopes?.includes('read') !== true) return []\n")],
    reds: [ALL_CALLERS],
    // The legacy-declaration cell registers for a caller granted nothing (measured 2026-10-02).
    allowed: [LEGACY_SCOPES],
    greens: [REGISTERS_READ, NO_ENTITIES, SDK, WIRED, DERIVED, DISAGREE, MASK_CARD],
  },
  {
    id: 'R4', claim: 'CARD-MASKED', instrument: 'resources', subject: SUBJECT,
    operation: 'the masker severed where the card is masked',
    edits: [edit('    const masked = maskJsonDocument(card, deps.maskText)\n', '    const masked = maskJsonDocument(card, (text) => text)\n')],
    reds: [MASK_CARD],
    allowed: [],
    greens: [MASK_REFUSAL, MASK_URI, ANSWER, ONCE, ALL_CALLERS],
  },
  {
    id: 'R5', claim: 'PARSE-LOAD-BEARING', instrument: 'resources', subject: SUBJECT,
    operation: 'the raw URI passed to the op as ref instead of the parsed canonical short-ID',
    edits: [edit('      card = await deps.invoke(ENTITIES_GET_OP_ID, { ref: parsed.shortId })\n',
      '      card = await deps.invoke(ENTITIES_GET_OP_ID, { ref: uri.href })\n')],
    reds: [ONCE],
    allowed: [],
    greens: [ANSWER, MASK_CARD, DISAGREE, ALL_CALLERS],
  },
  {
    id: 'R6', claim: 'OP-REFUSAL-MASKED', instrument: 'resources', subject: SUBJECT,
    operation: 'maskText dropped from the op-refusal path',
    edits: [edit('        deps.maskText(err instanceof Error ? err.message : String(err)),\n',
      '        err instanceof Error ? err.message : String(err),\n')],
    reds: [MASK_REFUSAL],
    allowed: [],
    greens: [MASK_CARD, MASK_URI, ONCE, ALL_CALLERS],
  },
  {
    id: 'R7', claim: 'URI-REFUSAL-MASKED', instrument: 'resources', subject: SUBJECT,
    operation: 'maskText dropped from the URI-refusal path',
    edits: [edit('      throw new EntityResourceUriError(deps.maskText(uri.href))\n', '      throw new EntityResourceUriError(uri.href)\n')],
    reds: [MASK_URI],
    allowed: [],
    greens: [MASK_CARD, MASK_REFUSAL, DISAGREE, ALL_CALLERS],
  },
  {
    id: 'R8', claim: 'LEGACY-SCOPES-IGNORED', instrument: 'resources', subject: SUBJECT,
    operation: "a legacy declaration's scope list gates registration again",
    edits: [edit(DECLARATION_FOUND, DECLARATION_FOUND
      + "  if ((declaration as { readonly requiredScopes?: readonly string[] }).requiredScopes?.includes('config-write') === true) return []\n")],
    reds: [LEGACY_SCOPES],
    allowed: [],
    greens: [ALL_CALLERS, REGISTERS_READ, NO_ENTITIES, SDK, WIRED],
  },
]

runGate({
  slug: '396-resources-mutation', envPrefix: 'RESOURCES_MUTATION',
  instruments, legs, expectedLegs: 8, explicitIds: true, parseCheck: true, banner: 'RESOURCES_MUTATION_OK',
})
NODE
