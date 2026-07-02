import { existsSync, globSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { registerFirstPartySafetyHooks } from '../hooks/first-party'
import { GuardrailConfigError } from '../guardrail/policy-loader'

// SAFE-03 release gate (D-04). This is the closing enforcement conformance gate,
// wired into the release plan beside validate:tools/validate:arch. It carries three
// per-check-tailored detections:
//   (a) STRUCTURAL — the safety egress seam is pinned last in model's MIDDLEWARE chain
//       and spread last in the createModel composition (T-350-14).
//   (b) BEHAVIORAL — the first-party registrar fails closed on bad guardrail config
//       (T-350-15, GUARD-04 hoisted to the release gate).
//   (c) STATIC import firewall — no LLM-context builder imports the audit surface
//       (T-350-16); see Task 2 below.
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
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index]
    if (char === '[') depth += 1
    else if (char === ']') {
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
  const offenders: string[] = []
  const source = stripComments(rawSource)
  const rule = (name: string, detail: string) => `${label} | ${name} | ${detail}`

  const importRe =
    /import\s*\{[^}]*\bregisterFirstPartySafetyHooks\b[^}]*\}\s*from\s*['"]@vostride\/agent-qa-safety['"]/
  if (!importRe.test(source)) {
    offenders.push(
      rule(
        'registrar-import',
        'missing import of registerFirstPartySafetyHooks from @vostride/agent-qa-safety',
      ),
    )
  }

  const declMatch = /const\s+MIDDLEWARE\b[^=]*=\s*\[/.exec(source)
  if (!declMatch) {
    offenders.push(rule('middleware-array', 'MIDDLEWARE array literal not found'))
  } else {
    const openIndex = declMatch.index + declMatch[0].length - 1
    const closeIndex = matchBracket(source, openIndex)
    const entries = splitTopLevelEntries(source.slice(openIndex + 1, closeIndex))
    const last = entries.at(-1) ?? ''
    if (!(last.includes('registerFirstPartySafetyHooks') && last.includes('.middleware'))) {
      offenders.push(
        rule(
          'safety-seam-last',
          'the last MIDDLEWARE entry must be registerFirstPartySafetyHooks().middleware',
        ),
      )
    }
  }

  const spreadIndex = source.indexOf('...MIDDLEWARE')
  if (spreadIndex === -1) {
    offenders.push(
      rule('composition-spread', '...MIDDLEWARE spread not found in the createModel composition'),
    )
  } else {
    let openIndex = -1
    let depth = 0
    for (let index = spreadIndex; index >= 0; index -= 1) {
      const char = source[index]
      if (char === ']') depth += 1
      else if (char === '[') {
        if (depth === 0) {
          openIndex = index
          break
        }
        depth -= 1
      }
    }
    if (openIndex === -1) {
      offenders.push(
        rule('composition-spread', 'enclosing createModel composition array literal not found'),
      )
    } else {
      const closeIndex = matchBracket(source, openIndex)
      const entries = splitTopLevelEntries(source.slice(openIndex + 1, closeIndex))
      const last = entries.at(-1) ?? ''
      if (!last.startsWith('...MIDDLEWARE')) {
        offenders.push(
          rule(
            'composition-spread-last',
            'the createModel composition must spread ...MIDDLEWARE as its final element',
          ),
        )
      }
    }
  }

  return offenders
}

// Held-out fixtures (synthetic mini-sources) — these are what give the gate teeth.
const FIXTURE_MISSING_SEAM = [
  "import { registerFirstPartySafetyHooks } from '@vostride/agent-qa-safety'",
  'const MIDDLEWARE: LanguageModelMiddleware[] = [',
  '  retryMiddleware(),',
  '  repairMiddleware(),',
  ']',
  'const middleware = [capabilityUpdateMiddleware(profile), ...MIDDLEWARE]',
].join('\n')

const FIXTURE_REORDERED_SEAM = [
  "import { registerFirstPartySafetyHooks } from '@vostride/agent-qa-safety'",
  'const MIDDLEWARE: LanguageModelMiddleware[] = [',
  '  registerFirstPartySafetyHooks().middleware,',
  '  retryMiddleware(),',
  ']',
  'const middleware = [capabilityUpdateMiddleware(profile), ...MIDDLEWARE]',
].join('\n')

const FIXTURE_SPREAD_NOT_LAST = [
  "import { registerFirstPartySafetyHooks } from '@vostride/agent-qa-safety'",
  'const MIDDLEWARE: LanguageModelMiddleware[] = [',
  '  retryMiddleware(),',
  '  registerFirstPartySafetyHooks().middleware,',
  ']',
  'const middleware = [...MIDDLEWARE, capabilityUpdateMiddleware(profile)]',
].join('\n')

describe('SAFE-03 (a) structural seam pinning', () => {
  it('reports zero structural offenders against the real model registry source', () => {
    expect(findSeamStructuralOffenders(modelRegistrySource, 'packages/model/src/registry.ts')).toEqual(
      [],
    )
  })

  it('rejects a held-out fixture whose MIDDLEWARE array omits the registrar seam', () => {
    expect(findSeamStructuralOffenders(FIXTURE_MISSING_SEAM, 'fixture')).toEqual([
      'fixture | safety-seam-last | the last MIDDLEWARE entry must be registerFirstPartySafetyHooks().middleware',
    ])
  })

  it('rejects a held-out fixture with the registrar seam reordered out of last position', () => {
    expect(findSeamStructuralOffenders(FIXTURE_REORDERED_SEAM, 'fixture')).toEqual([
      'fixture | safety-seam-last | the last MIDDLEWARE entry must be registerFirstPartySafetyHooks().middleware',
    ])
  })

  it('rejects a held-out fixture whose composition spreads ...MIDDLEWARE before another element', () => {
    expect(findSeamStructuralOffenders(FIXTURE_SPREAD_NOT_LAST, 'fixture')).toEqual([
      'fixture | composition-spread-last | the createModel composition must spread ...MIDDLEWARE as its final element',
    ])
  })
})

// ---------------------------------------------------------------------------
// check (b): behavioral fail-closed proof at the composed seam
// ---------------------------------------------------------------------------

describe('SAFE-03 (b) behavioral fail-closed', () => {
  it('throws GuardrailConfigError when the registrar is wired with an invalid guardrail policy', () => {
    // Pass garbage explicitly — never monkeypatch defaultGuardrailPolicyInput (Pitfall 6).
    expect(() =>
      registerFirstPartySafetyHooks({ guardrailPolicyInput: { detectors: 'garbage' } }),
    ).toThrow(GuardrailConfigError)
  })
})
