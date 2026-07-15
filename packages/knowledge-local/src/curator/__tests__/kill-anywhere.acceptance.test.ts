import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { CurationAuthorship, Delta } from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { describe, expect, it, vi } from 'vitest'

import {
  CURATION_QUEUE_SCHEMA_VERSION,
  candidateContentAddress,
  commitCurationDelta,
  drainQueue,
  enqueueCurationCandidate,
  enumerateBundleDirs,
  listClaimedLeases,
  listQueuedCandidates,
  loadBundle,
  openIndexReaderConnection,
  readJobState,
  verifyBundleIntegrity,
  type CurationCandidateAddressFields,
  type CurationCandidatePayload,
  type CuratorAuthor,
  type DrainOptions,
} from '../../index.js'

const policy = loadGuardrailPolicy(defaultGuardrailPolicyInput)
const TEST_TIMEOUT_MS = 30_000

type FaultPoint =
  | 'after-emit-before-claim'
  | 'after-claim-before-author'
  | 'after-authored-before-bundling'
  | 'mid-bundling-staged-unpublished'
  | 'after-publish-before-index'
  | 'after-index-before-intent-clear'

type DrainOperations = NonNullable<DrainOptions['operations']>

function addressFields(seed: string): CurationCandidateAddressFields {
  return {
    schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
    sourceRunId: `run-${seed}`,
    scope: { tier: 'product', key: 'storefront' },
    buildOrdinal: 42,
    executionContext: 'local-interactive',
    secretFlagged: false,
    injectionFlagged: false,
    kind: 'fact',
    subtype: 'selector',
    anchors: [{ t: 'el', role: 'button', name: `Checkout ${seed}` }],
    summarySeed: `Checkout ${seed} selector`,
    bodySeed: `The Checkout ${seed} button was resolved and verified.`,
    distilledObservations: [
      {
        schemaVersion: 1,
        step: { naturalKey: `checkout-${seed}`, ordinal: 0 },
        platform: 'web',
        element: { naturalKey: `button:checkout-${seed}` },
        observedAtOrdinal: 42,
      },
    ],
    evidenceToken: `evidence-${seed}`,
    attributingObservationId: `run-${seed}:test-0:step-0`,
    artifactInventory: [],
    emittedAt: '2026-07-15T10:00:00.000Z',
  }
}

function payload(seed: string): CurationCandidatePayload {
  const fields = addressFields(seed)
  return { candidateId: candidateContentAddress(fields), ...fields }
}

function authoredAdd(job: Parameters<CuratorAuthor>[0]): {
  delta: Delta
  authorship: CurationAuthorship
} {
  const authorship: CurationAuthorship = {
    path: 'llm',
    model: { id: 'kill-anywhere-scripted-author' },
    executionContext: job.executionContext,
  }
  return {
    authorship,
    delta: {
      kind: 'Add',
      origin: 'agent',
      scope: job.scope,
      citedIds: [],
      authorship,
      bundle: {
        kind: job.kind,
        ...(job.subtype === undefined ? {} : { subtype: job.subtype }),
        anchors: job.anchors,
        scope: job.scope,
        summary: job.summarySeed,
        body: job.bodySeed,
        distilledEvidenceRef: {
          id: `curation-candidate-${job.candidateId}`,
          sha: job.candidateId,
        },
        originStage: 'run-curation',
      },
    },
  }
}

function scriptedAuthor() {
  return vi.fn<CuratorAuthor>(async (job) => ({ kind: 'authored', ...authoredAdd(job) }))
}

function enqueue(knowledgeRoot: string, candidate: CurationCandidatePayload): void {
  expect(
    enqueueCurationCandidate({
      knowledgeRoot,
      payload: candidate,
      artifactSources: [],
    }),
  ).toBe('enqueued')
}

function walk(root: string): string[] {
  if (!existsSync(root)) return []
  const entries: string[] = []
  const visit = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const absolute = join(current, name)
      entries.push(relative(root, absolute))
      if (statSync(absolute).isDirectory()) visit(absolute)
    }
  }
  visit(root)
  return entries
}

function treeSnapshot(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {}
  if (!existsSync(root)) return snapshot
  const visit = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const absolute = join(current, name)
      if (statSync(absolute).isDirectory()) {
        visit(absolute)
      } else {
        snapshot[relative(root, absolute)] = readFileSync(absolute).toString('base64')
      }
    }
  }
  visit(root)
  return snapshot
}

function hasIndexRow(knowledgeRoot: string, bundleId: string): boolean {
  const reader = openIndexReaderConnection(knowledgeRoot)
  try {
    return reader.db
      .prepare('SELECT 1 FROM records WHERE bundle_id = ?')
      .get(bundleId) !== undefined
  } finally {
    reader.db.close()
  }
}

function assertConsistent(
  knowledgeRoot: string,
  candidateId: string,
): { bundleId: string; bundleTree: string } {
  const bundles = enumerateBundleDirs(knowledgeRoot)
  expect(bundles).toHaveLength(1)
  const bundle = bundles[0]!
  const loaded = loadBundle(bundle.dir)
  expect(loaded.kind).toBe('loaded')
  if (loaded.kind !== 'loaded') throw new Error('expected one readable committed bundle')
  expect(verifyBundleIntegrity(bundle.dir)).toEqual({ ok: true, violations: [] })
  expect(hasIndexRow(knowledgeRoot, loaded.bundle.manifest.id)).toBe(true)
  expect(listQueuedCandidates(knowledgeRoot)).toEqual([])
  expect(listClaimedLeases(knowledgeRoot)).toEqual([])
  expect(readJobState(knowledgeRoot, candidateId).kind).toBe('absent')

  const residualPaths = walk(knowledgeRoot)
  expect(residualPaths.filter((entry) => entry.split('/').includes('.staging'))).toEqual([])
  expect(residualPaths.filter((entry) => entry.endsWith('.intent.json'))).toEqual([])
  return { bundleId: loaded.bundle.manifest.id, bundleTree: dirname(bundle.dir) }
}

function options(
  knowledgeRoot: string,
  auditBaseDir: string,
  author: CuratorAuthor,
  operations?: DrainOperations,
): DrainOptions {
  return {
    knowledgeRoot,
    auditBaseDir,
    author,
    executionContext: 'local-interactive',
    policy,
    ...(operations === undefined ? {} : { operations }),
  }
}

function operationsForFault(
  point: FaultPoint,
  knowledgeRoot: string,
  observed: { value: boolean },
): DrainOperations {
  if (point === 'after-claim-before-author') {
    return {
      readJobState: () => {
        observed.value = listClaimedLeases(knowledgeRoot).length === 1
        throw new Error('injected crash after claim before author')
      },
    }
  }
  if (point === 'after-authored-before-bundling') {
    return {
      commitCurationDelta: () => {
        observed.value = true
        throw new Error('injected crash after authored checkpoint')
      },
    }
  }
  if (point === 'mid-bundling-staged-unpublished') {
    return {
      commitCurationDelta: (deps, job, checkpoint) =>
        commitCurationDelta(
          {
            ...deps,
            hooks: {
              beforePublishRename: () => {
                observed.value = walk(knowledgeRoot).some((entry) =>
                  entry.split('/').includes('.staging'),
                )
                throw new Error('injected crash with staged unpublished bundle')
              },
            },
          },
          job,
          checkpoint,
        ),
    }
  }
  if (point === 'after-publish-before-index') {
    return {
      commitCurationDelta: (deps, job, checkpoint) =>
        commitCurationDelta(
          {
            ...deps,
            hooks: {
              afterBundlePublished: () => {
                observed.value = enumerateBundleDirs(knowledgeRoot).length === 1
                throw new Error('injected crash after publish before index')
              },
            },
          },
          job,
          checkpoint,
        ),
    }
  }
  if (point === 'after-index-before-intent-clear') {
    return {
      commitCurationDelta: (deps, job, checkpoint) =>
        commitCurationDelta(
          {
            ...deps,
            hooks: {
              afterIndexApplied: (bundleId) => {
                observed.value = hasIndexRow(knowledgeRoot, bundleId)
                throw new Error('injected crash after index before intent clear')
              },
            },
          },
          job,
          checkpoint,
        ),
    }
  }
  return {}
}

describe('kill-anywhere recovery across memory.md §8.7 lifecycle boundaries (CUR-04)', () => {
  const matrix: readonly FaultPoint[] = [
    'after-emit-before-claim',
    'after-claim-before-author',
    'after-authored-before-bundling',
    'mid-bundling-staged-unpublished',
    'after-publish-before-index',
    'after-index-before-intent-clear',
  ]

  it.each(matrix)('recovers %s exactly once without post-checkpoint re-authoring', async (point) => {
    const root = mkdtempSync(join(tmpdir(), `knowledge-kill-${point}-`))
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const auditBaseDir = join(root, '.agent-qa')
    const candidate = payload(point)
    const author = scriptedAuthor()
    const observed = { value: point === 'after-emit-before-claim' }
    enqueue(knowledgeRoot, candidate)

    try {
      if (point === 'after-emit-before-claim') {
        const controller = new AbortController()
        controller.abort()
        const first = await drainQueue({
          ...options(knowledgeRoot, auditBaseDir, author),
          signal: controller.signal,
        })
        expect(first.kind).toBe('aborted')
      } else if (point === 'after-claim-before-author') {
        await expect(
          drainQueue(
            options(
              knowledgeRoot,
              auditBaseDir,
              author,
              operationsForFault(point, knowledgeRoot, observed),
            ),
          ),
        ).rejects.toThrow('injected crash after claim before author')
      } else {
        const first = await drainQueue(
          options(
            knowledgeRoot,
            auditBaseDir,
            author,
            operationsForFault(point, knowledgeRoot, observed),
          ),
        )
        expect(first.failures).toBeGreaterThanOrEqual(1)
      }

      expect(observed.value).toBe(true)
      const callsAtRecoveryStart = author.mock.calls.length
      if (point === 'after-authored-before-bundling'
        || point === 'mid-bundling-staged-unpublished'
        || point === 'after-publish-before-index'
        || point === 'after-index-before-intent-clear') {
        expect(callsAtRecoveryStart).toBe(1)
      }

      await drainQueue(options(knowledgeRoot, auditBaseDir, author))
      const consistent = assertConsistent(knowledgeRoot, candidate.candidateId)
      expect(author).toHaveBeenCalledTimes(1)

      const beforeSecondRecovery = treeSnapshot(consistent.bundleTree)
      await drainQueue(options(knowledgeRoot, auditBaseDir, author))
      expect(treeSnapshot(consistent.bundleTree)).toEqual(beforeSecondRecovery)
      expect(enumerateBundleDirs(knowledgeRoot).map(({ dir }) => dir)).toHaveLength(1)
      expect(author).toHaveBeenCalledTimes(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('recovers a real SIGKILL after authored intent in under 30 seconds', async () => {
    const startedAt = Date.now()
    const root = mkdtempSync(join(tmpdir(), 'knowledge-sigkill-'))
    const knowledgeRoot = join(root, 'agent-qa-knowledge')
    const auditBaseDir = join(root, '.agent-qa')
    const markerPath = join(root, 'child-at-intent.marker')
    const candidate = payload('sigkill')
    enqueue(knowledgeRoot, candidate)

    const fixturePath = fileURLToPath(
      new URL('./fixtures/sigkill-drain-child.test.ts', import.meta.url),
    )
    const packageRoot = fileURLToPath(new URL('../../../', import.meta.url))
    const vitestPath = join(packageRoot, 'node_modules', 'vitest', 'vitest.mjs')
    const child = spawn(
      process.execPath,
      [
        vitestPath,
        'run',
        fixturePath,
        '--pool=threads',
        '--maxWorkers=1',
      ],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          AGENT_QA_SIGKILL_CHILD: '1',
          AGENT_QA_SIGKILL_KNOWLEDGE_ROOT: knowledgeRoot,
          AGENT_QA_SIGKILL_AUDIT_BASE_DIR: auditBaseDir,
          AGENT_QA_SIGKILL_MARKER: markerPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let childOutput = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      childOutput += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      childOutput += chunk
    })

    try {
      const markerDeadline = Date.now() + 10_000
      while (!existsSync(markerPath) && Date.now() < markerDeadline) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`SIGKILL fixture exited before marker:\n${childOutput}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      if (!existsSync(markerPath)) {
        throw new Error(`timed out waiting for SIGKILL marker:\n${childOutput}`)
      }

      const exited = once(child, 'exit')
      expect(child.kill('SIGKILL')).toBe(true)
      await exited

      const leasePath = join(knowledgeRoot, '.lease')
      const lease = JSON.parse(readFileSync(leasePath, 'utf8')) as Record<string, unknown>
      writeFileSync(leasePath, `${JSON.stringify({ ...lease, heartbeatAtMs: 0 })}\n`, 'utf8')

      const recoveryAuthor = scriptedAuthor()
      await drainQueue(options(knowledgeRoot, auditBaseDir, recoveryAuthor))
      assertConsistent(knowledgeRoot, candidate.candidateId)
      expect(recoveryAuthor).not.toHaveBeenCalled()
      expect(Date.now() - startedAt).toBeLessThan(TEST_TIMEOUT_MS)
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      rmSync(root, { recursive: true, force: true })
    }
  }, TEST_TIMEOUT_MS)
})
