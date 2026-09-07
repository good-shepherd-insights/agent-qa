// Run-owned DATA, published before queue handoff. A drainer's flags never own another run.
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { CROSS_CHECKS, canonicalJson, sha256hex } from '@vostride/agent-qa-schema'

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

const count = z.number().int().nonnegative()
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const completionSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string().min(1), candidateId: z.string().min(1),
  attributedObservationId: z.string().min(1), observedStateDigest: digest,
  result: z.union([z.object({
    kind: z.literal('ablated'), crossCheck: z.enum(CROSS_CHECKS), corpusDigest: digest,
    k: z.number().int().min(3).refine(k => k % 2 === 1), baseSeed: z.number().int(),
    seeds: z.array(z.number().int()), seedHonored: z.boolean(),
    spend: z.object({ modelCalls: count, screens: count, promptTokens: count, completionTokens: count }).strict(),
    gate2Dir: z.string().min(1),
  }).strict().refine(result => result.seeds.length === result.k && result.seeds[0] === result.baseSeed),
  z.object({ kind: z.literal('error'), message: z.literal('ablation-error') }).strict(),
  z.object({ kind: z.literal('unavailable'), reason: z.literal('ablation-unavailable') }).strict(),
  z.object({ kind: z.literal('no-eval-root') }).strict()]),
}).strict()
export type CompletedCanaryAblation = z.infer<typeof completionSchema>
const COMPLETIONS_DIR = 'canary-completions'

/** Completed calls only: an interrupted/unrecorded provider call is not recovered here. */
export function readCompletedCanaryAblations(runDir: string, runId: string): CompletedCanaryAblation[] {
  const dir = join(runDir, COMPLETIONS_DIR)
  let names: string[]
  try { names = readdirSync(dir).sort() } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error('completed canary evidence unavailable')
  }
  return names.filter(name => !name.startsWith('.')).map(name => {
    let value: CompletedCanaryAblation
    try { value = completionSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8'))) }
    catch { throw new Error('completed canary evidence invalid') }
    if (value.runId !== runId || name !== `${sha256hex(value.candidateId)}.json`) {
      throw new Error('completed canary evidence identity mismatch')
    }
    return value
  })
}

export function saveCompletedCanaryAblation(runDir: string, input: CompletedCanaryAblation): void {
  const value = completionSchema.parse(input)
  const dir = join(runDir, COMPLETIONS_DIR)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${sha256hex(value.candidateId)}.json`)
  const temporary = join(dir, `.${randomUUID()}.tmp`)
  const text = canonicalJson(value) + '\n'
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 })
    const fd = openSync(temporary, 'r')
    try { fsyncSync(fd) } finally { closeSync(fd) }
    try { linkSync(temporary, file) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || readFileSync(file, 'utf8') !== text) {
        throw new Error('completed canary evidence conflict')
      }
    }
    const directory = openSync(dir, 'r')
    try { fsyncSync(directory) } finally { closeSync(directory) }
  } finally { rmSync(temporary, { force: true }) }
}
