#!/usr/bin/env bash
# The task-oriented Config contract instrument's own test (429-34). Every declared leg is run
# NEUTERED — the mutation withheld — and must FATAL with "<leg>: suite stayed green" after an actual
# green child of its own suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must mutate
# every subject and hand back the exact bytes and mtimes, then rebuild; a dirty subject must be
# refused and left as found; invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED. A leg silently dropped, re-aimed or renamed in
# 429-config-contract-mutation.sh reddens HERE instead of shrinking both in step — which is the
# whole reason a total read off the gate would be worthless: it would agree with the gate however
# the gate moved.
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const WRITE_SRC = 'packages/schema/src/config/config-write.ts'
const MASKING_SRC = 'packages/schema/src/config/masking.ts'
const ERROR_SRC = 'packages/schema/src/llm/provider-error.ts'
const CONNECT_SRC = 'packages/schema/src/llm/connect.ts'
const PRIMITIVES_SRC = 'packages/core/src/schema/primitives.ts'
const MANAGER_SRC = 'packages/dashboard-server/src/config/config-manager.ts'
const UNDO_SRC = 'packages/dashboard-server/src/config/undo-store.ts'
const CONFIG_ROUTES_SRC = 'packages/dashboard-server/src/server/config-routes.ts'
const CONNECT_ROUTE_SRC = 'packages/dashboard-server/src/server/llm-connect-route.ts'
const ROUTES_SRC = 'packages/dashboard-server/src/server/routes.ts'
const AUTH_SRC = 'packages/cli/src/commands/auth.ts'

const SCHEMA_T = 'src/__tests__/429-config-contracts.test.ts'
const SCHEMA_D = 'src/__tests__/429-config-contracts.test-d.ts'
const CORE_SCHEMA_T = 'src/__tests__/config-schema.test.ts'
const LEAVES_T = 'src/__tests__/config-schema-leaves.test.ts'
const WRITE_T = 'src/__tests__/routes.config-write.test.ts'
const MASKING_T = 'src/__tests__/routes.config-masking.test.ts'
const REVEAL_T = 'src/__tests__/routes.config-reveal.test.ts'
const UNDO_T = 'src/__tests__/routes.config-undo.test.ts'
const CONNECT_T = 'src/__tests__/routes.llm-connect.test.ts'
const DRAFT_T = 'src/__tests__/routes.draft-credential.test.ts'
const MANAGER_T = 'src/__tests__/config-manager.test.ts'
const AUTH_T = 'src/__tests__/auth-test.test.ts'
const LINT_T = 'src/__tests__/429-classifier-lint.test.ts'
const SHOW_T = 'src/composition/__tests__/masked-config.test.ts'

const SCHEMA = '@vostride/agent-qa-schema'

runSelftest({
  slug: '429-config-contract-mutation',
  gateScript: 'scripts/429-config-contract-mutation.sh',
  envPrefix: 'AGENT_QA_429_CONFIG_CONTRACT_MUTATION',
  idPrefix: 'C',
  banner: 'CONFIG_CONTRACT_MUTATION_OK',
  registration: {
    'validate:429-config-contract-mutation': 'bash scripts/429-config-contract-mutation.sh',
    'validate:429-config-contract-mutation-selftest': 'bash scripts/429-config-contract-mutation-selftest.sh',
  },
  expected: [
    { id: 'C01', claim: 'C429-CONFIG-WRITE-OPS-EXACT', subject: WRITE_SRC,
      reds: [`${SCHEMA_D} > C429-CONFIG-WRITE-OPS-EXACT`] },
    { id: 'C02', claim: 'C429-CONFIG-WRITE-REFUSALS-EXACT', subject: WRITE_SRC,
      reds: [`${SCHEMA_D} > C429-CONFIG-WRITE-REFUSALS-EXACT`] },
    { id: 'C03', claim: 'C429-CONFIG-NAMED-ARRAYS-EXACT', subject: WRITE_SRC,
      reds: [`${SCHEMA_D} > C429-CONFIG-NAMED-ARRAYS-EXACT`] },
    { id: 'C04', claim: 'C429-MASKING-CLASSES-EXACT', subject: MASKING_SRC,
      reds: [`${SCHEMA_D} > C429-MASKING-CLASSES-EXACT`] },
    { id: 'C05', claim: 'C429-PROVIDER-ERROR-CLASSES-EXACT', subject: ERROR_SRC,
      reds: [`${SCHEMA_D} > C429-PROVIDER-ERROR-CLASSES-EXACT`] },
    { id: 'C06', claim: 'C429-LLM-SETUP-REFUSALS-EXACT', subject: CONNECT_SRC,
      reds: [`${SCHEMA_D} > C429-LLM-SETUP-REFUSALS-EXACT`] },
    { id: 'C07', claim: 'C429-CONFIG-ACTION-REFUSALS-EXACT', subject: WRITE_SRC,
      reds: [`${SCHEMA_D} > C429-CONFIG-ACTION-REFUSALS-EXACT`] },
    { id: 'C08', claim: 'DOTTED-NAMES-ACCEPTED', subject: PRIMITIVES_SRC,
      reds: [`${CORE_SCHEMA_T} > DOTTED-NAMES-ACCEPTED`] },
    { id: 'C09', claim: 'DRAFT-CREDENTIAL-ACCEPTED', subject: ROUTES_SRC,
      reds: [`${DRAFT_T} > DRAFT-CREDENTIAL-ACCEPTED`] },
    { id: 'C10', claim: 'DRAFT-SIGN-IN-ACCEPTED', subject: ROUTES_SRC,
      reds: [`${DRAFT_T} > DRAFT-SIGN-IN-ACCEPTED`] },
    { id: 'C11', claim: 'AUTH-TEST-EXIT-MISSING-CREDENTIAL', subject: AUTH_SRC,
      reds: [`${AUTH_T} > AUTH-TEST-EXIT-MISSING-CREDENTIAL`] },
    { id: 'C12', claim: 'AUTH-TEST-EXIT-AUTH-ERROR', subject: AUTH_SRC,
      reds: [`${AUTH_T} > AUTH-TEST-EXIT-AUTH-ERROR`] },
    { id: 'C13', claim: 'CLASSIFIER-ORDER-PINNED', subject: ERROR_SRC,
      reds: [`${SCHEMA_T} > CLASSIFIER-ORDER-PINNED`] },
    { id: 'C14', claim: 'CLASSIFIER-ONE-MODULE', subject: ROUTES_SRC,
      reds: [`${LINT_T} > CLASSIFIER-ONE-MODULE`] },
    { id: 'C15', claim: 'SC3-FIELD-MERGE', subject: MANAGER_SRC,
      reds: [`${WRITE_T} > SC3-FIELD-MERGE`] },
    { id: 'C16', claim: 'GET-CARRIES-NO-SECRET', subject: MASKING_SRC, crossing: SCHEMA,
      reds: [`${MASKING_T} > GET-CARRIES-NO-SECRET`] },
    { id: 'C17', claim: 'REVEAL-SAME-SITE-ONLY', subject: CONFIG_ROUTES_SRC,
      reds: [`${REVEAL_T} > REVEAL-SAME-SITE-ONLY`] },
    { id: 'C18', claim: 'REVEAL-SECRET-PATHS-ONLY', subject: CONFIG_ROUTES_SRC,
      reds: [`${REVEAL_T} > REVEAL-SECRET-PATHS-ONLY`] },
    { id: 'C19', claim: 'ENV-VAR-NAME-IN-CLEAR', subject: MASKING_SRC, crossing: SCHEMA,
      reds: [`${MASKING_T} > ENV-VAR-NAME-IN-CLEAR`] },
    { id: 'C20', claim: 'CONNECT-NOTHING-WRITTEN-ON-FAIL', subject: CONNECT_ROUTE_SRC,
      reds: [`${CONNECT_T} > CONNECT-NOTHING-WRITTEN-ON-FAIL`] },
    { id: 'C21', claim: 'MASK-NEVER-WRITTEN-BACK', subject: MANAGER_SRC,
      reds: [`${MANAGER_T} > MASK-NEVER-WRITTEN-BACK`] },
    { id: 'C22', claim: 'UNDO-TOKEN-SINGLE-USE', subject: UNDO_SRC,
      reds: [`${UNDO_T} > UNDO-TOKEN-SINGLE-USE (x2)`] },
    { id: 'C23', claim: 'INVALID-MERGE-KEEPS-BYTES', subject: MANAGER_SRC,
      reds: [`${WRITE_T} > INVALID-MERGE-KEEPS-BYTES`] },
    { id: 'C24', claim: 'CREDENTIAL-PROVIDER-CONFLICT-REFUSED', subject: ROUTES_SRC,
      reds: [
        `${DRAFT_T} > CREDENTIAL-PROVIDER-CONFLICT-REFUSED: another provider's credential under the name is never overwritten`,
        `${DRAFT_T} > CREDENTIAL-PROVIDER-CONFLICT-REFUSED: an oauth entry compares by its product provider`,
      ] },
    { id: 'C25', claim: 'CONFIG-SCHEMA-LEAVES-PINNED', subject: MASKING_SRC, crossing: SCHEMA,
      reds: [`${LEAVES_T} > CONFIG-SCHEMA-LEAVES-PINNED`] },
    { id: 'C26', claim: 'CONFIG-SHOW-ENV-VAR-NAME-IN-CLEAR', subject: MASKING_SRC, crossing: SCHEMA,
      reds: [`${SHOW_T} > CONFIG-SHOW-ENV-VAR-NAME-IN-CLEAR`] },
    { id: 'C27', claim: 'LEGACY-WRITE-ROUTES-GONE', subject: ROUTES_SRC,
      reds: [`${WRITE_T} > LEGACY-WRITE-ROUTES-GONE`] },
  ],
})
NODE
