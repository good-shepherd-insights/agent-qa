import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type PluginDeclarationLike = {
  package?: string
  path?: string
}

export function findPackageJson(packageName: string, baseDir: string): string | null {
  let current = resolve(baseDir)
  while (true) {
    const candidate = resolve(current, 'node_modules', ...packageName.split('/'), 'package.json')
    if (existsSync(candidate)) return candidate

    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function exportTargetFromPackageJson(pkg: Record<string, unknown>): string | null {
  const exportsField = pkg.exports
  if (typeof exportsField === 'string') return exportsField
  if (exportsField && typeof exportsField === 'object') {
    const rootExport = (exportsField as Record<string, unknown>)['.'] ?? exportsField
    if (typeof rootExport === 'string') return rootExport
    if (rootExport && typeof rootExport === 'object') {
      const conditions = rootExport as Record<string, unknown>
      if (typeof conditions.import === 'string') return conditions.import
      if (typeof conditions.default === 'string') return conditions.default
      if (typeof conditions.require === 'string') return conditions.require
    }
  }
  if (typeof pkg.module === 'string') return pkg.module
  if (typeof pkg.main === 'string') return pkg.main
  return null
}

export function resolvePackageImportFromBase(packageName: string, baseDir: string): string | null {
  const packageJsonPath = findPackageJson(packageName, baseDir)
  if (!packageJsonPath) return null

  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as Record<string, unknown>
  const target = exportTargetFromPackageJson(pkg)
  if (!target || !target.startsWith('.')) return null
  return pathToFileURL(resolve(dirname(packageJsonPath), target)).href
}

export function packageDeclarationValue(declaration: PluginDeclarationLike): string {
  return typeof declaration.package === 'string' ? declaration.package.trim() : ''
}

export function pathDeclarationValue(declaration: PluginDeclarationLike): string {
  return typeof declaration.path === 'string' ? declaration.path.trim() : ''
}

export function declarationKey(declaration: PluginDeclarationLike, baseDir: string): string {
  const packageName = packageDeclarationValue(declaration)
  if (packageName) return `package:${packageName}`
  return `path:${resolve(baseDir, pathDeclarationValue(declaration))}`
}

export function resolveModuleSpecifier(declaration: PluginDeclarationLike, baseDir: string): string {
  const packageName = packageDeclarationValue(declaration)
  if (packageName) {
    const packageImport = resolvePackageImportFromBase(packageName, baseDir)
    if (packageImport) return packageImport

    const parentUrl = pathToFileURL(resolve(baseDir, 'agent-qa.config.yaml')).href
    try {
      const resolveImport = import.meta.resolve as (specifier: string, parent?: string) => string
      return resolveImport(packageName, parentUrl)
    } catch {
      const require = createRequire(resolve(baseDir, 'agent-qa.config.yaml'))
      return pathToFileURL(require.resolve(packageName)).href
    }
  }

  const pluginPath = pathDeclarationValue(declaration)
  const absolutePath = isAbsolute(pluginPath)
    ? pluginPath
    : resolve(baseDir, pluginPath)
  return pathToFileURL(absolutePath).href
}
