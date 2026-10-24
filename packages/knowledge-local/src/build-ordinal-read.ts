/**
 * Pure read-only mirror of runner-local/src/build-tag-map.ts latestBuildOrdinal semantics.
 *
 * knowledge-local deliberately cannot import runner-local, so D-14 resolves the shared
 * build-ordinals.json contract through this small host-local reader instead. `runtimeRoot` is the
 * explicitly supplied agent runtime root, not the committed knowledge root. Missing, corrupt, or
 * wrong-shaped state falls through without advancing, rewriting, or creating the counter file.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BUILD_ORDINALS_FILE = 'build-ordinals.json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function readLatestBuildOrdinal(
  runtimeRoot: string,
  product: string,
): number | undefined {
  try {
    const parsed: unknown = JSON.parse(
      readFileSync(join(runtimeRoot, BUILD_ORDINALS_FILE), 'utf8'),
    )
    if (!isRecord(parsed)) return undefined

    const ordinal = parsed[product]
    return typeof ordinal === 'number' && Number.isFinite(ordinal)
      ? ordinal
      : undefined
  } catch {
    return undefined
  }
}
