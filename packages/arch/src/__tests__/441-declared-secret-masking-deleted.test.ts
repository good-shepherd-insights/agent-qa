// The 441 deletion census (D-17). Phase 441 masks declared secrets only; every removed masker,
// restore path, marker vocabulary, redactor, guardrail, audit writer and hook seam has a
// C441-RETURN cell here that turns red when it returns to production source. Comments are
// blanked by the 432 lexer, so dated notes never count. Needles are assembled from halves and no
// cell title spells one, so this file never spells what it forbids (C441-SELF-MATCH).

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGES_DIR = fileURLToPath(new URL('../../../', import.meta.url))
const THIS_FILE = fileURLToPath(import.meta.url)
const OWN = 'arch/src/__tests__/441-declared-secret-masking-deleted.test.ts'

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

function everyProductionRegion(): string[] {
  return readdirSync(PACKAGES_DIR)
    .filter((name) => existsSync(join(PACKAGES_DIR, name, 'src')))
    .map((name) => `${name}/src/`)
}

const inRegion = (file: string, region: string): boolean =>
  region.endsWith('/') ? file.startsWith(region) : file === region

interface Universe {
  readonly files: (regions: readonly string[]) => string[]
  readonly code: (file: string) => string
  readonly exists: (path: string) => boolean
}

const codeCache = new Map<string, string>()
const PRODUCTION: Universe = {
  files: (regions) => [...new Set(regions.flatMap(filesOf))],
  code: (file) => {
    let cached = codeCache.get(file)
    if (cached === undefined) {
      cached = codeOf(readFileSync(join(PACKAGES_DIR, file)).toString('utf8'))
      codeCache.set(file, cached)
    }
    return cached
  },
  exists: (path) => existsSync(join(PACKAGES_DIR, path)),
}

function planted(path: string, source: string, present: readonly string[] = []): Universe {
  return {
    files: (regions) => (regions.some((region) => inRegion(path, region)) ? [path] : []),
    code: () => codeOf(source),
    exists: (candidate) => present.includes(candidate),
  }
}

type Halves = readonly [string, string]
const joined = (halves: Halves): string => halves[0] + halves[1]

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
function needlePattern(needle: string): RegExp {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return IDENTIFIER.test(needle) ? new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`) : new RegExp(escaped)
}

interface Scan {
  readonly regions: readonly string[]
  readonly needles?: readonly Halves[]
  readonly patterns?: readonly (readonly [Halves, Halves])[]
}

interface ReturnLeg {
  readonly subject: string
  readonly absent?: readonly string[]
  readonly scans: readonly Scan[]
}

function findings(leg: ReturnLeg, universe: Universe): string[] {
  const found = (leg.absent ?? []).filter(universe.exists).map((path) => `${path} is back`)
  for (const scan of leg.scans) {
    const tests = [
      ...(scan.needles ?? []).map((needle) => [joined(needle), needlePattern(joined(needle))] as const),
      ...(scan.patterns ?? []).map(([pattern]) => [joined(pattern), new RegExp(joined(pattern))] as const),
    ]
    for (const file of universe.files(scan.regions)) {
      universe.code(file).split('\n').forEach((text, index) => {
        for (const [label, pattern] of tests) {
          if (pattern.test(text)) found.push(`${label} at ${file}:${index + 1}: ${text.trim().slice(0, 160)}`)
        }
      })
    }
  }
  return found
}

const ALL = everyProductionRegion()
const RUNNER = 'runner/src/'
const MODEL = 'model/src/'
const CLI = 'cli/src/'
const DASHBOARD_UI_LIB = 'dashboard-ui/src/lib/'
const CURATION_REGIONS = ['cli/src/curation/', 'knowledge-local/src/', 'schema/src/']
const NAMED_REGIONS = [RUNNER, MODEL, CLI, DASHBOARD_UI_LIB, ...CURATION_REGIONS]

const MASKING_CONTEXT: Halves = ['Maskin', 'gContext']
const UNMASK_KEY: Halves = ['(^|[^\\w$])unm', 'ask\\??\\s*:']
const UNMASK_CALL: Halves = ['\\.unm', 'ask\\s*\\(']
const MARKER_OPENER: Halves = [String.fromCharCode(0x241f), 'masked:']

const RETURN_LEGS: readonly ReturnLeg[] = [
  {
    subject: 'the safety masker',
    absent: ['safety/src/masking/'],
    scans: [{
      regions: ALL,
      needles: [
        ['createMaskin', 'gContext'], ['getActiveMaskin', 'gContext'], ['setActiveMaskin', 'gContextResolver'],
        ['seedMaskin', 'gContext'], ['MaskingSeed', 'Sources'], ['snapshot', 'Registered'], ['unmaskForHuman', 'Output'],
        ['detect', 'Emails'], ['createMaskingProvider', 'RequestHook'], ['ambientMaskin', 'gContextResolver'],
      ],
    }],
  },
  {
    subject: 'the masking context type and its restore member',
    absent: ['schema/src/safety/masking.ts'],
    scans: [{
      regions: ALL,
      needles: [MASKING_CONTEXT],
      patterns: [
        [UNMASK_KEY, ['const port = { mask, unm', 'ask: (text) => text }']],
        [UNMASK_CALL, ['const shown = context.unm', 'ask(text)']],
      ],
    }],
  },
  {
    subject: 'the numbered placeholders and the generic redaction marker',
    scans: [
      { regions: ALL, needles: [['<SEC', 'RET_'], ['<EMA', 'IL_'], ['PLACEHOLDER', '_PATTERN']] },
      { regions: [RUNNER], needles: [['generic', 'Marker']] },
    ],
  },
  {
    subject: 'the run masking seed',
    scans: [{
      regions: ALL,
      needles: [
        ['buildRunMaskin', 'gContext'], ['RunMaskin', 'gContext'], ['sensitiveEnv', 'Slice'],
        ['extractAuthStateSensitive', 'Strings'], ['createAnalyticsMaskin', 'gContext'], ['merged', 'SecretStore'],
        ['bindMasking', 'Secrets'], ['maskingSecret', 'Stores'], ['minted', 'SecretStore'], ['MINTED_LIVE_URL', '_TOKEN_CAP'],
      ],
    }],
  },
  {
    subject: 'the display restore and the digest sidecar',
    absent: [
      'cli/src/composition/display-unmask.ts',
      'dashboard-server/src/masking/display-tree.ts',
      'runner-local/src/masking-sidecar.ts',
    ],
    scans: [{
      regions: ALL,
      needles: [
        ['unmaskFor', 'Display'], ['unmaskTreeFor', 'Display'], ['createDisplay', 'Unmasker'],
        ['markUnrestorable', 'Placeholders'], ['MASKING_DIGESTS', '_FILE'], ['MASKING_HOST', '_KEY_FILE'],
        ['MASKING_DIGESTS_SCHEMA', '_VERSION'], ['resolveMaskingHost', 'Key'], ['digestMasked', 'Value'],
        ['writeMasking', 'Digests'], ['readMasking', 'Digests'], ['masking-digests', '.json'],
      ],
    }],
  },
  {
    subject: 'the masked-value marker vocabulary and its chips',
    absent: [
      'schema/src/run/masked-marker.ts',
      'dashboard-ui/src/lib/masked-text.ts',
      'dashboard-ui/src/components/run-detail/masked-chip.tsx',
      'dashboard-ui/src/components/run-detail/masked-text.tsx',
    ],
    scans: [
      {
        regions: ALL,
        needles: [
          ['masked', 'Marker'], ['MASKED_MARKER', '_PATTERN'], ['MASKED_MARKER', '_DELIMITER'], ['Masked', 'Category'],
          MARKER_OPENER, ['MASKED_SECRET', '_LABEL'], ['MASKED_SECRET_LIVE', '_LABEL'], ['MASKED_EMAIL', '_LABEL'],
          ['masked', 'Label'], ['Masked', 'Chip'], ['Masked', 'Text'], ['Masked', 'Segment'], ['splitMasked', 'Text'],
          ['truncateMasked', 'Text'], ['copyText', 'Of'],
        ],
      },
      { regions: [DASHBOARD_UI_LIB], needles: [['masked?', ': boolean'], ['masked', ': true']] },
    ],
  },
  {
    subject: 'the auth-state redaction',
    absent: ['runner/src/hooks/redaction.ts', 'core/src/auth-state/redaction.ts'],
    scans: [{
      regions: ALL,
      needles: [
        ['redactAuthState', 'Value'], ['redactAuthState', 'String'], ['AuthStateRedaction', 'Context'],
        ['AUTH_STATE_REDACTION', '_MARKER'], ['[auth state ', 'redacted]'],
      ],
    }],
  },
  {
    subject: 'the network header mask',
    scans: [{ regions: ALL, needles: [['NETWORK_CREDENTIAL', '_HEADERS'], ['NetworkCredential', 'Header']] }],
  },
  {
    subject: 'the debug log regex redactor',
    scans: [{ regions: [MODEL], needles: [['SECRET', '_PATTERNS']] }],
  },
  {
    subject: 'the capture blacklist and its receipt',
    absent: [joined(['knowledge-local/src/curator/capture-black', 'list.ts']), 'schema/src/action/credential-fields.ts'],
    scans: [
      {
        regions: ALL,
        needles: [
          ['CAPTURE_BLACKLIST_NAME', '_PATTERNS'], ['CAPTURE_BLACKLIST_REDACTION', '_PLACEHOLDER'],
          ['CaptureBlacklist', 'Evidence'], ['SanitizedCaptureBlacklist', 'Region'], ['CaptureBlacklistSkipped', 'Artifact'],
          ['classifyCapture', 'Blacklist'], ['sanitizeCaptureBlacklist', 'Evidence'], ['filterArtifactsFor', 'Capture'],
          ['capture-black', 'list'], ['capture', 'Receipt'], ['artifactFreeCapture', 'Receipt'],
          ['curationCaptureReceipt', 'Schema'], ['CurationCapture', 'Receipt'], ['curationCandidateOmission', 'Schema'],
          ['curationCandidateRedaction', 'Schema'], ['CurationCandidate', 'Omission'], ['CurationCandidate', 'Redaction'],
          ['ARTIFACT_VALUE_REDACTION', '_PLACEHOLDER'], ['redactArtifact', 'Values'], ['capture', 'Evidence'],
          ['step', 'Interactions'], ['isCredentialValue', 'Field'], ['CREDENTIAL_VALUE', '_FIELDS'],
          ['secretRegion', 'Keys'], ['secretBy', 'Receipt'],
        ],
      },
      {
        regions: CURATION_REGIONS,
        needles: [['slot.target', 'Ref'], ['targetRef: primary', 'Ref'], ['targetRef: z.str', 'ing']],
      },
    ],
  },
]

const cellId = (index: number): string => `C441-RETURN-${String(index + 1).padStart(2, '0')}`

const plantPath = (region: string): string => (region.endsWith('/') ? `${region}planted-return.ts` : region)

describe('C441-RETURN — the declared-secret deletion census (441 D-17)', () => {
  it('C441-UNIVERSE-FLOORS: every region reads real code, so no leg can pass over an empty scan', () => {
    expect(ALL.length, 'the package universe is empty').toBeGreaterThan(20)
    expect(PRODUCTION.files(ALL).length, 'the production universe scanned too little').toBeGreaterThan(1000)
    for (const region of NAMED_REGIONS) {
      expect(filesOf(region).length, `${region} scanned nothing`).toBeGreaterThan(3)
    }
    RETURN_LEGS.forEach((leg, index) => {
      for (const scan of leg.scans) {
        for (const region of scan.regions) {
          expect(filesOf(region).length, `${cellId(index)}: the region ${region} does not exist`).toBeGreaterThan(0)
        }
        expect((scan.needles?.length ?? 0) + (scan.patterns?.length ?? 0), `${cellId(index)} has an empty scan`).toBeGreaterThan(0)
      }
    })
    expect(RETURN_LEGS.length).toBe(10)
    expect(new Set(RETURN_LEGS.map((leg) => leg.subject)).size).toBe(RETURN_LEGS.length)
  })

  RETURN_LEGS.forEach((leg, index) => {
    it(`${cellId(index)}: ${leg.subject} stays deleted`, () => {
      const found = findings(leg, PRODUCTION)
      expect(found, `${leg.subject} returned:\n${found.join('\n')}`).toEqual([])
    })
  })
})

describe('C441-RETURN census instruments', () => {
  it('C441-LEXER-CONTROL: comments are blanked, strings, templates and regex literals are kept', () => {
    const needle = joined(MASKING_CONTEXT)
    const sample = [
      `const a = 'kept // not a comment' // ${needle}`,
      `/* ${needle} */ const b = \`kept \${x ? \`nested \${y}\` : "q"} tail\` // dropped`,
      'const c = /kept\\/regex/g.test(z) /* dropped */',
      `// 2026-10-15 (441): ${needle} was deleted`,
      '/** dropped',
      ` * ${needle} */ const d = "kept\u0000joined"`,
    ].join('\n')
    const lines = codeOf(sample).split('\n')
    expect(lines).toHaveLength(6)
    expect(lines[0]).toContain("'kept // not a comment'")
    expect(lines[1]).toContain('`kept ${x ? `nested ${y}` : "q"} tail`')
    expect(lines[2]).toContain('/kept\\/regex/g')
    expect(lines[3]!.trim()).toBe('')
    expect(lines[4]!.trim()).toBe('')
    expect(lines[5]).toContain('"kept\u0000joined"')
    expect(codeOf(sample)).not.toContain(needle)
    expect(codeOf(sample)).not.toContain('dropped')
  })

  it('C441-PLANTED-POSITIVE: every leg fails on a planted return and stays green on a planted comment', () => {
    let plants = 0
    RETURN_LEGS.forEach((leg, index) => {
      for (const path of leg.absent ?? []) {
        expect(findings(leg, planted('unused/src/x.ts', '', [path])), `${cellId(index)}: ${path} restored`).not.toEqual([])
        plants++
      }
      for (const scan of leg.scans) {
        const path = plantPath(scan.regions[0]!)
        for (const needle of scan.needles ?? []) {
          const spelled = joined(needle)
          const asCode = IDENTIFIER.test(spelled) ? `export const ${spelled} = 1` : `export const planted = \`${spelled}\``
          expect(findings(leg, planted(path, asCode)), `${cellId(index)}: ${spelled} as code`).not.toEqual([])
          expect(findings(leg, planted(path, `// ${spelled}\n/* ${spelled} */`)), `${cellId(index)}: ${spelled} as a comment`).toEqual([])
          plants++
        }
        for (const [pattern, sample] of scan.patterns ?? []) {
          expect(findings(leg, planted(path, joined(sample))), `${cellId(index)}: ${joined(pattern)} as code`).not.toEqual([])
          expect(findings(leg, planted(path, `// ${joined(sample)}`)), `${cellId(index)}: ${joined(pattern)} as a comment`).toEqual([])
          plants++
        }
      }
    })
    expect(plants).toBeGreaterThan(100)

    const contextLeg = RETURN_LEGS[1]!
    const keptSeam = `export interface Analytics${joined(MASKING_CONTEXT)} { readonly mask: (text: string) => string }`
    expect(findings(contextLeg, planted('analytics/src/masking-seam.ts', keptSeam))).toEqual([])
    expect(findings(contextLeg, planted('analytics/src/compose.ts', 'const masked = ok ? unmasked : raw'))).toEqual([])

    const captureLeg = RETURN_LEGS[9]!
    expect(findings(captureLeg, planted('ios/src/adapter.ts', 'function wheel(targetRef: string) { return targetRef }'))).toEqual([])
    expect(findings(captureLeg, planted('knowledge-local/src/x.ts', 'function wheel(targetRef: string) { return targetRef }'))).toEqual([])
    expect(findings(captureLeg, planted('knowledge-local/src/x.ts', `const s = { ${joined(['targetRef: primary', 'Ref'])} }`))).not.toEqual([])
    expect(findings(RETURN_LEGS[5]!, planted('dashboard-ui/src/components/x.tsx', `const row = { ${joined(['masked', ': true'])} }`))).toEqual([])
    expect(findings(RETURN_LEGS[8]!, planted('runner/src/x.ts', `const ${joined(['SECRET', '_PATTERNS'])} = []`))).toEqual([])
  })

  it('C441-SELF-MATCH: this file spells none of the needles it assembles, and lies outside every region it scans', () => {
    const own = readFileSync(THIS_FILE).toString('utf8')
    expect(existsSync(join(PACKAGES_DIR, OWN)), 'the self path is wrong').toBe(true)
    const needles = RETURN_LEGS.flatMap((leg) => leg.scans.flatMap((scan) => (scan.needles ?? []).map(joined)))
    expect(needles.length).toBeGreaterThan(80)
    const spelled = needles.filter((needle) => own.includes(needle))
    expect(spelled, `this file spells what it forbids: ${spelled.join(', ')}`).toEqual([])
    const scanned = PRODUCTION.files([...new Set([...RETURN_LEGS.flatMap((leg) => leg.scans.flatMap((scan) => scan.regions)), ...ALL])])
    expect(scanned.length, 'the regions scanned nothing').toBeGreaterThan(1000)
    expect(scanned, 'this census file is inside a region it scans').not.toContain(OWN)
    expect(scanned.filter((file) => file.includes('/__tests__/')), 'a test file was scanned').toEqual([])
  })
})
