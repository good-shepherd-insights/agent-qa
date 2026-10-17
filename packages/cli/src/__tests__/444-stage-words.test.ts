// 2026-10-17 (444-10, D-13/D-36): one stage vocabulary on every surface. A finished stage reads
// `complete`; `done` stays only as agent-jobs.db's own job and notification words.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createFunctionRegistry,
  invokeFunction,
  RUNS_POST_PROCESSING_FUNCTION_ID,
} from '@vostride/agent-qa-agent'
import type { FunctionDeps, PostProcessingChainState } from '@vostride/agent-qa-agent'
import { asJobId } from '@vostride/agent-qa-schema'
import type { FunctionCaller, PostProcessingStatus } from '@vostride/agent-qa-schema'
import { describe, expect, it } from 'vitest'

import { renderPostProcessingSummaryLine } from '../curation/post-run-tail.js'

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

function depsWith(state: PostProcessingChainState): FunctionDeps {
  return {
    runs: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
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
