import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { judgePanelWalls } from '../lint/judge-panel-walls.js'
import { calibrationBoundaryHits, calibrationClosure } from '../lint/label-calibration-walls.js'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const read = (file: string) => readFileSync(`${root}/${file}`, 'utf8')
const local = 'packages/eval-local/src/'
const sources = [...globSync('packages/*/src/**/*.{ts,tsx}', { cwd: root })]
  .filter(file => !file.startsWith('packages/arch/') && !file.includes('__tests__') && !/\.test\.|\.d\.ts$/.test(file))
  .map(file => ({ file, text: read(file) }))
const check = (text: string, file = local + 'replay-composition.ts') => judgePanelWalls([{ file, text }]).map(hit => hit.rule)
const replay = (value: string, extra = '') => `import { assessPanelEligibility as assess } from '@vostride/agent-qa-eval'
  function runCassetteReplay(input: RunCassetteReplayInput) { ${extra}
    assess({ replayedModelId: ${value}, memberModelIds: input.judge.members.map(m => m.profile.model) }) }`

describe('421 judge panel walls', () => {
  it('rejects caller-controlled family declarations', () => {
    expect(check('const key = "plannerFamily"; const shape = { [key]: z.string(), judgeFamily: z.string() }',
      'packages/core/src/schema/config-schema.ts')).toContain('caller-family')
  })
  it.each(['"gpt-forged"', 'input.judge.members[0].profile.model', 'profile.model', 'replayedModelId'])(
    'rejects wrong replay provenance %s despite matching identifier names', value => {
      expect(check(replay(value, 'const profile = { model: "gpt-forged" }; const replayedModelId = "gpt-forged"'))).toContain('replay-provenance')
    })
  it('accepts aliases of actual replay profile and rejects lexical shadowing', () => {
    expect(check(replay('id', 'const { profile: actual } = input; const id = actual.model'))).toEqual([])
    expect(check(replay('id', 'const actual = input.profile; function inner(actual: Fake) { const id = actual.model; assess({ replayedModelId: id }); } const id = actual.model'))).toContain('replay-provenance')
  })
  it.each([
    "import { assessPanelEligibility as hidden } from '@vostride/agent-qa-eval'; const call = hidden;",
    "import * as evalCore from '@vostride/agent-qa-eval'; const call = evalCore.assessPanelEligibility;",
    "const { assessPanelEligibility: call } = await import('@vostride/agent-qa-eval');",
    "const evalCore = await import('@vostride/agent-qa-eval'); const call = evalCore['assessPanelEligibility'];",
  ])('detects direct, aliased and dynamic eligibility calls: %s', declaration => {
    expect(check(`${declaration} function runCassetteReplay(input: RunCassetteReplayInput) { call({ replayedModelId: 'forged' }) }`)).toContain('replay-provenance')
  })
  it('rejects forged recorded identity and omission on the real replay path', () => {
    const source = sources.find(row => row.file === local + 'replay-composition.ts')!
    expect(check(source.text.replace('recordedReceiptModelId(input.cassette)', "'gpt-forged'"))).toContain('recorded-provenance')
    expect(check(source.text.replace('...(recordedModelId !== undefined ? { recordedModelId } : {}),', ''))).toContain('recorded-provenance')
    expect(check(source.text.replace('cassette.receipt.model.declared?.modelId ?? cassette.receipt.model.resolvedModelId', "'gpt-forged'"))).toContain('recorded-provenance')
  })
  it('accepts Gate identity aliases but rejects a same-named forged identity', () => {
    const source = sources.find(row => row.file === local + 'replay-gate-composition.ts')!
    expect(check(source.text.replace('const { injection, identity } = input', 'const { injection } = input; const identity = { plannerModelId: "forged" }'), source.file)).toContain('replay-provenance')
    expect(check(source.text.replace('const common = { replayedModelId: identity.plannerModelId,', 'const actual = identity; const modelId = actual.plannerModelId; const common = { replayedModelId: modelId,'), source.file)).toEqual([])
  })
  it.each([
    "import { createModel as hidden } from '@vostride/agent-qa-model'; hidden(profile, auth)",
    "const { createModel: hidden } = await import('@vostride/agent-qa-model'); hidden(profile, auth)",
    "import * as model from '@vostride/agent-qa-model'; const hidden = model.createModel; hidden(profile, auth)",
  ])('rejects a second judge factory %s', text => {
    expect(check(text, local + 'judge-second.ts')).toContain('judge-factory')
  })
  it('pins N existing bindings and the single factory in bindJudgePort', () => {
    const source = sources.find(row => row.file === local + 'judge-binding.ts')!
    expect(check(source.text.replace('inputs.map(bindJudgePort)', 'inputs.map(input => createModel(input.profile, input.auth))'), source.file)).toContain('panel-binding')
    expect(check(source.text + '\nconst second = createModel(profile, auth)', source.file)).toContain('judge-factory')
  })
  it.each(["export { loadJudgeCalibrationEvidence as publicData } from './judge-calibration-evidence-source.js'",
    "export * from './judge-calibration-evidence-source.js'",
    "const data = await import('./judge-calibration-evidence-source.js'); export { data }"])(
    'rejects private evidence through reader %s', text => {
      expect(check(text, local + 'reader.ts')).toContain('private-reader')
    })
  it.each(["import { publishJudgeCalibration as write } from '@vostride/agent-qa-eval-local'",
    "const writer = await import('@vostride/agent-qa-eval-local')"])(
    'rejects learner writer %s', text => {
      expect(check(text, 'packages/knowledge-local/src/plant.ts')).toContain('learner-eval-writer')
    })
  it.each(['eval', 'eval-local'])('rejects eval/knowledge edges in %s', pkg => {
    expect(check("const k = await import('@vostride/agent-qa-knowledge-local')", `packages/${pkg}/src/plant.ts`)).toContain('eval-knowledge-edge')
  })
  it.each(['Promise.all', 'Promise.allSettled', 'Promise.race'])('rejects member concurrency through %s', method => {
    expect(check(`import { judgePairwise as run } from './adjudicate'; const pending = members.map(m => run(m, evidence)); await ${method}(pending)`,
      'packages/eval/src/judge/plant.ts')).toContain('judge-concurrency')
  })
  it('rejects async member scheduling even without Promise.all but preserves legal unrelated concurrency', () => {
    expect(check('members.forEach(async member => { await judgePairwise(member, evidence) })', 'packages/eval/src/judge/plant.ts')).toContain('judge-concurrency')
    expect(check('await Promise.all(files.map(file => readFile(file)))', local + 'judge-calibration-composition.ts')).toEqual([])
  })
  it('accepts completed real source including captured-provider and operator seams', () => {
    expect(sources.length).toBeGreaterThan(500)
    expect(judgePanelWalls(sources)).toEqual([])
    expect(calibrationBoundaryHits(sources)).toEqual([])
  })
  it('reader transitive closure never reaches private calibration DATA', () => {
    const packages = new Map<string, string>()
    for (const file of globSync('packages/*/package.json', { cwd: root })) {
      const pkg = JSON.parse(read(file))
      for (const [key, value] of Object.entries(pkg.exports ?? {})) {
        const target = typeof value === 'string' ? value : (value as { import?: string; default?: string }).import ?? (value as { default?: string }).default
        if (target) packages.set(pkg.name + (key === '.' ? '' : key.slice(1)), file.replace('package.json', '') + target.replace(/^\.\//, '').replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'))
      }
    }
    const closure = calibrationClosure(sources, [local + 'reader.ts'], packages)
    expect(closure.missingEntries).toEqual([])
    expect(closure.unresolved).toEqual([])
    expect(closure.files.filter(file => /judge-calibration|calibration-evidence/.test(file))).toEqual([])
  })
  it('registers the actual wall suite in validate:arch', () => {
    expect(JSON.parse(read('package.json')).scripts['validate:arch'].split(/\s+/)).toContain('src/__tests__/421-judge-panel-walls.test.ts')
  })
})
