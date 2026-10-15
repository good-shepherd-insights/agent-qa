import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// SAFE-03 release gate (D-04). This is the closing enforcement conformance gate,
// wired into the release plan beside validate:tools/validate:arch. It carries these
// per-check-tailored detections:
//   (a) STRUCTURAL — createModel's per-call middleware array ends with ...MIDDLEWARE and
//       then createMaskingMiddleware(mask), with createModel's own MaskFn (441 D-06, E7).
//   (c) STATIC import firewall — no LLM-context builder imports the audit surface
//       (T-350-16); see Task 2 below.
// 2026-10-15 (441-33, D-15): (b), the registrar's fail-closed guardrail policy load, is deleted
// with the registrar.
// The (a) egress-bypass check covers the model-egress chokepoint today; it extends to
// committed-egress consumer paths (knowledge/issue bundles, CI diff, cassettes) as M2/MC
// derive them via assertCommittedEgressSafe (deferred, not this plan).
//
// House style mirrors validate:tools-in-core / validate:arch-in-arch: self-contained
// scan helpers (no cross-package import), offender lists, and held-out fixtures that
// prove each check rejects its violation. The model registry is read AS TEXT — never
// imported — so the safety package never depends on model (dependency inversion would
// trip validate:arch's direction/cycle firewalls — RESEARCH Pitfall 4). Test files are
// exempt from safety's ownership source-scan (arch's sourceFilesFor filters __tests__),
// so node:fs here is fine.

const testDir = dirname(fileURLToPath(import.meta.url))
const packagesRoot = join(testDir, '..', '..', '..')
const modelRegistrySource = readFileSync(
  join(packagesRoot, 'model', 'src', 'registry.ts'),
  'utf8',
)

// ---------------------------------------------------------------------------
// check (a): structural seam-pinning over a source string (pure, fixture-driven)
// ---------------------------------------------------------------------------

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

function matchBracket(source: string, openIndex: number): number {
  const open = source[openIndex]
  const close = open === '(' ? ')' : ']'
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    if (char === open) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function splitTopLevelEntries(inner: string): string[] {
  const entries: string[] = []
  let depth = 0
  let current = ''

  for (const char of inner) {
    if (char === '(' || char === '[' || char === '{') depth += 1
    else if (char === ')' || char === ']' || char === '}') depth -= 1

    if (char === ',' && depth === 0) {
      entries.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) entries.push(current)

  return entries.map(entry => entry.trim()).filter(Boolean)
}

// Assert presence AND position; tolerate formatting-only edits; never merely check
// that the identifier appears somewhere (RESEARCH Pitfall 5).
function findSeamStructuralOffenders(rawSource: string, label: string): string[] {
  const source = stripComments(rawSource)
  const rule = (name: string, detail: string) => `${label} | ${name} | ${detail}`

  const signature = /export\s+function\s+createModel\s*\(/.exec(source)
  if (!signature) return [rule('create-model', 'export function createModel( not found')]
  const paramsOpen = signature.index + signature[0].length - 1
  const paramsClose = matchBracket(source, paramsOpen)
  const params = splitTopLevelEntries(source.slice(paramsOpen + 1, paramsClose))
  const maskParam = params
    .map(param => /^(\w+)\s*:\s*MaskFn$/.exec(param)?.[1])
    .find(name => name !== undefined)
  if (maskParam === undefined) {
    return [rule('mask-parameter', 'createModel must take a required MaskFn parameter')]
  }

  const declaration = /const\s+middleware\s*=\s*\[/.exec(source.slice(paramsOpen))
  if (!declaration) {
    return [rule('composition-array', 'the createModel per-call middleware array not found')]
  }
  const openIndex = paramsOpen + declaration.index + declaration[0].length - 1
  const entries = splitTopLevelEntries(source.slice(openIndex + 1, matchBracket(source, openIndex)))
  const expected = `createMaskingMiddleware(${maskParam})`
  const last = entries.at(-1) ?? ''
  if (last.replace(/\s+/g, '') !== expected) {
    return [rule('masking-last', `the last per-call element must be ${expected}, found ${last}`)]
  }
  if (entries.at(-2) !== '...MIDDLEWARE') {
    return [rule('spread-before-masking', `...MIDDLEWARE must come immediately before ${expected}`)]
  }
  return []
}

// Held-out fixtures (synthetic mini-sources) — these are what give the gate teeth.
function registryFixture(middleware: string[]): string {
  return [
    'const MIDDLEWARE: LanguageModelMiddleware[] = [retryMiddleware(), dropEmptyMessagesMiddleware()]',
    'export function createModel(',
    '  profile: ModelProfile,',
    '  auth: ResolvedModelAuth,',
    '  mask: MaskFn,',
    '  overrides: ModelProviderOverrides = {},',
    '): LanguageModelV3 {',
    '  const middleware = [',
    ...middleware.map(entry => `    ${entry},`),
    '  ]',
    '  return wrap(middleware)',
    '}',
  ].join('\n')
}

const FIXTURE_MISSING_MASKING = registryFixture([
  'capabilityUpdateMiddleware(profile)',
  '...MIDDLEWARE',
])

const FIXTURE_REORDERED_MASKING = registryFixture([
  'createMaskingMiddleware(mask)',
  'capabilityUpdateMiddleware(profile)',
  '...MIDDLEWARE',
])

const FIXTURE_SPREAD_AFTER_MASKING = registryFixture([
  'capabilityUpdateMiddleware(profile)',
  'createMaskingMiddleware(mask)',
  '...MIDDLEWARE',
])

const FIXTURE_ELEMENT_BETWEEN = registryFixture([
  'capabilityUpdateMiddleware(profile)',
  '...MIDDLEWARE',
  'dropEmptyMessagesMiddleware()',
  'createMaskingMiddleware(mask)',
])

const FIXTURE_FOREIGN_MASK = registryFixture([
  'capabilityUpdateMiddleware(profile)',
  '...MIDDLEWARE',
  'createMaskingMiddleware((text) => text)',
])

const MASKING_LAST =
  'fixture | masking-last | the last per-call element must be createMaskingMiddleware(mask), found'

describe('SAFE-03 (a) structural seam pinning', () => {
  it('reports zero structural offenders against the real model registry source', () => {
    expect(findSeamStructuralOffenders(modelRegistrySource, 'packages/model/src/registry.ts')).toEqual(
      [],
    )
  })

  it('rejects a held-out fixture whose createModel array omits the masking middleware', () => {
    expect(findSeamStructuralOffenders(FIXTURE_MISSING_MASKING, 'fixture')).toEqual([
      `${MASKING_LAST} ...MIDDLEWARE`,
    ])
  })

  it('rejects a held-out fixture with the masking middleware reordered out of last position', () => {
    expect(findSeamStructuralOffenders(FIXTURE_REORDERED_MASKING, 'fixture')).toEqual([
      `${MASKING_LAST} ...MIDDLEWARE`,
    ])
  })

  it('rejects a held-out fixture whose composition spreads ...MIDDLEWARE after the masking middleware', () => {
    expect(findSeamStructuralOffenders(FIXTURE_SPREAD_AFTER_MASKING, 'fixture')).toEqual([
      `${MASKING_LAST} ...MIDDLEWARE`,
    ])
  })

  it('rejects a held-out fixture with another element between ...MIDDLEWARE and the masking middleware', () => {
    expect(findSeamStructuralOffenders(FIXTURE_ELEMENT_BETWEEN, 'fixture')).toEqual([
      'fixture | spread-before-masking | ...MIDDLEWARE must come immediately before createMaskingMiddleware(mask)',
    ])
  })

  it("rejects a held-out fixture whose masking middleware is not given createModel's mask", () => {
    expect(findSeamStructuralOffenders(FIXTURE_FOREIGN_MASK, 'fixture')).toEqual([
      `${MASKING_LAST} createMaskingMiddleware((text) => text)`,
    ])
  })
})

// ---------------------------------------------------------------------------
// check (c): audit-into-LLM-context static import firewall (D-04c, T-350-16)
// ---------------------------------------------------------------------------

// The packages that assemble LLM context today: planner/context assembly under
// core/src/agent and prompt flow through model. Audit rows must never flow back into
// any LLM context (spec execution-safety §6). The audit surface is write-only today
// (Phase 343), so this is a forward-looking firewall against a future audit reader
// being fed into prompts. EXTENSION POLICY: M1/M4 add new context builders to this list
// as they land (RESEARCH Open Q3 resolution).
const CONTEXT_BUILDER_PACKAGES = ['core', 'model'] as const

// The host adapter package that writes audit trails; no context builder may import it.
const SAFETY_LOCAL_PACKAGE = '@vostride/agent-qa-safety-local'
// The audit sink symbol and the JSONL trail filenames. 2026-10-01 (432-19, D-17/D-22): the sink
// writes `guardrail_audit.jsonl` only, and `execution_audit.jsonl` has no writer; an old one stays in
// a workspace and is never read. It stays a needle here for exactly that reason — a context builder
// that started reading the legacy trail would be the first reader it ever had.
const AUDIT_SINK_SYMBOL = 'JsonlAuditSink'
const AUDIT_TRAIL_FILES = ['execution_audit.jsonl', 'guardrail_audit.jsonl'] as const

// Copied locally (validate:tools self-contained house style) — coupling safety's test to
// arch internals via a cross-package relative import was considered and rejected in RESEARCH.
const SPECIFIER_RE =
  /\bfrom\s+['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\.resolve\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g

function findAuditFirewallOffenders(file: string, source: string): string[] {
  const offenders: string[] = []
  const lines = source.split('\n')

  lines.forEach((text, index) => {
    const line = index + 1

    // R1: an import specifier is or starts with the safety-local package name.
    for (const match of text.matchAll(SPECIFIER_RE)) {
      const specifier = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5]
      if (
        specifier &&
        (specifier === SAFETY_LOCAL_PACKAGE || specifier.startsWith(`${SAFETY_LOCAL_PACKAGE}/`))
      ) {
        offenders.push(
          `${file}:${line} | ${specifier} | R1 context builder must not import the audit host adapter ${SAFETY_LOCAL_PACKAGE}`,
        )
      }
    }

    // R2: a source line references the audit sink identifier.
    if (new RegExp(`\\b${AUDIT_SINK_SYMBOL}\\b`).test(text)) {
      offenders.push(
        `${file}:${line} | ${AUDIT_SINK_SYMBOL} | R2 context builder must not reference the audit sink symbol`,
      )
    }

    // R3: a source line references an audit JSONL trail filename.
    for (const trail of AUDIT_TRAIL_FILES) {
      if (text.includes(trail)) {
        offenders.push(
          `${file}:${line} | ${trail} | R3 context builder must not reference an audit trail filename`,
        )
      }
    }
  })

  return offenders
}

function contextBuilderSourceFiles(): { file: string; source: string }[] {
  const files: { file: string; source: string }[] = []

  for (const pkg of CONTEXT_BUILDER_PACKAGES) {
    const packageRoot = join(packagesRoot, pkg)
    if (!existsSync(join(packageRoot, 'src'))) continue

    for (const relative of globSync('src/**/*.{ts,tsx,mjs,cjs,js}', { cwd: packageRoot })) {
      if (relative.includes('__tests__')) continue
      files.push({
        file: `${pkg}/${relative}`,
        source: readFileSync(join(packageRoot, relative), 'utf8'),
      })
    }
  }

  return files
}

const FIXTURE_AUDIT_LEAK = [
  "import type { AuditSink } from '@vostride/agent-qa-safety-local'",
  'const sink: JsonlAuditSink = makeSink()',
].join('\n')

const FIXTURE_CLEAN_CONTEXT = [
  "import { createModel } from '@vostride/agent-qa-model'",
  'const model = createModel(profile, auth)',
].join('\n')

describe('SAFE-03 (c) audit-into-context import firewall', () => {
  it('reports zero audit-firewall offenders across every context-builder source file', () => {
    const offenders = contextBuilderSourceFiles().flatMap(({ file, source }) =>
      findAuditFirewallOffenders(file, source),
    )
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('rejects a held-out fixture importing safety-local and naming the audit sink', () => {
    expect(
      findAuditFirewallOffenders('packages/core/src/agent/context.ts', FIXTURE_AUDIT_LEAK),
    ).toEqual([
      'packages/core/src/agent/context.ts:1 | @vostride/agent-qa-safety-local | R1 context builder must not import the audit host adapter @vostride/agent-qa-safety-local',
      'packages/core/src/agent/context.ts:2 | JsonlAuditSink | R2 context builder must not reference the audit sink symbol',
    ])
  })

  it('C432-AUDIT-UNREAD: a context builder naming the legacy execution-audit trail is still an offender', () => {
    expect(
      findAuditFirewallOffenders(
        'packages/core/src/agent/context.ts',
        "const legacy = readFileSync(join(root, 'execution_audit.jsonl'), 'utf8')",
      ),
    ).toEqual([
      'packages/core/src/agent/context.ts:1 | execution_audit.jsonl | R3 context builder must not reference an audit trail filename',
    ])
  })

  it('accepts a clean context builder that composes the model without touching the audit surface', () => {
    expect(
      findAuditFirewallOffenders('packages/core/src/agent/context.ts', FIXTURE_CLEAN_CONTEXT),
    ).toEqual([])
  })
})
