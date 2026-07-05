// Barrel for @vostride/agent-qa-runner-local.
//
// Phase 356 Plan 05 populates the concrete store exports here:
//   export { FsActionCache } from './fs-action-cache'
//   export { resolveBranch } from './branch-resolver'
//   export { shouldWrite } from './write-policy'
//
// Until then the barrel forward-declares the neutral port + key types this
// package's store implements. These type re-exports also anchor the runner +
// schema workspace dependencies the ownership contract declares.
export type { ActionPlanCache } from '@vostride/agent-qa-runner'
export type { CacheKey } from '@vostride/agent-qa-schema'
