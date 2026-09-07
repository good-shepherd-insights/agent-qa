// Run-owned DATA, published before queue handoff. A drainer's flags never own another run.
import { closeSync, fsyncSync, linkSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export interface RunCanaryPolicy {
  schemaVersion: 1
  runId: string
  maxAblations: number
  source: 'flag' | 'config' | 'default'
}
const POLICY_FILE = 'canary-policy.json'

export function readRunCanaryPolicy(runDir: string, runId: string): RunCanaryPolicy | undefined {
  let text: string
  try { text = readFileSync(join(runDir, POLICY_FILE), 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error('canary policy unavailable')
  }
  const policy: unknown = JSON.parse(text)
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)
    || Object.keys(policy).sort().join(',') !== 'maxAblations,runId,schemaVersion,source'
    || !('schemaVersion' in policy) || policy.schemaVersion !== 1
    || !('runId' in policy) || policy.runId !== runId
    || !('maxAblations' in policy) || typeof policy.maxAblations !== 'number'
    || !Number.isSafeInteger(policy.maxAblations) || policy.maxAblations < 1
    || !('source' in policy) || !['flag', 'config', 'default'].includes(String(policy.source))) {
    throw new Error('canary policy invalid')
  }
  return policy as RunCanaryPolicy
}

export function writeRunCanaryPolicy(runDir: string, policy: RunCanaryPolicy): void {
  const existing = readRunCanaryPolicy(runDir, policy.runId)
  // Resumption preserves the ORIGINAL resolution, including its recorded source.
  if (existing !== undefined) return
  const temporary = join(runDir, `.${POLICY_FILE}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(policy) + '\n', { flag: 'wx', mode: 0o600 })
    const fd = openSync(temporary, 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
    try { linkSync(temporary, join(runDir, POLICY_FILE)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      readRunCanaryPolicy(runDir, policy.runId)
    }
    const dir = openSync(runDir, 'r')
    try { fsyncSync(dir) } finally { closeSync(dir) }
  } finally { rmSync(temporary, { force: true }) }
}
