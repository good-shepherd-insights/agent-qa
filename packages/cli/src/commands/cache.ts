import { Command } from 'commander'
import pc from 'picocolors'
import { readdir, rm, stat } from 'node:fs/promises'
import { join, resolve, basename } from 'node:path'
import { createInterface } from 'node:readline'
import { DEFAULT_AGENT_QA_CACHE_DIR } from '@vostride/agent-qa-core'
import { resolveConfig } from '../config.js'

const CACHE_DIR_FALLBACK = DEFAULT_AGENT_QA_CACHE_DIR || '.agent-qa/cache'

/**
 * Count + remove all `<branch-slug>/<cacheKey>.json` entries under the redesigned cache
 * root (Phase 356 layout, D-06/D-14). The 16-hex cacheKey is the whole filename and folds
 * a runtime screenIdentityHash, so entries are opaque and content-addressed — they cannot
 * be recomputed statically from a test file. Purge therefore operates over the on-disk
 * layout directly.
 */
async function removeCacheEntries(cacheRoot: string): Promise<number> {
  let branchDirs: string[]
  try {
    branchDirs = await readdir(cacheRoot)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw err
  }

  let purged = 0
  for (const branch of branchDirs) {
    const branchPath = join(cacheRoot, branch)
    let entryStat
    try {
      entryStat = await stat(branchPath)
    } catch {
      continue
    }
    if (!entryStat.isDirectory()) {
      await rm(branchPath, { force: true })
      continue
    }
    let files: string[]
    try {
      files = await readdir(branchPath)
    } catch {
      continue
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      await rm(join(branchPath, file), { force: true })
      purged++
    }
    // Remove the now-empty branch namespace directory (best-effort).
    await rm(branchPath, { recursive: true, force: true }).catch(() => {})
  }

  return purged
}

async function countCacheEntries(cacheRoot: string): Promise<number> {
  let branchDirs: string[]
  try {
    branchDirs = await readdir(cacheRoot)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw err
  }
  let count = 0
  for (const branch of branchDirs) {
    try {
      const files = await readdir(join(cacheRoot, branch))
      count += files.filter((f) => f.endsWith('.json')).length
    } catch {
      // not a directory — skip
    }
  }
  return count
}

/**
 * Per-test targeting is not possible under the redesigned cache: keys are opaque,
 * content-addressed over masked step text + a runtime screenIdentityHash, and carry no raw
 * step text on disk (D-06). `--test` therefore clears the whole branch-namespaced cache so
 * the requested test's stale plans are guaranteed gone.
 */
export async function purgeTest(_testPath: string, cacheDir: string): Promise<number> {
  return removeCacheEntries(resolve(cacheDir))
}

export async function purgeAll(cacheDir: string, force: boolean): Promise<number> {
  const resolvedDir = resolve(cacheDir)
  const total = await countCacheEntries(resolvedDir)
  if (total === 0) return 0

  if (!force) {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise<string>((res) => {
      rl.question(`About to delete ${total} cached plans. Continue? (y/N) `, res)
    })
    rl.close()
    if (answer.toLowerCase() !== 'y') {
      console.log('Aborted.')
      return 0
    }
  }

  return removeCacheEntries(resolvedDir)
}

export function createCacheCommand(): Command {
  const cmd = new Command('cache').description('Manage action cache')

  cmd
    .command('purge')
    .description('Clear cached action plans')
    .option('--test <path>', 'purge cache for a specific test file')
    .option('--all', 'purge all cached plans')
    .option('--force', 'skip confirmation prompt')
    .action(async (opts) => {
      if (!opts.test && !opts.all) {
        console.error(pc.red('Specify --test <path> or --all'))
        process.exitCode = 1
        return
      }

      const parentOpts = cmd.parent?.opts() ?? {}
      const config = await resolveConfig({
        configPath: parentOpts.config as string | undefined,
      })
      const cacheDir = config.services?.cache?.dir ?? CACHE_DIR_FALLBACK

      if (opts.test) {
        const count = await purgeTest(opts.test, cacheDir)
        if (count === 0) {
          console.log(pc.dim('No cached plans found'))
        } else {
          console.log(pc.green(`Purged ${count} cached plans for ${basename(opts.test)}`))
        }
      } else if (opts.all) {
        const count = await purgeAll(cacheDir, !!opts.force)
        if (count === 0) {
          console.log(pc.dim('No cached plans found'))
        } else {
          console.log(pc.green(`Purged ${count} cached plans (all)`))
        }
      }
    })

  return cmd
}
