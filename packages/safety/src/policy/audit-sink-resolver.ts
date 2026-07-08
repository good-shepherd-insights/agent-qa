import type { AuditSink } from '../ports/audit-sink'

export type AuditSinkResolver = () => AuditSink | undefined

let active: AuditSinkResolver = () => undefined

export function setActiveAuditSinkResolver(resolve: AuditSinkResolver): void {
  active = resolve
}

export function getActiveAuditSink(): AuditSink | undefined {
  return active()
}
