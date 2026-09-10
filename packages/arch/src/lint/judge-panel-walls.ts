import ts from 'typescript'
import { calibrationImports, type CalibrationSource } from './label-calibration-walls.js'

export interface JudgePanelDiagnostic { file: string; rule: string; line: number }

/** Lexical symbols matter: a local with the right spelling is not a profile or receipt. */
function analysis(source: CalibrationSource) {
  const ast = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true)
  const host = ts.createCompilerHost({ noLib: true, noResolve: true })
  host.getSourceFile = file => file === source.file ? ast : undefined
  const checker = ts.createProgram([source.file], { noLib: true, noResolve: true }, host).getTypeChecker()
  const declarations = (node: ts.Node) => checker.getSymbolAtLocation(node)?.declarations ?? []
  const unwrap = (node: ts.Node): ts.Node => ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node)
    ? unwrap(node.expression) : node
  const walk = (node: ts.Node, visit: (node: ts.Node) => void) => {
    visit(node)
    ts.forEachChild(node, child => walk(child, visit))
  }
  const key = (node: ts.Node): string | undefined => {
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
    if (ts.isComputedPropertyName(node)) {
      const value = valueOf(node.expression)
      if (value && ts.isStringLiteral(value)) return value.text
    }
    return undefined
  }
  function valueOf(node: ts.Node, seen = new Set<ts.Node>()): ts.Node | undefined {
    node = unwrap(node)
    if (seen.has(node)) return undefined
    seen.add(node)
    if (ts.isIdentifier(node)) {
      const declaration = declarations(node)[0]
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer)
        return valueOf(declaration.initializer, seen)
    }
    return node
  }
  function fields(node: ts.Node | undefined, name: string, seen = new Set<ts.Node>()): ts.Node[] {
    if (!node || seen.has(node)) return []
    seen.add(node)
    const value = valueOf(node)
    if (!value) return []
    if (ts.isConditionalExpression(value)) return [...fields(value.whenTrue, name, new Set(seen)), ...fields(value.whenFalse, name, new Set(seen))]
    if (!ts.isObjectLiteralExpression(value)) return []
    // An explicit assignment after a spread wins; unknown spreads remain visible as unknown DATA.
    let result: ts.Node[] = []
    for (const prop of value.properties) {
      if (ts.isSpreadAssignment(prop)) {
        const spread = fields(prop.expression, name, new Set(seen))
        if (spread.length) result = spread
      } else if (key(prop.name) === name) {
        result = ts.isPropertyAssignment(prop) ? [prop.initializer]
          : ts.isShorthandPropertyAssignment(prop) ? [prop.name] : [prop]
      }
    }
    return result
  }
  function origin(node: ts.Node | undefined, seen = new Set<ts.Node>(), bindings = new Map<ts.Node, string[]>()): string[] {
    if (!node) return ['?']
    node = unwrap(node)
    if (seen.has(node)) return ['?']
    seen.add(node)
    const next = (value: ts.Node | undefined) => origin(value, new Set(seen), bindings)
    if (ts.isIdentifier(node)) {
      // Shorthand properties have a property symbol; resolve their value symbol instead.
      const symbol = ts.isShorthandPropertyAssignment(node.parent)
        ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node)
      const declaration = symbol?.declarations?.[0]
      if (!declaration) return [node.text === 'undefined' ? 'undefined' : '?']
      if (bindings.has(declaration)) return bindings.get(declaration)!
      if (ts.isImportSpecifier(declaration)) return [`import:${(declaration.propertyName ?? declaration.name).text}`]
      if (ts.isNamespaceImport(declaration)) return ['namespace']
      if (ts.isFunctionDeclaration(declaration)) return [`function:${declaration.name?.text}`]
      if (ts.isParameter(declaration)) return [`parameter:${declaration.type?.getText(ast) ?? '?'}`]
      if (ts.isBindingElement(declaration)) {
        const container = declaration.parent.parent
        if (ts.isVariableDeclaration(container)) {
          const name = key(declaration.propertyName ?? declaration.name)
          return next(container.initializer).map(path => `${path}.${name}`)
        }
      }
      if (ts.isVariableDeclaration(declaration)) {
        if (declaration.initializer) return next(declaration.initializer)
        const loop = declaration.parent.parent
        if (ts.isForOfStatement(loop)) return next(loop.expression).map(path => path + '[]')
      }
      return ['?']
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = ts.isPropertyAccessExpression(node) ? node.name.text
        : node.argumentExpression && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : '[]'
      const values = fields(node.expression, name)
      if (values.length) return values.flatMap(next)
      return next(node.expression).map(path => path === 'namespace' ? `import:${name}` : `${path}.${name}`)
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.length ? node.elements.flatMap(next) : ['undefined']
    if (ts.isConditionalExpression(node)) return [...next(node.whenTrue), ...next(node.whenFalse)]
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind))
      return [...next(node.left), ...next(node.right)]
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return ['namespace']
      if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map') {
        const callback = node.arguments[0]
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          const bound = new Map(bindings)
          if (callback.parameters[0]) bound.set(callback.parameters[0], next(node.expression.expression)
            .filter(path => path !== 'undefined').map(path => path + '[]'))
          return origin(callback.body, new Set(seen), bound)
        }
      }
      const names = next(node.expression)
      if (names.includes('import:loadJudgeCalibrationEvidence') || names.includes('function:loadJudgeCalibrationEvidence'))
        return next(node.arguments[0]).map(path => `${path}.admittedEvidence`)
      // Imported local evidence readers have import symbols too. Function bodies are evaluated,
      // not trusted by the name recordedReceiptModelId (a forged helper return must fail).
      const declaration = ts.isIdentifier(node.expression) ? declarations(node.expression)[0] : undefined
      if (declaration && ts.isFunctionDeclaration(declaration) && declaration.body) {
        const bound = new Map(bindings)
        declaration.parameters.forEach((param, index) => bound.set(param, next(node.arguments[index])))
        const returned: string[] = []
        walk(declaration.body, child => {
          if (ts.isReturnStatement(child)) returned.push(...origin(child.expression, new Set(seen), bound))
        })
        return returned.length ? returned : ['?']
      }
      return ['?']
    }
    return ['?']
  }
  const callName = (node: ts.CallExpression) => {
    const names = origin(node.expression)
    return names.map(name => name.replace(/^(?:import|function):/, '').replace(/^namespace\./, ''))
  }
  return { ast, walk, key, valueOf, fields, origin, callName }
}

const local = 'packages/eval-local/src/'
const executionNames = new Set(['judgePairwise', 'callJudge', 'adjudicatePanelComparison', 'adjudicateTie',
  'dispatchTie', 'adjudicateNoConsensus', 'adjudicateCassetteScore', 'runCassetteReplay'])

export function judgePanelWalls(sources: readonly CalibrationSource[]): JudgePanelDiagnostic[] {
  const hits: JudgePanelDiagnostic[] = []
  for (const source of sources) {
    if (!/^(?:packages\/(?:eval(?:-local)?|core|knowledge(?:-local)?|agent(?:-local)?|schema)\/src\/)/.test(source.file)) continue
    // Parse all imports cheaply; lexical analysis is needed only in source with a guarded surface.
    const edges = calibrationImports(source)
    const addEdge = (rule: string, line: number) => hits.push({ file: source.file, rule, line })
    for (const edge of edges) {
      if (/^packages\/(?:knowledge(?:-local)?|agent(?:-local)?|schema)\//.test(source.file)
        && /^@vostride\/agent-qa-eval(?:-local)?(?:$|\/)/.test(edge.specifier)
        && edge.specifier !== '@vostride/agent-qa-eval-local/reader') addEdge('learner-eval-writer', edge.line)
      if (/^packages\/eval(?:-local)?\//.test(source.file)
        && /(?:agent-qa-knowledge|\/knowledge(?:-local)?\/)/.test(edge.specifier)) addEdge('eval-knowledge-edge', edge.line)
      if (source.file === local + 'reader.ts' && /calibration|judge-binding|eval-local$/.test(edge.specifier)) addEdge('private-reader', edge.line)
    }
    if (!/assessPanelEligibility|createModel|bindJudgePanel|judgePairwise|adjudicate|plannerFamily|judgeFamily/.test(source.text)) continue
    const a = analysis(source)
    const add = (rule: string, node: ts.Node) => addEdge(rule, a.ast.getLineAndCharacterOfPosition(node.getStart(a.ast)).line + 1)
    const calls: ts.CallExpression[] = []
    a.walk(a.ast, node => {
      if (ts.isCallExpression(node)) calls.push(node)
      if (source.file.startsWith('packages/core/src/schema/') &&
        (ts.isPropertyAssignment(node) || ts.isPropertySignature(node)) &&
        ['plannerFamily', 'judgeFamily'].includes(a.key(node.name) ?? '')) add('caller-family', node)
    })
    const eligibility = calls.filter(call => a.callName(call).includes('assessPanelEligibility'))
    if (source.file.startsWith(local)) for (const call of eligibility) {
      const replay = a.fields(call.arguments[0], 'replayedModelId').flatMap(value => a.origin(value))
      const allowedReplay = new Set(['parameter:RunCassetteReplayInput.profile.model',
        'parameter:RunReplayGateInput.identity.plannerModelId', 'parameter:RunJudgePanelCalibrationInput.replayProfile.model'])
      if (!replay.length || replay.some(path => !allowedReplay.has(path))) add('replay-provenance', call)
      const members = a.fields(call.arguments[0], 'memberModelIds').flatMap(value => a.origin(value))
      const memberPath = /^(?:parameter:RunCassetteReplayInput\.judge\.members|parameter:RunReplayGateInput\.(?:judgeMembers|judge)|parameter:RunJudgePanelCalibrationInput\.members)\[\]\.profile\.model$/
      if (!members.length || members.some(path => !memberPath.test(path))) add('member-provenance', call)
      const recorded = a.fields(call.arguments[0], 'recordedModelId').flatMap(value => a.origin(value))
      const receipt = /^(?:parameter:RunCassetteReplayInput\.cassette(?:\.steps\[\]\.record)?|parameter:LeafCassette|parameter:RunJudgePanelCalibrationInput\.admittedEvidence\.evidence\[\]\.recordedReceipt)\.receipt\.model\.(?:declared\.modelId|resolvedModelId)$/
      // Tiny provenance-only fixtures can omit recorded input. Real compositions carry their
      // receipt surface, and deleting the argument there must not silently certify replay-only IDs.
      const requiresRecorded = ['replay-composition.ts', 'replay-gate-composition.ts', 'judge-calibration-composition.ts']
        .some(file => source.file === local + file)
      if ((requiresRecorded && !recorded.length) || recorded.some(path => path !== 'undefined' && !receipt.test(path))) add('recorded-provenance', call)
    }
    if (['replay-composition.ts', 'replay-gate-composition.ts', 'judge-calibration-composition.ts']
      .some(file => source.file === local + file) && /export (?:async )?function (?:runCassetteReplay|runReplayGate|runJudgePanelCalibration)\b/.test(source.text)
      && eligibility.length !== 1) add('eligibility-site', a.ast)
    const factories = calls.filter(call => a.callName(call).includes('createModel'))
    if (source.file.startsWith(local)) {
      for (const call of factories) {
        let parent: ts.Node | undefined = call.parent
        while (parent && !ts.isFunctionDeclaration(parent)) parent = parent.parent
        const owner = parent && ts.isFunctionDeclaration(parent) ? parent.name?.text : undefined
        if (!((source.file === local + 'judge-binding.ts' && owner === 'bindJudgePort') ||
          (source.file === local + 'replay-composition.ts' && owner === 'runCassetteReplay')) || factories.length !== 1) add('judge-factory', call)
      }
      if (source.file === local + 'judge-binding.ts') {
        const fn = a.ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'bindJudgePanel')
        let maps = 0
        if (fn) a.walk(fn, node => {
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map'
            && a.origin(node.expression.expression).includes('parameter:readonly JudgeBindingInput[]')
            && node.arguments[0] && a.origin(node.arguments[0]).includes('function:bindJudgePort')) maps++
        })
        if (!fn || maps !== 1) add('panel-binding', fn ?? a.ast)
        if (factories.length === 0) add('judge-factory', a.ast)
      }
    }
    const hasExecution = (node: ts.Node, seen = new Set<ts.Node>()): boolean => {
      if (seen.has(node)) return false
      seen.add(node)
      let found = false
      a.walk(node, child => {
        if (ts.isCallExpression(child) && (a.callName(child).some(name => executionNames.has(name))
          || (ts.isIdentifier(child.expression) && executionNames.has(child.expression.text)))) found = true
        if (ts.isIdentifier(child)) {
          const value = a.valueOf(child)
          if (value && value !== child && hasExecution(value, seen)) found = true
        }
      })
      return found
    }
    // Reject scheduling of judge work, not Promise use for unrelated filesystem/host work.
    for (const call of calls) {
      if (!ts.isPropertyAccessExpression(call.expression)) continue
      const method = call.expression.name.text
      if (['all', 'allSettled', 'race', 'any', 'map', 'flatMap', 'forEach'].includes(method)
        && call.arguments.some(argument => hasExecution(argument))) add('judge-concurrency', call)
    }
  }
  return hits
}
