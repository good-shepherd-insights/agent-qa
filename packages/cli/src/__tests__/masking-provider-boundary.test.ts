// The captured provider boundary of a run-shaped createModel (C441-EGRESS), and the SEAM-02/04
// stamped-audit integration proof.

import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { RUNS_SUBDIR, slugBranch } from '@vostride/agent-qa-runner-local'
import { SecretRedactor, SecretStore } from '@vostride/agent-qa-runner'
import { createModel } from '@vostride/agent-qa-model'
import type { ResolvedModelAuth } from '@vostride/agent-qa-model'
import { describe, expect, it } from 'vitest'

import { buildRunAuditSink } from '@vostride/agent-qa-agent-local'
import { buildRunSafetyHooks } from '../run-session-composition.js'

// Derive the AI-SDK shapes from `createModel` itself — the CLI package declares neither
// @ai-sdk/provider nor @vostride/agent-qa-schema, and this proof needs neither.
type StubLanguageModel = ReturnType<typeof createModel>
type CapturedCallOptions = Parameters<StubLanguageModel['doGenerate']>[0]
type StubGenerateResult = Awaited<ReturnType<StubLanguageModel['doGenerate']>>

const noneAuth: ResolvedModelAuth = { kind: 'none' }

const fileSecret = 'file-secret-passphrase-alpha'
const envSecret = 'env-token-passphrase-bravo'
const cookieSecret = 'cookie-session-passphrase-charlie'

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

function createCapturingModel(mask: (text: string) => string): {
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
    mask,
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

describe('C441-EGRESS', () => {
  it('a run-shaped model masks the declared value and nothing else', async () => {
    const redactor = new SecretRedactor(
      SecretStore.fromEnvContent(`MY_SERVICE_SECRET=${fileSecret}`),
    )
    const { captured, model } = createCapturingModel((text) => redactor.redactString(text))

    await model.doGenerate(
      promptRequest(`file=${fileSecret} env=${envSecret} cookie=${cookieSecret}`),
    )

    expect(capturedUserText(captured())).toBe(
      `file=[secret:MY_SERVICE_SECRET] env=${envSecret} cookie=${cookieSecret}`,
    )
    expect(JSON.stringify(captured())).not.toContain(fileSecret)
  })
})

describe('SEAM-02/04 stamped-audit integration proof (production helpers)', () => {
  // RE-SPELLED 2026-10-01 (432-19, D-15/D-17) from 'writes a stamped fail-closed execution_audit.jsonl
  // row for a soft-destructive dispatch in ci (D-16 remediation)'. The in-run gate hook that denied
  // `delete_record` in ci and wrote that row is deleted, and so is the execution-audit writer. The
  // stamped-audit integration survives on the GUARDRAIL row: the run's own registrar, over the run's
  // own stamped sink, lands a correlated row in the run directory.
  it('C432-GUARDRAIL-AUDIT-RETAINED: the run registrar writes a runId-stamped guardrail row and no execution row', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'masking-boundary-audit-'))
    const runId = 'r_provider-boundary-audit'
    const runDir = join(resolve(configDir, '.agent-qa'), RUNS_SUBDIR, slugBranch(runId))

    // The production per-run stamped sink + per-run registrar, exactly as run.ts wires them.
    const auditSink = buildRunAuditSink({ configDir, runId })
    const { safetyHooks } = buildRunSafetyHooks({ auditSink })

    // A soft-destructive in-test action is no longer gated: it passes the tool-call point.
    const action = { name: 'delete_record', recognized: true }
    expect(await safetyHooks.runToolCallAsync(action)).toEqual({ action: 'allow', call: action })

    // A provider request carrying a bearer trips the guardrail, which writes the stamped row.
    safetyHooks.runProviderRequest({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Authorization: Bearer abcdefghijklmno12345' }] }],
    } as never)

    expect(existsSync(join(runDir, 'execution_audit.jsonl'))).toBe(false)
    const line = readFileSync(join(runDir, 'guardrail_audit.jsonl'), 'utf-8').trim()
    expect(line.split('\n')).toHaveLength(1)
    expect(line).not.toContain('abcdefghijklmno12345')
    const row = JSON.parse(line) as Record<string, unknown>
    expect(row.runId).toBe(runId)
    expect(row).toMatchObject({ action: 'redact', detector: 'bearer' })
    expect(typeof row.ts).toBe('string')
  })
})
