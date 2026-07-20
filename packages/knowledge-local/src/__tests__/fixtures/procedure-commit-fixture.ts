import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { BundleDraft, Delta } from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'

import {
  CURATION_QUEUE_SCHEMA_VERSION,
  candidateContentAddress,
  commitCurationDelta,
  type AuthoredDeltaCheckpoint,
  type CommitCurationDependencies,
  type CommitCurationJob,
} from '../../index.js'
import { candidateAddressFixture } from './curation-candidate-fixture.js'
import {
  makeProcedureBundleDraftFixture,
  makeProcedureScreenStateSequenceFixture,
} from './bundle-fixture.js'

export interface CommitFixtureProcedureOptions {
  /** Temp root that holds the `claimed/` staging dir; distinct from `knowledgeRoot`. */
  root: string
  knowledgeRoot: string
  auditBaseDir: string
  draft?: BundleDraft
  sourceRunId?: string
  buildOrdinal?: number
  evidenceToken?: string
  attributingObservationId?: string
}

/**
 * The LIVE procedure commit path, shared by the D-02 commit suite's shape assertions and by
 * read-face suites that need a genuinely committed agent-verified procedure bundle rather
 * than a hand-rolled index entry. Mirrors `procedure-commit.test.ts`'s job assembly exactly:
 * a content-addressed claimed candidate with per-step artifacts, a capture receipt, and an
 * authored Add delta, driven through `commitCurationDelta`.
 */
export function commitFixtureProcedure(options: CommitFixtureProcedureOptions) {
  const draft = options.draft ?? makeProcedureBundleDraftFixture()
  const sourceRunId = options.sourceRunId ?? 'run-procedure-commit'
  const buildOrdinal = options.buildOrdinal ?? 81
  const evidenceToken = options.evidenceToken ?? 'procedure-evidence'
  const attributingObservationId =
    options.attributingObservationId ?? 'run-procedure-commit:test-sign-in:step-0'

  mkdirSync(options.knowledgeRoot, { recursive: true })
  if (!existsSync(join(options.knowledgeRoot, '.epoch'))) {
    writeFileSync(join(options.knowledgeRoot, '.epoch'), '1\n', 'utf8')
  }

  const screenStates = makeProcedureScreenStateSequenceFixture()
  const artifacts = screenStates.map((_, stepIndex) => {
    const role = stepIndex === 1 ? 'dom-snapshot' as const : 'opaque-evidence' as const
    const originalName = stepIndex === 1
      ? 'procedure-step-1.dom.json'
      : `procedure-step-${stepIndex}.txt`
    const bytes = Buffer.from(
      stepIndex === 1
        ? '{"role":"textbox","name":"Password"}\n'
        : `procedure capture ${stepIndex}\n`,
    )
    return {
      bytes,
      sha: createHash('sha256').update(bytes).digest('hex'),
      stepIndex,
      role,
      originalName,
    }
  })

  const fields = candidateAddressFixture({
    schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
    sourceRunId,
    scope: draft.scope,
    buildOrdinal,
    executionContext: 'local-interactive',
    secretFlagged: false,
    injectionFlagged: false,
    kind: 'procedure',
    anchors: draft.anchors,
    summarySeed: draft.summary,
    bodySeed: draft.body,
    distilledObservations: screenStates.map((_, stepIndex) => ({
      schemaVersion: 1,
      step: {
        naturalKey: ['enter-email', 'enter-password', 'submit'][stepIndex]!,
        ordinal: stepIndex,
      },
      platform: 'web',
      test: { id: 'sign-in-test' },
      procedure: { id: 'sign-in-flow' },
      flow: {
        name: 'Sign in flow',
        ...(stepIndex === 0 ? {} : { precedes: ['enter-email', 'enter-password'][stepIndex - 1]! }),
      },
      surface: { kind: 'page', naturalKey: '/login' },
      element: {
        naturalKey: ['textbox:email', 'textbox:password', 'button:sign in'][stepIndex]!,
      },
      observedAtOrdinal: buildOrdinal + stepIndex,
    })),
    evidenceToken,
    attributingObservationId,
    artifactInventory: artifacts.map(({ bytes, sha, stepIndex, role, originalName }) => ({
      relativePath: `artifacts/${sha}`,
      sha256: sha,
      bytes: bytes.byteLength,
      stepIndex,
      role,
      originalName,
    })),
    captureReceipt: {
      regions: [
        {
          stepIndex: 1,
          elementRef: screenStates[1]!.elements[0]!.ref,
          role: 'textbox',
          normalizedName: 'password',
          reason: 'credential-name',
        },
      ],
      interactions: artifacts.map(({ stepIndex }) => ({
        stepIndex,
        elementRef: screenStates[stepIndex]!.elements[0]!.ref,
      })),
      omissions: [],
      redactions: [],
    },
    emittedAt: '2026-07-15T10:00:00.000Z',
  })

  const candidateId = candidateContentAddress(fields)
  const candidateDir = join(options.root, 'claimed', candidateId)
  const artifactsDir = join(candidateDir, 'artifacts')
  mkdirSync(artifactsDir, { recursive: true })
  for (const artifact of artifacts) {
    writeFileSync(join(artifactsDir, artifact.sha), artifact.bytes)
  }

  const job: CommitCurationJob = {
    kind: 'claimed',
    candidateId,
    leaseId: 'procedure-lease',
    payload: { candidateId, ...fields },
    candidateDir,
    payloadPath: join(candidateDir, 'payload.json'),
    artifactsDir,
    screenStates,
  }
  const delta: Delta = {
    kind: 'Add',
    origin: 'agent',
    scope: draft.scope,
    citedIds: [],
    authorship: {
      path: 'llm',
      model: { id: 'procedure-fixture' },
      executionContext: 'local-interactive',
    },
    bundle: draft,
  }
  const checkpoint: AuthoredDeltaCheckpoint = {
    schemaVersion: 1,
    delta,
    neighborIds: [],
    preconditions: [],
    authorship: delta.authorship!,
  }
  const dependencies: CommitCurationDependencies = {
    knowledgeRoot: options.knowledgeRoot,
    auditBaseDir: options.auditBaseDir,
    epoch: 1,
    profile: { mode: 'drain-to-active' },
    drainState: { supersedesSeenByAnchorKey: new Map() },
    policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
  }
  return commitCurationDelta(dependencies, job, checkpoint)
}
