// 2026-10-17 (444-10, D-13/D-36): one stage vocabulary on every surface. A finished stage reads
// `complete`; `done` stays only as agent-jobs.db's own job and notification words.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createFunctionRegistry,
  invokeFunction,
  RUNS_DIGEST_FUNCTION_ID,
  RUNS_POST_PROCESSING_FUNCTION_ID,
} from '@vostride/agent-qa-agent'
import type { FunctionDeps, PostProcessingChainState } from '@vostride/agent-qa-agent'
import {
  asJobId,
  CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
  PostProcessingStatusSchema,
  RunDigestSchema,
} from '@vostride/agent-qa-schema'
import type {
  CompletedRunHandoff,
  FunctionCaller,
  PostProcessingStatus,
  RunDigest,
  RunNotification,
} from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { renderChainTerminalLine, renderPostProcessingSummaryLine } from '../curation/post-run-tail.js'

const PACKAGES_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

const RENDERERS = [
  'cli/src/curation/post-run-tail.ts',
  'agent/src/functions/ops/runs-digest.ts',
  'dashboard-server/src/run-service/post-processing-routes.ts',
  'dashboard-ui/src/lib/post-processing-view.ts',
  'dashboard-ui/src/lib/api.ts',
  'dashboard-ui/src/lib/analysis-view.ts',
  'dashboard-ui/src/lib/knowledge-view.ts',
] as const

const RUN_ID = 'run-444-stage-words'

const CALLER: FunctionCaller = { surface: 'test', origin: 'agent' }

function stripComments(source: string): string {
  let i = 0
  let out = ''
  const copy = (): void => {
    out += source[i++] ?? ''
  }
  const quoted = (quote: string): void => {
    copy()
    while (i < source.length && source[i] !== quote && source[i] !== '\n') {
      if (source[i] === '\\') copy()
      copy()
    }
    copy()
  }
  const template = (): void => {
    copy()
    while (i < source.length) {
      if (source[i] === '\\') {
        copy()
        copy()
      } else if (source[i] === '`') {
        copy()
        return
      } else if (source[i] === '$' && source[i + 1] === '{') {
        copy()
        copy()
        code(true)
      } else {
        copy()
      }
    }
  }
  const code = (untilClose: boolean): void => {
    let depth = 0
    while (i < source.length) {
      const c = source[i]
      const next = source[i + 1]
      if (c === '/' && next === '/') {
        while (i < source.length && source[i] !== '\n') i += 1
      } else if (c === '/' && next === '*') {
        const end = source.indexOf('*/', i + 2)
        i = end === -1 ? source.length : end + 2
      } else if (c === "'" || c === '"') {
        quoted(c)
      } else if (c === '`') {
        template()
      } else if (c === '{') {
        depth += 1
        copy()
      } else if (c === '}') {
        copy()
        if (depth === 0 && untilClose) return
        depth -= 1
      } else {
        copy()
      }
    }
  }
  code(false)
  return out
}

const DONE_LITERAL = /'done'|"done"/u

function doneLiteralLines(code: string): string[] {
  return code.split('\n').filter(line => DONE_LITERAL.test(line)).map(line => line.trim())
}

function depsWith(state: PostProcessingChainState, handoff?: CompletedRunHandoff): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(handoff),
      readEvents: () => Promise.resolve([]),
      readStepEvidence: () => Promise.resolve({ kind: 'run-not-recorded' } as const),
    },
    knowledge: {
      listBundles: () => Promise.resolve([]),
      inspectRecords: () => Promise.resolve([]),
      diffSince: () => Promise.resolve([]),
      showRecord: ({ recordId }) =>
        Promise.resolve({ kind: 'not-found', schemaVersion: 1, recordId } as const),
    },
    entities: {
      resolve: () => Promise.resolve({ kind: 'none' as const, reason: 'no-match' as const }),
      get: () => Promise.resolve(undefined),
    },
    config: {
      getMasked: () => Promise.resolve({ schemaVersion: 1, configPath: 'agent-qa.config.yaml', entries: [] }),
    },
    postProcessing: {
      idSource: { jobIdFor: (kind, key) => asJobId(`stage_words_${kind}_${key}`) },
      readChain: () => Promise.resolve(state),
    },
    secretMask: (text: string) => text,
  }
}

async function served(state: PostProcessingChainState): Promise<PostProcessingStatus> {
  return await invokeFunction(
    createFunctionRegistry({ deps: depsWith(state) }),
    RUNS_POST_PROCESSING_FUNCTION_ID,
    { runId: RUN_ID },
    CALLER,
  ) as PostProcessingStatus
}

function storedNotification(): RunNotification {
  return {
    schemaVersion: CURRENT_RUN_NOTIFICATION_SCHEMA_VERSION,
    runId: RUN_ID,
    outcome: 'done',
    verdictSummary: { total: 1, byClass: { app_bug: 1 } },
    stages: {
      analysis: { status: 'done' },
      curation: { status: 'done', curated: 2, deprecated: 0 },
      proposals: { status: 'done', proposed: 1, skipped: 0 },
    },
  }
}

function finishedChain(notification: RunNotification): PostProcessingChainState {
  return {
    analyzeRun: { status: 'done', claimed: false },
    curateMemory: { status: 'done', claimed: false },
    proposeImprovements: { status: 'done', claimed: false },
    notification,
  }
}

const HANDOFF = { runId: RUN_ID } as unknown as CompletedRunHandoff

describe('C444-STAGE-WORDS', () => {
  it('the CLI exit line prints complete', async () => {
    const status = await served({
      analyzeRun: { status: 'done', claimed: false },
      curateMemory: { status: 'done', claimed: false },
    })
    const line = renderPostProcessingSummaryLine(status, 'none')
    expect(line).toContain('analysis: complete · curation: complete')
    expect(line).not.toMatch(/\bdone\b/u)
  })

  it('no renderer spells done as a stage word', () => {
    expect(doneLiteralLines(stripComments("// 'done'\n/* \"done\" */\nconst url = 'https://x' // 'done'")))
      .toEqual([])
    expect(doneLiteralLines(stripComments("const w = `a ${x === 'done' ? 1 : 2}` // y"))).toHaveLength(1)
    const found: Record<string, string[]> = {}
    for (const file of RENDERERS) {
      const path = join(PACKAGES_ROOT, file)
      expect(existsSync(path), `${file} is missing; the census cannot read it`).toBe(true)
      const code = stripComments(readFileSync(path, 'utf8'))
      expect(code.length, `${file} read as empty`).toBeGreaterThan(0)
      const hits = doneLiteralLines(code)
      if (hits.length > 0) found[file] = hits
    }
    expect(found).toEqual({})
  })
})

describe('C444-NOTIFICATION-VIEW', () => {
  it('the stored notification keeps done and the served view reads complete', async () => {
    const stored = storedNotification()
    const before = structuredClone(stored)
    const status = await served(finishedChain(stored))
    expect(status.notification).toEqual({
      ...before,
      outcome: 'complete',
      stages: {
        analysis: { status: 'complete' },
        curation: { status: 'complete', curated: 2, deprecated: 0 },
        proposals: { status: 'complete', proposed: 1, skipped: 0 },
      },
    })
    expect(stored).toEqual(before)

    const failed: RunNotification = {
      ...storedNotification(),
      outcome: 'failed',
      stages: { analysis: { status: 'done' }, curation: { status: 'failed' }, proposals: { status: 'failed' } },
    }
    const failedView = (await served(finishedChain(failed))).notification
    expect(failedView?.outcome).toBe('failed')
    expect(failedView?.stages).toEqual({
      analysis: { status: 'complete' },
      curation: { status: 'failed' },
      proposals: { status: 'failed' },
    })
  })

  it('the CLI chain terminal line and the proposals segment print complete', async () => {
    const status = await served(finishedChain(storedNotification()))
    const line = renderChainTerminalLine(status.notification!)
    expect(line.startsWith(`post-processing complete for ${RUN_ID} — `)).toBe(true)
    expect(line).toContain('analysis: complete')
    expect(line).toContain('curation: complete (2 curated, 0 deprecated)')
    expect(line).toContain('proposals: complete (staged 1, skipped 0)')
    expect(line).not.toMatch(/\bdone\b/u)
  })

  it("the digest's chain line prints complete", async () => {
    const digest = await invokeFunction(
      createFunctionRegistry({ deps: depsWith(finishedChain(storedNotification()), HANDOFF) }),
      RUNS_DIGEST_FUNCTION_ID,
      { runId: RUN_ID },
      CALLER,
    ) as RunDigest
    expect(digest.chain).toEqual({ analysis: 'complete', curation: 'complete', outcome: 'complete' })
    expect(digest.lines).toContain('chain — analysis: complete · curation: complete · chain complete')
    expect(digest.lines.join('\n')).not.toMatch(/\bdone\b/u)
  })

  it("the served output validates against the functions' output schema", async () => {
    const status = await served(finishedChain(storedNotification()))
    expect(PostProcessingStatusSchema.parse(status)).toEqual(status)
    expect(PostProcessingStatusSchema.safeParse({
      ...status,
      notification: { ...status.notification, outcome: 'done' },
    }).success).toBe(false)
    expect(PostProcessingStatusSchema.safeParse({
      ...status,
      notification: { ...status.notification, stages: { ...status.notification!.stages, analysis: { status: 'done' } } },
    }).success).toBe(false)
    const digest = await invokeFunction(
      createFunctionRegistry({ deps: depsWith(finishedChain(storedNotification()), HANDOFF) }),
      RUNS_DIGEST_FUNCTION_ID,
      { runId: RUN_ID },
      CALLER,
    ) as RunDigest
    expect(RunDigestSchema.parse(digest)).toEqual(digest)
    expect(RunDigestSchema.safeParse({ ...digest, chain: { ...digest.chain, outcome: 'done' } }).success)
      .toBe(false)
  })
})
