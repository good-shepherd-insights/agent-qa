#!/usr/bin/env bash
# The approval and permission removal instrument's own test (432-43). Every declared leg is run
# NEUTERED — the mutation withheld — and must FATAL with "<leg>: suite stayed green" after an actual
# green child of its own suite. The interruption modes (fatal, SIGINT, SIGTERM, SIGHUP) must plant
# every subject — the edited files and the deleted modules created again — and hand back the exact
# bytes and mtimes (and the absence of every created file), then rebuild; a dirty subject must be
# refused and left as found; invalid knobs refuse before ownership.
#
# THE INVENTORY BELOW IS WRITTEN OUT, NOT DERIVED, and not read from the driver. Each row is spelled
# here: its id, the member's cell, the file it plants into (every dependent path for the five public
# returns), the dist it rebuilds, and the NAMED ASSERTION its RED must carry. A leg silently dropped,
# re-aimed, re-pointed or renamed in 432-approval-permission-mutation.sh reddens HERE instead of
# shrinking both in step. `scripts/__tests__/432-mutation-map.test.cjs` holds this table, the driver's
# and the mutation map's to one another, keyed by id.
#
# AGENT_QA_432_APPROVAL_PERMISSION_MUTATION_SELFTEST_EXPECTED=<file> writes this table to <file> as
# JSON and exits without running anything (the map test reads it).
#
# Runs in place on the real tree. Slow; a phase gate, not a per-commit sample.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --test-reporter=tap --input-type=commonjs - <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const { runSelftest } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))

const CENSUS = 'src/__tests__/432-approval-permission-deleted.test.ts'
const P = 'packages/'

/** A removed member: its own census cell, red by the assertion spelled here. */
const member = (id, subject, assertion, extra = {}) => ({
  id, claim: `C432-RETURN-${id}`, subject: `${P}${subject}`,
  reds: [`${CENSUS} > C432-RETURN-${id} [${assertion}]`], ...extra,
})
/** A member whose module is gone: the leg creates it, so its one path is the created module. */
const created = (id, subject, assertion) => member(id, subject, assertion, { paths: [`${P}${subject}`] })
const returned = (id, what, spelled) => `${id}: ${what} returned (${spelled})`

const HOST = 'cli/src/composition/local-agent-host.ts'
const CHAT = 'cli/src/commands/chat.ts'
const MAINTAIN = 'cli/src/commands/knowledge-maintain.ts'
const REGISTRY = 'agent/src/functions/registry.ts'
const MAPPING = 'mcp/src/mapping.ts'
const SPEC = 'agent/src/functions/spec.ts'
const CALLER = 'schema/src/functions/function-caller.ts'
const SCOPE = 'schema/src/functions/function-scope.ts'
const REMEDIES = 'schema/src/safety/remedies.ts'
const PROTECTED = 'schema/src/safety/protected-classes.ts'
const GATE = 'safety/src/policy/gate.ts'
const SERVICES = 'core/src/schema/services-schema.ts'
const PARSER = 'the public parser accepts the removed member'
const CORE = '@vostride/agent-qa-core'

const expected = [
  member('A01', HOST, returned('A01', 'the terminal y/N approval prompt', '[y/N]')),
  member('A02', CHAT, returned('A02', 'the chat two-answer approval prompt', '[y/N]')),
  member('A03', CHAT, returned('A03', 'the chat always-answer branch', "'always'")),
  member('A04', MAINTAIN, returned('A04', 'the knowledge rollback confirmation', 'Apply this rollback')),
  member('A05', 'cli/src/commands/cache.ts', returned('A05', 'the cache purge confirmation', 'Continue? (y/N)')),
  member('A06', MAINTAIN, returned('A06', 'the knowledge purge repeated-id confirmation', "'--confirm")),
  created('A07', 'dashboard-server/src/chat/chat-routes.ts', returned('A07', 'the GET run-confirm channel route', '/api/run-confirm/channel')),
  created('A08', 'dashboard-server/src/chat/chat-routes.ts', returned('A08', 'the POST run-confirm answer route', '/api/run-confirm/answer')),
  created('A09', 'dashboard-ui/src/components/run-confirm-dialog.tsx', returned('A09', 'the dashboard run-confirm dialog', 'RunConfirmDialog')),
  created('A10', 'dashboard-ui/src/components/run-detail/feedback-approval.tsx', returned('A10', 'the dashboard mark approval', 'FeedbackApproval')),
  created('A11', 'dashboard-server/src/chat/confirm-registry.ts', returned('A11', 'the confirm registry', 'ConfirmRegistry')),
  created('A12', GATE, returned('A12', 'resolveAsk', 'resolveAsk')),
  created('A13', GATE, 'A13: the execution-policy evaluate export returned:'),
  created('A14', GATE, returned('A14', 'the baseVerdict ask ladder', 'baseVerdict')),
  created('A15', 'safety/src/policy/gate-hook.ts', returned('A15', 'the execution gate hook', 'createPolicyGateToolCallHook')),
  created('A16', 'safety/src/ports/policy-ports.ts', returned('A16', 'ConfirmPort', 'ConfirmPort')),
  created('A17', 'safety-local/src/readline-confirm.ts', returned('A17', 'the readline confirmation', 'createReadlineConfirm')),
  member('A18', REGISTRY, returned('A18', 'grants.list', "'grants.list'")),
  member('A19', REGISTRY, returned('A19', 'grants.revoke', "'grants.revoke'")),
  created('A20', 'knowledge-local/src/grants/ledger.ts', returned('A20', 'the grant ledger writer', 'appendGrantLedgerEvents')),
  created('A21', 'knowledge-local/src/grants/reader.ts', returned('A21', 'the grant ledger reader', 'readGrantLedger')),
  created('A22', 'schema/src/safety/standing-approval.ts', returned('A22', 'the standing approval contract', 'StandingApprovalGrant')),
  created('A23', PROTECTED, returned('A23', 'the protected proposals class', 'fn:proposals.accept')),
  created('A24', PROTECTED, returned('A24', 'the protected grants class', 'fn:grants.revoke')),
  member('A25', REGISTRY, returned('A25', 'proposals.list', "'proposals.list'")),
  member('A26', REGISTRY, returned('A26', 'proposals.show', "'proposals.show'")),
  member('A27', REGISTRY, returned('A27', 'proposals.accept', "'proposals.accept'")),
  member('A28', REGISTRY, returned('A28', 'proposals.reject', "'proposals.reject'")),
  member('A29', REGISTRY, returned('A29', 'knowledge.proposal.apply', "'knowledge.proposal.apply'")),
  member('A30', REGISTRY, returned('A30', 'config.proposal.apply', "'config.proposal.apply'")),
  member('A31', REGISTRY, returned('A31', 'config.undo.propose', "'config.undo.propose'")),
  member('A32', REGISTRY, returned('A32', 'knowledge.accept.propose', "'knowledge.accept.propose'")),
  member('A33', REGISTRY, returned('A33', 'knowledge.reject.propose', "'knowledge.reject.propose'")),
  member('A34', REGISTRY, returned('A34', 'knowledge.forget.propose', "'knowledge.forget.propose'")),
  member('A35', MAPPING, returned('A35', 'the propose-knowledge-change tool', 'agent_qa_propose_knowledge_change')),
  member('A36', MAPPING, returned('A36', 'the apply-proposal tool', 'agent_qa_apply_proposal')),
  member('A37', MAPPING, returned('A37', 'the propose-config-change tool', 'agent_qa_propose_config_change')),
  member('A38', MAPPING, returned('A38', 'the apply-config-proposal tool', 'agent_qa_apply_config_proposal')),
  member('A39', MAPPING, returned('A39', 'the list-proposals tool', 'agent_qa_list_proposals')),
  member('A40', MAPPING, returned('A40', 'the show-proposal tool', 'agent_qa_show_proposal')),
  created('A41', 'schema/src/proposal/envelope.ts', returned('A41', 'the proposal envelope', 'ProposalEnvelope')),
  created('A42', 'knowledge-local/src/review/proposals-store.ts', returned('A42', 'the proposal store', 'writePendingProposal')),
  created('A43', 'knowledge-local/src/review/proposals-inbox.ts', returned('A43', 'the proposal inbox reader', 'createProposalsInbox')),
  created('A44', 'cli/src/commands/proposals.ts', returned('A44', 'the proposals CLI', 'createProposalsCommand')),
  member('A45', SPEC, returned('A45', 'requiresHumanOrigin', 'requiresHumanOrigin')),
  created('A46', SCOPE, returned('A46', 'FunctionScope', 'FunctionScopeSchema')),
  created('A47', SCOPE, 'A47: the capability member read returned:'),
  created('A48', SCOPE, 'A48: the capability member run returned:'),
  created('A49', SCOPE, 'A49: the capability member config-write returned:'),
  created('A50', SCOPE, 'A50: the capability member knowledge-write returned:'),
  created('A51', SCOPE, 'A51: the capability member approval-write returned:'),
  created('A52', SCOPE, 'A52: the capability member test-write returned:'),
  member('A53', SPEC, returned('A53', 'requiredScopes metadata', 'requiredScopes')),
  member('A54', CALLER, returned('A54', 'the grantedScopes caller key', 'grantedScopes')),
  member('A55', CALLER, returned('A55', 'the safeMode caller key', 'safeMode')),
  member('A56', CALLER, returned('A56', 'the credential caller key', 'credential')),
  member('A57', CALLER, returned('A57', 'the sessionId overlay caller key', 'sessionId')),
  created('A58', 'mcp/src/visibility.ts', returned('A58', 'MCP permission visibility', 'visibleToCaller')),
  // A59/A61/A63: the key on core's schema, its entry DTO created where it lived, both barrels.
  member('A59', SERVICES, `${PARSER} (services.mcp.tokens)`, { crossing: CORE,
    paths: [`${P}${SERVICES}`, `${P}schema/src/config/mcp.ts`, `${P}schema/src/config/index.ts`, `${P}schema/src/index.ts`] }),
  member('A60', 'cli/src/commands/mcp.ts', returned('A60', 'the MCP bearer check', 'Bearer')),
  member('A61', SERVICES, `${PARSER} (services.dashboard.runServiceTokens)`, { crossing: CORE,
    paths: [`${P}${SERVICES}`, `${P}schema/src/config/run-service.ts`, `${P}schema/src/config/index.ts`, `${P}schema/src/index.ts`] }),
  member('A62', 'dashboard-server/src/run-service/run-service-routes.ts', returned('A62', 'the run-service bearer check', 'Bearer')),
  member('A63', SERVICES, `${PARSER} (services.mcp.stdio)`, { crossing: CORE,
    paths: [`${P}${SERVICES}`, `${P}schema/src/config/mcp.ts`, `${P}schema/src/config/index.ts`, `${P}schema/src/index.ts`] }),
  // A64: Commander's own option on createRunCommand, read back through the rebuilt binary's help.
  member('A64', 'cli/src/commands/run.ts', 'the run command registers the trust flag again', { crossing: 'agent-qa' }),
  member('A65', 'core/src/schema/config-schema.ts', `${PARSER} (safety)`, { crossing: CORE }),
  member('A66', 'safety/src/policy/execution-context.ts', returned('A66', 'the fail-closed policy', 'requiresFailClosed')),
  member('A67', 'agent/src/chat/turn-engine.ts', returned('A67', 'the pin directive', "'pin'")),
  created('A68', 'agent/src/chat/pin-overlay.ts', returned('A68', 'the pin overlay resolver', 'createPinOverlay')),
  created('A69', REMEDIES, returned('A69', 'the answer-confirm remedy', "'answer-confirm'")),
  created('A70', REMEDIES, returned('A70', 'the trust-session-flag remedy', "'trust-session-flag'")),
  created('A71', REMEDIES, returned('A71', 'the session-pin-final remedy', "'session-pin-final'")),
  created('A72', REMEDIES, returned('A72', 'the present-bearer-scope remedy', "'present-bearer-scope'")),
  member('A73', 'cli/src/commands/receipt-line.ts', returned('A73', 'the CLI remedy renderer', 'remed')),
  member('A74', 'dashboard-ui/src/components/run-detail/denial-block.tsx', returned('A74', 'the dashboard remedy renderer', 'remed')),
  member('A75', 'safety/src/policy/lexicon.ts', returned('A75', 'the hard destructive command patterns', 'HARD_DESTRUCTIVE_PATTERNS')),
  member('A76', 'safety-local/src/jsonl-audit-sink.ts', returned('A76', 'the execution audit writer', 'appendExecutionAudit')),
  member('A77', 'safety/src/ports/audit-sink.ts', returned('A77', 'ExecutionAuditRow', 'ExecutionAuditRow')),
  member('A78', HOST, returned('A78', 'the product git commit', "'commit'")),
  { id: 'B01', claim: 'C432-PRODUCTION-BEFORE-EFFECTS', subject: `${P}agent-local/src/composition/run-invocation-core.ts`,
    reds: ['src/composition/__tests__/432-production-boundary.test.ts > C432-PRODUCTION-BEFORE-EFFECTS'] },
  { id: 'B02', claim: 'C432-MIXED-SUITE-PRODUCTION', subject: `${P}cli/src/commands/run.ts`,
    reds: ['src/composition/__tests__/432-production-producers.test.ts > C432-MIXED-SUITE-PRODUCTION (x2)'] },
  { id: 'B03', claim: 'C432-EDITOR-PRODUCTION', subject: `${P}dashboard-server/src/live-editor/live-session.ts`,
    reds: ['src/__tests__/432-editor-production.test.ts > C432-EDITOR-PRODUCTION: direct initialize refuses a production (x3)'] },
  { id: 'B04', claim: 'C432-EXPLICIT-ALL-CONTEXTS', subject: `${P}knowledge-local/src/curator/knowledge-store.ts`,
    reds: ['src/review/__tests__/432-direct-review.test.ts > C432-EXPLICIT-ALL-CONTEXTS'] },
  { id: 'B05', claim: 'C432-CURATION-CONTEXT', subject: `${P}knowledge-local/src/curator/author-contract.ts`,
    reds: ['src/curator/__tests__/disposition.test.ts > C432-CURATION-CONTEXT'] },
  { id: 'B06', claim: 'C432-MARK-RETRY-ONCE', subject: `${P}cli/src/gates/feedback-host.ts`,
    reds: ['src/gates/__tests__/feedback-host.test.ts > C432-MARK-RETRY-ONCE: a knowledge mark interrupted before receipt lands its fix exactly once on retry',
      'src/gates/__tests__/feedback-host.test.ts > C432-MARK-RETRY-ONCE: a test-edit mark interrupted before its receipt reuses the written file without a second edit'] },
  { id: 'B07', claim: 'C432-CONFIG-OUTSIDE-EDIT', subject: `${P}dashboard-server/src/config/config-manager.ts`, crossing: '@vostride/agent-qa-dashboard',
    reds: ['src/composition/__tests__/432-direct-config.test.ts > C432-CONFIG-OUTSIDE-EDIT: a generated change merges onto the file as it is at its turn > a field change queued behind another writer keeps the outside edit made while it waited'] },
  { id: 'B08', claim: 'C432-TEST-WRITE-DISPOSITION', subject: `${P}agent/src/authoring/loop.ts`, crossing: '@vostride/agent-qa-agent',
    reds: ['src/__tests__/authoring-loop.e2e.test.ts > C432-TEST-WRITE-DISPOSITION: never writes a REJECTED draft to its target'] },
  { id: 'B09', claim: 'C432-CONFIG-LEAVES-92', subject: `${P}schema/src/config/masking.ts`, crossing: '@vostride/agent-qa-schema',
    reds: ['src/__tests__/config-schema-leaves.test.ts > C432-CONFIG-LEAVES-92'] },
  { id: 'B10', claim: 'C432-CONFIG-WRITABLE-88', subject: `${P}dashboard-ui/src/pages/config.tsx`,
    reds: ['src/pages/__tests__/config-page.schema-coverage.test.tsx > C432-CONFIG-WRITABLE-88'] },
  { id: 'B11', claim: 'C432-INCONSISTENCY-HOLD', subject: `${P}schema/src/knowledge/promotion-gate.ts`, crossing: '@vostride/agent-qa-schema',
    reds: ['src/review/__tests__/gate-inconsistency.test.ts > C432-INCONSISTENCY-HOLD'] },
  { id: 'B12', claim: 'C432-RETAINED-HOST', subject: `${P}cli/src/commands/mcp.ts`,
    reds: ['src/__tests__/mcp-mark-credential.test.ts > C432-RETAINED-HOST'] },
  { id: 'B13', claim: 'C432-RETAINED-ORIGIN', subject: `${P}cli/src/commands/mcp.ts`,
    reds: ['src/__tests__/mcp-mark-credential.test.ts > C432-RETAINED-ORIGIN'] },
  { id: 'B14', claim: 'C432-RETAINED-CROSS-SITE', subject: `${P}dashboard-server/src/server/routes.ts`, crossing: '@vostride/agent-qa-dashboard',
    reds: ['src/__tests__/dashboard-door-security.test.ts > C432-RETAINED-CROSS-SITE'] },
  { id: 'B15', claim: 'C432-RETAINED-LIVE-LINK', subject: `${P}dashboard-server/src/run-service/run-service-routes.ts`, crossing: '@vostride/agent-qa-dashboard',
    reds: ['src/__tests__/live-view-masking.test.ts > C432-RETAINED-LIVE-LINK'] },
  { id: 'B16', claim: 'C432-GUARDRAIL-AUDIT-RETAINED', subject: `${P}safety-local/src/jsonl-audit-sink.ts`,
    reds: ['src/__tests__/jsonl-audit-sink.test.ts > C432-GUARDRAIL-AUDIT-RETAINED (x2)'] },
]

const out = process.env.AGENT_QA_432_APPROVAL_PERMISSION_MUTATION_SELFTEST_EXPECTED
if (out !== undefined) {
  fs.writeFileSync(out, JSON.stringify(expected, null, 2) + '\n', { flag: 'wx' })
  process.exit(0)
}

runSelftest({
  slug: '432-approval-permission-mutation',
  gateScript: 'scripts/432-approval-permission-mutation.sh',
  envPrefix: 'AGENT_QA_432_APPROVAL_PERMISSION_MUTATION',
  idPrefix: 'A', banner: 'APPROVAL_PERMISSION_MUTATION_OK',
  registration: {
    'validate:432-approval-permission-mutation': 'bash scripts/432-approval-permission-mutation.sh',
    'validate:432-approval-permission-mutation-selftest': 'bash scripts/432-approval-permission-mutation-selftest.sh',
  },
  expected,
})
NODE
