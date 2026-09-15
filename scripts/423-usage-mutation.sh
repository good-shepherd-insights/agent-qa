#!/usr/bin/env bash
# 423-usage-mutation.sh — provider authority and all-call accounting cannot silently regress
# (423-22, PXH-RUN-06).
#
# WHAT THIS PROVES, AND WHY A GREEN SUITE DOES NOT PROVE IT. Phase 423's usage contract has one
# rule that every leg below defends from a different side: a token count, a cache count or a
# responding model identity is published only when the PROVIDER reported it for EVERY attempt in
# the step's population. The SDK's normalized fields, the declared profile, a later successful
# retry, a neighbouring invocation and the cache-read subtotal are all plausible-looking sources
# that would each produce a confident, wrong number. So each leg plants the regression that would
# let one of them in, and requires its named cell to red while the listed controls hold.
#
# THE LEGS
#   U01  the raw-report cache guard falls back to the SDK's normalized cacheRead  -> USAGE-RAW-ABSENT
#   U02  a missing provider identity is filled from the declared profile          -> MODEL-SDK-FALLBACK
#   U03  post-loop extraction runs on the unscoped verifier model                 -> USAGE-EXTRACTION
#   U04  a failed provider attempt is dropped from the step population            -> USAGE-RETRY-FAILURE
#   U05  an invocation reads the scope's latest attempt instead of its own        -> USAGE-CONCURRENT
#   U06  the projection certifies totals from successes, skipping the failed try  -> USAGE-NO-DOUBLE-COUNT
#        (dist-crossing: the schema dist is rebuilt so the cold dashboard roundtrip reads it)
#   U07  the persisted role record admits a third, unconfigured healer role        -> C423-MODEL-ROLES-EXACT
#   U08  the observation event union and list widen with a retry arm              -> C423-OBSERVATION-EXACT
#   U09  cache reads are added on top of the already-inclusive input total        -> INPUT-SAMPLE-POPULATION
#
# U06 AND U09 SPLIT ONE PLANNED LEG ON PURPOSE. The plan names "cached double-add" against
# USAGE-NO-DOUBLE-COUNT. Measured against the cell, its scenario is a failed retry whose population
# can certify NO totals at all, so a literal cache-into-input add cannot reach it — the population
# gate hides every total first. U06 therefore plants the regression that cell actually guards (a
# later success re-certifying the population as if the failed attempt never happened, cache
# included), and U09 keeps the literal double-add, measured by the schema cell that owns it.
#
# Engine, arrival proof, counted selection and restoration: scripts/423-mutation-engine.cjs.
#
# USAGE
#   pnpm run validate:423-usage-mutation                 # from the agent-qa root
#   bash agent-qa/scripts/423-usage-mutation.sh          # from the super-repository root
#
# KNOBS — AGENT_QA_423_USAGE_MUTATION_SELFTEST
#   neutered  apply NO mutation; the run must FATAL with "<leg>: suite stayed green"
#   fatal     mutate every subject, then throw; every subject must be restored
#   SIGINT | SIGTERM | SIGHUP   the same, then deliver that signal to itself
# AGENT_QA_423_USAGE_MUTATION_LEG=U01..U09 runs one leg (normal or neutered runs only).
# AGENT_QA_423_USAGE_MUTATION_LIST=1 prints the declared inventory and exits.
#
# Installed Node 24 and workspace tools are required. No downloads or provider calls. Ends with a
# forced workspace build whenever a byte was mutated.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const REPORT = 'packages/model/src/provider-call-report.ts'
const REGISTRY = 'packages/model/src/registry.ts'
const MEMBER = 'packages/runner/src/run/member-runner.ts'
const SCOPE = 'packages/runner/src/run/step-model-observations.ts'
const USAGE = 'packages/schema/src/run/model-usage.ts'

const AUTH = 'src/__tests__/423-usage-authority.test.ts'
const AUTH_D = 'src/__tests__/423-usage-authority.test-d.ts'
const COVER = 'src/run/__tests__/423-usage-coverage.test.ts'
const COLD = 'src/__tests__/423-read-migration.test.ts'
const ROLES = 'src/__tests__/423-model-usage.test.ts'
const ROLES_D = 'src/__tests__/423-model-usage.test-d.ts'

const instruments = {
  'model-authority': { pkg: 'packages/model', files: [AUTH], typecheck: false, count: 54 },
  'model-observation': { pkg: 'packages/model', files: [AUTH, AUTH_D], typecheck: true, count: 60 },
  'runner-coverage': { pkg: 'packages/runner', files: [COVER], typecheck: false, count: 23 },
  'dashboard-cold': { pkg: 'packages/dashboard-server', files: [COLD], typecheck: false, count: 20 },
  'schema-usage': { pkg: 'packages/schema', files: [ROLES, ROLES_D], typecheck: true, count: 18 },
}

const auth = (name, count) => cell('model-authority', AUTH, name, count)
const cover = (name, count) => cell('runner-coverage', COVER, name, count)

const legs = [
  {
    subject: REPORT, instrument: 'model-authority', claim: 'USAGE-RAW-ABSENT', operation: 'fall back to the normalized cacheRead when the raw report is silent',
    edits: [{
      from: '  const cachedInputTokens = rawCacheCount(result.usage, origin)\n',
      to: '  const cachedInputTokens = rawCacheCount(result.usage, origin) ?? count(result.usage.inputTokens.cacheRead)\n',
    }],
    reds: [cell('model-authority', AUTH, 'USAGE-RAW-ABSENT', 5)],
    allowed: [auth('MODEL-SDK-FALLBACK and CUSTOM-UNKNOWN reject normalized custom facts'), auth('USAGE-MALFORMED'), auth('CUSTOM-UNKNOWN')],
    greens: [auth('USAGE-RAW-ZERO', 5), auth('USAGE-RAW-NONZERO', 5), auth('INPUT-DENOMINATOR', 5),
      auth('MODEL-SDK-FALLBACK never fills absent provider-result identity', 5), auth('USAGE-RETRY-FAILURE', 2)],
  },
  {
    subject: REGISTRY, instrument: 'model-authority', claim: 'MODEL-SDK-FALLBACK', operation: 'fill an absent provider response with the declared profile identity',
    edits: [{
      from: "            observe({ kind: 'success', report: providerCallReport(result, origin) })\n",
      to: "            observe({ kind: 'success', report: providerCallReport(result.response === undefined ? { ...result, response: { modelId: profile.model } } : result, origin) })\n",
    }],
    reds: [cell('model-authority', AUTH, 'MODEL-SDK-FALLBACK never fills absent provider-result identity', 5)],
    allowed: [auth('USAGE-MALFORMED'), auth('MODEL-SDK-FALLBACK subscription')],
    greens: [auth('MODEL-REPORTED', 6), auth('MODEL-SAME-AS-DECLARED', 5), auth('USAGE-RAW-ABSENT', 5), auth('CUSTOM-UNKNOWN'),
      auth('MODEL-SDK-FALLBACK and CUSTOM-UNKNOWN reject normalized custom facts')],
  },
  {
    subject: MEMBER, instrument: 'runner-coverage', claim: 'USAGE-EXTRACTION', operation: 'run post-loop capture on the unscoped verifier model',
    edits: [{
      from: '        const extractor = makeExtractor(modelScope?.verifierModel ?? config.verifierModel, method)\n',
      to: '        const extractor = makeExtractor(config.verifierModel, method)\n',
    }],
    reds: [cell('runner-coverage', COVER, 'USAGE-EXTRACTION: post-loop capture reaches final facts and replaces legacy loop totals once')],
    allowed: [],
    greens: ['USAGE-EXTRACTION-FAILURE', 'USAGE-ALL-CALLS', 'USAGE-ASSERTION', 'USAGE-SCOPE-LIFETIME', 'USAGE-RETRY-FAILURE'].map(name => cover(name)),
  },
  {
    subject: SCOPE, instrument: 'runner-coverage', claim: 'USAGE-RETRY-FAILURE', operation: 'drop a failed provider attempt from the step population',
    edits: [{
      from: '        } else if (active) {\n          active.kind = event.kind\n',
      to: "        } else if (active && event.kind === 'failure') {\n          attempts.splice(attempts.indexOf(active), 1)\n          active = undefined\n        } else if (active) {\n          active.kind = event.kind\n",
    }],
    reds: [cell('runner-coverage', COVER, 'USAGE-RETRY-FAILURE')],
    allowed: [cover('MIXED-COVERAGE-INCOMPLETE'), cover('USAGE-EXTRACTION-FAILURE')],
    greens: [...['USAGE-ALL-CALLS', 'USAGE-CONCURRENT', 'USAGE-EXTRACTION', 'ZERO-CALL'].map(name => cover(name)),
      cover('MIXED-COVERAGE-INVALID', 6)],
  },
  {
    subject: SCOPE, instrument: 'runner-coverage', claim: 'USAGE-CONCURRENT', operation: "answer an invocation's identity from the scope's latest attempt",
    edits: [{
      from: "        respondingModelId: () => last?.kind === 'success'\n          ? last.report?.respondingModelId : undefined,\n",
      to: "        respondingModelId: () => attempts.at(-1)?.kind === 'success'\n          ? attempts.at(-1)?.report?.respondingModelId : undefined,\n",
    }],
    reds: [cell('runner-coverage', COVER, 'USAGE-CONCURRENT')],
    allowed: [],
    greens: [...['USAGE-ALL-CALLS', 'USAGE-RETRY-FAILURE', 'USAGE-EXTRACTION', 'USAGE-ISOLATION'].map(name => cover(name)),
      cover('MODEL-SDK-FALLBACK', 3)],
  },
  {
    subject: USAGE, instrument: 'dashboard-cold', claim: 'USAGE-NO-DOUBLE-COUNT', operation: 'certify totals from successful attempts, skipping the failed retry',
    crossing: { pkg: '@vostride/agent-qa-schema', dir: 'packages/schema', marker: 'counted423' },
    edits: [
      { from: '  const complete = attempts.length > 0 && attempts.every(attempt =>\n',
        to: "  const counted423 = attempts.filter(attempt => attempt.kind !== 'failure')\n  const complete = counted423.length > 0 && counted423.every(attempt =>\n" },
      { from: '  const input = complete ? attempts.reduce(', to: '  const input = complete ? counted423.reduce(' },
      { from: '  const output = complete ? attempts.reduce(', to: '  const output = complete ? counted423.reduce(' },
      { from: '  const cached = measured && attempts.every(', to: '  const cached = measured && counted423.every(' },
      { from: '    ? attempts.reduce((sum, item) => sum + item.report!.cachedInputTokens!, 0) : undefined',
        to: '    ? counted423.reduce((sum, item) => sum + item.report!.cachedInputTokens!, 0) : undefined' },
    ],
    reds: [cell('dashboard-cold', COLD, 'USAGE-NO-DOUBLE-COUNT')],
    allowed: [],
    greens: ['USAGE-COLD-ROUNDTRIP', 'USAGE-EXTRACTION-FINAL', 'USAGE-RAW-ABSENT', 'USAGE-LEGACY-UNSCOPED', 'HISTORICAL-USAGE-ABSENT']
      .map(name => cell('dashboard-cold', COLD, name)),
  },
  {
    subject: USAGE, instrument: 'schema-usage', claim: 'C423-MODEL-ROLES-EXACT', operation: 'widen the persisted role record with a healer role',
    edits: [{
      from: '  roles: z.object({ planner: roleSchema.optional(), verifier: roleSchema.optional() }).strict(),\n',
      to: '  roles: z.object({ planner: roleSchema.optional(), verifier: roleSchema.optional(), healer: roleSchema.optional() }).strict(),\n',
    }],
    reds: [cell('schema-usage', ROLES, 'C423-MODEL-ROLES-EXACT'), cell('schema-usage', ROLES_D, 'C423-MODEL-ROLES-EXACT')],
    allowed: [],
    greens: [cell('schema-usage', ROLES, 'INPUT-SAMPLE-POPULATION', 4), cell('schema-usage', ROLES, 'MODEL-USAGE-MASK', 2),
      cell('schema-usage', ROLES_D, 'MODEL-USAGE-OPTIONAL: bus and persisted step share the schema-owned optional contracts')],
  },
  {
    subject: REPORT, instrument: 'model-observation', claim: 'C423-OBSERVATION-EXACT', operation: 'widen the observation event union and list with a retry arm',
    edits: [{
      from: "  | { kind: 'failure' }\n\nexport const MODEL_CALL_EVENT_KINDS = [\n  'start', 'success', 'failure',\n]",
      to: "  | { kind: 'failure' }\n  | { kind: 'retry' }\n\nexport const MODEL_CALL_EVENT_KINDS = [\n  'start', 'success', 'failure', 'retry',\n]",
    }],
    reds: [
      cell('model-observation', AUTH, 'C423-OBSERVATION-EXACT independently pins event and trusted-origin lists'),
      cell('model-observation', AUTH_D, 'C423-OBSERVATION-EXACT event discriminants are exactly start/success/failure'),
      cell('model-observation', AUTH_D, 'C423-OBSERVATION-EXACT exhaustive event never-bar'),
    ],
    allowed: [],
    greens: [
      cell('model-observation', AUTH_D, 'C423-OBSERVATION-EXACT trusted origin set has exactly four protocols'),
      cell('model-observation', AUTH_D, 'C423-OBSERVATION-EXACT exhaustive origin never-bar'),
      cell('model-observation', AUTH_D, 'C423-OBSERVATION-EXACT only success carries a neutral report'),
      cell('model-observation', AUTH, 'USAGE-RETRY-FAILURE', 2),
    ],
  },
  {
    subject: USAGE, instrument: 'schema-usage', claim: 'INPUT-SAMPLE-POPULATION', operation: 'add cache reads on top of the inclusive input total',
    edits: [{
      from: 'sum + item.report!.inputTokens!, 0)',
      to: 'sum + item.report!.inputTokens! + (item.report!.cachedInputTokens ?? 0), 0)',
    }],
    reds: [cell('schema-usage', ROLES, 'INPUT-SAMPLE-POPULATION: inclusive totals count each attempt once without adding cache reads')],
    allowed: [cell('schema-usage', ROLES, 'MODEL-USAGE-OPTIONAL: reported zero is present and mixed reporting omits cache'),
      cell('schema-usage', ROLES, 'MODEL-USAGE-OPTIONAL: invalid cache')],
    greens: [cell('schema-usage', ROLES, 'C423-MODEL-ROLES-EXACT'), cell('schema-usage', ROLES_D, 'C423-MODEL-ROLES-EXACT'),
      cell('schema-usage', ROLES, 'INPUT-SAMPLE-POPULATION: failure attempt prevents certification of the complete population'),
      cell('schema-usage', ROLES, 'MODEL-USAGE-MASK', 2),
      cell('schema-usage', ROLES, 'MODEL-USAGE-OPTIONAL: missing observations and zero calls never fabricate measurements')],
  },
]

runGate({
  slug: '423-usage-mutation', envPrefix: 'AGENT_QA_423_USAGE_MUTATION', idPrefix: 'U',
  instruments, legs, expectedLegs: 9, banner: 'USAGE_MUTATION_OK',
})
NODE
