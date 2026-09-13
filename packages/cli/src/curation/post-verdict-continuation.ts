// The run owns preparation independently of the runner's bounded observation of it.
// Intent is input, never authority: every path and capability comes from the current host.
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { canonicalJson, misdirectionSourceDigest, sha256hex } from '@vostride/agent-qa-schema'
import { completedRunHandoffPath, defaultCurationTailOperations } from './curation-tail.js'

export const POST_VERDICT_PENDING_FILE = 'post-verdict-pending.json'
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const intentSchema = z.object({ schemaVersion: z.literal(1), runId: z.string().min(1),
  sourceDigest: digest, configDigest: digest }).strict()
type Intent = z.infer<typeof intentSchema>
const ownerSchema = intentSchema.extend({ pid: z.number().int().positive(), token: z.uuid() }).strict()
type Owner = z.infer<typeof ownerSchema>

export class PostVerdictContinuationRefused extends Error {
  constructor(readonly category: 'unsafe-path' | 'identity-conflict' | 'intent-invalid' | 'owner-busy' | 'queue-conflict') {
    super(category)
    this.name = 'PostVerdictContinuationRefused'
  }
}

export interface PostVerdictContinuationIdentity {
  readonly agentQaRoot: string
  readonly configPath: string
  readonly knowledgeRoot: string
  readonly runId: string
  readonly maxAblations?: number
}

export function postVerdictPendingPath(input: Pick<PostVerdictContinuationIdentity, 'agentQaRoot' | 'runId'>): string {
  return join(dirname(completedRunHandoffPath(input.agentQaRoot, input.runId)), POST_VERDICT_PENDING_FILE)
}

function sync(dir: string): void {
  const fd = openSync(dir, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

/** No symlink ancestor below the trusted project; regular files only at read boundaries. */
function safePath(path: string, directory = false): void {
  const stat = lstatSync(path)
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) {
    throw new PostVerdictContinuationRefused('unsafe-path')
  }
}

function safeRun(input: PostVerdictContinuationIdentity): string {
  const root = resolve(input.agentQaRoot)
  const handoffPath = completedRunHandoffPath(root, input.runId)
  for (const path of [dirname(root), root, join(root, 'runs'), dirname(handoffPath)]) safePath(path, true)
  // State stores predate this journal; validate their ancestors/files before allowing their IO.
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) { safePath(path, true); walk(path) }
      else safePath(path)
    }
  }
  walk(dirname(handoffPath))
  safePath(handoffPath)
  safePath(input.configPath)
  return handoffPath
}

function identity(input: PostVerdictContinuationIdentity): Intent {
  const path = safeRun(input)
  const handoff = defaultCurationTailOperations().loadCompletedRunHandoff(path)
  if (String(handoff.runId) !== input.runId || handoff.gateRun || handoff.excludedFromOutcomes) {
    throw new PostVerdictContinuationRefused('identity-conflict')
  }
  return { schemaVersion: 1, runId: input.runId, sourceDigest: misdirectionSourceDigest(handoff),
    configDigest: sha256hex(canonicalJson({ configPath: resolve(input.configPath),
      config: sha256hex(readFileSync(input.configPath, 'utf8')),
      knowledgeRoot: resolve(input.knowledgeRoot), maxAblations: input.maxAblations ?? null })) }
}

function readIntent(path: string): Intent | undefined {
  try {
    safePath(path)
    return intentSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    if (error instanceof PostVerdictContinuationRefused) throw error
    throw new PostVerdictContinuationRefused('intent-invalid')
  }
}

function same(a: Intent, b: Intent): boolean { return canonicalJson(a) === canonicalJson(b) }

function publishIntent(path: string, intent: Intent): void {
  const existing = readIntent(path)
  if (existing !== undefined) {
    if (!same(existing, intent)) throw new PostVerdictContinuationRefused('identity-conflict')
    return
  }
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    const fd = openSync(tmp, 'wx', 0o600)
    try { writeFileSync(fd, `${canonicalJson(intent)}\n`); fsyncSync(fd) } finally { closeSync(fd) }
    try { linkSync(tmp, path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const raced = readIntent(path)
      if (raced === undefined || !same(raced, intent)) throw new PostVerdictContinuationRefused('identity-conflict')
    }
    sync(dirname(path))
  } finally { rmSync(tmp, { force: true }) }
}

function readOwner(lock: string, intent: Intent): Owner | undefined {
  try {
    safePath(lock, true)
    if (readdirSync(lock).join() !== 'owner.json') return undefined
    safePath(join(lock, 'owner.json'))
    const owner = ownerSchema.parse(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')))
    const { pid: _pid, token: _token, ...bound } = owner
    return same(bound, intent) ? owner : undefined
  } catch { return undefined }
}

function positivelyDead(pid: number): boolean {
  try { process.kill(pid, 0); return false }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH' }
}

/** Nonblocking candidate/owner protocol. Retained nonempty dead generations fence ABA. */
function claim(lock: string, intent: Intent): () => void {
  const owner: Owner = { ...intent, pid: process.pid, token: randomUUID() }
  const candidate = `${lock}.candidate-${owner.token}`
  mkdirSync(candidate)
  let acquired = false
  try {
    const fd = openSync(join(candidate, 'owner.json'), 'wx', 0o600)
    try { writeFileSync(fd, `${canonicalJson(owner)}\n`); fsyncSync(fd) } finally { closeSync(fd) }
    sync(candidate)
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { mkdirSync(lock) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        const current = readOwner(lock, intent)
        if (current === undefined || !positivelyDead(current.pid)) throw new PostVerdictContinuationRefused('owner-busy')
        try { renameSync(lock, `${lock}.dead-${current.token}`); sync(dirname(lock)); continue }
        catch { throw new PostVerdictContinuationRefused('owner-busy') }
      }
      renameSync(join(candidate, 'owner.json'), join(lock, 'owner.json'))
      sync(lock)
      sync(dirname(lock))
      acquired = true
      break
    }
    if (!acquired) throw new PostVerdictContinuationRefused('owner-busy')
  } finally { rmSync(candidate, { recursive: true, force: true }) }
  return () => {
    if (readOwner(lock, intent)?.token !== owner.token) throw new PostVerdictContinuationRefused('owner-busy')
    const released = `${lock}.released-${owner.token}`
    renameSync(lock, released)
    sync(dirname(lock))
    rmSync(released, { recursive: true })
    sync(dirname(lock))
  }
}

const running = new Map<string, { intent: Intent; completion: Promise<'enqueued' | 'deduped'> }>()

export function ownPostVerdictContinuation(input: PostVerdictContinuationIdentity & {
  readonly prepare: () => Promise<void>
  readonly queued: () => Promise<boolean>
  readonly enqueue: () => Promise<'enqueued' | 'deduped'>
}): Promise<'enqueued' | 'deduped'> {
  const path = postVerdictPendingPath(input)
  const intent = identity(input)
  const active = running.get(path)
  if (active !== undefined) {
    if (!same(active.intent, intent)) throw new PostVerdictContinuationRefused('identity-conflict')
    return active.completion
  }
  const release = claim(`${path}.owner`, intent)
  const completion = (async () => {
    try {
      publishIntent(path, intent)
      let result: 'enqueued' | 'deduped' = 'deduped'
      if (!await input.queued()) {
        await input.prepare()
        // Revalidate paths and source/config after preparation, before publishing a job.
        if (!same(identity(input), intent)) throw new PostVerdictContinuationRefused('identity-conflict')
        result = await input.enqueue()
        if (!await input.queued()) throw new PostVerdictContinuationRefused('queue-conflict')
      }
      const current = readIntent(path)
      if (current === undefined || !same(current, intent)) throw new PostVerdictContinuationRefused('identity-conflict')
      rmSync(path)
      sync(dirname(path))
      return result
    } finally { release() }
  })().finally(() => { running.delete(path) })
  running.set(path, { intent, completion })
  return completion
}

/** Deadline expiry observes the work; it never cancels or releases the producer. */
export async function waitForPostVerdictContinuation(
  completion: Promise<unknown> | undefined, deadlineMs: number, signal?: AbortSignal,
): Promise<boolean> {
  if (completion === undefined) return true
  if (signal?.aborted || Date.now() >= deadlineMs) return false
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    return await Promise.race([
      completion.then(() => true, () => true),
      new Promise<boolean>((done) => {
        timer = setTimeout(() => done(false), Math.max(0, deadlineMs - Date.now()))
        onAbort = () => done(false)
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) done(false)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
  }
}
