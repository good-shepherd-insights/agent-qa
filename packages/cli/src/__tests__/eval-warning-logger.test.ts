import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'

import { installEvalWarningLogger } from '../eval-warning-logger.js'

const original = globalThis.AI_SDK_LOG_WARNINGS
afterEach(() => { globalThis.AI_SDK_LOG_WARNINGS = original })

it('keeps the real installed SDK first warning off stdout and retains returned warnings', () => {
  // A fresh process guarantees the installed SDK's one-time warning state is uninitialized.
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { generateText } from 'ai';
    import { installEvalWarningLogger } from ${JSON.stringify(new URL('../eval-warning-logger.ts', import.meta.url).href)};
    globalThis.fetch = () => { throw new Error('network forbidden'); };
    const restore = installEvalWarningLogger();
    const warning = { type: 'unsupported', feature: 'seed' };
    const result = await generateText({ prompt: 'ok', seed: 11, model: {
      specificationVersion: 'v3', provider: 'warning-fixture', modelId: 'warning-fixture', supportedUrls: {},
      doStream() { throw new Error('stream forbidden'); },
      async doGenerate() { return { content: [{ type: 'text', text: 'ok' }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } }, warnings: [warning] }; }
    }});
    console.log(JSON.stringify({ text: result.text, warnings: result.warnings }));
    restore();
  `], { encoding: 'utf8' })
  expect(child.status, child.stderr).toBe(0)
  expect(JSON.parse(child.stdout)).toEqual({ text: 'ok', warnings: [{ type: 'unsupported', feature: 'seed' }] })
  expect(child.stderr).toContain('AI SDK Warning (warning-fixture / warning-fixture)')
  expect(child.stderr).toContain('"feature":"seed"')
  expect(child.stdout).not.toContain('AI SDK Warning System')
})

it('preserves deliberate logging configuration and restores the default after eval', () => {
  const custom = vi.fn()
  for (const configured of [false, custom] as const) {
    globalThis.AI_SDK_LOG_WARNINGS = configured
    installEvalWarningLogger()()
    expect(globalThis.AI_SDK_LOG_WARNINGS).toBe(configured)
  }
  globalThis.AI_SDK_LOG_WARNINGS = undefined
  const restore = installEvalWarningLogger()
  expect(globalThis.AI_SDK_LOG_WARNINGS).toBeTypeOf('function')
  restore()
  expect(globalThis.AI_SDK_LOG_WARNINGS).toBeUndefined()
})
