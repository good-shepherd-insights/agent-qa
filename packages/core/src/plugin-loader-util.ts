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

export type PluginDeclarationKind = 'auth' | 'provider'

/**
 * A plugin the project's own config DECLARES and the project does not have (395-21 · F-05).
 *
 * THE MEASUREMENT THAT PRODUCED THIS TYPE. `agent-qa init --platform web` — the default,
 * non-interactive road — writes `plugins.auth: [{ package: "@vostride/agent-qa-subscription-auth" }]`
 * and a `package.json` naming that package, then tells the person to fetch it. Until they do, every
 * verb that resolves the config with plugin loading enabled dies on a bare `require.resolve`:
 *
 *     Framework error: Cannot find module '@vostride/agent-qa-subscription-auth'
 *     Require stack:
 *     - /path/to/agent-qa.config.yaml
 *
 * That is Node's loader talking about its own internals — a "Require stack" naming a YAML file as
 * if it were a module — to a person whose actual next step is one install command that init itself
 * had already printed. The failure is real and must stay a failure; what changes is that it names
 * the package and the remedy instead of an import stack.
 *
 * ONE PRODUCER, BOTH MEMBERS. `loadLLMAuthPlugins` and `loadProviderPlugins` carried the identical
 * bare resolve-and-import, and this project's recurring failure mode is a guard placed on the member
 * a verifier happened to find while its sibling stays open (388/390/392/395-18). Both go through
 * `importDeclaredPluginModule` below.
 */
export class PluginNotInstalledError extends Error {
  readonly pluginKind: PluginDeclarationKind
  readonly pluginPackage: string | null
  readonly pluginPath: string | null

  constructor(declaration: PluginDeclarationLike, kind: PluginDeclarationKind) {
    const label = kind === 'auth' ? 'Auth' : 'Provider'
    const packageName = packageDeclarationValue(declaration)
    const pluginPath = pathDeclarationValue(declaration)
    // NO `cause`, EVER (395-16 · D-395-16-A). The wrapped error carries a require stack of absolute
    // paths, and an `Error` with a `cause` is serialized by `util.inspect` on the roads this project
    // has already been burned by. The remedy is composed from the DECLARATION, which is the
    // person's own one-line config entry, and from nothing the loader saw.
    super(
      packageName
        ? `${label} plugin package "${packageName}" is declared in agent-qa.config.yaml but is not `
          + `installed. Install it with your package manager (for example: npm install `
          + `${packageName}), or remove the plugins.${kind} entry that declares it.`
        : `${label} plugin file "${pluginPath}" is declared in agent-qa.config.yaml but could not be `
          + `loaded. Check that the path is correct and the file exists, or remove the `
          + `plugins.${kind} entry that declares it.`,
    )
    this.name = 'PluginNotInstalledError'
    this.pluginKind = kind
    this.pluginPackage = packageName === '' ? null : packageName
    this.pluginPath = pluginPath === '' ? null : pluginPath
  }
}

function isModuleResolutionFailure(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code
  return code === 'MODULE_NOT_FOUND' || code === 'ERR_MODULE_NOT_FOUND'
}

/**
 * Resolve and import one declared plugin, answering the person when the module is not there.
 *
 * ONLY module-resolution failures are translated. A plugin that IS installed and throws from its own
 * body rethrows untouched — disguising a plugin's own crash as "not installed" would send the person
 * to install something they already have.
 */
export async function importDeclaredPluginModule<T>(
  declaration: PluginDeclarationLike,
  baseDir: string,
  kind: PluginDeclarationKind,
): Promise<T> {
  let specifier: string
  try {
    specifier = resolveModuleSpecifier(declaration, baseDir)
  } catch (err) {
    if (isModuleResolutionFailure(err)) throw new PluginNotInstalledError(declaration, kind)
    throw err
  }

  try {
    return await import(specifier) as T
  } catch (err) {
    if (isModuleResolutionFailure(err)) throw new PluginNotInstalledError(declaration, kind)
    throw err
  }
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
