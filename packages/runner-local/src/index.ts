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
