import type { AuthoringBrief, ScopeKey } from '@vostride/agent-qa-schema'

/**
 * D-13 authoring-read port: the M4 QA agent's screenless seam, minted beside KnowledgePort and
 * test-proven in M2 with no CLI surface (382's verb family or M4 adds one). Read-only law: this
 * port must survive 382's no-write-symbol module-boundary proof — no Delta/commit/promote symbol
 * may ever join it. The runner's six-method KnowledgeHintReader hot-path contract is untouched.
 */
export interface AuthoringReadPort {
  getAuthoringBrief(intent: string, scope: ScopeKey): Promise<AuthoringBrief>
}
