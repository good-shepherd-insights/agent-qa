import type { PersistencePort } from '@vostride/agent-qa-agent'

/**
 * The local implementation of the neutral persistence port.
 *
 * 2026-07-29 (Phase 385 plan 02, D-06): this alias now covers approvals and patches ONLY.
 * Job rows and checkpoints left the port for the agent job queue's own store, whose verbs are
 * compound and transactional rather than generic CRUD, and the conversation surface left it
 * entirely. The alias is deliberately narrower than the package's name suggests, and saying
 * so here is cheaper than letting a later reader infer that anything job-shaped belongs
 * behind it.
 *
 * The job store itself is not on this barrel. It is reachable by relative path within the
 * package and is published, if at all, by the composition root — a store that any importer
 * can construct is a second way to open the database beside the one the host owns.
 */
export type LocalPersistenceStore = PersistencePort
