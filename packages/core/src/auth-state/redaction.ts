// Auth-state redaction moved to @vostride/agent-qa-runner (Phase 363 D-06) so the
// DockerHookExecutor (runner-local) can apply it without importing core (Pitfall 3). Re-exported
// here so the log-manager / dashboard reporter / mcp consumers keep resolving through the core
// barrel until they re-point.

export {
  AUTH_STATE_REDACTION_MARKER,
  redactAuthStateString,
  redactAuthStateValue,
} from '@vostride/agent-qa-runner'
export type { AuthStateRedactionContext } from '@vostride/agent-qa-runner'
