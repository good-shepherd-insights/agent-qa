import { AsyncLocalStorage } from 'node:async_hooks'

import {
  setActiveExecutionContextResolver,
  setActiveMaskingContextResolver,
} from '@vostride/agent-qa-safety'
import type { ExecutionContext, MaskingContext } from '@vostride/agent-qa-schema'

import { detectExecutionContext } from './execution-context-detector'

export interface SafetyScopeBundle {
  maskingContext?: MaskingContext
  executionContext?: ExecutionContext
}

// D-02: exactly ONE AsyncLocalStorage store carries the whole run-safety bundle,
// feeding both active resolvers with one nesting-safe, concurrency-safe scope.
const als = new AsyncLocalStorage<SafetyScopeBundle>()

/**
 * The ambient masking resolver, NAMED so it can be put back (423-46).
 *
 * The install below is a module-load side effect and `setActiveMaskingContextResolver` has no
 * getter, so a caller that temporarily forces a context has no way to describe what it displaced.
 * The habit that grew in its absence — "restore" by installing `() => undefined` — does not restore
 * anything: it PINS the process answer to absent for every later reader, and a scope opened by
 * `runSafetyScope` after that point is invisible. Exporting the resolver the install site uses is
 * what makes a real restore expressible.
 */
export const ambientMaskingContextResolver = (): MaskingContext | undefined =>
  als.getStore()?.maskingContext

// Single install site per resolver (Pitfall 9). Reachable from the package barrel
// so any import of @vostride/agent-qa-safety-local wires the scope.
setActiveMaskingContextResolver(ambientMaskingContextResolver)
setActiveExecutionContextResolver(() => als.getStore()?.executionContext ?? detectExecutionContext())

export function runSafetyScope<T>(bundle: SafetyScopeBundle, fn: () => T): T {
  return als.run(bundle, fn)
}
