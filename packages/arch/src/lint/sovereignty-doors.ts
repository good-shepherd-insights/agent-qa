import ts from 'typescript'

export interface DoorSource {
  file: string
  text: string
}
export interface DoorSite {
  file: string
  marker: string
  label: string
}
export interface DoorHit extends DoorSite {
  line: number
}

export function doorDifferences(
  hits: readonly DoorHit[],
  allowed: readonly DoorSite[],
  marker: string,
): string[] {
  const key = (site: DoorSite) => `${site.file}::${site.marker}::${site.label}`
  const expected = new Set(allowed.map(key))
  const seen = new Set<string>()
  const differences: string[] = []
  for (const hit of hits) {
    const identity = key(hit)
    if (!expected.has(identity) || seen.has(identity)) {
      differences.push(`${hit.file}:${hit.line}: ${hit.label} (${hit.marker || `missing ${marker}:`})`)
    }
    seen.add(identity)
  }
  for (const identity of expected) {
    if (!seen.has(identity)) differences.push(`missing allowed site: ${identity}`)
  }
  return differences
}

export function commitDoorHits(sources: readonly DoorSource[]): DoorHit[] {
  const NEEDLES = [
    { label: 'store commit', needle: /\.commit\s*\(/ },
    { label: 'profile commit', needle: /\bcommitWithProfile\s*\(/ },
  ] as const
  return sources.flatMap(({ file, text }) => {
    const lines = text.split('\n')
    return lines.flatMap((line, index) => NEEDLES.flatMap(({ label, needle }) => {
      if (!needle.test(line)) return []
      const marker = lines[index - 1]?.match(/^\s*\/\/ 419-COMMIT-DOOR:\s*(.+?)\s*$/)?.[1] ?? ''
      return [{ file, line: index + 1, marker, label }]
    }))
  })
}

/**
 * 2026-09-08: adjacency alone misses materialize's helper-derived path and init's atomic
 * scaffold plan. Track policy path expressions through variables and returned helper values,
 * then census actual write calls (including the scaffold publisher's declared path input).
 * This is a conservative source lint, not a general interprocedural filesystem proof.
 */
export function policyWriterHits(sources: readonly DoorSource[]): DoorHit[] {
  const parsed = sources.map(source => ({
    ...source,
    ast: ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true),
    paths: new Set<string>(),
    aliases: new Map<string, string>(),
  }))
  const helpers = new Set<string>()
  const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => {
    visit(node)
    ts.forEachChild(node, child => {
      walk(child, visit)
    })
  }
  const callName = (node: ts.Expression): string =>
    ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : ''
  for (const source of parsed) {
    walk(source.ast, node => {
      if (ts.isImportSpecifier(node)) {
        source.aliases.set(node.name.text, node.propertyName?.text ?? node.name.text)
      }
    })
  }
  function isPath(node: ts.Node | undefined, source: (typeof parsed)[number]): boolean {
    if (node === undefined) return false
    if (ts.isStringLiteralLike(node)) return /(^|[/\\])policies($|[/\\])/.test(node.text)
    if (ts.isIdentifier(node)) return source.paths.has(node.text)
    if (ts.isTemplateExpression(node)) {
      return isPath(node.head, source) || node.templateSpans.some(span =>
        isPath(span.expression, source) || /(^|[/\\])policies($|[/\\])/.test(span.literal.text))
    }
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression)
      return helpers.has(source.aliases.get(name) ?? name) || node.arguments.some(arg => isPath(arg, source))
    }
    if (ts.isBinaryExpression(node)) return isPath(node.left, source) || isPath(node.right, source)
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return isPath(node.expression, source)
    return false
  }
  let changed = true
  while (changed) {
    changed = false
    for (const source of parsed) {
      walk(source.ast, node => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isPath(node.initializer, source)) {
          if (!source.paths.has(node.name.text)) {
            source.paths.add(node.name.text)
            changed = true
          }
        }
        if (ts.isReturnStatement(node) && isPath(node.expression, source)) {
          let owner: ts.Node | undefined = node.parent
          while (owner !== undefined && !ts.isFunctionLike(owner)) owner = owner.parent
          if (owner !== undefined && ts.isFunctionDeclaration(owner) && owner.name !== undefined && !helpers.has(owner.name.text)) {
            helpers.add(owner.name.text)
            changed = true
          }
        }
      })
    }
  }
  const hits: DoorHit[] = []
  for (const source of parsed) {
    const lines = source.text.split('\n')
    walk(source.ast, node => {
      if (!ts.isCallExpression(node)) return
      const rawName = callName(node.expression)
      const name = source.aliases.get(rawName) ?? rawName
      const pathArg = /^(scaffoldFilePlan|renameSync|rename)$/.test(name) ? 1 : 0
      if (!/^(openSync|renameSync|rename|writeFileSync|appendFileSync|mkdirSync|writeFile|appendFile|mkdir|scaffoldFilePlan)$/.test(name)) return
      if (!isPath(node.arguments[pathArg], source)) return
      const line = source.ast.getLineAndCharacterOfPosition(node.getStart(source.ast)).line
      const marker = lines[line - 1]?.match(/^\s*\/\/ 419-POLICY-WRITER:\s*(.+?)\s*$/)?.[1] ?? ''
      hits.push({ file: source.file, line: line + 1, marker, label: name })
    })
  }
  return hits
}
