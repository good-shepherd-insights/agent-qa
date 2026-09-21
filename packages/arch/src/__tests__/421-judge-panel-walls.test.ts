import { globSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { judgePanelWalls } from '../lint/judge-panel-walls.js'
import { calibrationBoundaryHits, calibrationClosure } from '../lint/label-calibration-walls.js'
import { calibrationImports } from '../lint/label-calibration-walls.js'
import { ARCH_MANIFEST } from '../manifest.js'
import { findSetMismatchOffenders } from '../lint/reconcile-deps.js'
import { findSurfaceFirewallOffenders } from '../lint/surface-firewall.js'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const read = (file: string) => readFileSync(`${root}/${file}`, 'utf8')
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
// Phase 421 introduced no runtime dependency or SDK change. These independently pinned
// sets also prevent editing both package.json and ownership metadata to bless a new edge.
// Re-blessed once since Phase 421, for the cli set only. Phase 424 plan 35, commit
// 51a16ebc0, raised playwright-core from 1.59.1 to 1.61.0 in packages/cli, authorized by
// Phase 424 plan 11's disposition: that release's public first-frame metadata is what the
// local-web recording witnesses read. The cli digest below was recomputed from that tree
// by this wall's own expression. No other pin moved and no ownership edge was widened.
const dependencyPins = {
  eval: '3dfdd67ac8febb33dc7f7d027408677ff5f7852b02c6df15d221b5395c9b5371',
  'eval-local': '2a080fb9e46b9858ba6d8f2fb2739fa273db8d458e9ca9ed17545389c0d0216d',
  'knowledge-local': '65a609c2ac046b32cde426e3b4d7d7752dc432995c65f333f93a7c97f946ff3c',
  'agent-local': 'b2e720e8c49b10e5882523a1cffdfa8e502619dd3e1e799e1078eba3dc6d01d0',
  cli: '0087836ed2fd263ec5e779e5a1abd44803b5787e33b2714d58037da9c8274d5b',
}
const internalPins: Record<string, string> = {
  eval: 'f09db8107041e27d15929be67224e779d7ecaca3b45594f7c63cee45c9c200ed',
  'eval-local': 'deedee0b56409517d1fca91bbe7f4b7c56984409290a66d6beddccbaaa843f45',
  'knowledge-local': '1fb4bd85868bfa9e2497d7462fd3ccb7cc66f1f2042db976379a0bfb9f7d6087',
  'agent-local': 'ffe54e4e45a22c4544b49e376470cea3421d2b9e03f0bd903755b0af711db469',
  cli: '72c3719b1219ba5143c261ebbdf966e1bab08190d422b9cc261c7bb09218b248',
}
const local = 'packages/eval-local/src/'
const sources = [...globSync('packages/*/src/**/*.{ts,tsx}', { cwd: root })]
  .filter(file => !file.startsWith('packages/arch/') && !file.includes('__tests__') && !/\.test\.|\.d\.ts$/.test(file))
  .map(file => ({ file, text: read(file) }))
const check = (text: string, file = local + 'replay-composition.ts') => judgePanelWalls([{ file, text }]).map(hit => hit.rule)
const replay = (value: string, extra = '') => `import { assessPanelEligibility as assess } from '@vostride/agent-qa-eval'
  function runCassetteReplay(input: RunCassetteReplayInput) { ${extra}
    assess({ replayedModelId: ${value}, recordedModelId: input.cassette.receipt.model.declared?.modelId ?? input.cassette.receipt.model.resolvedModelId,
      memberModelIds: input.judge.members.map(m => m.profile.model) }) }`

describe('421 judge panel walls', () => {
  it.each(Object.entries(dependencyPins))('pins runtime versions and exact ownership edges for %s', (pkg, pin) => {
    const dependencies = JSON.parse(read(`packages/${pkg}/package.json`)).dependencies
    expect(digest(JSON.stringify(Object.entries(dependencies).sort()))).toBe(pin)
    const contract = ARCH_MANIFEST.packages.find(row => row.packageDir === `packages/${pkg}`)!
    expect(digest(JSON.stringify([...contract.internalDependencies].sort()))).toBe(internalPins[pkg])
    // CLI's package dependencies predate and exceed its direct-import ownership set;
    // pin both independently instead of broadening the direct-import contract.
    const declared = [...contract.internalDependencies, ...contract.externalDependencies]
    expect(findSetMismatchOffenders('judge-dependency-edge', [...declared, 'new-sdk'], declared))
      .toEqual(['judge-dependency-edge: unexpected new-sdk'])
  })
  it('retains the exact existing firewall ledger and rejects new direct/aliased/dynamic CLI imports', () => {
    expect(digest(read('packages/arch/src/lint/surface-firewall-ledger.ts'))).toBe('33be3af90770bf9d5d297a69e762b05d8658525a67e8a801d164acae70c08c82')
    for (const text of ["import { loadJudgeCalibrationEvidence as data } from '@vostride/agent-qa-eval-local'",
      "const data = await import('@vostride/agent-qa-eval-local')"]) {
      const hits = calibrationImports({ file: 'packages/cli/src/judge-new.ts', text })
      expect(findSurfaceFirewallOffenders([{ packageDir: 'packages/cli', hits }], [])).toEqual([
        'packages/cli | packages/cli/src/judge-new.ts:1 | @vostride/agent-qa-eval-local | surface-firewall un-ledgered internal import',
      ])
    }
  })
  it('rejects caller-controlled family declarations', () => {
    expect(check('const key = "plannerFamily"; const shape = { [key]: z.string(), judgeFamily: z.string() }',
      'packages/core/src/schema/config-schema.ts')).toContain('caller-family')
  })
  it('keeps config and registry declarations free of model/provider and filesystem bindings', () => {
    for (const specifier of ['@vostride/agent-qa-model', '@ai-sdk/openai', 'node:fs']) {
      expect(check(`const host = await import('${specifier}')`, 'packages/core/src/schema/registry-schema.ts')).toContain('core-judge-host')
    }
  })
  it.each(['"gpt-forged"', 'input.judge.members[0].profile.model', 'profile.model', 'replayedModelId'])(
    'rejects wrong replay provenance %s despite matching identifier names', value => {
      expect(check(replay(value, 'const profile = { model: "gpt-forged" }; const replayedModelId = "gpt-forged"'))).toContain('replay-provenance')
    })
  it('accepts aliases of actual replay profile and rejects lexical shadowing', () => {
    expect(check(replay('id', 'const { profile: actual } = input; const id = actual.model'))).toEqual([])
    expect(check(replay('id', 'const actual = input.profile; function inner(actual: Fake) { const id = actual.model; assess({ replayedModelId: id }); } const id = actual.model'))).toContain('replay-provenance')
  })
  it('refuses reassigned model aliases and mutation of the actual profile identity', () => {
    expect(check(replay('id', 'let id = input.profile.model; id = "forged"'))).toContain('replay-provenance')
    expect(check(replay('input.profile.model', 'input.profile.model = "forged"'))).toContain('identity-mutation')
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
  it('rejects forged member IDs and removal of production eligibility', () => {
    for (const name of ['replay-composition.ts', 'replay-gate-composition.ts', 'judge-calibration-composition.ts']) {
      const source = sources.find(row => row.file === local + name)!
      expect(check(source.text.replace(/assessPanelEligibility\(/g, 'unreviewedEligibility('), source.file)).toContain('eligibility-site')
    }
    expect(check(replay('input.profile.model').replace('input.judge.members.map(m => m.profile.model)', '["claude-forged", "gemini-forged"]'))).toContain('member-provenance')
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
    expect(check('function compare(panel: JudgePanelPort) { return Promise.all(panel.members.map(member => member.call(request))) }',
      'packages/eval/src/judge/adjudicate.ts')).toContain('judge-concurrency')
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
