import { createHash } from 'node:crypto'
import { realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// 2026-10-19 (444.1-19, D-29): a project whose socket path is over budget gets a tmpdir fallback
// directory the product never removes. The daemon (`daemon/server.ts`) hashes `resolve(root)`, the
// embedder worker hashes `realpathSync(root)`; both are removed with the root.
function socketFallbackDirs(root: string): string[] {
  const paths = [resolve(root)]
  try {
    paths.push(realpathSync(root))
  } catch {}
  return [...new Set(paths)].map((path) =>
    join(tmpdir(), `agent-qa-${createHash('sha256').update(path).digest('hex').slice(0, 12)}`))
}

export function removeTempRoots(roots: readonly string[]): void {
  const fallbacks = roots.flatMap(socketFallbackDirs)
  for (const path of [...fallbacks, ...roots]) rmSync(path, { recursive: true, force: true })
}
