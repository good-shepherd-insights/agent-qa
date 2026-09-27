import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, readFile, realpath, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  Document,
  isAlias,
  isMap,
  isNode,
  isPair,
  isScalar,
  isSeq,
  LineCounter,
  parseDocument,
  Scalar,
  visit,
  type Node,
} from 'yaml'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import {
  classifyConfigPath,
  CONFIG_MASK_PLACEHOLDER,
  CONFIG_NAMED_ARRAYS,
  CONFIG_REVISION_ABSENT,
  type ConfigChange,
  type MaskingClass,
  type ConfigPathSegment,
  type ConfigWriteIssue,
  type ConfigWriteRefusal,
} from '@vostride/agent-qa-schema'

export type ApplyChangesOutcome =
  | { kind: 'ok'; revision: string; baseRevision: string; priors?: ConfigPriors }
  | {
    kind: 'refused'
    error: Exclude<ConfigWriteRefusal, 'write_failed'>
    issues?: ConfigWriteIssue[]
    /** The field an `expect` found changed. */
    path?: ConfigPathSegment[]
  }

type FieldState = { present: false } | { present: true; value: unknown }

/**
 * What one change found and left at the field it touched (429-11 D-24). The nodes are the file's
 * own, so a restore brings back real secrets and comments rather than anything the page holds.
 */
export type ConfigPrior =
  | { kind: 'entry'; array: ConfigPathSegment[]; name: string; index: number; node: Node }
  | { kind: 'path'; path: ConfigPathSegment[]; before: Node | null | undefined; after: FieldState }

export type ConfigPriors = readonly ConfigPrior[]

export type RestorePriorsOutcome =
  | { kind: 'ok'; revision: string }
  | { kind: 'refused'; error: 'undo_conflict' | 'file_invalid' }

export type ConfigReadOutcome =
  | { kind: 'ok'; config: Record<string, unknown>; raw: string; revision: string }
  | { kind: 'absent' }
  | { kind: 'file_invalid'; message: string; revision: string }

/** One line of the masked config file. `path` is the segment path of the secret the line holds. */
export interface ConfigFileLine {
  n: number
  text: string
  class?: Exclude<MaskingClass, 'plain'>
  path?: ConfigPathSegment[]
}

export type MaskedConfigOutcome =
  | {
    kind: 'ok'
    config: Record<string, unknown>
    revision: string
    lines: ConfigFileLine[]
    fileIssues: ConfigWriteIssue[]
  }
  | { kind: 'file_invalid'; message: string; revision: string }

export type RevealOutcome = { kind: 'ok'; value: string } | { kind: 'not_found' }

export const MASK_WRITTEN_BACK = 'mask_written_back'

/** True when any string anywhere in the value is the mask placeholder the server hands the page. */
export function carriesMaskPlaceholder(value: unknown): boolean {
  if (typeof value === 'string') return value === CONFIG_MASK_PLACEHOLDER
  if (Array.isArray(value)) return value.some(carriesMaskPlaceholder)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some(carriesMaskPlaceholder)
  }
  return false
}

function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
}

export class ConfigFileInvalidError extends Error {
  constructor(message: string) {
    super(`The config file does not parse: ${message}`)
    this.name = 'ConfigFileInvalidError'
  }
}

/**
 * The config's values for a reader that only needs them (429-32, Pitfall 3): a missing file reads
 * as empty, and a file that does not parse is an error rather than the part of it yaml recovers.
 */
export async function readConfigValues(manager: ConfigManager): Promise<Record<string, unknown>> {
  const read = await manager.readWithRevision()
  if (read.kind === 'ok') return read.config
  if (read.kind === 'absent') return {}
  throw new ConfigFileInvalidError(read.message)
}

export class ConfigManager {
  constructor(private configPath: string) {}

  // 429-05 Pitfall 3: a half-edited file is named, never served as the partial config yaml recovers.
  async readWithRevision(): Promise<ConfigReadOutcome> {
    const read = await this.readParsed()
    if (read.kind !== 'ok') return read
    return { kind: 'ok', config: read.config, raw: read.raw, revision: read.revision }
  }

  // 429-06 D-08: every value the map classes secret is replaced whole, in the payload and in the
  // file view, and the view is tagged on the masked text because masking changes line counts.
  async readMasked(): Promise<MaskedConfigOutcome> {
    const read = await this.readParsed()
    if (read.kind === 'absent') {
      return { kind: 'ok', config: {}, revision: CONFIG_REVISION_ABSENT, lines: [], fileIssues: [] }
    }
    if (read.kind === 'file_invalid') return read
    const secretValues: string[] = []
    const masked = maskDocument(read.doc, secretValues)
    stripComments(masked)
    const config = (maskByMap(masked.toJSON(), []) as Record<string, unknown> | null) ?? {}
    const parsed = AgentQaConfigSchema.safeParse(normalizeForValidation(read.config))
    const fileIssues = parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({
        path: issue.path.map((key) => (typeof key === 'number' ? key : String(key))),
        message: redactSecrets(issue.message, secretValues),
      }))
    const lines = classifyLines(masked.toString())
    return { kind: 'ok', config, revision: read.revision, lines, fileIssues }
  }

  // 429-06 D-09: one in-file value, read from the config file alone.
  async revealAt(path: readonly ConfigPathSegment[]): Promise<RevealOutcome> {
    let raw: string
    try {
      raw = await readFile(this.configPath, 'utf-8')
    } catch (err: unknown) {
      if (isMissingFile(err)) return { kind: 'not_found' }
      throw err
    }
    const doc = parseDocument(raw)
    if (doc.errors.length > 0) return { kind: 'not_found' }
    const resolved = resolvePath(doc, path)
    if (resolved === undefined) return { kind: 'not_found' }
    let node = doc.getIn(resolved, true)
    if (isAlias(node)) node = node.resolve(doc)
    if (!isScalar(node) || node.value === null || node.value === undefined) {
      return { kind: 'not_found' }
    }
    return { kind: 'ok', value: String(node.value) }
  }

  private async readParsed(): Promise<
    | { kind: 'ok'; doc: Document; config: Record<string, unknown>; raw: string; revision: string }
    | { kind: 'absent' }
    | { kind: 'file_invalid'; message: string; revision: string }
  > {
    let bytes: Buffer
    try {
      bytes = await readFile(this.configPath)
    } catch (err: unknown) {
      if (isMissingFile(err)) return { kind: 'absent' }
      throw err
    }
    const revision = createHash('sha256').update(bytes).digest('hex')
    const raw = bytes.toString('utf-8')
    const doc = parseDocument(raw)
    if (doc.errors.length > 0) {
      return { kind: 'file_invalid', message: parseErrorSummary(doc), revision }
    }
    return {
      kind: 'ok',
      doc,
      config: (doc.toJSON() as Record<string, unknown> | null) ?? {},
      raw,
      revision,
    }
  }

  // 429-01 D-19/D-22: one transaction per request, serialised so overlapping autosaves never
  // read the same bytes and drop each other's field.
  async applyChanges(
    changes: readonly ConfigChange[],
    options: { capturePriors?: boolean } = {},
  ): Promise<ApplyChangesOutcome> {
    return this.serialized(() => this.applyChangesOnce(changes, options.capturePriors === true))
  }

  // 429-11 D-24: an Undo is one more transaction on the same mutex, newest change first. A field
  // that no longer holds what the change left there was written since, and is never overwritten.
  async restorePriors(priors: ConfigPriors): Promise<RestorePriorsOutcome> {
    return this.serialized(() => this.restorePriorsOnce(priors))
  }

  // The per-instance mutex: each transaction chains onto the tail, released however it settles.
  private writeChain: Promise<void> = Promise.resolve()

  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(work)
    this.writeChain = next.then(() => undefined, () => undefined)
    return next
  }

  private async restorePriorsOnce(priors: ConfigPriors): Promise<RestorePriorsOutcome> {
    let doc: Document
    try {
      doc = parseDocument(await readFile(this.configPath, 'utf-8'))
    } catch (err: unknown) {
      if (isMissingFile(err)) return { kind: 'refused', error: 'undo_conflict' }
      throw err
    }
    if (doc.errors.length > 0) return { kind: 'refused', error: 'file_invalid' }
    let next: string
    try {
      for (const prior of [...priors].reverse()) {
        if (!restorePrior(doc, prior)) return { kind: 'refused', error: 'undo_conflict' }
      }
      const parsed = AgentQaConfigSchema.safeParse(normalizeForValidation(doc.toJSON()))
      if (!parsed.success) return { kind: 'refused', error: 'undo_conflict' }
      next = doc.toString()
    } catch {
      // A restored node that no longer fits the file (an alias whose anchor is gone) is not restorable.
      return { kind: 'refused', error: 'undo_conflict' }
    }
    await this.writeAtomic(next)
    return { kind: 'ok', revision: revisionOf(next) }
  }

  private async applyChangesOnce(
    changes: readonly ConfigChange[],
    capturePriors: boolean,
  ): Promise<ApplyChangesOutcome> {
    if (changes.some((change) => change.op !== 'unset' && change.op !== 'move' && carriesMaskPlaceholder(change.value))) {
      return { kind: 'refused', error: MASK_WRITTEN_BACK }
    }
    let doc: Document
    // 429-37 CR-01: the revision of the bytes this write merges onto, so the page can tell when an
    // outside edit it never read was absorbed.
    let baseRevision: string
    try {
      const bytes = await readFile(this.configPath)
      baseRevision = createHash('sha256').update(bytes).digest('hex')
      doc = parseDocument(bytes.toString('utf-8'))
    } catch (err: unknown) {
      if (!isMissingFile(err)) throw err
      // Pitfall 2: a missing file starts empty and goes through setIn like any other, so a dotted
      // top-level key such as `use.timeout:` can never be written.
      baseRevision = CONFIG_REVISION_ABSENT
      doc = new Document()
    }
    // yaml recovers a partial tree from a broken file and refuses to stringify it: never rewrite one.
    if (doc.errors.length > 0) return { kind: 'refused', error: 'file_invalid' }
    // 429-42 CR-01: a write computed from the page's snapshot names what it read; every expect is
    // checked against the file as read, before anything applies. A secret is never compared.
    const expects = changes.filter((change) => change.op === 'expect')
    if (expects.some((change) => classifySegments(change.path) === 'secret')) {
      return { kind: 'refused', error: 'path_not_writable' }
    }
    for (const change of expects) {
      if (!isDeepStrictEqual(expectedFieldValue(doc, change.path), change.value ?? null)) {
        return { kind: 'refused', error: 'field_changed', path: [...change.path] }
      }
    }
    let writesBrowserHeadless = false
    const priors: ConfigPrior[] = []
    for (const change of changes) {
      if (change.op === 'expect') continue
      if (change.op === 'move') {
        const moved = moveField(doc, change.from, change.path, capturePriors)
        if (moved.kind === 'refused') return moved
        priors.push(...moved.priors)
        continue
      }
      const path = resolvePath(doc, change.path)
      if (path === undefined) return { kind: 'refused', error: 'path_not_found' }
      const entry = capturePriors ? namedEntryPrior(doc, change, path) : undefined
      const before = capturePriors && entry === undefined ? nodeAt(doc, path) : undefined
      let legacyPrior: ConfigPrior | undefined
      try {
        if (change.op === 'set') {
          doc.setIn(path, doc.createNode(change.value))
          writesBrowserHeadless ||= setsLeaf(path, change.value, BROWSER_HEADLESS_PATH)
        } else if (change.op === 'set-if-absent') {
          // Required-sibling completion is decided by the file at this point of the transaction.
          if (doc.hasIn(path)) continue
          if (samePath(path, BROWSER_HEADLESS_PATH) && doc.hasIn(LEGACY_HEADLESS_PATH)) {
            // The owner's root use.headless is the value completion keeps, under its new key.
            const legacy = nodeAt(doc, LEGACY_HEADLESS_PATH)
            doc.setIn(path, legacy === undefined || legacy === null ? null : legacy)
            if (capturePriors) {
              legacyPrior = { kind: 'path', path: [...LEGACY_HEADLESS_PATH], before: legacy, after: { present: false } }
            }
            doc.deleteIn(LEGACY_HEADLESS_PATH)
          } else {
            doc.setIn(path, doc.createNode(change.value))
          }
        } else if (change.op === 'unset') {
          unsetAndPrune(doc, path)
        } else if (!appendTo(doc, path, change.value)) {
          return { kind: 'refused', error: 'path_not_found' }
        }
      } catch {
        // yaml throws when a path walks through a scalar: the field the change names is not there.
        return { kind: 'refused', error: 'path_not_found' }
      }
      if (entry !== undefined) priors.push(entry)
      else if (capturePriors) {
        priors.push({ kind: 'path', path: [...change.path], before, after: fieldState(doc, path) })
      }
      if (legacyPrior !== undefined) priors.push(legacyPrior)
    }
    // The browser-scoped key replaces a root use.headless in the same write.
    if (writesBrowserHeadless && doc.hasIn(LEGACY_HEADLESS_PATH)) {
      const before = capturePriors ? nodeAt(doc, LEGACY_HEADLESS_PATH) : undefined
      doc.deleteIn(LEGACY_HEADLESS_PATH)
      if (capturePriors) {
        priors.push({ kind: 'path', path: [...LEGACY_HEADLESS_PATH], before, after: { present: false } })
      }
    }

    const parsed = AgentQaConfigSchema.safeParse(normalizeForValidation(doc.toJSON()))
    if (!parsed.success) {
      return {
        kind: 'refused',
        error: 'validation_failed',
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.map((key) => (typeof key === 'number' ? key : String(key))),
          message: issue.message,
        })),
      }
    }

    const next = doc.toString()
    await this.writeAtomic(next)
    return capturePriors
      ? { kind: 'ok', revision: revisionOf(next), baseRevision, priors }
      : { kind: 'ok', revision: revisionOf(next), baseRevision }
  }

  // 429-05 Pitfall 8 / Pattern 1 step 6: the temp file sits beside the real file, keeps its mode
  // (chmod, because writeFile's mode is filtered by the umask), and replaces it in one rename.
  private async writeAtomic(content: string): Promise<void> {
    const target = await this.writeTarget()
    const directory = dirname(target)
    const tempPath = join(directory, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`)
    const mode = await stat(target).then(
      (stats) => stats.mode & 0o777,
      (err: unknown) => {
        if (isMissingFile(err)) return undefined
        throw err
      },
    )
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(tempPath, content, mode === undefined ? undefined : { mode })
      if (mode !== undefined) await chmod(tempPath, mode)
      await rename(tempPath, target)
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  // A symlinked config keeps its link: the file it points at is the one replaced.
  private async writeTarget(): Promise<string> {
    const isLink = await lstat(this.configPath).then(
      (stats) => stats.isSymbolicLink(),
      (err: unknown) => {
        if (isMissingFile(err)) return false
        throw err
      },
    )
    return isLink ? await realpath(this.configPath) : this.configPath
  }
}

type ResolvedPath = (string | number)[]

const NAMED_ARRAY_PATHS: readonly (readonly string[])[] = CONFIG_NAMED_ARRAYS.map((named) => named.split('.'))
const BROWSER_HEADLESS_PATH = ['use', 'browser', 'headless']
const LEGACY_HEADLESS_PATH = ['use', 'headless']

function samePath(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i])
}

// A { name } segment is resolved to the index its entry has in the file now, and only inside the
// named arrays, so an outside reorder can never redirect a change to another entry.
function resolvePath(doc: Document, path: readonly ConfigPathSegment[]): ResolvedPath | undefined {
  const resolved: ResolvedPath = []
  for (const segment of path) {
    if (typeof segment !== 'object') {
      resolved.push(segment)
      continue
    }
    if (!NAMED_ARRAY_PATHS.some((named) => samePath(named, resolved))) return undefined
    const seq = doc.getIn(resolved, true)
    if (!isSeq(seq)) return undefined
    const index = seq.items.findIndex((item) => isMap(item) && item.get('name') === segment.name)
    if (index < 0) return undefined
    resolved.push(index)
  }
  return resolved
}

// Deleting a leaf leaves `parent: {}`, which a section schema can reject, so every ancestor map the
// delete empties goes too. A sequence entry is never pruned: that would shift its siblings.
function unsetAndPrune(doc: Document, path: ResolvedPath): void {
  if (!doc.hasIn(path)) return
  doc.deleteIn(path)
  for (let depth = path.length - 1; depth >= 1; depth--) {
    const ancestor = path.slice(0, depth)
    if (typeof ancestor[depth - 1] !== 'string') return
    const node = doc.getIn(ancestor, true)
    if (!isMap(node) || node.items.length > 0) return
    doc.deleteIn(ancestor)
  }
}

// 429-52 (deferred 429-24): a rename re-keys the file's own node, value and comments, so the value
// never travels. Both ends must share a masking class, or a secret could land on a field served in
// clear. The value lands before from is pruned, so an emptied parent goes only once it has moved.
function moveField(
  doc: Document,
  from: readonly ConfigPathSegment[],
  to: readonly ConfigPathSegment[],
  capturePriors: boolean,
): { kind: 'ok'; priors: ConfigPrior[] } | { kind: 'refused'; error: 'path_not_found' | 'path_not_writable' } {
  const fromPath = resolvePath(doc, from)
  const toPath = resolvePath(doc, to)
  if (fromPath === undefined || toPath === undefined) return { kind: 'refused', error: 'path_not_found' }
  if (classifySegments(from) !== classifySegments(to)) return { kind: 'refused', error: 'path_not_writable' }
  const node = nodeAt(doc, fromPath)
  if (node === undefined) return { kind: 'refused', error: 'path_not_found' }
  // A block whose ends share a class can still hold leaves that class differently at the new key.
  const leaves = leafPaths(isNode(node) ? node.toJS(doc) : node)
  if (leaves.some((leaf) => classifySegments([...from, ...leaf]) !== classifySegments([...to, ...leaf]))) {
    return { kind: 'refused', error: 'path_not_writable' }
  }
  if (samePath(fromPath, toPath)) return { kind: 'ok', priors: [] }
  // A field moved inside itself, or onto an ancestor, would be deleted with its old key.
  if (isPrefix(fromPath, toPath) || isPrefix(toPath, fromPath)) {
    return { kind: 'refused', error: 'path_not_writable' }
  }
  const before = capturePriors ? nodeAt(doc, toPath) : undefined
  try {
    doc.setIn(toPath, node)
  } catch {
    return { kind: 'refused', error: 'path_not_found' }
  }
  unsetAndPrune(doc, fromPath)
  if (!capturePriors) return { kind: 'ok', priors: [] }
  return {
    kind: 'ok',
    priors: [
      { kind: 'path', path: [...from], before: node === null ? null : node.clone() as Node, after: { present: false } },
      { kind: 'path', path: [...to], before, after: fieldState(doc, toPath) },
    ],
  }
}

// The path of every leaf below a value, relative to it; a scalar or an empty block is its own leaf.
function leafPaths(value: unknown): (string | number)[][] {
  const entries: [string | number, unknown][] = Array.isArray(value)
    ? value.map((item, i) => [i, item])
    : typeof value === 'object' && value !== null ? Object.entries(value) : []
  if (entries.length === 0) return [[]]
  return entries.flatMap(([key, item]) => leafPaths(item).map((leaf) => [key, ...leaf]))
}

function isPrefix(prefix: ResolvedPath, path: ResolvedPath): boolean {
  return prefix.length < path.length && samePath(prefix, path.slice(0, prefix.length))
}

// An unset of one named-array entry is recorded as the entry itself, so Undo re-inserts it by
// name at its index instead of comparing the whole list.
function namedEntryPrior(doc: Document, change: ConfigChange, path: ResolvedPath): ConfigPrior | undefined {
  const last = change.path[change.path.length - 1]
  if (change.op !== 'unset' || typeof last !== 'object') return undefined
  const index = path[path.length - 1]
  const node = doc.getIn(path, true)
  if (typeof index !== 'number' || !isNode(node)) return undefined
  return { kind: 'entry', array: change.path.slice(0, -1), name: last.name, index, node: node.clone() as Node }
}

// undefined: the field is absent. null: the key is there with no value.
function nodeAt(doc: Document, path: ResolvedPath): Node | null | undefined {
  if (!doc.hasIn(path)) return undefined
  const node = doc.getIn(path, true)
  if (isNode(node)) return node.clone() as Node
  return node === undefined || node === null ? null : doc.createNode(node)
}

function fieldState(doc: Document, path: ResolvedPath): FieldState {
  if (!doc.hasIn(path)) return { present: false }
  const node = doc.getIn(path, true)
  return { present: true, value: isNode(node) ? node.toJS(doc) : node ?? null }
}

// What an expect compares against: the field's value as the file holds it, null when absent. A
// selector naming no entry, or a path through a scalar, reads as absent.
function expectedFieldValue(doc: Document, path: readonly ConfigPathSegment[]): unknown {
  const resolved = resolvePath(doc, path)
  if (resolved === undefined) return null
  const state = fieldState(doc, resolved)
  return state.present ? state.value : null
}

function restorePrior(doc: Document, prior: ConfigPrior): boolean {
  if (prior.kind === 'entry') {
    const arrayPath = resolvePath(doc, prior.array)
    if (arrayPath === undefined) return false
    const seq = doc.getIn(arrayPath, true)
    if (seq === undefined || seq === null || (isScalar(seq) && seq.value === null)) {
      doc.setIn(arrayPath, doc.createNode([]))
      return restorePrior(doc, prior)
    }
    if (!isSeq(seq)) return false
    if (seq.items.some((item) => isMap(item) && item.get('name') === prior.name)) return false
    seq.items.splice(Math.min(prior.index, seq.items.length), 0, prior.node.clone())
    return true
  }
  const path = resolvePath(doc, prior.path)
  if (path === undefined) return false
  if (!isDeepStrictEqual(fieldState(doc, path), prior.after)) return false
  if (prior.before === undefined) unsetAndPrune(doc, path)
  else doc.setIn(path, prior.before === null ? null : prior.before.clone())
  return true
}

function appendTo(doc: Document, path: ResolvedPath, value: unknown): boolean {
  const existing = doc.getIn(path, true)
  if (existing === undefined || existing === null || (isScalar(existing) && existing.value === null)) {
    doc.setIn(path, doc.createNode([value]))
    return true
  }
  if (!isSeq(existing)) return false
  existing.add(doc.createNode(value))
  return true
}

function setsLeaf(path: ResolvedPath, value: unknown, leaf: readonly string[]): boolean {
  if (path.length > leaf.length || !samePath(path, leaf.slice(0, path.length))) return false
  let cursor = value
  for (const key of leaf.slice(path.length)) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return false
    cursor = (cursor as Record<string, unknown>)[key]
  }
  return cursor !== undefined
}

// The first line only: yaml's message goes on to quote the offending source line, which can be a
// secret the page must not be served.
function parseErrorSummary(doc: Document): string {
  const first = doc.errors[0]?.message ?? 'The config file is not valid YAML.'
  return first.split('\n')[0]!.replace(/:\s*$/, '')
}

type VisitPath = readonly unknown[]

// The segment path of a node inside a pair value or a sequence item; undefined for a mapping key.
// With `named`, an entry of a named array that carries a unique name is addressed by `{ name }`.
function nodeSegments(
  key: unknown,
  node: unknown,
  path: VisitPath,
  named = false,
): ConfigPathSegment[] | undefined {
  if (key === 'key') return undefined
  const segments: ConfigPathSegment[] = []
  const plain: (string | number)[] = []
  for (let i = 0; i < path.length; i++) {
    const ancestor = path[i]
    const child = i + 1 < path.length ? path[i + 1] : node
    if (isPair(ancestor)) {
      if (child === ancestor.key) return undefined
      const segment = isScalar(ancestor.key) ? String(ancestor.key.value) : String(ancestor.key)
      segments.push(segment)
      plain.push(segment)
    } else if (isSeq(ancestor)) {
      const index = ancestor.items.indexOf(child as never)
      const inNamedArray = named && NAMED_ARRAY_PATHS.some((arrayPath) => samePath(arrayPath, plain))
      const name = inNamedArray ? uniqueName(ancestor.items, child) : undefined
      segments.push(name === undefined ? index : { name })
      plain.push(index)
    }
  }
  return segments
}

function uniqueName(items: readonly unknown[], child: unknown): string | undefined {
  if (!isMap(child)) return undefined
  const name = child.get('name')
  if (typeof name !== 'string') return undefined
  const matches = items.filter((item) => isMap(item) && item.get('name') === name)
  return matches.length === 1 ? name : undefined
}

function classifySegments(segments: readonly ConfigPathSegment[]): MaskingClass {
  return classifyConfigPath(segments.map((segment) => (typeof segment === 'object' ? 0 : segment)))
}

function maskDocument(doc: Document, secretValues: string[]): Document {
  const masked = doc.clone()
  visit(masked, {
    Scalar(key, node, path) {
      const segments = nodeSegments(key, node, path)
      if (segments === undefined || node.value === null || node.value === undefined) return
      if (classifySegments(segments) !== 'secret' || node.value === CONFIG_MASK_PLACEHOLDER) return
      secretValues.push(String(node.value))
      node.value = CONFIG_MASK_PLACEHOLDER
      node.type = undefined
    },
    // An alias at a secret path would carry the anchored value into the payload in clear.
    Alias(key, node, path) {
      const segments = nodeSegments(key, node, path)
      if (segments !== undefined && classifySegments(segments) === 'secret') {
        return new Scalar(CONFIG_MASK_PLACEHOLDER)
      }
      return undefined
    },
  })
  return masked
}

// 429-41 (CR-02): every comment goes, because secrecy is never decided from text (D-08).
function stripComments(doc: Document): void {
  doc.commentBefore = null
  doc.comment = null
  visit(doc, {
    Node(_key, node) {
      node.commentBefore = undefined
      node.comment = undefined
    },
  })
}

function maskByMap(value: unknown, segments: (string | number)[]): unknown {
  if (Array.isArray(value)) return value.map((item, i) => maskByMap(item, [...segments, i]))
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        maskByMap(item, [...segments, key]),
      ]),
    )
  }
  if (value === null || value === undefined) return value
  return classifyConfigPath(segments) === 'secret' ? CONFIG_MASK_PLACEHOLDER : value
}

function classifyLines(text: string): ConfigFileLine[] {
  const lineCounter = new LineCounter()
  const doc = parseDocument(text, { lineCounter })
  const tags = new Map<number, Pick<ConfigFileLine, 'class' | 'path'>>()
  visit(doc, {
    Scalar(key, node, path) {
      if (node.range === undefined || node.range === null || node.value === null) return
      const segments = nodeSegments(key, node, path, true)
      if (segments === undefined) return
      const maskingClass = classifySegments(segments)
      if (maskingClass === 'plain') return
      const { line } = lineCounter.linePos(node.range[0])
      const existing = tags.get(line)
      if (existing?.class === 'secret') return
      if (maskingClass === 'secret') tags.set(line, { class: 'secret', path: segments })
      else if (existing === undefined) tags.set(line, { class: 'env-var-name' })
    },
  })
  const texts = text.split('\n')
  if (texts.length > 0 && texts[texts.length - 1] === '') texts.pop()
  return texts.map((lineText, i) => ({ n: i + 1, text: lineText, ...tags.get(i + 1) }))
}

// A validation message may quote the value it rejects; a secret one never reaches the page.
function redactSecrets(message: string, secretValues: readonly string[]): string {
  return secretValues.some((value) => value.length >= 4 && message.includes(value))
    ? 'This value is not valid.'
    : message
}

function revisionOf(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

// Mirrors cli/src/config.ts normalizeConfigForValidation: a root use.headless is read by the CLI
// and dropped before validation, so it must not fail a dashboard write either.
function normalizeForValidation(config: unknown): unknown {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return config
  const normalized = { ...(config as Record<string, unknown>) }
  const use = normalized.use
  if (typeof use === 'object' && use !== null && !Array.isArray(use)) {
    const rest = { ...(use as Record<string, unknown>) }
    delete rest.headless
    normalized.use = rest
  }
  return normalized
}
