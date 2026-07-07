// Barrel for @vostride/agent-qa-runner-local.
//
// The storageImplementation home for the concrete filesystem + git-branch
// action-plan cache store behind the runner ActionPlanCache port (Phase 356).

// Neutral port + key types this package's store implements. These type
// re-exports also anchor the runner + schema workspace dependencies the
// ownership contract declares.
export type { ActionPlanCache, StorageStatePort, StorageStateReference, StorageStateBlob } from '@vostride/agent-qa-runner'
export type { CacheKey } from '@vostride/agent-qa-schema'

// Concrete filesystem store + its bumped on-disk schema version (D-03/D-06/D-14).
export { FsActionCache, CACHE_SCHEMA_VERSION } from './fs-action-cache.js'
export type { FsActionCacheConfig } from './fs-action-cache.js'

// Concrete filesystem storage-state store (D-14) — raw-but-local auth persistence.
export { FsStorageStateStore, STORAGE_STATES_SUBDIR } from './storage-state-store.js'
export type { FsStorageStateStoreConfig } from './storage-state-store.js'

// Injectable git-branch resolver + slug sanitizer (security V5).
export { resolveBranch, slugBranch } from './branch-resolver.js'
export type { BranchResolverOptions, ResolvedBranch } from './branch-resolver.js'

// Branch write-skip policy (D-14).
export { shouldWrite } from './write-policy.js'
export type { CachePolicy } from './write-policy.js'

// Runner-local persistence tier (Phase 361, D-05/D-06/D-17/D-18/D-19).
// JSONL event log + completed-run handoff store + per-product buildOrdinal counter,
// each behind a runner-declared port (EventLogPort/HandoffStorePort) or a thin fs leg.
export { FsEventLog, RUNS_SUBDIR, EVENTS_FILE } from './event-log.js'
export type { FsEventLogConfig } from './event-log.js'
export { FsHandoffStore, loadCompletedRunHandoff, HANDOFF_FILE } from './handoff-store.js'
export type { FsHandoffStoreConfig } from './handoff-store.js'
export { nextBuildOrdinal, BUILD_ORDINALS_FILE } from './build-ordinal.js'
export type { NextBuildOrdinalOptions } from './build-ordinal.js'
