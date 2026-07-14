/**
 * The single memory.md §5.5.1 scope/status predicate authority (377 D-15, §13.3).
 * FTS joins, brute scans, anchor seeds, and expansion admission bind this exact fragment so the
 * tenancy wall cannot drift between consumers. The vec0 leg in Plan 377-08 mirrors these clauses
 * in vec0 metadata syntax; any predicate change must update that named mirror site in the same
 * change. Scope keys remain caller-owned outputs of the schema scope-key helpers.
 */
export interface PreFilterOptions {
  product: string
  testKey: string
  suiteKey: string
  productKey: string
  globalKey: string
  includeSuperseded?: boolean
}

export interface PreFilterPredicate {
  sql: string
  binds: string[]
}

export function preFilterPredicate(options: PreFilterOptions): PreFilterPredicate {
  const clauses = [
    ...(options.includeSuperseded === true
      ? []
      : ["r.status NOT IN ('deprecated', 'superseded')"]),
    "(r.product = ? OR r.scope_tier = 'global')",
    'r.scope_key IN (?, ?, ?, ?)',
  ]

  return {
    sql: clauses.join('\nAND '),
    binds: [
      options.product,
      options.testKey,
      options.suiteKey,
      options.productKey,
      options.globalKey,
    ],
  }
}
