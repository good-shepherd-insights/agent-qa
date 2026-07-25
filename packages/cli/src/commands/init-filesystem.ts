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
  beforeAtomicReplacePublish?: (path: string) => void
  beforeRetainedModeOpen?: (path: string) => void
  afterRetainedModeOpen?: (path: string) => void
  afterRetainedModeConfirm?: (path: string) => void
  afterTemporaryModeApply?: (temporaryPath: string) => void
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

interface DurableTemporary {
  temporary: string
  confirmed?: { dev: number, ino: number }
}

function writeDurableTemporary(
  plan: InitPathPlan,
  hooks: InitFilesystemHooks = {},
): DurableTemporary {
  const path = resolve(plan.path)
  const temporary = resolve(
    dirname(path),
    `.${basename(path)}.agent-qa-init-${process.pid}-${randomUUID()}.tmp`,
  )
  let fd: number | undefined
  try {
    fd = openSync(temporary, 'wx', plan.mode ?? 0o666)
    let confirmed: { dev: number, ino: number } | undefined
    if (plan.mode !== undefined && MODE_ENFORCEMENT_SUPPORTED) {
      // The creation mode is masked by the process umask; harden the descriptor and
      // re-read the bits before any content reaches the inode, then record that
      // inode so publication can prove it linked the file it confirmed.
      const requested = plan.mode & PERMISSION_MASK
      fchmodSync(fd, requested)
      invokeHook(hooks.afterTemporaryModeApply, temporary)
      const opened = confirmDescriptorMode(fd, path, requested)
      confirmed = { dev: opened.dev, ino: opened.ino }
    }
    writeFileSync(fd, plan.content)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    return { temporary, confirmed }
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    unlinkIfPresent(temporary)
    throw error
  }
}

function confirmPublishedDestination(
  path: string,
  requested: number,
  identity: { dev: number, ino: number },
): void {
  const { O_RDONLY, O_NOFOLLOW = 0 } = fsConstants
  let fd: number | undefined
  try {
    fd = openSync(path, O_RDONLY | O_NOFOLLOW)
    const published = confirmDescriptorMode(fd, path, requested)
    if (!published.isFile()) {
      refuseModeEnforcement(path, 'on a non-regular destination')
    }
    if (
      published.dev !== identity.dev
      || published.ino !== identity.ino
      || published.nlink !== 1
    ) {
      refuseModeEnforcement(path, 'because the destination changed at publication')
    }
  } catch (error) {
    // D-22: the unlink STAYS. For a credential-bearing publication, leaving a file at a
    // mode that could not be confirmed is the worse failure, and on the replacement path
    // the rename has already consumed the original bytes before this runs. What changes
    // is only that the refusal now SAYS which disposition it took.
    unlinkIfPresent(path)
    throw withRefusalDisposition(error, REFUSAL_DISPOSITION_REMOVED)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

function publishExclusive(
  plan: InitPathPlan,
  hooks: InitFilesystemHooks,
): InitFileResult {
  const path = resolve(plan.path)
  const parent = dirname(path)
  const { temporary, confirmed } = writeDurableTemporary(plan, hooks)
  try {
    invokeHook(hooks.beforeExclusivePublish, path)
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
    if (confirmed !== undefined && plan.mode !== undefined) {
      confirmPublishedDestination(path, plan.mode & PERMISSION_MASK, confirmed)
    }
    afterPublication(() => bestEffortFsyncDirectory(parent))
    return { path, outcome: 'created' }
  } finally {
    unlinkIfPresent(temporary)
  }
}

function replaceRegularAtomic(
  plan: InitPathPlan,
  hooks: InitFilesystemHooks = {},
): InitFileResult {
  const path = resolve(plan.path)
  const parent = dirname(path)
  // The confirmed identity is consumed, not discarded: publication must prove it renamed
  // the inode whose mode was confirmed, exactly as the exclusive path does.
  const { temporary, confirmed } = writeDurableTemporary(plan, hooks)
  try {
    const classification = classifyInitPath(path, plan.root)
    if (classification !== 'regular') {
      throw new Error(`Refusing atomic replacement of missing init destination ${path}`)
    }
    invokeHook(hooks.beforeAtomicReplacePublish, path)
    renameSync(temporary, path)
    if (confirmed !== undefined && plan.mode !== undefined) {
      confirmPublishedDestination(path, plan.mode & PERMISSION_MASK, confirmed)
    }
    afterPublication(() => bestEffortFsyncDirectory(parent))
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

// The two dispositions a refusal can carry, appended after the existing reason so every
// reason string still reads verbatim at the head of the message. They are deliberately
// non-overlapping — neither is a substring of the other — so a caller holding only the
// thrown message can tell a removed destination from a retained one. Ratified as D-22.
// The token both disposition sentences open with, so the two sentences cannot drift apart in
// how they announce themselves to a reader. Nothing in this module DECIDES anything by
// looking for this token in a message: see `dispositionedRefusals` below for why.
const REFUSAL_DISPOSITION_LEAD = 'Disposition:'

const REFUSAL_DISPOSITION_REMOVED
  = `${REFUSAL_DISPOSITION_LEAD} the unconfirmed destination was not left in place — `
  + 'it was unlinked. '
  + 'If it was published by replacement, the bytes it held beforehand were already '
  + 'consumed by the rename and are not recoverable.'

// Phrased so it stays true even for the refusal that fires BECAUSE the destination
// vanished: this code did not remove or rewrite it, and the retention clause is
// conditioned on the destination still existing.
const REFUSAL_DISPOSITION_RETAINED
  = `${REFUSAL_DISPOSITION_LEAD} the destination was not removed or rewritten — if it `
  + 'still exists it '
  + 'retains its original contents at an unconfirmed mode.'

// Errors that must leave `writeScaffoldFileAtomic` exactly as they were thrown, because
// neither disposition is this module's to claim about them:
//
//   - a caller-supplied hook's own error. It is the consumer's, not a refusal of ours, and
//     grafting a factual claim about the destination onto it is a false statement.
//   - an error raised AFTER a publication has already succeeded (the directory fsync). The
//     destination was rewritten, so the retention sentence would be false, and it was not
//     unlinked, so the removal sentence would be false too.
//
// Keyed by identity in a module-private WeakSet: nothing about it is observable as API, and
// it cannot retain the errors it marks.
const passthroughRefusalErrors = new WeakSet<object>()

// The refusals to which this module has ALREADY appended a disposition sentence, recorded the
// same way and for the same reasons as the passthrough set above.
//
// Identity rather than text, because the text is partly the caller's. "Has a disposition
// already been appended?" is a question about what THIS module did, and every refusal message
// embeds the destination path verbatim — a public parameter. Deciding the question by testing
// the message for the disposition's lead token therefore let a caller-supplied path decide it:
// a destination under a directory named after the lead token suppressed the disposition
// entirely, one named after the removal sentence made a RETAINED refusal read as a destroyed
// destination, and either one could produce a second sentence. Membership in this set cannot
// be forged by any byte of any path.
const dispositionedRefusals = new WeakSet<object>()

// `WeakSet` keys on object identity, but `typeof` reports 'function' rather than 'object' for
// callable values — which are legal throw values. Marking and testing have to agree on which
// values are markable, or a thrown function would be marked and then never recognised.
function isMarkable(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function markPassthrough(error: unknown): unknown {
  if (isMarkable(error)) {
    passthroughRefusalErrors.add(error)
    return error
  }
  // A primitive cannot carry an identity mark, and leaving it unmarked is precisely what let a
  // consumer's own `throw 'oops'` acquire a factual claim about a destination this module never
  // acted on. Wrap it so identity marking always applies: the message is the thrown value's own
  // string form and the value itself stays reachable as the cause, so nothing is lost.
  const wrapper = new Error(String(error), { cause: error })
  passthroughRefusalErrors.add(wrapper)
  return wrapper
}

function isPassthrough(error: unknown): boolean {
  return isMarkable(error) && passthroughRefusalErrors.has(error)
}

// Every caller hook is invoked through here, at exactly the point it was invoked before —
// the hooks are marked, never hoisted, so their firing order is unchanged.
function invokeHook(
  hook: ((argument: string) => void) | undefined,
  argument: string,
): void {
  if (hook === undefined) return
  try {
    hook(argument)
  } catch (error) {
    throw markPassthrough(error)
  }
}

function afterPublication(operation: () => void): void {
  try {
    operation()
  } catch (error) {
    throw markPassthrough(error)
  }
}

function withRefusalDisposition(error: unknown, disposition: string): Error {
  // A non-`Error` throw value is converted rather than rethrown bare, so the removal path
  // can never deliver a destination-was-unlinked outcome carrying no disposition at all.
  const reason = error instanceof Error ? error.message : String(error)
  const refusal = new Error(`${reason} ${disposition}`, { cause: error })
  // Recorded at the moment the sentence is appended, so the fact travels with the error object
  // rather than having to be recovered from its text later.
  dispositionedRefusals.add(refusal)
  return refusal
}

function carriesDisposition(error: unknown): boolean {
  return isMarkable(error) && dispositionedRefusals.has(error)
}

// The floor under the whole refusal contract, not a replacement for the inner wraps: those
// are what keep each disposition specific to its path. Anything that reaches here escaped
// without one, and on every such path this module neither removed nor rewrote the
// destination — so retention is the correct default. A refusal added anywhere below
// inherits it, which is what makes the universal structural rather than sampled.
function withRefusalBackstop<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    if (isPassthrough(error)) throw error
    if (carriesDisposition(error)) throw error
    throw withRefusalDisposition(error, REFUSAL_DISPOSITION_RETAINED)
  }
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
 * permission bits are re-read from the descriptor rather than assumed applied and are
 * compared again on the settle observation, so the composite claim is a single one: the
 * path resolves to the inspected inode carrying the requested mode.
 *
 * Conditional on the platform: where `process.platform === 'win32'` this returns
 * immediately and none of the above happens — no chmod, no confirmation, no refusal.
 */
function enforceRetainedFileMode(
  path: string,
  inspection: InitPathInspection,
  mode: number,
  hooks: InitFilesystemHooks,
): void {
  if (!MODE_ENFORCEMENT_SUPPORTED) return

  // The retention disposition wraps the WHOLE body, not a single throw, so the
  // classification refusals raised before the descriptor is opened carry it too. This
  // function is the sole site that leaves the destination alone, which is why the
  // disposition is a property of the path rather than of any one reason (D-22).
  try {
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
    invokeHook(hooks.beforeRetainedModeOpen, path)

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

      invokeHook(hooks.afterRetainedModeOpen, path)

      confirmDescriptorMode(fd, path, requested)

      invokeHook(hooks.afterRetainedModeConfirm, path)

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
      // The settle observation already holds the permission bits; comparing them collapses
      // "the inode had mode M" and "the path resolves to that inode" into one observation.
      if ((settled.mode & PERMISSION_MASK) !== requested) {
        refuseModeEnforcement(
          path,
          `because the requested mode ${octalMode(requested)} did not settle `
          + `(observed ${octalMode(settled.mode)}); another process changed the destination's `
          + `permissions. Run \`chmod 600 ${path}\` and rerun agent-qa init.`,
        )
      }
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  } catch (error) {
    // A caller hook's own error is the consumer's; it is not restated as an init refusal
    // and acquires no factual claim about the destination.
    if (isPassthrough(error)) throw error
    throw withRefusalDisposition(error, REFUSAL_DISPOSITION_RETAINED)
  }
}

/**
 * Publishes one scaffold destination and returns one of three outcomes:
 *
 * - `created` — the destination was absent and was published by the exclusive path
 *   (`link` from a durable temporary).
 * - `updated` — the destination existed, `force` was set without `preserveOnForce`, and it
 *   was published by the atomic-replacement path (`rename` over the existing inode).
 * - `preserved` — the destination existed and was kept; when the plan declares a mode AND
 *   the host platform enforces POSIX permissions, its permission bits are enforced in place
 *   on the retained inode.
 *
 * **Mode enforcement is conditional on the platform.** Every mode claim here — on all three
 * outcomes — holds only where `process.platform !== 'win32'`. On win32 a declared mode is a
 * silent no-op: nothing is applied, nothing is confirmed, and no refusal is raised, so a
 * plan that declares owner-only bits publishes at whatever mode the host gives it. This is
 * the shipped behaviour, stated rather than changed.
 *
 * **A refused post-publication confirmation DESTROYS the destination.** On both the
 * `created` and `updated` paths, if the mode or identity of the published file cannot be
 * confirmed after publication, the destination is UNLINKED before the refusal is rethrown.
 * On the `updated` path this is not recoverable: the `rename` has already consumed the
 * bytes the destination held beforehand, and this function does not retain a copy of them.
 *
 * A refused RETENTION behaves oppositely: the destination is neither removed nor
 * rewritten, so it is left in place at an unconfirmed mode with its contents intact.
 *
 * The asymmetry is deliberate, not accidental. For a credential-bearing publication a file
 * left at a mode that could not be confirmed is the worse failure, and on the replacement
 * path "leave it alone" was never available — the rename runs before the confirmation. The
 * two outcomes are told apart from the thrown error alone: every refusal this function
 * raises appends exactly one disposition sentence stating whether the destination was
 * unlinked or left in place. That is a floor, held by an outermost backstop rather than by
 * each throw site, so a refusal added anywhere beneath this function inherits it.
 *
 * **The floor is held by identity, not by reading the message.** Whether a refusal already
 * carries a disposition is recorded by adding the error OBJECT to a module-private `WeakSet`
 * at the moment the sentence is appended; the backstop tests membership. It is not decided by
 * looking for the disposition's lead token in the message. That distinction is load-bearing:
 * every refusal message embeds the destination path verbatim and the destination path is a
 * caller-supplied parameter, so a message-reading predicate handed those bytes a decision
 * about what this code did. Under identity marking a destination path cannot suppress the
 * disposition, cannot invert which of the two is reported, and cannot produce a second one,
 * because no decision is taken from the message at all. What a caller-supplied path CAN still
 * do is put the lead token, or an entire disposition sentence, inside the reason — so a
 * message may contain either more than once. Only the sentence appended past the reason is
 * this function's claim; a reader recovering the claim programmatically should take it from
 * the suffix past the root `cause`'s message rather than by scanning the whole string.
 *
 * Exactly two classes of error escape WITHOUT a disposition, and neither is a refusal of
 * this function's:
 *
 * - an error thrown by a caller-supplied hook, which is rethrown carrying its own message
 *   rather than restated as an init refusal with a claim about the destination. This holds
 *   for EVERY throw value, not only object ones: a primitive cannot carry an identity mark,
 *   so it is wrapped in an `Error` whose message is the value's own string form and whose
 *   `cause` is the value itself, and the wrapper is what gets marked;
 * - an error raised after a publication has already SUCCEEDED (the parent-directory fsync),
 *   for which neither sentence is true — the destination was rewritten, so it was not
 *   retained, and it was not unlinked either.
 *
 * Two limits on the EVIDENCE for this floor, carried forward rather than dropped. The refusal
 * walk asserting it enumerates 15 of the 21 refusal sites reachable beneath this function, so
 * the floor is structural by construction but sampled by test. And the temporary-cleanup
 * `finally` in both publication paths remains a site where neither sentence is true: a throw
 * there after a publication has already succeeded is stamped retained by the backstop, which
 * is false on that one path. Neither is changed here.
 *
 * Ratified as decision D-22 (phase 383).
 */
export function writeScaffoldFileAtomic(
  plan: InitPathPlan,
  hooks: InitFilesystemHooks = {},
): InitFileResult {
  return withRefusalBackstop(() => {
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
      return replaceRegularAtomic(normalizedPlan, hooks)
    }

    ensureSafeParentDirectories(normalizedPlan.path, normalizedPlan.root)
    return publishExclusive(normalizedPlan, hooks)
  })
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
  // The counts balance at one and one even when a bad merge inverts the pair, and the
  // anchored search then reports no match. Splicing at the offset computed from -1 would
  // cut the file at an arbitrary byte with no relationship to any marker, duplicating the
  // user's own rules and mangling a line. Refuse instead: this is the ordering property the
  // count-based refusal above already advertises but does not check.
  if (endMarker === -1) {
    throw new Error(
      'Refusing malformed target .gitignore: the agent-qa init managed '
      + 'end marker precedes its start marker',
    )
  }
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
