import { createHash } from 'node:crypto'
import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'
import * as publicApi from '@vostride/agent-qa-eval-local'
import * as reader from '@vostride/agent-qa-eval-local/reader'
import { adjudicatePanelComparison, canonicalJson, committedFileText, JUDGE_CONFIG,
  projectJudgeConfigContract, resolveJudgeCalibrationMinimum, wilsonInterval } from '@vostride/agent-qa-eval'
import { AGENT_QA_EVAL_LOCAL_OWNERSHIP_CONTRACT } from '../ownership-contract.js'
import { capturingStub, judgeGenerateResult, noneAuth, stubProfile } from './fixtures/replay-fixtures.js'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8')
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const source = (path: string) => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true)
const walk = (node: ts.Node, fn: (node: ts.Node) => void) => { fn(node); ts.forEachChild(node, child => walk(child, fn)) }
const calls = (node: ts.Node) => {
  const result: ts.CallExpression[] = []
  walk(node, child => { if (ts.isCallExpression(child)) result.push(child) })
  return result
}
afterEach(() => vi.restoreAllMocks())

it('reproduces complete frozen v2 bytes and preserves historical v1 and both material hashes', () => {
  const v1 = read('../demo/init/agent-qa-eval/contracts/judge-config.v1.json')
  const v2 = read('../demo/init/agent-qa-eval/contracts/judge-config.v2.json')
  expect(sha(v1)).toBe('8f385c65a0c4011b7610a698c64848645c0cf51167b7e3f8018e280dd4ba9eea')
  expect(sha(v2)).toBe('7fc8f16e4210333638a7dd51f36cd9cc291c7a3a72809d96cc623de578b272ec')
  const projection = projectJudgeConfigContract()
  expect(committedFileText(projection)).toBe(v2)
  expect(projection.config).toBe(JUDGE_CONFIG)
  const { judgeVersion, ...material } = JUDGE_CONFIG
  expect(judgeVersion).toBe(2)
  expect(sha(canonicalJson(material))).toBe('04ddea86ff73229268aabeaa1547f70adc2f9c6af29e7277cedaec8225474ba6')
  const { maxPanelMembers, lineageOverrides, pooling, scorePoolingReservation, ...historical } = material
  expect(sha(canonicalJson(historical))).toBe('b89e9dad4e1837d84ba93187e9299bb7dd4df12d584078dd4788ea5158bbc51d')
  expect({ maxPanelMembers, pooling }).toEqual({ maxPanelMembers: 3, pooling: { verdict: 'max', score: 'avg' } })
  expect(lineageOverrides).toHaveLength(2)
  expect(scorePoolingReservation).toContain('avg is reserved')
})

it('publishes private gold only through main while ownership names every sanctioned caller', () => {
  for (const name of ['bindJudgePanel', 'bindJudgePort', 'runJudgePanelCalibration', 'runJudgeCalibration',
    'loadJudgeCalibrationEvidence', 'readJudgeCalibration', 'publishJudgeCalibration']) {
    expect(publicApi).toHaveProperty(name, expect.any(Function))
    expect(reader).not.toHaveProperty(name)
  }
  expect(Object.keys(reader)).toEqual(['openCorpusReader'])
  const clause = AGENT_QA_EVAL_LOCAL_OWNERSHIP_CONTRACT.allowedResponsibilities.find(row => row.includes('bindJudgePanel'))!
  expect(clause).toContain('N existing bindings')
  expect(clause).toContain('replay, Gate 1 and operator calibration inside runSafetyScope')
})

it('censuses the completed replay/Gate/operator binding and safety routes', () => {
  const binders: string[] = []
  for (const path of globSync('packages/eval-local/src/**/*.ts', { cwd: root })) {
    if (path.includes('__tests__')) continue
    if (calls(source(path)).some(call => call.expression.getText() === 'bindJudgePanel')) binders.push(path)
  }
  expect(binders.sort()).toEqual(['packages/eval-local/src/judge-calibration-composition.ts', 'packages/eval-local/src/replay-composition.ts'])
  for (const [path, inner] of [['replay-composition.ts', 'adjudicateCassetteScore'], ['judge-calibration-composition.ts', 'adjudicatePanelComparison']]) {
    const scopes = calls(source(`packages/eval-local/src/${path}`)).filter(call => call.expression.getText() === 'runSafetyScope')
    expect(scopes.some(scope => scope.arguments[1] && calls(scope.arguments[1]).some(call => call.expression.getText() === inner))).toBe(true)
  }
  const gate = calls(source('packages/eval-local/src/replay-gate-composition.ts'))
  expect(gate.filter(call => call.expression.getText() === 'runCassetteReplay')).toHaveLength(2)
  expect(gate.some(call => call.expression.getText() === 'createModel')).toBe(false)
  expect(calls(source('packages/eval-local/src/replay-sweep.ts')).filter(call => call.expression.getText() === 'runCassetteReplay')).toHaveLength(1)
})

it.each([2, 3])('public binding uses %i independent captured handles in sequential order with fresh profiles', async size => {
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network'))
  const order: string[] = []
  const inputs = ['claude-fixture', 'gemini-fixture', 'llama-fixture'].slice(0, size).map(model => {
    const stub = capturingStub(() => { order.push(model); return judgeGenerateResult('equivalent', 'high') }, model)
    return { profile: { ...stubProfile(), model }, auth: noneAuth, modelOverrides: { languageModels: stub.languageModels } }
  })
  const before = inputs.map(input => JSON.stringify(input.profile))
  const port = publicApi.bindJudgePanel(inputs)
  expect(port.members.map(member => member.judgeModelId)).toEqual(inputs.map(input => input.profile.model))
  expect(order).toEqual([])
  const usage = { calls: 0 }
  expect(await adjudicatePanelComparison(port, { stepText: 'Compare values',
    question: { kind: 'value-equivalence', goldValue: 'Continue', candidateValue: 'Continue' } }, usage))
    .toMatchObject({ kind: 'settled', resolution: 'equivalent' })
  expect(order).toEqual(inputs.flatMap(input => [input.profile.model, input.profile.model]))
  expect(usage.calls).toBe(size * 2)
  expect(inputs.map(input => JSON.stringify(input.profile))).toEqual(before)
  expect(network).not.toHaveBeenCalled()
})

it('keeps statistical primitives short and default rationales explicit', () => {
  const wilson = source('packages/eval/src/stats/wilson.ts')
  const calibration = source('packages/eval/src/judge/calibration.ts')
  const primitives: ts.Node[] = []
  for (const ast of [wilson, calibration]) walk(ast, node => {
    if (ts.isFunctionDeclaration(node) && ['wilsonInterval', 'calibrationRate'].includes(node.name?.text ?? '')) primitives.push(node)
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'tally' && node.initializer) primitives.push(node.initializer)
  })
  expect(primitives).toHaveLength(3)
  for (const primitive of primitives) expect(primitive.getText().split('\n').length).toBeLessThanOrEqual(40)
  expect(wilson.text).toContain('Two-sided 95% normal quantile')
  expect(calibration.text).toContain('twenty decisions support a useful Wilson interval')
  expect(read('packages/eval/src/judge/config.ts')).toContain('Three disjoint families, sequential swaps: at most six calls per comparison.')
  expect(resolveJudgeCalibrationMinimum()).toEqual({ value: 20, source: 'default' })
  expect(wilsonInterval(20, 20)?.lower).toBeCloseTo(0.83887484, 7)
  expect(wilsonInterval(0, 0)).toBeUndefined()
})
