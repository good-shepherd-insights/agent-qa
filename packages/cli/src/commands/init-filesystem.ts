import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs'
import { basename, dirname, relative, resolve, sep } from 'node:path'

export type InitFileOutcome = 'created' | 'updated' | 'preserved'

export interface InitPathPlan {
  root?: string
  path: string
  content: string | Uint8Array
  force?: boolean
  preserveOnForce?: boolean
  mode?: number
}

export interface InitFileResult {
  path: string
  outcome: InitFileOutcome
}

export interface InitPreflightResult {
  path: string
  classification: 'missing' | 'regular'
}

export interface InitFilesystemHooks {
  beforeExclusivePublish?: (path: string) => void
  beforeRetainedModeOpen?: (path: string) => void
  afterRetainedModeOpen?: (path: string) => void
}

const PERMISSION_MASK = 0o7777
const MODE_ENFORCEMENT_SUPPORTED = process.platform !== 'win32'

export interface GitignoreProbe {
  path: string
  expected: 'ignored' | 'visible'
  requiredRule?: string
}

export const TARGET_GITIGNORE_PROBES = [
  { path: '.agent-qa/cache/cache.json', expected: 'ignored', requiredRule: '.agent-qa/' },
  {
    path: '.agent-qa/auth-states/default.json',
    expected: 'ignored',
    requiredRule: '.agent-qa/auth-states/',
  },
  { path: 'node_modules/example/index.js', expected: 'ignored', requiredRule: 'node_modules/' },
  {
    path: 'agent-qa.local.yaml',
    expected: 'ignored',
    requiredRule: 'agent-qa.local.yaml',
  },
  { path: '.env', expected: 'ignored', requiredRule: '.env' },
  { path: '.env.secrets.local', expected: 'ignored', requiredRule: '.env.secrets.local' },
  { path: 'agent-qa.config.yaml', expected: 'visible' },
  { path: 'tests/example-pass.yaml', expected: 'visible' },
] as const satisfies readonly GitignoreProbe[]

export const KNOWLEDGE_GITIGNORE_PROBES = [
  {
    path: 'memory/index/knowledge.sqlite',
    expected: 'ignored',
    requiredRule: 'memory/index/',
  },
  {
    path: 'memory/queue/candidate.json',
    expected: 'ignored',
    requiredRule: 'memory/queue/',
  },
  { path: '.lease', expected: 'ignored', requiredRule: '.lease' },
  { path: '.epoch', expected: 'ignored', requiredRule: '.epoch' },
  {
    path: 'memory/example/bundles/fact-example/artifacts/screenshot.png',
    expected: 'ignored',
    requiredRule: '**/artifacts/',
  },
  {
    path: 'skills/.staging/draft.md',
    expected: 'ignored',
    requiredRule: 'skills/.staging/',
  },
  { path: 'memory/example/bundles/fact-example/record.md', expected: 'visible' },
  { path: 'memory/example/bundles/fact-example/manifest.json', expected: 'visible' },
  {
    path: 'memory/example/bundles/fact-example/evidence/outcomes.jsonl',
    expected: 'visible',
  },
  { path: 'policies/global.md', expected: 'visible' },
] as const satisfies readonly GitignoreProbe[]

const TARGET_GITIGNORE_ENTRIES = [
  '.agent-qa/',
  '.agent-qa/auth-states/',
  'node_modules/',
  'agent-qa.local.yaml',
  '.env',
  '.env.secrets.local',
] as const

const MANAGED_GITIGNORE_START = '# agent-qa init:start'
const MANAGED_GITIGNORE_END = '# agent-qa init:end'

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code
}

function lstatIfPresent(path: string): Stats | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined
    throw error
  }
}

function pathKind(stat: Stats): string {
  if (stat.isSymbolicLink()) return 'symbolic link'
  if (stat.isDirectory()) return 'directory'
  if (stat.isFIFO()) return 'FIFO'
  if (stat.isSocket()) return 'socket'
  if (stat.isBlockDevice()) return 'block device'
  if (stat.isCharacterDevice()) return 'character device'
  return 'non-regular file'
}

function resolvePlanRoot(file: string, root?: string): string {
  const absoluteFile = resolve(file)
  const absoluteRoot = resolve(root ?? dirname(absoluteFile))
  const relativeFile = relative(absoluteRoot, absoluteFile)
  if (
    relativeFile === '..'
    || relativeFile.startsWith(`..${sep}`)
    || relativeFile === ''
  ) {
    throw new Error(`Init destination ${absoluteFile} must be a file inside ${absoluteRoot}`)
  }
  return absoluteRoot
}

function assertDirectoryComponent(file: string, component: string, root: boolean): void {
  const stat = lstatIfPresent(component)
  if (stat === undefined) return
  if (stat.isSymbolicLink()) {
    throw new Error(
      root
        ? `Refusing init destination ${file}: scaffold root ${component} is a symbolic link`
        : `Refusing init destination ${file}: symbolic link parent ${component}`,
    )
  }
  if (!stat.isDirectory()) {
    throw new Error(
      `Refusing init destination ${file}: ${pathKind(stat)} parent ${component}`,
    )
  }
}

function assertSafeParentComponents(file: string, planRoot?: string): void {
  const absoluteFile = resolve(file)
  const root = resolvePlanRoot(absoluteFile, planRoot)
  assertDirectoryComponent(absoluteFile, root, true)
  const relativeParent = relative(root, dirname(absoluteFile))
  const segments = relativeParent.split(sep).filter(Boolean)
  let current = root

  for (const segment of segments) {
    current = resolve(current, segment)
    assertDirectoryComponent(absoluteFile, current, false)
  }
}

function ensureDirectoryComponent(file: string, component: string, root: boolean): void {
  let stat = lstatIfPresent(component)
  if (stat === undefined) {
    try {
      if (root) mkdirSync(component, { recursive: true })
      else mkdirSync(component)
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error
    }
    stat = lstatIfPresent(component)
  }
  if (stat?.isSymbolicLink()) {
    throw new Error(
      root
        ? `Refusing init destination ${file}: scaffold root ${component} is a symbolic link`
        : `Refusing init destination ${file}: symbolic link parent ${component}`,
    )
  }
  if (stat === undefined || !stat.isDirectory()) {
    throw new Error(
      `Refusing init destination ${file}: non-directory parent ${component}`,
    )
  }
}

function ensureSafeParentDirectories(file: string, planRoot?: string): void {
  const absoluteFile = resolve(file)
  const root = resolvePlanRoot(absoluteFile, planRoot)
  ensureDirectoryComponent(absoluteFile, root, true)
  const relativeParent = relative(root, dirname(absoluteFile))
  const segments = relativeParent.split(sep).filter(Boolean)
  let current = root

  for (const segment of segments) {
    current = resolve(current, segment)
    ensureDirectoryComponent(absoluteFile, current, false)
  }
}

interface InitPathInspection {
  classification: 'missing' | 'regular'
  dev?: number
  ino?: number
  nlink?: number
  permissions?: number
}

function inspectInitPath(path: string, root?: string): InitPathInspection {
  const absolutePath = resolve(path)
  assertSafeParentComponents(absolutePath, root)
  const stat = lstatIfPresent(absolutePath)
  if (stat === undefined) return { classification: 'missing' }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(
      `Refusing init destination ${absolutePath}: existing path is a ${pathKind(stat)}`,
    )
  }
  return {
    classification: 'regular',
    dev: stat.dev,
    ino: stat.ino,
    nlink: stat.nlink,
    permissions: stat.mode & PERMISSION_MASK,
  }
}

export function classifyInitPath(
  path: string,
  root?: string,
): 'missing' | 'regular' {
  return inspectInitPath(path, root).classification
}

export function preflightInitPlan(
  plans: readonly InitPathPlan[],
): InitPreflightResult[] {
  const normalizedPlans = plans.map(plan => ({ ...plan, path: resolve(plan.path) }))
  const seen = new Set<string>()
  for (const plan of normalizedPlans) {
    if (seen.has(plan.path)) {
      throw new Error(`Init plan contains duplicate destination ${plan.path}`)
    }
    seen.add(plan.path)
  }

  const orderedPaths = [...seen].sort()
  for (let index = 0; index < orderedPaths.length - 1; index += 1) {
    const path = orderedPaths[index]!
    const nextPath = orderedPaths[index + 1]!
    if (nextPath.startsWith(`${path}${sep}`)) {
      throw new Error(`Init plan destination ${path} is a parent of ${nextPath}`)
    }
  }

  return normalizedPlans.map(plan => ({
    path: plan.path,
    classification: classifyInitPath(plan.path, plan.root),
  }))
}

function bestEffortFsyncDirectory(path: string): void {
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    fsyncSync(fd)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (
      code !== 'ENOENT'
      && code !== 'EINVAL'
      && code !== 'EISDIR'
      && code !== 'EPERM'
      && code !== 'ENOTSUP'
      && code !== 'EBADF'
    ) {
      throw error
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path)
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error
  }
}

function writeDurableTemporary(plan: InitPathPlan): string {
  const path = resolve(plan.path)
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.agent-qa-init-${process.pid}-${randomUUID()}.tmp`,
  )
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx', plan.mode ?? 0o666)
    if (plan.mode !== undefined && MODE_ENFORCEMENT_SUPPORTED) {
      // The creation mode is masked by the process umask; harden the descriptor
      // before any content reaches the inode that exclusive publication links.
      fchmodSync(fd, plan.mode & PERMISSION_MASK)
    }
    writeFileSync(fd, plan.content)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    return temporary
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    unlinkIfPresent(temporary)
    throw error
  }
}

function publishExclusive(
  plan: InitPathPlan,
  hooks: InitFilesystemHooks,
): InitFileResult {
  const path = resolve(plan.path)
  const parent = dirname(path)
  const temporary = writeDurableTemporary(plan)
  try {
    hooks.beforeExclusivePublish?.(path)
    try {
      linkSync(temporary, path)
    } catch (error) {
      if (isErrno(error, 'EEXIST')) {
        throw new Error(
          `Refusing init destination ${path}: path appeared during exclusive create`,
        )
      }
      throw error
    }
    unlinkSync(temporary)
    bestEffortFsyncDirectory(parent)
    return { path, outcome: 'created' }
  } finally {
    unlinkIfPresent(temporary)
  }
}

function replaceRegularAtomic(plan: InitPathPlan): InitFileResult {
  const path = resolve(plan.path)
  const parent = dirname(path)
  const temporary = writeDurableTemporary(plan)
  try {
    const classification = classifyInitPath(path, plan.root)
    if (classification !== 'regular') {
      throw new Error(`Refusing atomic replacement of missing init destination ${path}`)
    }
    renameSync(temporary, path)
    bestEffortFsyncDirectory(parent)
    return { path, outcome: 'updated' }
  } finally {
    unlinkIfPresent(temporary)
  }
}

function refuseModeEnforcement(path: string, reason: string): never {
  throw new Error(
    `Refusing init destination ${path}: cannot enforce owner-only permissions ${reason}`,
  )
}

function octalMode(mode: number): string {
  return (mode & PERMISSION_MASK).toString(8).padStart(4, '0')
}

function confirmDescriptorMode(fd: number, path: string, requested: number): Stats {
  const observed = fstatSync(fd)
  if ((observed.mode & PERMISSION_MASK) !== requested) {
    refuseModeEnforcement(
      path,
      `because the requested mode ${octalMode(requested)} was not applied `
      + `(observed ${octalMode(observed.mode)}); the destination filesystem may not `
      + 'persist POSIX permissions. Remount the destination with permission support '
      + 'or place the project on a filesystem that can store POSIX permissions.',
    )
  }
  return observed
}

/**
 * Applies an explicitly requested mode to a retained file through a descriptor
 * bound to the inode that classification inspected. Credential bytes are never
 * read, rewritten, or logged, and any identity, link-count, type, or permission
 * change between inspection, open, chmod, and the post-check fails closed — the
 * permission bits are re-read from the descriptor rather than assumed applied.
 */
function enforceRetainedFileMode(
  path: string,
  inspection: InitPathInspection,
  mode: number,
  hooks: InitFilesystemHooks,
): void {
  if (!MODE_ENFORCEMENT_SUPPORTED) return

  if (
    inspection.classification !== 'regular'
    || inspection.dev === undefined
    || inspection.ino === undefined
  ) {
    refuseModeEnforcement(path, 'on a non-regular destination')
  }
  if (inspection.nlink !== 1) {
    refuseModeEnforcement(path, 'on a file with multiple hard links')
  }

  const requested = mode & PERMISSION_MASK
  hooks.beforeRetainedModeOpen?.(path)

  const { O_RDONLY, O_NOFOLLOW = 0 } = fsConstants
  let fd: number | undefined
  try {
    try {
      fd = openSync(path, O_RDONLY | O_NOFOLLOW)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        refuseModeEnforcement(path, 'because the destination disappeared')
      }
      if (code === 'ELOOP' || code === 'EMLINK') {
        refuseModeEnforcement(path, 'on a symbolic-link destination')
      }
      if (code === 'EACCES' || code === 'EPERM') {
        throw new Error(
          `Refusing init destination ${path}: cannot enforce owner-only permissions `
          + `(permission denied). Run \`chmod 600 ${path}\` and rerun agent-qa init.`,
        )
      }
      throw error
    }

    const opened = fstatSync(fd)
    if (!opened.isFile()) refuseModeEnforcement(path, 'on a non-regular destination')
    if (opened.dev !== inspection.dev || opened.ino !== inspection.ino) {
      refuseModeEnforcement(path, 'because the destination changed')
    }
    if (opened.nlink !== 1) {
      refuseModeEnforcement(path, 'on a file with multiple hard links')
    }

    if ((opened.mode & PERMISSION_MASK) !== requested) fchmodSync(fd, requested)

    hooks.afterRetainedModeOpen?.(path)

    confirmDescriptorMode(fd, path, requested)

    const settled = lstatIfPresent(path)
    if (settled === undefined) {
      refuseModeEnforcement(path, 'because the destination disappeared')
    }
    if (settled.isSymbolicLink() || !settled.isFile()) {
      refuseModeEnforcement(path, 'on a non-regular destination')
    }
    if (
      settled.dev !== inspection.dev
      || settled.ino !== inspection.ino
      || settled.nlink !== 1
    ) {
      refuseModeEnforcement(path, 'because the destination changed')
    }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

export function writeScaffoldFileAtomic(
  plan: InitPathPlan,
  hooks: InitFilesystemHooks = {},
): InitFileResult {
  const normalizedPlan = { ...plan, path: resolve(plan.path) }
  const inspection = inspectInitPath(normalizedPlan.path, normalizedPlan.root)

  if (inspection.classification === 'regular') {
    if (!normalizedPlan.force || normalizedPlan.preserveOnForce) {
      if (normalizedPlan.mode !== undefined) {
        enforceRetainedFileMode(
          normalizedPlan.path,
          inspection,
          normalizedPlan.mode,
          hooks,
        )
      }
      return { path: normalizedPlan.path, outcome: 'preserved' }
    }
    ensureSafeParentDirectories(normalizedPlan.path, normalizedPlan.root)
    return replaceRegularAtomic(normalizedPlan)
  }

  ensureSafeParentDirectories(normalizedPlan.path, normalizedPlan.root)
  return publishExclusive(normalizedPlan, hooks)
}

export function writeConfigMarkerLast(
  plan: InitPathPlan,
  hooks: InitFilesystemHooks = {},
): InitFileResult {
  if (basename(plan.path) !== 'agent-qa.config.yaml') {
    throw new Error('Init completion marker must be agent-qa.config.yaml')
  }
  return writeScaffoldFileAtomic(plan, hooks)
}

function managedGitignoreBlock(entries: readonly string[]): string {
  return [
    MANAGED_GITIGNORE_START,
    '# Runtime, credential, dependency, and local-only paths managed by agent-qa init.',
    ...entries,
    MANAGED_GITIGNORE_END,
    '',
  ].join('\n')
}

function stripManagedGitignoreBlock(content: string): string {
  const startCount = content.split(MANAGED_GITIGNORE_START).length - 1
  const endCount = content.split(MANAGED_GITIGNORE_END).length - 1
  if (startCount !== endCount || startCount > 1) {
    throw new Error(
      'Refusing malformed target .gitignore: expected at most one complete '
      + 'agent-qa init managed block',
    )
  }
  if (startCount === 0) return content

  const start = content.indexOf(MANAGED_GITIGNORE_START)
  const endMarker = content.indexOf(MANAGED_GITIGNORE_END, start)
  let end = endMarker + MANAGED_GITIGNORE_END.length
  if (content.slice(end, end + 2) === '\r\n') end += 2
  else if (content[end] === '\n') end += 1
  return content.slice(0, start) + content.slice(end)
}

function appendManagedBlockAtEof(content: string, block: string): string {
  if (content.length === 0) return block
  const separator = content.endsWith('\n\n')
    ? ''
    : content.endsWith('\n')
      ? '\n'
      : '\n\n'
  return `${content}${separator}${block}`
}

export function upsertManagedGitignoreBlock(
  path: string,
  entries: readonly string[] = TARGET_GITIGNORE_ENTRIES,
): InitFileResult {
  const absolutePath = resolve(path)
  const root = dirname(absolutePath)
  const classification = classifyInitPath(absolutePath, root)
  const existing = classification === 'regular' ? readFileSync(absolutePath, 'utf8') : ''
  const candidate = appendManagedBlockAtEof(
    stripManagedGitignoreBlock(existing),
    managedGitignoreBlock(entries),
  )
  if (candidate === existing) return { path: absolutePath, outcome: 'preserved' }
  return writeScaffoldFileAtomic({
    path: absolutePath,
    root,
    content: candidate,
    force: classification === 'regular',
  })
}

function checkIgnoreStatus(cwd: string, path: string): number {
  const result = spawnSync(
    'git',
    ['check-ignore', '--no-index', '--quiet', '--', path],
    { cwd, encoding: 'utf8', stdio: 'pipe' },
  )
  if (result.error) throw result.error
  if (result.status === 0 || result.status === 1) return result.status
  throw new Error(
    `Unable to verify .gitignore semantics for "${path}" `
    + `(git check-ignore exited ${result.status ?? 'without status'})`,
  )
}

export function verifyEffectiveGitignore(options: {
  cwd: string
  label: string
  probes: readonly GitignoreProbe[]
}): { checked: boolean } {
  const cwd = resolve(options.cwd)
  const repositoryProbe = spawnSync(
    'git',
    ['rev-parse', '--is-inside-work-tree'],
    { cwd, encoding: 'utf8', stdio: 'pipe' },
  )
  if (repositoryProbe.error && isErrno(repositoryProbe.error, 'ENOENT')) {
    return { checked: false }
  }
  if (repositoryProbe.status !== 0 || repositoryProbe.stdout.trim() !== 'true') {
    return { checked: false }
  }

  for (const probe of options.probes) {
    const status = checkIgnoreStatus(cwd, probe.path)
    const ignored = status === 0
    if (probe.expected === 'ignored' && !ignored) {
      throw new Error(
        `${options.label} is unsafe: "${probe.path}" must be ignored. `
        + `Move "${probe.requiredRule}" after any negation, then rerun agent-qa init; `
        + 'no files were changed.',
      )
    }
    if (probe.expected === 'visible' && ignored) {
      throw new Error(
        `${options.label} is unsafe: "${probe.path}" must remain commit-visible. `
        + 'Remove the rule that ignores it, then rerun agent-qa init; no files were changed.',
      )
    }
  }

  return { checked: true }
}
