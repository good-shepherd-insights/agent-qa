import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import { loadBundle, verifyBundleIntegrity, type LoadedBundle } from './bundle-read.js'
import type { EnumeratedBundleDir } from './bundle-scan.js'

export type KnowledgeMaintenanceScanIssue =
  | 'directory-read'
  | 'non-directory-entry'
  | 'bundle-load'
  | 'bundle-integrity'
  | 'receipt-read'
  | 'receipt-invalid'

/** Fail-closed maintenance read error: callers must never render a partial clean-looking view. */
export class KnowledgeMaintenanceScanError extends Error {
  override readonly name = 'KnowledgeMaintenanceScanError'
  readonly issue: KnowledgeMaintenanceScanIssue
  readonly path: string

  constructor(issue: KnowledgeMaintenanceScanIssue, path: string, detail: string) {
    super(`knowledge maintenance scan incomplete at ${path}: ${detail}`)
    this.issue = issue
    this.path = path
  }
}

function directoryEntries(dir: string, missingIsEmpty: boolean) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (missingIsEmpty && (error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new KnowledgeMaintenanceScanError(
      'directory-read',
      dir,
      error instanceof Error ? error.message : String(error),
    )
  }
}

/** Strict counterpart to the serving scanner: every visible bundle entry must be inspectable. */
export function enumerateMaintenanceBundleDirs(knowledgeRoot: string): EnumeratedBundleDir[] {
  const memoryRoot = join(knowledgeRoot, 'memory')
  const products = directoryEntries(memoryRoot, true)
    .filter((entry) => (
      !entry.name.startsWith('.')
      && entry.name !== 'index'
      && entry.name !== 'queue'
      && entry.name !== 'receipts'
    ))
    .sort((left, right) => left.name.localeCompare(right.name))

  const found: EnumeratedBundleDir[] = []
  for (const product of products) {
    const productPath = join(memoryRoot, product.name)
    if (!product.isDirectory()) {
      throw new KnowledgeMaintenanceScanError(
        'non-directory-entry',
        productPath,
        'product entry is not a canonical directory',
      )
    }
    const bundlesRoot = join(productPath, 'bundles')
    const bundles = directoryEntries(bundlesRoot, true)
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((left, right) => left.name.localeCompare(right.name))
    for (const bundle of bundles) {
      const dir = join(bundlesRoot, bundle.name)
      if (!bundle.isDirectory()) {
        throw new KnowledgeMaintenanceScanError(
          'non-directory-entry',
          dir,
          'bundle entry is not a canonical directory',
        )
      }
      found.push({ product: product.name, dir })
    }
  }
  return found
}

export function loadMaintenanceBundle(entry: EnumeratedBundleDir): LoadedBundle {
  const loaded = loadBundle(entry.dir)
  if (loaded.kind !== 'loaded') {
    const detail = 'reason' in loaded ? `${loaded.kind}: ${loaded.reason}` : loaded.kind
    throw new KnowledgeMaintenanceScanError('bundle-load', entry.dir, detail)
  }
  const integrity = verifyBundleIntegrity(entry.dir)
  if (!integrity.ok) {
    throw new KnowledgeMaintenanceScanError(
      'bundle-integrity',
      entry.dir,
      integrity.violations.join('; '),
    )
  }
  return loaded.bundle
}
