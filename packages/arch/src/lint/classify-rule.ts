import { PACKAGE_CLASS_RULES } from '../contract-types.js'
import { classifySpecifier } from './extract-specifiers.js'
import type { OwnershipContract, PackageClass } from '../contract-types.js'
import type { ClassifiedSpecifier, SpecifierHit } from './extract-specifiers.js'

export type RuleMatcher = (hit: SpecifierHit) => boolean

interface CompiledRuleMatcher {
  className: PackageClass
  entry: string
  matcher: RuleMatcher
}

export function compileForbiddenEntry(entry: string): RuleMatcher | null {
  if (entry.includes(' ')) {
    return null
  }

  if (entry === 'node:*') {
    return hit => classifySpecifier(hit.specifier).kind === 'node'
  }

  if (entry.endsWith('/*')) {
    const prefix = entry.slice(0, -1)
    return hit => hit.specifier.startsWith(prefix)
  }

  return hit => {
    const parsed = classifySpecifier(hit.specifier)
    const bareEntry = entry.replace(/^node:/, '')

    if (hit.specifier === entry) {
      return true
    }

    if (parsed.kind === 'node' && parsed.bare === bareEntry) {
      return true
    }

    return hasPackageName(parsed) && parsed.pkgName === entry
  }
}

export function findClassRuleOffenders(
  contract: OwnershipContract,
  hits: readonly SpecifierHit[],
): string[] {
  if (contract.packageClasses.includes('transitional')) {
    return []
  }

  const allowedTokens = allowedTokensFor(contract.packageClasses)
  const matchers = compileClassMatchers(contract.packageClasses)
  const offenders: string[] = []

  for (const hit of hits) {
    if (isAllowed(hit, allowedTokens)) {
      continue
    }

    for (const className of contract.packageClasses) {
      const classMatches = matchers.filter(
        compiled => compiled.className === className && compiled.matcher(hit),
      )
      const selectedMatch = selectMatchForHit(hit, classMatches)
      if (selectedMatch) {
        offenders.push(
          `${contract.packageDir} | ${hit.file}:${hit.line} | ${hit.specifier} | ${className} forbids ${selectedMatch.entry}`,
        )
      }
    }
  }

  return offenders
}

function compileClassMatchers(packageClasses: readonly PackageClass[]): CompiledRuleMatcher[] {
  const matchers: CompiledRuleMatcher[] = []

  for (const className of packageClasses) {
    for (const entry of PACKAGE_CLASS_RULES[className].forbidden) {
      const matcher = compileForbiddenEntry(entry)
      if (matcher) {
        matchers.push({ className, entry, matcher })
      }
    }
  }

  return matchers
}

function allowedTokensFor(packageClasses: readonly PackageClass[]): Set<string> {
  const allowed = new Set<string>()

  for (const className of packageClasses) {
    for (const entry of PACKAGE_CLASS_RULES[className].allowed) {
      if (!entry.includes(' ')) {
        allowed.add(entry)
      }
    }
  }

  return allowed
}

function isAllowed(hit: SpecifierHit, allowedTokens: ReadonlySet<string>): boolean {
  if (allowedTokens.has(hit.specifier)) {
    return true
  }

  const parsed = classifySpecifier(hit.specifier)
  if (parsed.kind === 'node' && allowedTokens.has(parsed.bare)) {
    return true
  }

  return hasPackageName(parsed) && allowedTokens.has(parsed.pkgName)
}

function selectMatchForHit(
  hit: SpecifierHit,
  matches: readonly CompiledRuleMatcher[],
): CompiledRuleMatcher | undefined {
  if (matches.length === 0) {
    return undefined
  }

  const exactSpecifierMatch = matches.find(match => match.entry === hit.specifier)
  if (exactSpecifierMatch) {
    return exactSpecifierMatch
  }

  const parsed = classifySpecifier(hit.specifier)
  if (parsed.kind === 'node') {
    return (
      matches.find(match => match.entry === parsed.bare) ??
      matches.find(match => match.entry === `node:${parsed.bare}`) ??
      matches[0]
    )
  }

  if (hasPackageName(parsed)) {
    return matches.find(match => match.entry === parsed.pkgName) ?? matches[0]
  }

  return matches[0]
}

function hasPackageName(
  parsed: ClassifiedSpecifier,
): parsed is Extract<ClassifiedSpecifier, { kind: 'internal' | 'external' }> {
  return parsed.kind === 'internal' || parsed.kind === 'external'
}
