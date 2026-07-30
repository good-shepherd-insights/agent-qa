import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  commitCurationDelta,
  drainQueue,
  openIndexWriter,
  type AuthoredDeltaCheckpoint,
  type CommitCurationDependencies,
  type CommitCurationJob,
  type CommitCurationOutcome,
  type CuratorAuthor,
} from '@vostride/agent-qa-knowledge-local'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'

import {
  createScriptedAuthor,
  enqueueFixtureBytes,
  readFixture,
} from '../dual-host/fixtures.js'
import { FENCING_ENV, writeDurableJson } from './spawn-helpers.js'

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`missing ${name}`)
  return value
}

function blockSynchronouslyUntil(file: string): void {
  const sleepCell = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT))
  while (!existsSync(file)) Atomics.wait(sleepCell, 0, 0, 20)
}

function currentAuthor(fixture: ReturnType<typeof readFixture>): CuratorAuthor {
  return createScriptedAuthor(fixture, [])
}

export async function runPausedDrainerFixture(): Promise<void> {
  const root = requiredEnv(FENCING_ENV.root)
  const fixture = readFixture(requiredEnv(FENCING_ENV.fixture))
  const marker = requiredEnv(FENCING_ENV.marker)
  const permit = requiredEnv(FENCING_ENV.permit)
  const reportFile = requiredEnv(FENCING_ENV.report)
  const knowledgeRoot = join(root, 'agent-qa-knowledge')
  const agentQaRoot = join(root, '.agent-qa')
  const candidateId = fixture.candidates[0]?.candidateId
  if (candidateId === undefined || fixture.candidates.length !== 1) {
    throw new Error('fencing fixture requires exactly one candidate')
  }

  openIndexWriter(knowledgeRoot).close()
  enqueueFixtureBytes(knowledgeRoot, fixture)

  let hookCount = 0
  let beforePublishRenameReached = false
  let retained: {
    deps: CommitCurationDependencies
    job: CommitCurationJob
    checkpoint: AuthoredDeltaCheckpoint
  } | undefined
  let firstOutcome: CommitCurationOutcome | undefined

  const wrappedCommit = (
    deps: CommitCurationDependencies,
    job: CommitCurationJob,
    checkpoint: AuthoredDeltaCheckpoint,
  ): CommitCurationOutcome => {
    if (retained !== undefined) throw new Error('the real drain entered the commit wrapper twice')
    const retainedDeps: CommitCurationDependencies = {
      ...deps,
      hooks: {
        ...deps.hooks,
        afterIntentWritten: () => {
          deps.hooks?.afterIntentWritten?.()
          hookCount += 1
          writeDurableJson(marker, {
            phase: 'afterIntentWritten',
            pid: process.pid,
            candidateId: job.candidateId,
            leaseId: job.leaseId,
            oldEpoch: deps.epoch,
          })
          blockSynchronouslyUntil(permit)
        },
        beforePublishRename: () => {
          beforePublishRenameReached = true
          throw new Error('stale drainer reached beforePublishRename')
        },
      },
    }
    retained = { deps: retainedDeps, job, checkpoint }
    firstOutcome = commitCurationDelta(retainedDeps, job, checkpoint)
    return firstOutcome
  }

  try {
    await drainQueue({
      knowledgeRoot,
      auditBaseDir: agentQaRoot,
      author: currentAuthor(fixture),
      executionContext: 'local-interactive',
      policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
      maintenance: 'skip',
      operations: { commitCurationDelta: wrappedCommit },
    })

    if (retained === undefined || firstOutcome?.kind !== 'abandoned-stale-epoch') {
      throw new Error(`expected a real stale-epoch refusal, received ${JSON.stringify(firstOutcome)}`)
    }
    if (hookCount !== 1 || beforePublishRenameReached) {
      throw new Error(
        `invalid guard path: afterIntentWritten=${hookCount}, beforePublishRename=${beforePublishRenameReached}`,
      )
    }

    writeDurableJson(reportFile, {
      failed: true,
      pid: process.pid,
      candidateId,
      oldEpoch: retained.deps.epoch,
      exactInputRetained: true,
      hookCount,
      beforePublishRenameReached,
      outcomes: [{ guard: 'beforePublish', ...firstOutcome }],
    })
    throw new Error(
      `expected fencing refusal: ${firstOutcome.kind} (observed ${firstOutcome.observedEpoch})`,
    )
  } catch (error) {
    if (!existsSync(reportFile)) {
      writeDurableJson(reportFile, {
        failed: true,
        pid: process.pid,
        candidateId,
        reason: error instanceof Error ? error.message : String(error),
        outcomes: firstOutcome === undefined ? [] : [firstOutcome],
      })
    }
    throw error
  }
}

if (process.env[FENCING_ENV.role] === 'paused-drainer') {
  void runPausedDrainerFixture().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
