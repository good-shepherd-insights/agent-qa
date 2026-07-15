import { writeFileSync } from 'node:fs'

import type { CurationAuthorship, Delta } from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { describe, it } from 'vitest'

import {
  commitCurationDelta,
  drainQueue,
  type CuratorAuthor,
} from '../../../index.js'

const childMode = process.env.AGENT_QA_SIGKILL_CHILD === '1'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is required`)
  return value
}

const author: CuratorAuthor = async (job) => {
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
      summary: job.summarySeed,
      body: job.bodySeed,
      distilledEvidenceRef: {
        id: `curation-candidate-${job.candidateId}`,
        sha: job.candidateId,
      },
      originStage: 'run-curation',
    },
  }
  return { kind: 'authored', delta, authorship }
}

describe.skipIf(!childMode)('SIGKILL drain child fixture', () => {
  it('blocks after the authored checkpoint and durable intent until killed', async () => {
    const knowledgeRoot = requiredEnv('AGENT_QA_SIGKILL_KNOWLEDGE_ROOT')
    const auditBaseDir = requiredEnv('AGENT_QA_SIGKILL_AUDIT_BASE_DIR')
    const marker = requiredEnv('AGENT_QA_SIGKILL_MARKER')

    await drainQueue({
      knowledgeRoot,
      auditBaseDir,
      author,
      executionContext: 'local-interactive',
      policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
      operations: {
        commitCurationDelta: (deps, job, checkpoint) =>
          commitCurationDelta(
            {
              ...deps,
              hooks: {
                afterIntentWritten: () => {
                  writeFileSync(marker, 'authored-and-intent-durable\n', 'utf8')
                  const wait = new Int32Array(
                    new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
                  )
                  Atomics.wait(wait, 0, 0)
                },
              },
            },
            job,
            checkpoint,
          ),
      },
    })
  }, 60_000)
})
