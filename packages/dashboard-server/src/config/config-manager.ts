import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isMap, isScalar, isSeq, parseDocument, stringify, type Document } from 'yaml'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import {
  CONFIG_NAMED_ARRAYS,
  type ConfigChange,
  type ConfigPathSegment,
  type ConfigWriteIssue,
} from '@vostride/agent-qa-schema'

export type ApplyChangesOutcome =
  | { kind: 'ok'; revision: string }
  | {
    kind: 'refused'
    error: 'invalid_write_input' | 'path_not_found' | 'validation_failed'
    issues?: ConfigWriteIssue[]
  }

const SENSITIVE_KEYS = new Set(['apikey', 'token', 'key', 'accesskey'])

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase())
}

function maskValue(value: string): string {
  if (value.length >= 8) {
    return value.slice(0, 3) + '****...' + value.slice(-4)
  }
  return '****'
}

function deepMask(obj: unknown, parentKey = ''): unknown {
  if (typeof obj === 'string' && isSensitiveKey(parentKey)) {
    return maskValue(obj)
  }
  if (Array.isArray(obj)) {
    return obj.map((item, i) => deepMask(item, String(i)))
  }
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = deepMask(value, key)
    }
    return result
  }
  return obj
}

export class ConfigManager {
  constructor(private configPath: string) {}

  async read(): Promise<Record<string, unknown>> {
    try {
      const content = await readFile(this.configPath, 'utf-8')
      const doc = parseDocument(content)
      return (doc.toJSON() as Record<string, unknown>) ?? {}
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw err
    }
  }

  async readMasked(): Promise<Record<string, unknown>> {
    const config = await this.read()
    return deepMask(config) as Record<string, unknown>
  }

  private sectionPath(section: string): string[] {
    return section.includes('.') ? section.split('.') : [section]
  }

  async updateSection(section: string, value: Record<string, unknown>): Promise<void> {
    const path = this.sectionPath(section)
    let content: string
    try {
      content = await readFile(this.configPath, 'utf-8')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await mkdir(dirname(this.configPath), { recursive: true })
        await writeFile(this.configPath, stringify({ [section]: value }))
        return
      }
      throw err
    }

    const doc = parseDocument(content)
    for (const [key, val] of Object.entries(value)) {
      doc.setIn([...path, key], val)
    }
    await writeFile(this.configPath, doc.toString())
  }

  async replaceSection(section: string, value: Record<string, unknown>): Promise<void> {
    const path = this.sectionPath(section)
    let content: string
    try {
      content = await readFile(this.configPath, 'utf-8')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await mkdir(dirname(this.configPath), { recursive: true })
        await writeFile(this.configPath, stringify({ [section]: value }))
        return
      }
      throw err
    }
    const doc = parseDocument(content)
    // Overwrite in-place to preserve key ordering in the YAML file
    doc.setIn(path, doc.createNode(value))
    await writeFile(this.configPath, doc.toString())
  }

  async replaceSectionRaw(section: string, value: unknown): Promise<void> {
    const path = this.sectionPath(section)
    let content: string
    try {
      content = await readFile(this.configPath, 'utf-8')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await mkdir(dirname(this.configPath), { recursive: true })
        await writeFile(this.configPath, stringify({ [section]: value }))
        return
      }
      throw err
    }
    const doc = parseDocument(content)
    // Overwrite in-place to preserve key ordering in the YAML file
    doc.setIn(path, doc.createNode(value))
    await writeFile(this.configPath, doc.toString())
  }

  async deleteSectionRaw(section: string): Promise<void> {
    const path = this.sectionPath(section)
    let content: string
    try {
      content = await readFile(this.configPath, 'utf-8')
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await mkdir(dirname(this.configPath), { recursive: true })
        await writeFile(this.configPath, stringify({}))
        return
      }
      throw err
    }
    const doc = parseDocument(content)
    doc.deleteIn(path)
    await writeFile(this.configPath, doc.toString())
  }

  async readDocument(): Promise<Document> {
    const content = await readFile(this.configPath, 'utf-8')
    return parseDocument(content)
  }

  // 429-01 D-19/D-22: one transaction per request, serialised so overlapping autosaves never
  // read the same bytes and drop each other's field.
  async applyChanges(changes: readonly ConfigChange[]): Promise<ApplyChangesOutcome> {
    const next = this.writeChain.then(() => this.applyChangesOnce(changes))
    this.writeChain = next.then(() => undefined, () => undefined)
    return next
  }

  private writeChain: Promise<void> = Promise.resolve()

  private async applyChangesOnce(changes: readonly ConfigChange[]): Promise<ApplyChangesOutcome> {
    const content = await readFile(this.configPath, 'utf-8')
    const doc = parseDocument(content)
    let writesBrowserHeadless = false
    for (const change of changes) {
      const path = resolvePath(doc, change.path)
      if (path === undefined) return { kind: 'refused', error: 'path_not_found' }
      try {
        if (change.op === 'set') {
          doc.setIn(path, doc.createNode(change.value))
          writesBrowserHeadless ||= setsLeaf(path, change.value, BROWSER_HEADLESS_PATH)
        } else if (change.op === 'unset') {
          unsetAndPrune(doc, path)
        } else if (!appendTo(doc, path, change.value)) {
          return { kind: 'refused', error: 'path_not_found' }
        }
      } catch {
        // yaml throws when a path walks through a scalar: the field the change names is not there.
        return { kind: 'refused', error: 'path_not_found' }
      }
    }
    // Carried from the legacy settings route: the browser-scoped key replaces a root use.headless.
    if (writesBrowserHeadless && doc.hasIn(LEGACY_HEADLESS_PATH)) doc.deleteIn(LEGACY_HEADLESS_PATH)

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
    return { kind: 'ok', revision: revisionOf(next) }
  }

  private async writeAtomic(content: string): Promise<void> {
    const directory = dirname(this.configPath)
    const tempPath = join(directory, `.${basename(this.configPath)}.${process.pid}.${randomUUID()}.tmp`)
    const { mode } = await stat(this.configPath)
    try {
      await writeFile(tempPath, content, { mode: mode & 0o777 })
      await rename(tempPath, this.configPath)
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined)
      throw error
    }
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
