import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { sha256hex } from '@vostride/agent-qa-schema'
import * as model from '@vostride/agent-qa-model'
import { resolveEvalSession, runReportVerb } from '../eval-session-composition.js'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const fixtureDir = fileURLToPath(new URL('./fixtures/pre-420-report/', import.meta.url))
const batchKey = JSON.parse(readFileSync(join(fixtureDir, 'report.json'), 'utf8')).batchKey as string
const parts = ['report.json', 'report.md', 'decisions.json']
const bytes = (dir: string) => parts.map(part => { const value = readFileSync(join(dir, part), 'utf8'); return { part, value, hash: sha256hex(value) } })
async function fixture(legacy = false) {
  const root = mkdtempSync(join(tmpdir(), 'agent-qa-report-history-')); roots.push(root)
  const configPath = join(root, 'agent-qa.config.yaml')
  writeFileSync(configPath, ['workspace:', '  testMatch: [tests/**/*.yaml]',
    '  suiteMatch: [suites/**/*.suite.yaml]', '  hooksFile: hooks.yaml', '  envFile: .env',
    '  secretsFile: .env.secrets.local', 'registry:', '  llms:', '    - name: planner',
    '      provider: openai-compatible', '      model: fixture-planner',
    '      baseURL: http://localhost:1/v1', 'use:', '  llm: planner', '  mobile:',
    '    appState: preserve', ''].join('\n'))
  writeFileSync(join(root, '.env.secrets.local'), '')
  const reportDir = join(root, 'agent-qa-eval', 'reports', batchKey)
  if (legacy) { mkdirSync(reportDir, { recursive: true }); cpSync(fixtureDir, reportDir, { recursive: true }) }
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('provider forbidden'))
  vi.spyOn(model, 'createModel').mockImplementation(() => { throw new Error('model forbidden') })
  return { root, reportDir, session: await resolveEvalSession({ configPath }) }
}
it.each([false, true])('actual legacy report regeneration preserves bytes and sidecars, baseline=%s', async baseline => {
  const f = await fixture(true), before = bytes(f.reportDir)
  const result = await runReportVerb(f.session, {}, { source: 'committed', commit: true, baseline })
  expect(result.committed).toEqual({ kind: 'write-conflict', path: `reports/${batchKey}/report.json` })
  expect(result.report.headline.verifierFalsePassRate).toEqual({ numerator: 0, denominator: 0 })
  expect(result.baseline).toBeUndefined()
  expect(existsSync(join(f.root, 'agent-qa-eval', 'reports', 'baselines'))).toBe(false)
  expect(bytes(f.reportDir)).toEqual(before)
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(model.createModel).not.toHaveBeenCalled()
})
it('designates legacy bytes from committed history without regenerating or overwriting any part', async () => {
  const f = await fixture(true), before = bytes(f.reportDir)
  const options = { baseline: true, fromCommitted: batchKey, seedPolicy: 'none' as const }
  const first = await runReportVerb(f.session, {}, options)
  expect(first.baseline?.kind).toBe('written')
  expect(first.report).not.toHaveProperty('calibration')
  expect(first.report).not.toHaveProperty('perSplit')
  expect(first.stagedFile).toBeUndefined()
  expect((await runReportVerb(f.session, {}, options)).baseline?.kind).toBe('unchanged')
  expect(bytes(f.reportDir)).toEqual(before)
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(model.createModel).not.toHaveBeenCalled()
})
it('commits all new fields and all sidecars then recommits identical bytes unchanged', async () => {
  const f = await fixture()
  const first = await runReportVerb(f.session, {}, { commit: true, baseline: true })
  expect(first.committed).toMatchObject({ kind: 'committed', json: 'written', markdown: 'written', decisions: 'written' })
  expect(first.baseline?.kind).toBe('written')
  const before = bytes(f.reportDir)
  expect(readFileSync(join(f.reportDir, 'report.md'), 'utf8')).toContain('verifierFalsePassRate: 0/0 (rate: unavailable (zero denominator))')
  const second = await runReportVerb(f.session, {}, { commit: true, baseline: true })
  expect(second.committed).toMatchObject({ kind: 'committed', json: 'unchanged', markdown: 'unchanged', decisions: 'unchanged' })
  expect(second.baseline?.kind).toBe('unchanged')
  expect(bytes(f.reportDir)).toEqual(before)
  expect(globalThis.fetch).not.toHaveBeenCalled()
  expect(model.createModel).not.toHaveBeenCalled()
})
