/**
 * THE HARN DELETION CENSUS (Phase 436, HARN-01..04; D-14, D-15, D-18, D-24..D-26).
 *
 * WHAT THIS PROVES. Phase 436 deleted the generic screen-change machinery: the progress module
 * under the runner loop with every export, the loop's progress state and helpers, the budget
 * refill, the recorder's three evidence producers, the step context's two progress members, the
 * long-press substitution ban, the planner prompt's progress rules and blocks, the router's two
 * progress signals, the old refilling planner key and the scroll compound's tree-identity
 * comparison with its retrying direction helper. A green suite proves what IS there; nothing in
 * it fails when one of those comes back. Each removed member has a `C436-RETURN-NN` cell here
 * that REDs on its return, with no mutation driver (D-18).
 *
 * REGION-SCOPED, AND COMMENTS DO NOT COUNT. Every scanned file goes through the same lexer as the
 * 432 census: comments are blanked, strings, templates and regex literals are kept. Dated notes
 * written beside the code ("re-spelled, never deleted") are comments, so they never count; a
 * returning member is code. Each cell scans the region its member lived in: the runner loop's
 * production source, the scroll compound and the three adapters, the agent router, the core
 * schema objects, the masking map, the dashboard-ui source and the scaffold.
 *
 * BYTES, NOT GREP. The scroll compound and the adapters once joined tree identities with control
 * characters, and plain grep reads such files as binary and prints nothing. This census reads
 * every file as a Buffer and decodes it itself, so a NUL byte never hides a line.
 *
 * THE CONFIG KEY IS OBSERVED, NOT GREPPED. The rebuilt public `AgentQaConfigSchema`
 * (`packages/core/dist/index.js`) parses a control config in an isolated Node process: the control
 * plus the new limit pair parses, the control plus the old key is refused with the plain message.
 *
 * SPLIT NEEDLES. Every needle is assembled at run time from two halves, and no cell name spells a
 * removed identifier, so this file never spells what it forbids; the SELF-MATCH cell asserts that
 * over this file's own bytes.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const PACKAGES_DIR = fileURLToPath(new URL('../../../', import.meta.url))
const THIS_FILE = fileURLToPath(import.meta.url)
const OWN = 'arch/src/__tests__/436-harness-progress-deleted.test.ts'

// ---------------------------------------------------------------------------------------------
// The lexer (the 432 census's, unchanged): comments out, everything else in
// ---------------------------------------------------------------------------------------------

function regexAllowed(out: string): boolean {
  let k = out.length - 1
  while (k >= 0 && /\s/.test(out[k]!)) k--
  if (k < 0) return true
  if ('(,=:[!&|?{};+-*%<>~^'.includes(out[k]!)) return true
  const word = /([A-Za-z_$][\w$]*)$/.exec(out.slice(0, k + 1))
  return word !== null
    && ['return', 'typeof', 'case', 'yield', 'await', 'in', 'of', 'void', 'delete'].includes(word[1]!)
}

function codeOf(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  const templateDepths: number[] = []
  let depth = 0
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'
  while (i < n) {
    const c = text[i]!
    const d = text[i + 1]
    if (state === 'code') {
      if (c === '/' && d === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && d === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === '/' && regexAllowed(out)) {
        let j = i + 1
        let inClass = false
        while (j < n && text[j] !== '\n') {
          const ch = text[j]
          if (ch === '\\') { j += 2; continue }
          if (ch === '[') inClass = true
          else if (ch === ']') inClass = false
          else if (ch === '/' && !inClass) break
          j++
        }
        if (j < n && text[j] === '/') {
          j++
          while (j < n && /[a-z]/i.test(text[j]!)) j++
          out += text.slice(i, j)
          i = j
          continue
        }
      }
      if (c === "'") { state = 'single'; out += c; i++; continue }
      if (c === '"') { state = 'double'; out += c; i++; continue }
      if (c === '`') { state = 'template'; out += c; i++; continue }
      if (c === '{') { depth++; out += c; i++; continue }
      if (c === '}') {
        if (templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === depth) {
          templateDepths.pop()
          depth--
          state = 'template'
          out += c
          i++
          continue
        }
        depth--
        out += c
        i++
        continue
      }
      out += c
      i++
      continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += c } else out += ' '
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && d === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : ' '
      i++
      continue
    }
    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"'
      if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
      if (c === quote || c === '\n') state = 'code'
      out += c
      i++
      continue
    }
    if (c === '\\') { out += c + (d ?? ''); i += 2; continue }
    if (c === '`') { state = 'code'; out += c; i++; continue }
    if (c === '$' && d === '{') { depth++; templateDepths.push(depth); state = 'code'; out += '${'; i += 2; continue }
    out += c
    i++
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// The universes: production source by the 412 path rule, read as bytes
// ---------------------------------------------------------------------------------------------

function listTree(root: string): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    if (!existsSync(join(PACKAGES_DIR, dir))) return
    for (const entry of readdirSync(join(PACKAGES_DIR, dir), { withFileTypes: true })) {
      const child = `${dir}${entry.name}`
      if (entry.isDirectory()) walk(`${child}/`)
      else if (/\.tsx?$/.test(entry.name)) files.push(child)
    }
  }
  walk(root)
  return files.sort()
}

const isProduction = (file: string): boolean =>
  !file.includes('/__tests__/') && !/\.test(-d)?\.tsx?$/.test(file)

function filesOf(region: string): string[] {
  if (region.endsWith('/')) return listTree(region).filter(isProduction)
  return existsSync(join(PACKAGES_DIR, region)) ? [region] : []
}

const bytesOf = (file: string): string => readFileSync(join(PACKAGES_DIR, file)).toString('utf8')

const codeCache = new Map<string, string>()
function code(file: string): string {
  let cached = codeCache.get(file)
  if (cached === undefined) {
    cached = codeOf(bytesOf(file))
    codeCache.set(file, cached)
  }
  return cached
}

function scanned(regions: readonly string[], exclude: readonly string[] = []): string[] {
  return [...new Set(regions.flatMap(filesOf))].filter((file) => !exclude.includes(file))
}

function hitsIn(regions: readonly string[], needle: string, exclude: readonly string[] = []): string[] {
  return scanned(regions, exclude).flatMap((file) =>
    code(file).split('\n').flatMap((text, index) =>
      text.includes(needle) ? [`${file}:${index + 1}: ${text.trim().slice(0, 160)}`] : []))
}

function regexHitsIn(regions: readonly string[], pattern: RegExp, exclude: readonly string[] = []): string[] {
  return scanned(regions, exclude).flatMap((file) =>
    code(file).split('\n').flatMap((text, index) =>
      pattern.test(text) ? [`${file}:${index + 1}: ${text.trim().slice(0, 160)}`] : []))
}

function everyProductionRegion(): string[] {
  return readdirSync(PACKAGES_DIR)
    .filter((name) => existsSync(join(PACKAGES_DIR, name, 'src')))
    .map((name) => `${name}/src/`)
}

// ---------------------------------------------------------------------------------------------
// The inventory: one leg per removed member (436-03's removed-member list, D-14, D-24..D-26)
// ---------------------------------------------------------------------------------------------

type Halves = readonly [string, string]
const joined = (halves: Halves): string => halves[0] + halves[1]

interface ReturnLeg {
  readonly subject: string
  readonly absentFiles?: readonly string[]
  readonly regions?: readonly string[]
  /** Files inside the regions that may spell the needle (the refusal that names a cut key). */
  readonly exclude?: readonly string[]
  readonly needles?: readonly Halves[]
  readonly patterns?: readonly Halves[]
  /** Spellings that must still be present in the regions, so the scan cannot pass over a stale file. */
  readonly controls?: readonly Halves[]
  /** A structural check that returns its offending lines. */
  readonly extra?: () => string[]
}

const RUNNER = 'runner/src/'
const LOOP = 'runner/src/loop/'
const LOOP_INDEX = 'runner/src/loop/index.ts'
const RECORDER = 'runner/src/loop/evidence.ts'
const PLANNER = 'runner/src/loop/planner.ts'
const PROMPTS = 'runner/src/loop/prompts.ts'
const STEP_TYPES = 'runner/src/loop/types.ts'
const METER = 'runner/src/loop/step-limits.ts'
const ROUTER = 'agent/src/authoring/router.ts'
const SCROLL_COMPOUND = 'runner/src/compound/'
const SCROLL_LOOP = 'runner/src/compound/scroll-until-visible.ts'
const WEB_SCROLL = 'web/src/compound-web.ts'
const ANDROID_ADAPTER = 'android/src/adapter.ts'
const IOS_ADAPTER = 'ios/src/adapter.ts'
const SCROLL_REGIONS = [SCROLL_COMPOUND, WEB_SCROLL, ANDROID_ADAPTER, IOS_ADAPTER, 'web/src/', 'android/src/', 'ios/src/']
const CORE = 'core/src/'
const RETIRED_KEYS = 'core/src/schema/retired-keys.ts'
const MASKING = 'schema/src/config/masking.ts'
const DASHBOARD_UI = 'dashboard-ui/src/'
const SCAFFOLD = 'cli/src/commands/scaffold-content.ts'
const PROGRESS_DIR = 'runner/src/loop/pro' + 'gress/'

const OLD_KEY: Halves = ['maxSub', 'Actions']

/** One leg per export of the deleted progress module, by the subject it named. */
const PROGRESS_EXPORTS: ReadonlyArray<readonly [string, Halves]> = [
  ['the local-effect evaluator', ['evaluateLocal', 'Effect']],
  ['the local-effect evidence mapper', ['toLocalEffect', 'Evidence']],
  ['the local-effect evaluator input type', ['EvaluateLocalEffect', 'Input']],
  ['the local-effect result type', ['LocalEffect', 'Result']],
  ['the local-effect oracle type', ['LocalEffect', 'Oracle']],
  ['the effect anchor type', ['Effect', 'Anchor']],
  ['the stagnation classifier', ['classify', 'Stagnation']],
  ['the obstruction role set', ['OBSTRUCTION', '_ROLES']],
  ['the loading role set', ['LOADING', '_ROLES']],
  ['the stagnation classifier input type', ['ClassifyStagnation', 'Input']],
  ['the stagnation anchor type', ['Stagnation', 'Anchor']],
  ['the stagnation class type', ['Stagnation', 'Class']],
  ['the stagnation tree', ['Stagnation', 'Tree']],
  ['the anchor-key builder', ['buildAnchor', 'Key']],
  ['the stagnation class bound', ['DEFAULT_STAGNATION', '_CLASS_BOUND']],
  ['the stagnation anchor bound', ['DEFAULT_STAGNATION', '_ANCHOR_BOUND']],
  ['the stagnation anchor identity type', ['StagnationAnc', 'horIdentity']],
  ['the no-effect record result type', ['RecordNoEffect', 'Result']],
  ['the stagnation snapshot entry type', ['StagnationSnapshot', 'Entry']],
  ['the stagnation tree options type', ['StagnationTr', 'eeOptions']],
  ['the revisitation window', ['Revisitation', 'Window']],
  ['the revisitation key builder', ['buildRevisitation', 'Key']],
  ['the revisitation window size', ['DEFAULT_REVISITATION', '_WINDOW']],
  ['the revisitation record type', ['Revisitation', 'Record']],
  ['the revisitation result type', ['Revisitation', 'Result']],
  ['the revisitation window options type', ['RevisitationWin', 'dowOptions']],
]

const RETURN_LEGS: readonly ReturnLeg[] = [
  {
    subject: 'the progress module directory',
    absentFiles: ['index.ts', 'oracle.ts', 'classifier.ts', 'revisitation.ts', 'stagnation-tree.ts']
      .map((name) => `${PROGRESS_DIR}${name}`),
    regions: [RUNNER],
    needles: [["/pro", "gress/"], ["/pro", "gress/index"], ["'./pro", "gress"]],
    extra: () => (existsSync(join(PACKAGES_DIR, PROGRESS_DIR)) ? [`${PROGRESS_DIR} exists`] : []),
  },
  ...PROGRESS_EXPORTS.map(([subject, needle]): ReturnLeg => ({ subject, regions: [RUNNER], needles: [needle] })),
  { subject: 'the loop progress carry', regions: [LOOP], needles: [['progress', 'Carry']] },
  { subject: 'the loop effect-anchor derivation', regions: [LOOP], needles: [['deriveEffect', 'Anchor']] },
  { subject: 'the loop tap-class verb set', regions: [LOOP], needles: [['TAP_CLASS', '_VERBS']] },
  { subject: 'the loop stagnation evidence mapper', regions: [LOOP], needles: [['toStagnation', 'Evidence']] },
  { subject: 'the loop mint-or-assertion meta probe', regions: [LOOP], needles: [['carriesMintOr', 'AssertionMeta']] },
  { subject: 'the loop cycle-break served flag', regions: [LOOP], needles: [['cycleBre', 'akServed']] },
  { subject: 'the loop cycle-break position', regions: [LOOP], needles: [['cycleBre', 'akAt']] },
  {
    subject: 'the loop progress state (revisitation, stagnation tree, settle-stable re-arm)',
    regions: [LOOP],
    needles: [['stagnati', 'onTree'], ['settled', 'Stable']],
    patterns: [['\\brevisit', 'ation\\b']],
  },
  {
    subject: 'the remaining-budget refill',
    regions: [LOOP],
    needles: [['= ', joined(OLD_KEY)], ['remaining =', ' max']],
    patterns: [
      ['\\bremaining\\s*=(?!=)\\s*(max|ports|limit|DEFAULT)', ''],
      ['this\\.(actions|planningCalls)\\s*(=(?!=)|-=|--)|\\bmeter\\.re', '(fill|set|fund)\\w*\\(|\\b(actions|planningCalls)--'],
    ],
    controls: [['tryDebit', 'Action'], ['new StepLimit', 'Meter(']],
    extra: () => {
      const constructions = code(LOOP_INDEX).split(joined(['new StepLimit', 'Meter('])).length - 1
      const meter = code(METER)
      return [
        ...(constructions === 1 ? [] : [`${LOOP_INDEX}: the meter is constructed ${constructions} times in one step`]),
        ...(/\b(re(fill|set|fund))\w*\s*\(/.test(meter) ? [`${METER}: the meter has a refill, reset or refund method`] : []),
        ...(/\bthis\.actions\+\+/.test(meter) && /\bthis\.planningCalls\+\+/.test(meter)
          ? [] : [`${METER}: the meter no longer only counts up`]),
      ]
    },
  },
  { subject: 'the recorder local-effect producer', regions: [RUNNER], needles: [['attachLocal', 'Effect']] },
  { subject: 'the recorder stagnation producer', regions: [RUNNER], needles: [['record', 'Stagnation']] },
  { subject: 'the recorder cycle producer', regions: [RUNNER], needles: [['record', 'Cycle']] },
  {
    subject: 'the step context stagnation member',
    regions: [LOOP],
    patterns: [['^\\s*(readonly\\s+)?stagna', 'tion\\??\\s*:'], ['context\\.stagna', 'tion\\b']],
    controls: [['interface Step', 'Context']],
    extra: () => (regexHitsIn([RECORDER], new RegExp(joined(['\\bthis\\.stagna', 'tion\\b']))).map((hit) => `recorder field: ${hit}`)),
  },
  {
    subject: 'the step context cycle-break member',
    regions: [RUNNER],
    needles: [['cyc', 'leBreak']],
    extra: () => (regexHitsIn([RECORDER], new RegExp(joined(['\\bthis\\.cyc', 'le\\b']))).map((hit) => `recorder field: ${hit}`)),
  },
  { subject: 'the long-press ban anchor-key resolver', regions: [LOOP], needles: [['resolveAction', 'AnchorKey']] },
  { subject: 'the long-press ban substitution message', regions: [LOOP], needles: [['bannedSubstitution', 'Message'], ['bannedSubsti', 'tutions']] },
  {
    subject: 'the prompt stagnation block builder',
    regions: [LOOP],
    needles: [['appendStagnation', 'Block'], ['Stagnation ', 'detected'], ['Remediate THAT ', 'control']],
  },
  {
    subject: 'the prompt cycle-break block builder',
    regions: [LOOP],
    needles: [['appendCycleBreak', 'Block'], ['Cycle detected', ' — you have revisited'], ['repeating the same path will ', 'not make progress']],
  },
  {
    subject: "Rule 3's scrolled-and-unchanged boundary sentence",
    regions: [PROMPTS, LOOP],
    needles: [['already scrolled and the screen ', 'did not change'], ['(you reached the ', 'boundary)'], ['the element is not on ', 'this page']],
    controls: [['3. If the target element is not ', 'visible']],
  },
  {
    subject: "Rule 8's no-screen-change sentence",
    regions: [PROMPTS, LOOP],
    needles: [['produced no screen ', 'change'], ['fundamentally different ', 'strategy']],
    controls: [['8. You may be called multiple ', 'times']],
  },
  {
    subject: 'the old Rule 22 heading',
    regions: [PROMPTS, LOOP],
    needles: [['STAGNATION ', 'FOCUS'], ['DO NOT ', 'WANDER']],
    controls: [['22. OUTCOME ', 'EVIDENCE']],
  },
  {
    subject: "Rule 13's blanket do-not-retry clause",
    regions: [PROMPTS, LOOP],
    needles: [['do not retry the same ', 'action']],
    controls: [['13. QA MINDSET', ' — ALWAYS MOVE FORWARD']],
  },
  {
    subject: 'the router cycle signal',
    regions: [ROUTER],
    needles: [["'cyc", "le'"], ['step.cyc', 'le'], ["push('cyc", "le')"]],
    controls: [['ROUTER_MECHANICS', '_SIGNALS = [']],
    extra: () => routerSignalsCarry(joined(["'cyc", "le'"])),
  },
  {
    subject: 'the router stagnation signal',
    regions: [ROUTER],
    needles: [["'stagna", "tion'"], ['step.stagna', 'tion']],
    controls: [['ROUTER_MECHANICS', '_SIGNALS = [']],
    extra: () => routerSignalsCarry(joined(["'stagna", "tion'"])),
  },
  {
    subject: 'the old planner key in the core schema objects',
    regions: [CORE],
    exclude: [RETIRED_KEYS],
    needles: [OLD_KEY],
    controls: [['maxPlanning', 'Turns'], ['max', 'Actions']],
  },
  {
    subject: 'the old planner key in the masking map',
    regions: [MASKING],
    needles: [OLD_KEY],
    controls: [["'use.planner.max", "Actions'"], ["'use.planner.maxPlanning", "Turns'"]],
  },
  {
    subject: 'the old planner key in the dashboard-ui source',
    regions: [DASHBOARD_UI],
    needles: [OLD_KEY],
    controls: [['max', 'Actions']],
  },
  {
    subject: 'the old planner key in the init scaffold',
    regions: [SCAFFOLD],
    needles: [OLD_KEY],
    controls: [['maxActions: DEFAULT_PLANNER', '_LIMITS.maxActions']],
  },
  {
    subject: 'the old planner key in any other production writer or schema',
    regions: everyProductionRegion(),
    exclude: [RETIRED_KEYS],
    needles: [OLD_KEY],
    extra: () => {
      const refusal = code(RETIRED_KEYS)
      const spelled = refusal.split(joined(OLD_KEY)).length - 1
      return spelled === 2 && refusal.includes(joined(['was removed in v2 — it was a refilling ', 'iteration count']))
        ? [] : [`${RETIRED_KEYS}: the refusal spells the old key ${spelled} times (expected the message and the key constant)`]
    },
  },
  {
    subject: 'the interim-tree identity helper',
    regions: [RUNNER, ...SCROLL_REGIONS],
    needles: [['interimTree', 'Identity'], ['TreeIden', 'tity(']],
  },
  {
    subject: 'the interim-tree equality decisions',
    regions: SCROLL_REGIONS,
    needles: [['anyPro', 'gress'], ["'no-", "change')"]],
    patterns: [['\\b(current|prev)\\w*\\s*[!=]==\\s*(prev|current)', '\\b']],
    controls: [['targetVisible(await p.read', 'InterimTree(), target)']],
    extra: () => regexHitsIn([SCROLL_LOOP, WEB_SCROLL, ANDROID_ADAPTER, IOS_ADAPTER],
      new RegExp(joined(["outcome:\\s*'no-", "change'"]))),
  },
  {
    subject: 'the retrying direction-scroll helper',
    regions: [RUNNER, ...SCROLL_REGIONS],
    needles: [['runDirectionScroll', 'WithRetry'], ['DirectionScroll', 'WithRetry']],
  },
]

/** The quoted literal inside the declared mechanics-signal array, if it is back. */
function routerSignalsCarry(literal: string): string[] {
  const routed = code(ROUTER)
  const declaration = new RegExp(joined(['ROUTER_MECHANICS_SIGNALS\\s*=\\s*\\[', '([\\s\\S]*?)\\]'])).exec(routed)
  if (declaration === null) return [`${ROUTER}: the mechanics-signal array is not declared`]
  return declaration[1]!.includes(literal) ? [`${ROUTER}: the mechanics-signal array carries ${literal}`] : []
}

const cellId = (index: number): string => `C436-RETURN-${String(index + 1).padStart(2, '0')}`

// ---------------------------------------------------------------------------------------------
// The config return: the rebuilt public parser in an isolated Node process
// ---------------------------------------------------------------------------------------------

interface ConfigVerdict {
  readonly success: boolean
  readonly planner: unknown
  readonly issues: ReadonlyArray<{ readonly code: string; readonly path: readonly string[]; readonly message: string }>
}

const CORE_DIST = join(PACKAGES_DIR, 'core/dist/index.js')

const PARSE_SCRIPT = `
const core = await import(process.argv[1])
const base = {
  workspace: { testMatch: ['tests/**/*.yaml'], suiteMatch: ['suites/**/*.suite.yaml'], hooksFile: 'hooks.yaml',
    envFile: '.env', secretsFile: '.env.secrets.local' },
  registry: { targets: { site: { platform: 'web', url: 'http://127.0.0.1:9/', product: 'census' } } },
  use: { timeout: { step: '30s', test: '90m', navigation: '2m' }, mobile: { appState: 'reset' } },
  services: { mcp: { enabled: true }, dashboard: { port: 4000 } },
}
const verdict = (planner) => {
  const parsed = core.AgentQaConfigSchema.safeParse({ ...base, use: { ...base.use, planner } })
  return {
    success: parsed.success,
    planner: parsed.success ? parsed.data.use.planner : null,
    issues: parsed.success ? [] : parsed.error.issues.map((issue) => ({ code: issue.code, path: issue.path.map(String), message: issue.message })),
  }
}
process.stdout.write(JSON.stringify({
  control: verdict({ maxActions: 30, maxPlanningTurns: 30, previousStepCount: 5 }),
  oldKey: verdict({ [process.argv[2]]: 10, previousStepCount: 5 }),
}))
`

const PLAIN_MESSAGE = joined([
  'use.planner.maxSub',
  'Actions was removed in v2 — it was a refilling iteration count; set use.planner.maxActions (default 30) and use.planner.maxPlanningTurns (default 30)',
])

let config: { control: ConfigVerdict; oldKey: ConfigVerdict } | undefined
let configFailure = ''

beforeAll(() => {
  const parsed = spawnSync(process.execPath, ['--input-type=module', '-e', PARSE_SCRIPT, pathToFileURL(CORE_DIST).href, joined(OLD_KEY)], {
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (parsed.status === 0) config = JSON.parse(parsed.stdout) as typeof config
  else configFailure = `${parsed.status} ${parsed.stderr}`
}, 120_000)

// ---------------------------------------------------------------------------------------------
// The cells
// ---------------------------------------------------------------------------------------------

describe('C436-RETURN — the HARN deletion census (436 D-18)', () => {
  it('C436-UNIVERSE-FLOORS: every region reads real code, so no leg can pass over an empty scan', () => {
    for (const region of [RUNNER, LOOP, SCROLL_COMPOUND, CORE, DASHBOARD_UI, 'web/src/', 'android/src/', 'ios/src/', 'agent/src/']) {
      expect(filesOf(region).length, `${region} scanned nothing`).toBeGreaterThan(3)
    }
    RETURN_LEGS.forEach((leg, index) => {
      for (const region of leg.regions ?? []) {
        expect(filesOf(region).length, `${cellId(index)}: the region ${region} does not exist`).toBeGreaterThan(0)
      }
      expect(
        (leg.needles?.length ?? 0) + (leg.patterns?.length ?? 0) + (leg.absentFiles?.length ?? 0) + (leg.extra === undefined ? 0 : 1),
        `${cellId(index)} asserts nothing`,
      ).toBeGreaterThan(0)
    })
    expect(RETURN_LEGS.length).toBe(59)
    expect(new Set(RETURN_LEGS.map((leg) => leg.subject)).size).toBe(RETURN_LEGS.length)
  })

  RETURN_LEGS.forEach((leg, index) => {
    it(`${cellId(index)}: ${leg.subject} stays deleted`, () => {
      for (const file of leg.absentFiles ?? []) {
        expect.soft(existsSync(join(PACKAGES_DIR, file)), `${file} is back`).toBe(false)
      }
      const regions = leg.regions ?? []
      for (const needle of leg.needles ?? []) {
        const hits = hitsIn(regions, joined(needle), leg.exclude)
        expect.soft(hits, `${leg.subject} returned (${joined(needle)}):\n${hits.join('\n')}`).toEqual([])
      }
      for (const pattern of leg.patterns ?? []) {
        const hits = regexHitsIn(regions, new RegExp(joined(pattern)), leg.exclude)
        expect.soft(hits, `${leg.subject} returned:\n${hits.join('\n')}`).toEqual([])
      }
      for (const control of leg.controls ?? []) {
        const present = scanned(regions, leg.exclude).some((file) => code(file).includes(joined(control)))
        expect.soft(present, `${leg.subject}: the control spelling is gone, so this region is stale (${joined(control)})`).toBe(true)
      }
      if (leg.extra !== undefined) {
        const hits = leg.extra()
        expect.soft(hits, `${leg.subject} returned:\n${hits.join('\n')}`).toEqual([])
      }
    })
  })

  it('C436-RETURN-CONFIG: the rebuilt public parser refuses the old planner key with the plain message and accepts the new pair', () => {
    expect(config, `the rebuilt public parser could not be loaded: ${configFailure}`).toBeDefined()
    expect(config!.control.success, `the control config with the new pair no longer parses: ${JSON.stringify(config!.control.issues)}`).toBe(true)
    expect(config!.control.planner).toEqual({ maxActions: 30, maxPlanningTurns: 30, previousStepCount: 5 })
    expect(config!.oldKey.success, 'the public parser accepts the old planner key').toBe(false)
    expect(config!.oldKey.issues).toEqual([
      { code: 'custom', path: ['use', 'planner', joined(OLD_KEY)], message: PLAIN_MESSAGE },
    ])
  })

  it('C436-NO-IMAGE-DIFF: no image-difference package and no screenshot-buffer comparison stands in for the deleted progress signal', () => {
    const IMAGE_DIFF: readonly Halves[] = [
      ['pixel', 'match'], ['looks', '-same'], ['resemble', 'js'], ['od', 'iff'], ['odiff', '-bin'], ['ssim', '.js'],
      ['blink', '-diff'], ['image', '-ssim'],
    ]
    const found: string[] = []
    for (const name of ['runner', 'web', 'android', 'ios', 'core']) {
      const manifest = JSON.parse(readFileSync(join(PACKAGES_DIR, name, 'package.json'), 'utf8')) as Record<string, unknown>
      const declared = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
        .flatMap((field) => Object.keys((manifest[field] as Record<string, string> | undefined) ?? {}))
      expect(declared.length, `${name}/package.json declares nothing`).toBeGreaterThan(0)
      for (const dep of declared) {
        if (IMAGE_DIFF.some((needle) => dep === joined(needle) || dep.endsWith(`/${joined(needle)}`))) found.push(`${name}: ${dep}`)
      }
    }
    expect(found, `an image-difference package is declared:\n${found.join('\n')}`).toEqual([])
    const comparisons = [
      ...hitsIn([LOOP], joined(['Buffer.com', 'pare('])),
      ...regexHitsIn([LOOP], new RegExp(joined(['\\.equa', 'ls\\(']))),
      ...regexHitsIn([LOOP], new RegExp(joined(['screenshot\\w*\\s*[!=]==\\s*\\w*screen', 'shot']), 'i')),
    ]
    expect(comparisons, `a screenshot comparison returned to the loop:\n${comparisons.join('\n')}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// Controls: the lexer, the planted needles and this file
// ---------------------------------------------------------------------------------------------

describe('C436-RETURN census instruments', () => {
  it('C436-LEXER-CONTROL: comments are blanked, strings, templates and regex literals are kept', () => {
    const sample = [
      "const a = 'kept // not a comment' // dropped",
      '/* dropped */ const b = `kept ${x ? `nested ${y}` : "q"} tail` // dropped',
      'const c = /kept\\/regex/g.test(z) /* dropped */',
      '// dropped entirely',
      '/** dropped',
      ' * dropped */ const d = "kept\u0000joined"',
    ].join('\n')
    const lines = codeOf(sample).split('\n')
    expect(lines).toHaveLength(6)
    expect(lines[0]).toContain("'kept // not a comment'")
    expect(lines[0]).not.toContain('dropped')
    expect(lines[1]).toContain('`kept ${x ? `nested ${y}` : "q"} tail`')
    expect(lines[2]).toContain('/kept\\/regex/g')
    expect(lines[3]!.trim()).toBe('')
    expect(lines[4]!.trim()).toBe('')
    expect(lines[5]).toContain('"kept\u0000joined"')
  })

  it('C436-PLANTED-POSITIVE: every needle and pattern is found when planted as code, and none when planted as a comment', () => {
    for (const [index, leg] of RETURN_LEGS.entries()) {
      for (const needle of leg.needles ?? []) {
        expect(codeOf(`const planted = \`${joined(needle)}\``).includes(joined(needle)), `${cellId(index)}: ${joined(needle)} as code`).toBe(true)
        expect(codeOf(`// ${joined(needle)}`).includes(joined(needle)), `${cellId(index)}: ${joined(needle)} as a comment`).toBe(false)
      }
    }
    const refill = RETURN_LEGS.find((leg) => leg.subject === 'the remaining-budget refill')!
    const [assignment, meter] = refill.patterns!.map((pattern) => new RegExp(joined(pattern)))
    expect(assignment!.test(joined(['remaining =', ' maxActions']))).toBe(true)
    expect(assignment!.test('const remaining = Math.max(0, budget)')).toBe(false)
    expect(meter!.test('this.actions = 0')).toBe(true)
    expect(meter!.test('meter.reset()')).toBe(true)
    expect(meter!.test('this.actions++')).toBe(false)
    const equality = new RegExp(joined(RETURN_LEGS.find((leg) => leg.subject === 'the interim-tree equality decisions')!.patterns![0]!))
    expect(equality.test('if (current === prev) break')).toBe(true)
    expect(equality.test('if (currentValue !== expected) return')).toBe(false)
    const routerPlant = `export const ROUTER_MECHANICS_SIGNALS = [\n  'termination',\n  ${joined(["'cyc", "le'"])},\n] as const`
    expect(new RegExp(joined(['ROUTER_MECHANICS_SIGNALS\\s*=\\s*\\[', '([\\s\\S]*?)\\]'])).exec(routerPlant)![1]).toContain(joined(["'cyc", "le'"]))
  })

  it('C436-SELF-MATCH: this file spells none of the needles it assembles, and lies outside every region it scans', () => {
    const own = readFileSync(THIS_FILE).toString('utf8')
    expect(existsSync(join(PACKAGES_DIR, OWN)), 'the self path is wrong').toBe(true)
    const needles = [
      ...RETURN_LEGS.flatMap((leg) => (leg.needles ?? []).map(joined)),
      ...PROGRESS_EXPORTS.map(([, needle]) => joined(needle)),
      joined(OLD_KEY),
    ]
    expect(needles.length).toBeGreaterThan(60)
    const spelled = needles.filter((needle) => own.includes(needle))
    expect(spelled, `this file spells what it forbids: ${spelled.join(', ')}`).toEqual([])
    const regions = scanned([...new Set([...RETURN_LEGS.flatMap((leg) => leg.regions ?? []), ...everyProductionRegion()])])
    expect(regions.length, 'the regions scanned nothing').toBeGreaterThan(1000)
    expect(regions, 'this census file is inside a region it scans').not.toContain(OWN)
    expect(regions.filter((file) => file.includes('/__tests__/')), 'a test file was scanned').toEqual([])
  })
})
