import ts from 'typescript'
import { resumePathClosureOf } from './resume-path-model-free.js'

export interface CalibrationSource { file: string; text: string }
export type PackageEntries = ReadonlyMap<string, string>

/** Parse statements rather than local names: aliases, re-exports and multiline imports count. */
export function calibrationImports(source: CalibrationSource, runtimeOnly = false) {
  const ast = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true)
  const hits: { file: string; line: number; specifier: string }[] = []
  const visit = (node: ts.Node): void => {
    if (runtimeOnly && ts.isImportDeclaration(node) && node.importClause) {
      const clause = node.importClause
      if (clause.isTypeOnly || (!clause.name && clause.namedBindings
        && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every(name => name.isTypeOnly))) return
    }
    if (runtimeOnly && ts.isExportDeclaration(node) && (node.isTypeOnly
      || (node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.every(name => name.isTypeOnly)))) return
    let literal: ts.Node | undefined
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal = node.moduleSpecifier
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) literal = node.arguments[0]
    if (literal && ts.isStringLiteral(literal)) hits.push({ file: source.file,
      line: ast.getLineAndCharacterOfPosition(literal.getStart()).line + 1, specifier: literal.text })
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return hits
}

/** Use the existing closure engine, resolving workspace export aliases into source edges. */
export function calibrationClosure(sources: readonly CalibrationSource[], entries: readonly string[], packages: PackageEntries, runtimeOnly = false) {
  const known = new Set(sources.map(source => source.file))
  const unresolved: string[] = []
  const modules = sources.map(source => ({ file: source.file, specifiers: calibrationImports(source, runtimeOnly).map(hit => {
    if (!hit.specifier.startsWith('@vostride/agent-qa-')) return hit
    const target = packages.get(hit.specifier)
    if (!target || !known.has(target)) {
      // Make an unresolved internal edge visible to the same fail-closed graph engine.
      return { ...hit, specifier: './__unresolved_workspace_export__' }
    }
    const depth = source.file.split('/').length - 1
    return { ...hit, specifier: '../'.repeat(depth) + target }
  }) }))
  const closure = resumePathClosureOf(modules, entries)
  for (const edge of closure.unresolved) unresolved.push(`${edge.from}: ${edge.hit.specifier}`)
  return { ...closure, unresolved }
}

const learner = /^packages\/(?:knowledge-local|agent-local|knowledge|schema)\/src\//
const privateCalibration = /\b(?:CHANNEL_TO_ORIGIN_CLASS|LabelSourceChannel|LABEL_SOURCE_CHANNELS|LABEL_TIERS|LabelTier|calibrateLabels|runLabelCalibration|readLabelCalibration|readCalibrationGoldIdentity|LABEL_CALIBRATION_PATH)\b|labels\/calibration\.json/

export function calibrationBoundaryHits(sources: readonly CalibrationSource[]): string[] {
  const hits: string[] = []
  for (const source of sources) {
    let leaked = false
    const ast = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && privateCalibration.test(node.text)) leaked = true
      ts.forEachChild(node, visit)
    }
    visit(ast)
    if (learner.test(source.file) && leaked) hits.push(`${source.file}: calibration vocabulary crossed neutral boundary`)
    for (const edge of calibrationImports(source)) {
      if (learner.test(source.file) && (/^@vostride\/agent-qa-eval(?:-local)?(?:$|\/)/.test(edge.specifier)
        && edge.specifier !== '@vostride/agent-qa-eval-local/reader')) hits.push(`${source.file}: eval main/writer import`)
    }
  }
  return hits
}

export function calibrationPureHits(sources: readonly CalibrationSource[]) {
  return sources.flatMap(source => calibrationImports(source, true).filter(hit =>
    /^(?:node:)?(?:fs|http|https|net|child_process)(?:$|\/)|@ai-sdk\/|^ai$|agent-qa-(?:model|.*-local)(?:$|\/)/.test(hit.specifier)))
}

/** A call census independent of textual call spelling; named and namespace aliases count. */
export function calibrationFoldCalls(source: CalibrationSource) {
  const ast = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true)
  const names = new Map<string, string>()
  const namespaces = new Set<string>()
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const binding = statement.importClause?.namedBindings
    if (binding && ts.isNamespaceImport(binding)) namespaces.add(binding.name.text)
    if (binding && ts.isNamedImports(binding)) for (const name of binding.elements) {
      names.set(name.name.text, (name.propertyName ?? name.name).text)
    }
  }
  const calls: { name: string; arguments: number; prior: string | undefined }[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const expression = node.expression
      const name = ts.isIdentifier(expression) ? names.get(expression.text)
        : ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)
          && namespaces.has(expression.expression.text) ? expression.name.text : undefined
      if (name === 'deriveBundleTrust' || name === 'foldBundleTrust') calls.push({ name,
        arguments: node.arguments.length,
        prior: node.arguments[name === 'deriveBundleTrust' ? 1 : 2]?.getText(ast) })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return calls
}
