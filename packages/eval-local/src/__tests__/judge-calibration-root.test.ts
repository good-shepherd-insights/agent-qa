import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { buildEvalReport, createPanelIdentity, resolveJudgeCalibrationMinimum } from '@vostride/agent-qa-eval'
import { sha256hex } from '@vostride/agent-qa-schema'
import { listCommittedReports } from '../committed-corpus-source.js'
import { createJudgeCalibrationArtifact, judgeCalibrationPath } from '../judge-calibration-source.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function put(path: string, value: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2)) }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'judge-root-')); roots.push(root)
  const committedRoot = join(root, 'committed'), agentQaRoot = join(root, 'runtime')
  mkdirSync(committedRoot); mkdirSync(agentQaRoot); mkdirSync(join(committedRoot, 'corpus'))
  const identity = createPanelIdentity(['claude-sonnet-4', 'gemini-2.5'])
  const artifact = createJudgeCalibrationArtifact({ committedRoot, agentQaRoot, identity,
    minN: resolveJudgeCalibrationMinimum(), profile: { plannerModelId: 'gpt-5', fingerprint: sha256hex('fixture'),
      matcherVersion: 1, judgeModelId: identity.judgeModelId, judgeVersion: identity.judgeVersion } },
  { status: 'capability-gap', reason: 'no-credential' })
  const path = join(committedRoot, judgeCalibrationPath(artifact.profileKey))
  put(path, artifact)
  return { root, committedRoot, path }
}
it('reserves judge calibration artifacts while discovering only ordinary batch reports', () => {
  const f = fixture(), report = buildEvalReport([])
  put(join(f.committedRoot, 'reports', report.batchKey, 'report.json'), report)
  const read = listCommittedReports(f.committedRoot)
  expect(read.refusals).toEqual([])
  expect(read.reports.map(row => row.batchKey)).toEqual([report.batchKey])
})
it('keeps the recursive L2 scan over clean and forbidden inherited-threshold payloads', () => {
  const f = fixture(), config = join(f.root, 'fixture-config.yaml')
  writeFileSync(config, 'eval: {}\n')
  const historicalKey = '358327d21294f77b91645e3cefde46ad12fe065422757372835447a41865a71e'
  put(join(f.committedRoot, 'reports', historicalKey, 'report.json'), { familyOverride: 'same-family-allowed' })
  const run = () => spawnSync('bash', [resolve('../../scripts/413-eval-root-hygiene.sh')], { encoding: 'utf8',
    env: { ...process.env, EVAL_ROOT: f.committedRoot, DEMO_CONFIG: config }, timeout: 30_000 })
  const clean = run()
  expect(clean.error).toBeUndefined(); expect(clean.status).toBe(0)
  expect(clean.stderr).toContain('PASS L2')
  put(f.path, { inheritedThreshold: 0.867 })
  const planted = run()
  expect(planted.error).toBeUndefined(); expect(planted.status).toBe(1)
  expect(planted.stderr).toContain('FAIL L2: inherited threshold literal on a gate path:')
  expect(planted.stderr).toContain('judge-calibration')
  expect(planted.stderr).not.toMatch(/FAIL L[13456]/)
})
