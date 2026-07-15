import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
} from '@ai-sdk/provider'
import {
  CURATION_QUEUE_SCHEMA_VERSION,
  buildCurationCandidateAddressFields,
  candidateContentAddress,
  enqueueCurationCandidate,
  enumerateBundleDirs,
  type CurationCandidatePayload,
} from '@vostride/agent-qa-knowledge-local'
import {
  createModel,
  type ModelProfile,
  type ResolvedModelAuth,
} from '@vostride/agent-qa-model'
import type { CompletedRunHandoff } from '@vostride/agent-qa-schema'
import {
  defaultGuardrailPolicyInput,
  loadGuardrailPolicy,
} from '@vostride/agent-qa-safety'
import { JsonlAuditSink } from '@vostride/agent-qa-safety-local'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildCuratorAuthor,
  runCurationTail,
  runVerdictFirstCurationTail,
  type RunCurationTailOptions,
} from '../index.js'

const noneAuth: ResolvedModelAuth = { kind: 'none' }

function generated(text: string): Awaited<ReturnType<LanguageModelV3['doGenerate']>> {
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
    warnings: [],
  }
}

function scriptedModel(onCall: (options: LanguageModelV3CallOptions) => void): LanguageModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'curation-audit-scripted',
    modelId: 'curation-audit-scripted',
    supportedUrls: {},
    async doGenerate(options) {
      onCall(options)
      return generated(JSON.stringify({
        kind: 'Add',
        citedAliases: [],
        bundle: {
          kind: 'fact',
          subtype: 'selector',
          anchors: [{ t: 'el', role: 'button', name: 'Place order' }],
          summary: 'Verified checkout submission control',
          body: 'The Place order button submits the completed checkout form.',
        },
      }))
    },
    async doStream() {
      return { stream: new ReadableStream() }
    },
  }
}

function profile(): ModelProfile {
  return {
    provider: 'openai-compatible',
    model: 'curation-audit-scripted',
    baseURL: 'http://localhost:11434/v1',
    auth: { mode: 'none' },
    capabilities: {
      text: true,
      vision: false,
      visionToolMessages: false,
      toolCalling: true,
      structuredOutput: false,
      streaming: false,
      contextWindow: 16_384,
      maxOutput: 1_024,
    },
  }
}

describe('tail-scoped Curator egress audit coverage (CUR-05)', () => {
  let root: string
  let agentQaRoot: string
  let knowledgeRoot: string
  let candidate: CurationCandidatePayload

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cli-curation-audit-'))
    agentQaRoot = join(root, '.agent-qa')
    knowledgeRoot = join(root, 'agent-qa-knowledge')
    const fields = buildCurationCandidateAddressFields({
      schemaVersion: CURATION_QUEUE_SCHEMA_VERSION,
      sourceRunId: 'run-curation-audit',
      scope: { tier: 'product', key: 'storefront' },
      buildOrdinal: 42,
      executionContext: 'local-interactive',
      secretFlagged: false,
      injectionFlagged: false,
      kind: 'fact',
      subtype: 'selector',
      anchors: [{ t: 'el', role: 'button', name: 'Place order' }],
      summarySeed: 'Use Bearer abcdefghijklmno12345 to describe the checkout control',
      bodySeed: 'The Place order button was resolved and verified.',
      distilledObservations: [],
      evidenceToken: 'evidence-curation-audit',
      attributingObservationId: 'run-curation-audit:test-0:step-0',
      artifactInventory: [],
      emittedAt: '2026-07-15T10:00:00.000Z',
    })
    candidate = { candidateId: candidateContentAddress(fields), ...fields }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function tailOptions(
    auditSink: JsonlAuditSink,
    modelCalls: ReturnType<typeof vi.fn<(options: LanguageModelV3CallOptions) => void>>,
  ): RunCurationTailOptions {
    const resolvedProfile = profile()
    return {
      runId: 'run-curation-audit',
      agentQaRoot,
      knowledgeConfig: { dir: knowledgeRoot },
      configDir: root,
      auditSink,
      modelDeps: { profile: resolvedProfile, auth: noneAuth },
      policy: loadGuardrailPolicy(defaultGuardrailPolicyInput),
      log: { warn: vi.fn() },
      operations: {
        loadCompletedRunHandoff: () => ({
          executionContext: 'local-interactive',
        }) as CompletedRunHandoff,
        resolveKnowledgeRoot: () => knowledgeRoot,
        emitCurationCandidates: () => {
          expect(
            enqueueCurationCandidate({
              knowledgeRoot,
              payload: candidate,
              artifactSources: [],
            }),
          ).toBe('enqueued')
          return {
            enqueued: 1,
            coalesced: 0,
            capExceeded: 0,
            refused: 0,
            details: [],
          }
        },
        buildCuratorAuthor: (deps) => buildCuratorAuthor({
          ...deps,
          createModelImpl: (seenProfile, auth) => createModel(seenProfile, auth, {
            languageModels: {
              [seenProfile.model]: scriptedModel(modelCalls),
            },
          }),
        }),
      },
    }
  }

  it('writes a guardrail row for the audited createModel call inside runCurationTail', async () => {
    const modelCalls = vi.fn<(options: LanguageModelV3CallOptions) => void>()
    const sink = new JsonlAuditSink(agentQaRoot)

    await runCurationTail(tailOptions(sink, modelCalls))

    expect(modelCalls).toHaveBeenCalledOnce()
    expect(enumerateBundleDirs(knowledgeRoot)).toHaveLength(1)
    const auditFile = join(agentQaRoot, 'guardrail_audit.jsonl')
    expect(existsSync(auditFile)).toBe(true)
    const rows = readFileSync(auditFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(rows).toContainEqual(
      expect.objectContaining({
        channel: 'request',
        action: 'redact',
        detector: 'bearer',
      }),
    )
  })

  it('records no curation egress when --detach skips the tail', async () => {
    const modelCalls = vi.fn<(options: LanguageModelV3CallOptions) => void>()
    const sink = new JsonlAuditSink(agentQaRoot)
    const runTail = vi.fn(() => runCurationTail(tailOptions(sink, modelCalls)))

    await expect(
      runVerdictFirstCurationTail({ exitCode: 0, detach: true, runTail }),
    ).resolves.toBe(0)

    expect(runTail).not.toHaveBeenCalled()
    expect(modelCalls).not.toHaveBeenCalled()
    expect(existsSync(join(agentQaRoot, 'guardrail_audit.jsonl'))).toBe(false)
  })
})
