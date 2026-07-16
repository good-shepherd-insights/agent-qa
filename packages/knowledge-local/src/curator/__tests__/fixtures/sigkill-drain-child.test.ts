import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

import {
  slugBranch,
  type CurationAuthorship,
  type Delta,
} from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { describe, expect, it } from 'vitest'

import {
  commitCurationDelta,
  drainQueue,
  enumerateBundleDirs,
  type CuratorAuthor,
} from '../../../index.js'

const childMode = process.env.AGENT_QA_SIGKILL_CHILD === '1'

type SigkillPoint = 'authored-intent' | 'publish-staged' | 'mutable-enrichment'

function parseSigkillPoint(value: string | undefined): SigkillPoint {
  if (value === undefined) return 'authored-intent'
  if (
    value === 'authored-intent'
    || value === 'publish-staged'
    || value === 'mutable-enrichment'
  ) {
    return value
  }
  throw new Error(`unsupported AGENT_QA_SIGKILL_POINT: ${value}`)
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

const MUTABLE_ENRICHED_SUMMARY =
  'Checkout submission sequence with verified terminal action'
const MUTABLE_ENRICHED_BODY =
  'Submit the resolved checkout form, wait for confirmation, and verify payment navigation.'

function scriptedAuthor(point: SigkillPoint): CuratorAuthor {
  return async (job) => {
    const authorship: CurationAuthorship = {
      path: 'llm',
      model: { id: 'sigkill-child-scripted-author' },
      executionContext: job.executionContext,
    }
    const delta: Delta = {
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
        summary:
          point === 'mutable-enrichment' ? MUTABLE_ENRICHED_SUMMARY : job.summarySeed,
        body: point === 'mutable-enrichment' ? MUTABLE_ENRICHED_BODY : job.bodySeed,
        distilledEvidenceRef: {
          id: `curation-candidate-${job.candidateId}`,
          sha: job.candidateId,
        },
        originStage: 'run-curation',
      },
    }
    return { kind: 'authored', delta, authorship }
  }
}

function markerAndBlock(
  markerPath: string,
  details: Record<string, string | number>,
): never {
  const stagingPath = `${markerPath}.${process.pid}.tmp`
  writeFileSync(stagingPath, `${JSON.stringify(details)}\n`, 'utf8')
  renameSync(stagingPath, markerPath)
  const wait = new Int32Array(
    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
  )
  Atomics.wait(wait, 0, 0)
  throw new Error('SIGKILL child boundary wait resumed unexpectedly')
}

function publishStagingDetails(
  knowledgeRoot: string,
  productKey: string,
  leaseId: string,
): { bundleId: string; stagingBasename: string } {
  const bundlesDir = join(
    knowledgeRoot,
    'memory',
    slugBranch(productKey),
    'bundles',
  )
  const stagingRoot = join(bundlesDir, '.staging')
  const stagingEntries = readdirSync(stagingRoot, { withFileTypes: true }).filter(
    (entry) =>
      entry.isDirectory()
      && entry.name.startsWith(`${leaseId}-`)
      && !entry.name.startsWith(`${leaseId}-mutation-`),
  )
  if (stagingEntries.length !== 1) {
    throw new Error(
      `publish boundary expected one ${leaseId}-owned staging tree, found ${stagingEntries.length}`,
    )
  }

  const stagingBasename = stagingEntries[0]!.name
  const manifest = JSON.parse(
    readFileSync(join(stagingRoot, stagingBasename, 'manifest.json'), 'utf8'),
  ) as { id?: unknown }
  if (typeof manifest.id !== 'string' || manifest.id === '') {
    throw new Error('publish boundary staged manifest omitted its bundle id')
  }
  if (existsSync(join(bundlesDir, manifest.id))) {
    throw new Error('publish boundary made the final bundle visible before its marker')
  }
  return { bundleId: manifest.id, stagingBasename }
}

function mutableStagingDetails(
  knowledgeRoot: string,
  leaseId: string,
): { bundleId: string; transactionBasename: string } {
  const bundles = enumerateBundleDirs(knowledgeRoot)
  if (bundles.length !== 1) {
    throw new Error(`mutable boundary expected one visible bundle, found ${bundles.length}`)
  }
  const bundle = bundles[0]!
  const bundleId = basename(bundle.dir)
  const stagingRoot = join(dirname(bundle.dir), '.staging')
  const transactionEntries = readdirSync(stagingRoot, { withFileTypes: true }).filter(
    (entry) =>
      entry.isDirectory()
      && entry.name.startsWith(`${leaseId}-mutation-${bundleId}-`),
  )
  if (transactionEntries.length !== 1) {
    throw new Error(
      `mutable boundary expected one ${leaseId}-owned transaction, found ${transactionEntries.length}`,
    )
  }
  return {
    bundleId,
    transactionBasename: transactionEntries[0]!.name,
  }
}

describe('SIGKILL child point selector', () => {
  it.each([
    'authored-intent',
    'publish-staged',
    'mutable-enrichment',
  ] as const)('accepts %s', (point) => {
    expect(parseSigkillPoint(point)).toBe(point)
  })

  it('keeps the original authored-intent mode when the selector is absent', () => {
    expect(parseSigkillPoint(undefined)).toBe('authored-intent')
  })

  it('rejects unknown selectors before the child drain starts', () => {
    expect(() => parseSigkillPoint('unknown-boundary')).toThrow(
      'unsupported AGENT_QA_SIGKILL_POINT: unknown-boundary',
    )
  })
})

describe.skipIf(!childMode)('SIGKILL drain child fixture', () => {
  it('blocks at the selected durable production boundary until killed', async () => {
    const knowledgeRoot = requiredEnv('AGENT_QA_SIGKILL_KNOWLEDGE_ROOT')
    const auditBaseDir = requiredEnv('AGENT_QA_SIGKILL_AUDIT_BASE_DIR')
    const marker = requiredEnv('AGENT_QA_SIGKILL_MARKER')
    const point = parseSigkillPoint(process.env.AGENT_QA_SIGKILL_POINT)

    await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author: scriptedAuthor(point),
      executionContext: 'local-interactive',
      policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
      operations: {
        commitCurationDelta: (deps, job, checkpoint) =>
          commitCurationDelta(
            {
              ...deps,
              hooks: {
                ...(point !== 'authored-intent'
                  ? {}
                  : {
                      afterIntentWritten: () =>
                        markerAndBlock(marker, {
                          point,
                          candidateId: job.candidateId,
                          leaseId: job.leaseId,
                        }),
                    }),
                ...(point !== 'publish-staged'
                  ? {}
                  : {
                      beforePublishRename: () => {
                        const staged = publishStagingDetails(
                          knowledgeRoot,
                          job.payload.scope.key,
                          job.leaseId,
                        )
                        markerAndBlock(marker, {
                          point,
                          candidateId: job.candidateId,
                          leaseId: job.leaseId,
                          ...staged,
                        })
                      },
                    }),
                ...(point !== 'mutable-enrichment'
                  ? {}
                  : {
                      afterMutableReplacement: (replacedRelPath: string) => {
                        if (replacedRelPath === 'manifest.json') return
                        const staged = mutableStagingDetails(
                          knowledgeRoot,
                          job.leaseId,
                        )
                        markerAndBlock(marker, {
                          point,
                          candidateId: job.candidateId,
                          leaseId: job.leaseId,
                          replacedRelPath,
                          enrichedSummary: MUTABLE_ENRICHED_SUMMARY,
                          enrichedBody: MUTABLE_ENRICHED_BODY,
                          ...staged,
                        })
                      },
                    }),
              },
            },
            job,
            checkpoint,
          ),
      },
    })
  }, 60_000)
})
