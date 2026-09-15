#!/usr/bin/env bash
# 423-evidence-mutation.sh — the teeth behind Phase 423's evidence closed sets, terminal
# finalization, masking and blob writer (423-22, CONTEXT "v54 bar").
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 423 declared six evidence
# vocabularies (kinds, absence reasons, ref prefixes, present/absent arms, credential headers and
# body content types) and five behaviours whose failure is silent: the member's terminal enrichment,
# the live ARIA mask, the body byte bound, honest absence for a missing blob, and an atomic blob
# publication. Every one of them is pinned by a named cell, and a pin has a failure mode a passing
# suite cannot show — agreeing with a constant it derived from, or naming a cell nothing executes.
# So each leg plants ONE semantic mutation in the production source, runs the cell's own suite, and
# requires exactly the RED declared below: the named cells fail, the GREEN controls hold, nothing
# outside REQUIRED + ALLOWED fails, and the restored tree is green again.
#
# THE CLOSED-SET LEGS MOVE BOTH HALVES AT ONCE. Each widens (or, for the credential headers,
# narrows — the dangerous direction) the literal list AND its union together, exactly as a real
# edit would. The runtime cell and the `.test-d.ts` never-bar must BOTH red, and the type RED only
# counts when a TypeCheckError points into the `.test-d.ts` itself.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:423-evidence-mutation                 # from the agent-qa root
#   bash agent-qa/scripts/423-evidence-mutation.sh          # from the super-repository root
#
# KNOBS — AGENT_QA_423_EVIDENCE_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_423_EVIDENCE_MUTATION_LEG=E01..E16 runs one leg (normal or neutered runs only).
# AGENT_QA_423_EVIDENCE_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24 and workspace tools are required. No downloads or provider calls. Ends with a
# forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const EVIDENCE = 'packages/schema/src/run/evidence.ts'
const REFS = 'packages/schema/src/ids/artifact-ref.ts'
const FINALIZER = 'packages/runner/src/run/step-read-finalization.ts'
const ARIA = 'packages/runner/src/loop/evidence.ts'
const POLICY = 'packages/runner/src/run/network-evidence-policy.ts'
const READ = 'packages/agent/src/functions/ops/runs-evidence.ts'
const STORE = 'packages/runner-local/src/evidence-artifact-store.ts'
const COMPOSE = 'packages/agent-local/src/composition/compose-local-agent.ts'
const MEMBER = 'packages/runner/src/run/member-runner.ts'

const RT = 'src/__tests__/423-read-contracts.test.ts'
const TD = 'src/__tests__/423-read-contracts.test-d.ts'
const FIN = 'src/run/__tests__/423-read-finalization.test.ts'
const ARIA_T = 'src/loop/__tests__/423-aria-evidence.test.ts'
const POLICY_T = 'src/run/__tests__/423-network-policy.test.ts'
const READ_T = 'src/functions/__tests__/423-runs-evidence.test.ts'
const STORE_T = 'src/__tests__/423-json-evidence.test.ts'
const POSTURE_T = 'src/__tests__/423-production-read-posture.test.ts'

const instruments = {
  'schema-sets': { pkg: 'packages/schema', files: [RT, TD], typecheck: true, count: 20 },
  'runner-finalization': { pkg: 'packages/runner', files: [FIN], typecheck: false, count: 69 },
  'runner-aria': { pkg: 'packages/runner', files: [ARIA_T], typecheck: false, count: 11 },
  'runner-policy': { pkg: 'packages/runner', files: [POLICY_T], typecheck: false, count: 5 },
  'agent-read': { pkg: 'packages/agent', files: [READ_T], typecheck: false, count: 38 },
  'store': { pkg: 'packages/runner-local', files: [STORE_T], typecheck: false, count: 10 },
  'cli-read-posture': { pkg: 'packages/cli', files: [POSTURE_T], typecheck: false, count: 3, env: { VITEST_MAX_WORKERS: '1' } },
}

const s = (file, name, count) => cell('schema-sets', file, name, count)
const fin = name => cell('runner-finalization', FIN, name)
const aria = name => cell('runner-aria', ARIA_T, name)
const posture = name => cell('cli-read-posture', POSTURE_T, name)
const read = name => cell('agent-read', READ_T, name)
const ALL_SETS_RT = ['C423-HEADERS-EXACT', 'C423-CONTENT-TYPES-EXACT', 'C423-KINDS-EXACT', 'C423-ABSENCE-EXACT', 'C423-REFS-EXACT']
const setGreens = (...moved) => [
  ...ALL_SETS_RT.filter(name => !moved.includes(name)).map(name => s(RT, name)),
  ...ALL_SETS_RT.filter(name => !moved.includes(name)).map(name => s(TD, name)),
  s(RT, 'C423-VARIABLES preserves all sources and rejects invented source'),
]

const legs = [
  {
    subject: EVIDENCE, instrument: 'schema-sets', claim: 'C423-KINDS-EXACT', operation: 'widen EvidenceKind and EVIDENCE_KINDS with video',
    edits: [{
      from: "export type EvidenceKind = 'console' | 'network' | 'a11y' | 'aria' | 'variables'\nexport const EVIDENCE_KINDS = [\n  'console', 'network', 'a11y', 'aria', 'variables',\n] as const",
      to: "export type EvidenceKind = 'console' | 'network' | 'a11y' | 'aria' | 'variables' | 'video'\nexport const EVIDENCE_KINDS = [\n  'console', 'network', 'a11y', 'aria', 'variables', 'video',\n] as const",
    }],
    reds: [s(RT, 'C423-KINDS-EXACT'), s(TD, 'C423-KINDS-EXACT')],
    allowed: [s(TD, 'C423-PRESENCE-EXACT')],
    greens: setGreens('C423-KINDS-EXACT'),
  },
  {
    subject: EVIDENCE, instrument: 'schema-sets', claim: 'C423-ABSENCE-EXACT', operation: 'widen EvidenceAbsenceReason and EVIDENCE_ABSENCE_REASONS with expired',
    edits: [{
      from: "  | 'empty' | 'not-captured' | 'unsupported' | 'unavailable' | 'failed'\nexport const EVIDENCE_ABSENCE_REASONS = [\n  'empty', 'not-captured', 'unsupported', 'unavailable', 'failed',\n]",
      to: "  | 'empty' | 'not-captured' | 'unsupported' | 'unavailable' | 'failed' | 'expired'\nexport const EVIDENCE_ABSENCE_REASONS = [\n  'empty', 'not-captured', 'unsupported', 'unavailable', 'failed', 'expired',\n]",
    }],
    reds: [s(RT, 'C423-ABSENCE-EXACT'), s(TD, 'C423-ABSENCE-EXACT')],
    allowed: [],
    greens: setGreens('C423-ABSENCE-EXACT'),
  },
  {
    subject: REFS, instrument: 'schema-sets', claim: 'C423-REFS-EXACT', operation: 'widen EvidenceRefPrefix and EVIDENCE_REF_PREFIXES with a variables blob prefix',
    edits: [{
      from: "  | 'aria-state:'\n\nexport const EVIDENCE_REF_PREFIXES = [\n  'decision-screenshot:',\n  'console-evidence:',\n  'network-evidence:',\n  'a11y-evidence:',\n  'aria-state:',\n]",
      to: "  | 'aria-state:'\n  | 'variables:'\n\nexport const EVIDENCE_REF_PREFIXES = [\n  'decision-screenshot:',\n  'console-evidence:',\n  'network-evidence:',\n  'a11y-evidence:',\n  'aria-state:',\n  'variables:',\n]",
    }],
    reds: [s(RT, 'C423-REFS-EXACT'), s(TD, 'C423-REFS-EXACT')],
    allowed: [],
    greens: setGreens('C423-REFS-EXACT'),
  },
  {
    subject: EVIDENCE, instrument: 'schema-sets', claim: 'C423-PRESENCE-EXACT', operation: 'let the absent arm carry counts',
    edits: [{
      from: "  kind: EvidenceKindSchema, state: z.literal('absent'), reason: EvidenceAbsenceReasonSchema,\n",
      to: "  kind: EvidenceKindSchema, state: z.literal('absent'), reason: EvidenceAbsenceReasonSchema,\n  counts: z.record(z.string(), count).optional(),\n",
    }],
    reds: [s(RT, 'C423-PRESENCE-EXACT rejects absent counts while valid absence parses'), s(TD, 'C423-PRESENCE-EXACT')],
    allowed: [],
    greens: setGreens(),
  },
  {
    subject: EVIDENCE, instrument: 'schema-sets', claim: 'C423-HEADERS-EXACT', operation: 'drop x-xsrf-token from the credential header denylist',
    edits: [{
      from: "  | 'x-auth-token' | 'x-access-token' | 'x-csrf-token' | 'x-xsrf-token'\nexport const NETWORK_CREDENTIAL_HEADERS = [\n  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key',\n  'x-auth-token', 'x-access-token', 'x-csrf-token', 'x-xsrf-token',\n]",
      to: "  | 'x-auth-token' | 'x-access-token' | 'x-csrf-token'\nexport const NETWORK_CREDENTIAL_HEADERS = [\n  'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key',\n  'x-auth-token', 'x-access-token', 'x-csrf-token',\n]",
    }],
    reds: [s(RT, 'C423-HEADERS-EXACT'), s(TD, 'C423-HEADERS-EXACT')],
    allowed: [],
    greens: setGreens('C423-HEADERS-EXACT'),
  },
  {
    subject: EVIDENCE, instrument: 'schema-sets', claim: 'C423-CONTENT-TYPES-EXACT', operation: 'admit application/javascript bodies',
    edits: [{
      from: "  | 'text/xml' | 'application/x-www-form-urlencoded'\nexport const NETWORK_BODY_CONTENT_TYPES = [\n  'application/json', 'text/html', 'text/plain', 'application/xml', 'text/xml',\n  'application/x-www-form-urlencoded',\n]",
      to: "  | 'text/xml' | 'application/x-www-form-urlencoded' | 'application/javascript'\nexport const NETWORK_BODY_CONTENT_TYPES = [\n  'application/json', 'text/html', 'text/plain', 'application/xml', 'text/xml',\n  'application/x-www-form-urlencoded', 'application/javascript',\n]",
    }],
    reds: [s(RT, 'C423-CONTENT-TYPES-EXACT'), s(TD, 'C423-CONTENT-TYPES-EXACT')],
    allowed: [],
    greens: setGreens('C423-CONTENT-TYPES-EXACT'),
  },
  {
    subject: FINALIZER, instrument: 'runner-finalization', claim: 'EVID-WEB-PRESENT', operation: "publish the member terminal without the console capture's enrichment",
    edits: [{
      from: '      console: consoleEvidence,\n',
      to: "      console: { kind: 'console', state: 'absent', reason: 'not-captured' },\n",
    }],
    reds: [cell('runner-finalization', FIN, 'EVID-WEB-PRESENT')],
    allowed: [
      'EVID-ABORT-DURING: an interrupted active console poll is failed, not an empty capture',
      'EVID-BYPASS-TERMINAL: appium produces one started terminal with final status',
      'EVID-FAILED', 'EVID-MOBILE-SCOPE: device logs remain captured while browser evidence is unsupported',
      'EVID-UNBOUND', 'EVID-ZERO',
    ].map(name => fin(name)),
    greens: ['VARIABLE-FINAL', 'VARIABLE-SOURCES', 'NETWORK-COUNTS', 'NETWORK-MULTIPAGE', 'EVID-A11Y-PRESENT', 'EVID-ONCE'].map(name => fin(name)),
  },
  {
    subject: ARIA, instrument: 'runner-aria', claim: 'ARIA-LIVE-MASK', operation: 'persist the before tree without the live run mask',
    edits: [{
      from: "      schemaVersion: 1, kind: 'aria', tree: masking.mask(evidence.stateBefore.tree),\n",
      to: "      schemaVersion: 1, kind: 'aria', tree: evidence.stateBefore.tree,\n",
    }],
    reds: [cell('runner-aria', ARIA_T, 'ARIA-LIVE-MASK')],
    allowed: [
      'ARIA-REF-APPEND', 'ARIA-ROTATED-SECRET',
      'ARIA-WRITE-FAILED: mask retains the action and screenshot with failed evidence', 'EVID-MOBILE-TREE',
    ].map(name => aria(name)),
    greens: [
      ...['write', 'missing-mask', 'missing-store', 'invalid-ref'].map(failure =>
        aria(`ARIA-WRITE-FAILED: ${failure} retains the action and screenshot with failed evidence`)),
      aria('ARIA-EMPTY'),
    ],
  },
  {
    subject: POLICY, instrument: 'runner-policy', claim: 'BODY-BYTES', operation: 'remove the captured-body byte filter',
    edits: [{
      from: '  if (!bodyContentTypes.has(type) || utf8Encode(body).length > NETWORK_BODY_MAX_BYTES) return undefined\n',
      to: '  if (!bodyContentTypes.has(type)) return undefined\n',
    }],
    reds: [cell('runner-policy', POLICY_T, 'BODY-BYTES')],
    allowed: [],
    greens: ['HEADER-CASE', 'BODY-TYPE', 'BODY-REQUEST-INDEPENDENT', 'DATA-URI-OMITTED'].map(name => cell('runner-policy', POLICY_T, name)),
  },
  {
    subject: READ, instrument: 'agent-read', claim: 'EVID-MISSING-BLOB', operation: 'answer a missing blob as plain unavailable, dropping evidenceIncomplete',
    edits: [{
      from: "      if (lookup.status === 'blob_absent') return absent('unavailable', true)\n",
      to: "      if (lookup.status === 'blob_absent') return absent('unavailable')\n",
    }],
    reds: [cell('agent-read', READ_T, 'EVID-MISSING-BLOB')],
    allowed: [],
    greens: [
      cell('agent-read', READ_T, 'EVID-BAD-BLOB', 6), cell('agent-read', READ_T, 'EVIDENCE-SHA-MISMATCH'),
      cell('agent-read', READ_T, 'EVIDENCE-MASK'),
      cell('agent-read', READ_T, 'console absent preserves capture-time reason without reading bytes'),
    ],
  },
  {
    subject: STORE, instrument: 'store', claim: 'CONCURRENT-BLOB', operation: 'write the blob in place instead of publishing a complete temporary by rename',
    edits: [
      { from: "    const fd = openSync(temporary, 'wx', 0o600)\n", to: "    const fd = openSync(target, 'w', 0o600)\n" },
      { from: '      renameSync(temporary, target)\n', to: '' },
    ],
    reds: [cell('store', STORE_T, 'CONCURRENT-BLOB')],
    allowed: [
      'INTERRUPTED-BLOB: partial write failure never publishes a successful ref or target',
      'INTERRUPTED-BLOB: sync failure at stage 1 never returns a successful reference',
    ].map(name => cell('store', STORE_T, name)),
    greens: [
      ...['MASK-BEFORE-HASH', 'DEDUP', 'JSON-KINDS', 'DURABLE-PARENTS'].map(name => cell('store', STORE_T, name)),
      cell('store', STORE_T, 'INTERRUPTED-BLOB: sync failure at stage 2 never returns a successful reference'),
    ],
  },
  {
    // The production host reaches runs.evidence only through the rebuilt agent-local dist.
    subject: COMPOSE, instrument: 'cli-read-posture', claim: 'COLD-EVIDENCE-HOST', operation: 'drop runs.evidence from the cold read-scope allowlist',
    crossing: { pkg: '@vostride/agent-qa-agent-local', dir: 'packages/agent-local', marker: 'evidence423allowlist' },
    edits: [{
      from: "const COLD_READ_SCOPE_FUNCTION_IDS = [\n  'runs.postprocessing', 'runs.knowledge', 'runs.evidence',\n] as const",
      to: "const COLD_READ_SCOPE_FUNCTION_IDS = [\n  'runs.postprocessing', 'runs.knowledge', 'evidence423allowlist',\n] as const",
    }],
    reds: [posture('COLD-EVIDENCE-HOST')],
    allowed: [posture('COLD-EVIDENCE-HTTP')],
    greens: [posture('COLD-EVIDENCE-UNAVAILABLE')],
  },
  {
    subject: READ, instrument: 'agent-read', claim: 'EVIDENCE-MASK-NO-CONTEXT', operation: 'answer a no-context read by masking every string with the shared secret marker instead of the typed masking-unavailable arm',
    edits: [{
      from: "    if (context === undefined) return error('masking-unavailable', capture)\n    try {\n      const mask: MaskFn = text => context.mask(text)\n",
      to: "    try {\n      const mask: MaskFn = context === undefined ? () => '\u241fmasked:secret\u241f' : text => context.mask(text)\n",
    }],
    reds: [read('EVIDENCE-MASK-NO-CONTEXT')],
    allowed: [],
    greens: [
      ...['console', 'network', 'a11y', 'aria', 'variables'].map(kind =>
        read(`EVIDENCE-ALL-KINDS > ${kind} present returns its validated recorded document`)),
      read('EVIDENCE-MULTI-KEY'),
    ],
  },
  {
    subject: MEMBER, instrument: 'runner-finalization', claim: 'EVID-TIMEOUT-NAVIGATE', operation: 'discard the navigation timeout result instead of recording it',
    edits: [{
      from: "      if (aborted.status === 'failed') recordBeforeStart(0, 'Navigate to test URL', aborted)\n",
      to: '',
    }],
    reds: [fin('EVID-TIMEOUT-NAVIGATE')],
    allowed: [],
    greens: [fin('EVID-TIMEOUT'), cell('runner-finalization', FIN, 'EVID-ABORT-BEFORE', 4), fin('EVID-TIMEOUT-DEADLINE')],
  },
  {
    subject: MEMBER, instrument: 'runner-finalization', claim: 'EVID-TIMEOUT-DEADLINE', operation: 'break on the between-steps deadline without recording a row',
    edits: [{
      from: "      recordBeforeStart(stepIndex, rawInstruction, createTimeoutStepResult(rawInstruction, 'test', testTimeout))\n",
      to: '',
    }],
    reds: [fin('EVID-TIMEOUT-DEADLINE')],
    allowed: [],
    greens: [fin('EVID-TIMEOUT'), cell('runner-finalization', FIN, 'EVID-ABORT-BEFORE', 4), fin('EVID-TIMEOUT-NAVIGATE')],
  },
  {
    subject: MEMBER, instrument: 'runner-finalization', claim: 'EVID-CATCH-REDACTED', operation: 'record the catch-path result without the declared-secret redactor',
    edits: [{
      from: "        error: config.secretRedactor ? config.secretRedactor.redactString(message) : message,\n      }) }\n      // completedExecution predates the normal path's redaction; nothing raw may be recorded.\n      result = redactSecretValue(result, config.secretRedactor)\n",
      to: "        error: message,\n      }) }\n",
    }],
    reds: [fin('EVID-CATCH-REDACTED')],
    allowed: [],
    greens: [fin('EVID-TIMEOUT'), cell('runner-finalization', FIN, 'EVID-ABORT-BEFORE', 4), fin('VARIABLE-MASK-NAMES')],
  },
]

runGate({
  slug: '423-evidence-mutation', envPrefix: 'AGENT_QA_423_EVIDENCE_MUTATION', idPrefix: 'E',
  instruments, legs, expectedLegs: 16, banner: 'EVIDENCE_MUTATION_OK',
})
NODE
