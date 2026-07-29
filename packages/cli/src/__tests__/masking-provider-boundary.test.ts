// SEAM-01 captured-provider-boundary proof (Phase 362, Plan 07 — the phase's headline behavioral
// proof) + the SEAM-02/04 stamped-audit integration proof.
//
// Unlike model/__tests__/masking-egress.test.ts (which installs the active-context resolver
// DIRECTLY to prove createModel egress reaches the masking hook), this proof drives the REAL
// production chain end-to-end in-process: the 362-05 seed helper `buildRunMaskingContext`, the
// 362-02 ALS scope `runSafetyScope`, safety-local's package-import-installed masking resolver, the
// untouched pinned-last model-registrar middleware, and `createModel`'s provider overrides as the
// capture point. It therefore FAILS if any link of the run-scope chain breaks — not just the hook.
// We deliberately do NOT call setActiveMaskingContextResolver: the resolver under proof is the one
// safety-local wires on import (als.getStore()?.maskingContext), so there is no global resolver
// state to restore and the suite stays order-independent (scopes exit after each awaited test body).

import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import { SecretStore } from '@vostride/agent-qa-runner'
import { createModel } from '@vostride/agent-qa-model'
import type { ResolvedModelAuth } from '@vostride/agent-qa-model'
import { runSafetyScope } from '@vostride/agent-qa-safety-local'
import { describe, expect, it } from 'vitest'

import { buildRunAuditSink, buildRunMaskingContext } from '@vostride/agent-qa-agent-local'
import { buildRunSafetyHooks } from '../run-session-composition.js'

// Derive the AI-SDK shapes from `createModel` itself — the CLI package declares neither
// @ai-sdk/provider nor @vostride/agent-qa-schema, and this proof needs neither.
type StubLanguageModel = ReturnType<typeof createModel>
type CapturedCallOptions = Parameters<StubLanguageModel['doGenerate']>[0]
type StubGenerateResult = Awaited<ReturnType<StubLanguageModel['doGenerate']>>

const noneAuth: ResolvedModelAuth = { kind: 'none' }

// Fixtures: obviously-fake literals (T-362-23), each >=16 chars so the masking context's default
// 4-char floor registers them, and each hyphenated to avoid the guardrail detector shapes
// (sk-/ghp_/AIza/AKIA/Bearer/40-contiguous-base64/luhn-card/email) — so an UNMASKED value passes
// through the pinned-last seam untouched, keeping the masking claim and the guardrail claim separate
// (the masking-egress.test.ts separation of concerns).
const fileSecret = 'file-secret-passphrase-alpha'
const envSecret = 'env-token-passphrase-bravo'
const cookieSecret = 'cookie-session-passphrase-charlie'
const passthroughValue = 'passthrough-plain-marker-delta'

function stubGenerateResult(): StubGenerateResult {
  return {
    content: [],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
    warnings: [],
  }
}

// A local capturing LanguageModelV3 injected via createModel's overrides.languageModels. It records
// the params `doGenerate` receives — which is POST pinned-last middleware, i.e. after transformParams
// (mask + guardrail) has run — exactly the captured provider boundary.
function createCapturingModel(): {
  captured: () => CapturedCallOptions | undefined
  model: StubLanguageModel
} {
  let captured: CapturedCallOptions | undefined
  const stub: StubLanguageModel = {
    specificationVersion: 'v3',
    provider: 'stub',
    modelId: 'stub',
    supportedUrls: {},
    async doGenerate(params) {
      captured = params
      return stubGenerateResult()
    },
    async doStream() {
      return { stream: new ReadableStream() }
    },
  }
  const model = createModel(
    {
      provider: 'openai-compatible',
      model: 'override-model',
      baseURL: 'http://localhost:11434/v1',
      auth: { mode: 'none' },
    },
    noneAuth,
    { languageModels: { 'override-model': stub } },
  )
  return { captured: () => captured, model }
}

function promptRequest(text: string): CapturedCallOptions {
  return {
    prompt: [
      {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    ],
  }
}

function capturedUserText(captured: CapturedCallOptions | undefined): string {
  expect(captured).toBeDefined()
  const message = captured?.prompt[0]
  expect(message?.role).toBe('user')
  if (message?.role !== 'user') throw new Error('expected captured user message')

  const part = message.content[0]
  expect(part?.type).toBe('text')
  if (part?.type !== 'text') throw new Error('expected captured text part')

  return part.text
}

describe('SEAM-01 captured-provider-boundary proof (production chain)', () => {
  it('masks in-scope secret + sensitive-env + auth-state values at the captured boundary; raw absent from serialized params', async () => {
    // Seed the REAL run MaskingContext from the same three production sources run.ts uses:
    // the run SecretStore (fromEnvContent — the run.ts source), a sensitive-name env entry, and an
    // auth-state storageState payload.
    const secretStore = SecretStore.fromEnvContent(`MY_SERVICE_SECRET=${fileSecret}`)
    const maskingContext = buildRunMaskingContext({
      secretStore,
      env: { MY_API_TOKEN: envSecret },
      authStatePayloads: [{ cookies: [{ name: 'session', value: cookieSecret }] }],
    })

    const { captured, model } = createCapturingModel()

    try {
      await runSafetyScope({ maskingContext }, async () => {
        await model.doGenerate(
          promptRequest(`file=${fileSecret} env=${envSecret} cookie=${cookieSecret}`),
        )
      })

      // Placeholder presence: the seam replaced the seeded values with <SECRET_n> tokens.
      const text = capturedUserText(captured())
      expect(text).toMatch(/<SECRET_\d+>/)

      // Raw absence: over the FULL serialized captured params, not just the user text (acceptance).
      const serialized = JSON.stringify(captured())
      expect(serialized).not.toContain(fileSecret)
      expect(serialized).not.toContain(envSecret)
      expect(serialized).not.toContain(cookieSecret)
    } finally {
      maskingContext.dispose()
    }
  })

  it('passes a raw value through untouched when invoked OUTSIDE any safety scope', async () => {
    // No active run scope => the ALS store is empty => getActiveMaskingContext() is undefined => the
    // masking hook is a passthrough. The fixture matches no guardrail detector, so it survives raw.
    const { captured, model } = createCapturingModel()

    await model.doGenerate(promptRequest(`plain=${passthroughValue}`))

    const text = capturedUserText(captured())
    expect(text).toBe(`plain=${passthroughValue}`)
    expect(text).not.toContain('<SECRET_')
  })

  it('isolates sibling scopes — each capture sees only its own placeholders (D-02 concurrent guarantee)', async () => {
    const secretA = 'sibling-secret-alpha-value'
    const secretB = 'sibling-secret-bravo-value'
    const ctxA = buildRunMaskingContext({ env: { A_SERVICE_TOKEN: secretA } })
    const ctxB = buildRunMaskingContext({ env: { B_SERVICE_TOKEN: secretB } })
    const capA = createCapturingModel()
    const capB = createCapturingModel()

    try {
      // Two concurrent ALS scopes: each doGenerate resolves only its own scope's masking context.
      await Promise.all([
        runSafetyScope({ maskingContext: ctxA }, async () => {
          await capA.model.doGenerate(promptRequest(`uses ${secretA} and names ${secretB}`))
        }),
        runSafetyScope({ maskingContext: ctxB }, async () => {
          await capB.model.doGenerate(promptRequest(`uses ${secretB} and names ${secretA}`))
        }),
      ])

      const serializedA = JSON.stringify(capA.captured())
      const serializedB = JSON.stringify(capB.captured())

      // Scope A masks its OWN secret but NOT the sibling's (ctxA never registered secretB).
      expect(serializedA).not.toContain(secretA)
      expect(serializedA).toContain(secretB)
      // Scope B is the mirror image — no cross-scope bleed of either placeholders or raw values.
      expect(serializedB).not.toContain(secretB)
      expect(serializedB).toContain(secretA)
    } finally {
      ctxA.dispose()
      ctxB.dispose()
    }
  })
})

describe('SEAM-02/04 stamped-audit integration proof (production helpers)', () => {
  it('writes a stamped fail-closed execution_audit.jsonl row for a soft-destructive dispatch in ci (D-16 remediation)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'masking-boundary-audit-'))
    const runId = 'r_provider-boundary-audit'

    // The production per-run stamped sink + per-run registrar, exactly as run.ts wires them.
    const auditSink = buildRunAuditSink({ configDir, runId, executionContext: 'ci' })
    const { safetyHooks } = buildRunSafetyHooks({
      auditSink,
      executionContext: 'ci',
      trustMode: false,
    })

    const result = await safetyHooks.runToolCallAsync({ name: 'delete_record', recognized: true })
    expect(result.action).toBe('deny')

    const jsonlPath = join(
      resolve(configDir, '.agent-qa'),
      RUNS_SUBDIR,
      slugBranch(runId),
      'execution_audit.jsonl',
    )
    expect(existsSync(jsonlPath)).toBe(true)

    const line = readFileSync(jsonlPath, 'utf-8').trim()
    // Acceptance: the raw row line carries these substrings (correlation + D-16 remediation clause).
    expect(line).toContain('runId')
    expect(line).toContain('executionContext')
    expect(line).toContain('--trust-session')

    const row = JSON.parse(line) as Record<string, unknown>
    expect(row.runId).toBe(runId)
    expect(row.executionContext).toBe('ci')
    expect(row.outcome).toBe('fail-closed-denied')
    expect(String(row.reason)).toContain('--trust-session')
  })
})
