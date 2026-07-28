// The evaluate() named-set pin (Phase 384, FUNC-02 / D-12 / SC2).
//
// Two — and only two — legitimate gate domains exist in this repo:
//
//   1. IN-RUN TOOL ACTIONS. safety's own policy gate hook adapts the v48 gate into the
//      async tool_call attachment point the first-party registrar wires.
//   2. SURFACE CAPABILITIES. agent's `invokeFunction` is the single dispatch path every
//      surface crosses, and it gates every invocation without exception (D-11).
//
// Plus the export seam: safety's package barrel republishes the symbol so domain 2 can
// reach it at all. Three files, enumerated below. A FOURTH is a second gate call-site,
// which SC2 makes build-impossible rather than review-caught.
//
// WHAT COUNTS AS ACQUISITION, and why the obvious detector is wrong.
//
// The three real files use THREE DIFFERENT syntactic forms, and one of them is not an
// import statement at all — the safety barrel re-EXPORTS the symbol. A detector keyed on
// the import keyword finds two of three and then reports the barrel as a stale entry,
// failing the build for exactly the wrong reason. Both keywords count here.
//
// Detection keys on module STATEMENTS, never on call tokens. `page.evaluate(...)` and
// `asserter.evaluate(...)` are all over this codebase; a token scan would drown the pin
// in noise and teach everyone to ignore it.

/** The safety package's published name — the specifier domain 2 acquires the symbol by. */
export const SAFETY_PACKAGE_SPECIFIER = '@vostride/agent-qa-safety'

/** The gate module itself, repo-relative and extensionless. Domain 1's target. */
export const SAFETY_GATE_MODULE = 'packages/safety/src/policy/gate'

/** The pinned symbol. An alias changes the local name, never the imported one. */
export const EVALUATE_SYMBOL = 'evaluate'

/**
 * The exact production file set permitted to acquire the gate, each entry carrying the
 * domain that justifies it. The map doubles as the documentation of those domains: a
 * reader who wants to know why a file may call the gate reads its rationale here, and a
 * phase that adds one must state a rationale in the same commit.
 *
 * Test files are OUT OF SCOPE by construction, not by exception: the scan is fed through
 * `sourceFilesFor`, which drops `__tests__`. Five test files across agent, cli and safety
 * legitimately exercise the shipped gate and classifier; none of them is a call-site in
 * the sense this pin polices.
 */
export const EVALUATE_PIN: Readonly<Record<string, string>> = {
  'packages/safety/src/policy/gate-hook.ts':
    'Domain 1 (2026-07-28): the v48 in-run TOOL-ACTION gate. Adapts the gate into the async tool_call hook the first-party registrar wires; performs zero audit work of its own.',
  'packages/safety/src/index.ts':
    'The export seam (2026-07-28): re-export only. Nothing in this file calls the gate; it republishes the symbol so the surface-capability domain can acquire it across a package boundary at all.',
  'packages/agent/src/functions/invoke.ts':
    'Domain 2 (2026-07-28): the surface-CAPABILITY gate. The single dispatch path every surface crosses, gating every invocation including reads (D-11), so scope enforcement never becomes a second gate in disguise.',
}

export interface EvaluatePinSource {
  /** Repo-relative, forward-slash path. */
  file: string
  source: string
}

/** How a statement got hold of the module's values. */
export type EvaluateAcquisitionForm = 'named' | 'whole-module'

export interface EvaluateAcquisition {
  file: string
  line: number
  keyword: 'import' | 'export'
  specifier: string
  form: EvaluateAcquisitionForm
}

export interface ModuleStatement {
  keyword: 'import' | 'export'
  /** Everything between the keyword and the specifier — the binding clause. */
  clause: string
  specifier: string
  /** 1-based line of the statement's first line. */
  line: number
}

const STATEMENT_START_RE = /^\s*(?:import|export)\b/
const COMPLETE_STATEMENT_RE = /^\s*(import|export)\s+([\s\S]*?)\s*\bfrom\s*(['"])([^'"]+)\3/
const WHOLE_MODULE_CALL_RE = /\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g

/** Longest run a binding clause may span before we stop looking for its specifier. */
const MAX_CLAUSE_LINES = 24

/**
 * Drop block and line comments so a commented-out statement is never read as real code.
 *
 * The `[^:]` guard keeps a protocol-relative URL from being mistaken for a line comment,
 * which is the classic way this kind of stripper eats half a file.
 */
export function stripCodeComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Every module statement that names a specifier, multi-line clauses included.
 *
 * A statement is grown line by line until its specifier appears, stopping at a blank line
 * or at the next statement start. The clause character set is deliberately narrow, so an
 * ordinary `export const` or `export interface` cannot swallow a later statement's
 * specifier and be reported as one binding.
 */
export function parseModuleStatements(source: string): ModuleStatement[] {
  const lines = stripCodeComments(source).split('\n')
  const statements: ModuleStatement[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const first = lines[index]
    if (first === undefined || !STATEMENT_START_RE.test(first)) continue

    let buffer = first
    let consumed = 0
    let matched: RegExpExecArray | null = COMPLETE_STATEMENT_RE.exec(buffer)

    while (matched === null && consumed < MAX_CLAUSE_LINES) {
      const next = lines[index + consumed + 1]
      if (next === undefined || next.trim() === '' || STATEMENT_START_RE.test(next)) break
      buffer = `${buffer}\n${next}`
      consumed += 1
      matched = COMPLETE_STATEMENT_RE.exec(buffer)
    }

    if (matched === null) continue

    const keyword = matched[1] === 'export' ? 'export' : 'import'
    statements.push({
      keyword,
      clause: (matched[2] ?? '').trim(),
      specifier: matched[4] ?? '',
      line: index + 1,
    })
    index += consumed
  }

  return statements
}

function normalizeRepoPath(file: string): string {
  return file.replaceAll('\\', '/')
}

/** Resolve a relative specifier against the importing file, extensionless. */
function resolveRelative(file: string, specifier: string): string {
  const segments = normalizeRepoPath(file).split('/').slice(0, -1)

  for (const part of specifier.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      segments.pop()
      continue
    }
    segments.push(part)
  }

  return segments.join('/').replace(/\.(?:ts|tsx|js|mjs|cjs)$/, '')
}

type GateRelevance = 'barrel' | 'gate-module' | 'none'

function gateRelevance(file: string, specifier: string): GateRelevance {
  if (
    specifier === SAFETY_PACKAGE_SPECIFIER
    || specifier.startsWith(`${SAFETY_PACKAGE_SPECIFIER}/`)
  ) {
    return 'barrel'
  }

  if (specifier.startsWith('.') && resolveRelative(file, specifier) === SAFETY_GATE_MODULE) {
    return 'gate-module'
  }

  return 'none'
}

interface ClauseShape {
  typeOnly: boolean
  wholeModule: boolean
  /** Imported (left-hand) names bound in VALUE position; an alias is discarded. */
  valueNames: string[]
}

function readClause(clause: string): ClauseShape {
  if (/^type\b/.test(clause)) {
    return { typeOnly: true, wholeModule: false, valueNames: [] }
  }

  const braced = /\{([\s\S]*)\}/.exec(clause)
  if (braced === null) {
    // `* as ns`, `* `, or a bare default binding. Each one is a whole-module value
    // acquisition for our purposes — a default binding is the CJS namespace under
    // interop, and a pin that guessed otherwise would guess in the unsafe direction.
    return { typeOnly: false, wholeModule: true, valueNames: [] }
  }

  const valueNames = (braced[1] ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry !== '')
    .filter(entry => !/^type\b/.test(entry))
    .map(entry => (entry.split(/\s+as\s+/)[0] ?? entry).trim())
    .filter(entry => entry !== '')

  return { typeOnly: false, wholeModule: false, valueNames }
}

/**
 * Every statement in one file that acquires gate power.
 *
 * From the safety BARREL, only the pinned symbol counts: the barrel publishes thirty-odd
 * unrelated values, and half the workspace legitimately names one of them.
 *
 * From the GATE MODULE itself, any value counts. Everything that module publishes is gate
 * machinery, so a future factory or helper added beside the symbol cannot be used to
 * acquire the same power under a different name.
 *
 * Type-only acquisitions count for neither. A type is erased before anything runs, so a
 * file holding one cannot call the gate — and calling it a call-site would both misstate
 * the architecture and inflate the pin past the set SC2 is about.
 */
export function findEvaluateAcquisitions(
  source: string,
  file: string,
): EvaluateAcquisition[] {
  const normalized = normalizeRepoPath(file)
  const acquisitions: EvaluateAcquisition[] = []

  for (const statement of parseModuleStatements(source)) {
    const relevance = gateRelevance(normalized, statement.specifier)
    if (relevance === 'none') continue

    const shape = readClause(statement.clause)
    if (shape.typeOnly) continue

    const acquires = shape.wholeModule
      || (relevance === 'gate-module'
        ? shape.valueNames.length > 0
        : shape.valueNames.includes(EVALUATE_SYMBOL))
    if (!acquires) continue

    acquisitions.push({
      file: normalized,
      line: statement.line,
      keyword: statement.keyword,
      specifier: statement.specifier,
      form: shape.wholeModule ? 'whole-module' : 'named',
    })
  }

  const stripped = stripCodeComments(source)
  const lines = stripped.split('\n')
  lines.forEach((text, index) => {
    for (const match of text.matchAll(WHOLE_MODULE_CALL_RE)) {
      const specifier = match[2] ?? ''
      if (gateRelevance(normalized, specifier) === 'none') continue
      acquisitions.push({
        file: normalized,
        line: index + 1,
        keyword: 'import',
        specifier,
        form: 'whole-module',
      })
    }
  })

  return acquisitions
}

/**
 * The pin, in both directions.
 *
 *   1. a file that acquires the gate and is absent the pin is an offender;
 *   2. a pin entry that no longer acquires the gate is a STALE offender.
 *
 * Direction 2 is what keeps the pin honest as the code moves: when 386 relocates a
 * composition root or 396 rewrites the MCP server, an entry left behind fails the build
 * instead of quietly widening the permitted set.
 */
export function findEvaluatePinOffenders(
  sources: readonly EvaluatePinSource[],
): string[] {
  const offenders: string[] = []
  const acquiring = new Set<string>()

  for (const entry of sources) {
    for (const acquisition of findEvaluateAcquisitions(entry.source, entry.file)) {
      acquiring.add(acquisition.file)
      if (Object.hasOwn(EVALUATE_PIN, acquisition.file)) continue
      offenders.push(
        `evaluate-pin: ${acquisition.file}:${acquisition.line} ⇏ ${acquisition.specifier} (un-pinned gate acquisition)`,
      )
    }
  }

  for (const file of Object.keys(EVALUATE_PIN).sort()) {
    if (acquiring.has(file)) continue
    offenders.push(`evaluate-pin: ${file} ⇏ pin entry no longer acquires the gate (stale)`)
  }

  return offenders
}
