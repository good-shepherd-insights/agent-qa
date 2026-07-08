import { AsyncLocalStorage } from 'node:async_hooks'

import {
  setActiveAuditSinkResolver,
  setActiveExecutionContextResolver,
  setActiveMaskingContextResolver,
  type AuditSink,
} from '@vostride/agent-qa-safety'
import type { ExecutionContext, MaskingContext } from '@vostride/agent-qa-schema'

import { detectExecutionContext } from './execution-context-detector'
import { JsonlAuditSink } from './jsonl-audit-sink'

export interface SafetyScopeBundle {
  maskingContext?: MaskingContext
  auditSink?: AuditSink
  executionContext?: ExecutionContext
}

// D-02: exactly ONE AsyncLocalStorage store carries the whole run-safety bundle,
// feeding all three active resolvers with one nesting-safe, concurrency-safe scope.
const als = new AsyncLocalStorage<SafetyScopeBundle>()

// D-03: outside any run scope the audit-sink resolver still returns a durable sink,
// lazily constructed once and memoized so module import creates nothing on its own.
let processDefaultAuditSink: AuditSink | undefined

function getProcessDefaultAuditSink(): AuditSink {
  processDefaultAuditSink ??= new JsonlAuditSink('.agent-qa')
  return processDefaultAuditSink
}

// Single install site per resolver (Pitfall 9). Reachable from the package barrel
// so any import of @vostride/agent-qa-safety-local wires the scope.
setActiveMaskingContextResolver(() => als.getStore()?.maskingContext)
setActiveExecutionContextResolver(() => als.getStore()?.executionContext ?? detectExecutionContext())
setActiveAuditSinkResolver(() => als.getStore()?.auditSink ?? getProcessDefaultAuditSink())

export function runSafetyScope<T>(bundle: SafetyScopeBundle, fn: () => T): T {
  return als.run(bundle, fn)
}
