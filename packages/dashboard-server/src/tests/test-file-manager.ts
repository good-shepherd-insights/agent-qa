import { readFile, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, basename } from 'node:path'
import { generateTestId } from '@vostride/agent-qa-ids'
import { parse as parseYaml } from 'yaml'
import {
  discoverWorkspaceFiles,
  resolveWorkspaceFileTarget,
  type ResolvedWorkspacePaths,
} from '@vostride/agent-qa-core'
import { createPathLock, replaceFileAtomic } from './replace-file-atomic.js'

export interface TestFileInfo {
  path: string
  name: string
  testId: string | null
  targetName: string | null
  platform: string | null
  modified: string
}

export type SupportedPlatform = 'web' | 'android' | 'ios'

export interface TestFileMetadata {
  name: string | null
  testId: string | null
  targetName: string | null
  platform: SupportedPlatform | null
  parallel: boolean | null
}

export interface TestValidationError {
  message: string
  line?: number
  column?: number
  suggestion?: string
}

export interface TestValidationResult {
  valid: boolean
  errors: TestValidationError[]
}

function normalizeQuotedString(value: string): string {
  return value.trim().replace(/^["'](.*)["']$/, '$1')
}

function normalizePlatform(value: unknown): SupportedPlatform | null {
  if (value !== 'web' && value !== 'android' && value !== 'ios') return null
  return value
}

// 2026-10-18 (444-36, D-67): a key's value is read from its own line, and a blank one is no value.
function valueOnLine(match: RegExpMatchArray | null): string | null {
  if (match === null) return null
  const value = normalizeQuotedString(match[1])
  return value.trim() === '' ? null : value
}

// 2026-10-18 (444-36, D-67): a blank id key is filled in place; otherwise the id line goes after a
// leading --- marker, so the file stays one YAML document, or on the first line.
export function withIdLine(content: string, key: 'test-id' | 'suite-id', id: string): string {
  const line = `${key}: ${id}`
  const blankKey = new RegExp(`^${key}:[ \\t]*(?:(["'])[ \\t]*\\1)?[ \\t]*$`, 'm')
  if (blankKey.test(content)) return content.replace(blankKey, () => line)
  const marker = content.match(/^---[ \t]*(?:#[^\r\n]*)?(?:\r?\n|$)/)
  if (marker === null) return `${line}\n${content}`
  const head = marker[0].endsWith('\n') ? marker[0] : `${marker[0]}\n`
  return `${head}${line}\n${content.slice(marker[0].length)}`
}

export function extractTestFileMetadata(content: string): TestFileMetadata {
  let parsed: Record<string, unknown> | null = null

  try {
    const yamlValue = parseYaml(content)
    if (yamlValue && typeof yamlValue === 'object' && !Array.isArray(yamlValue)) {
      parsed = yamlValue as Record<string, unknown>
    }
  } catch {
    // fall back to regex extraction for partially-authored files
  }

  const config = parsed?.config
  const parsedConfig = config && typeof config === 'object' && !Array.isArray(config)
    ? config as Record<string, unknown>
    : null
  const use = parsed?.use
  const parsedUse = use && typeof use === 'object' && !Array.isArray(use)
    ? use as Record<string, unknown>
    : null

  const nameMatch = content.match(/^name:[ \t]*(\S.*)$/m)
  const targetMatch = content.match(/^[ \t]*target:[ \t]*(\S.*)$/m)
  const testIdMatch = content.match(/^test-id:[ \t]*(\S.*)$/m)
  const platformMatch = content.match(/^[ \t]*platform:[ \t]*(web|android|ios)[ \t]*$/m)
  const parallelMatch = content.match(/^[ \t]*parallel:[ \t]*(true|false)[ \t]*$/m)

  const name = typeof parsed?.name === 'string' && parsed.name.trim().length > 0
    ? parsed.name.trim()
    : valueOnLine(nameMatch)

  const targetName = typeof parsed?.target === 'string' && parsed.target.trim().length > 0
    ? parsed.target.trim()
    : valueOnLine(targetMatch)

  const testId = typeof parsed?.['test-id'] === 'string' && parsed['test-id'].trim().length > 0
    ? parsed['test-id'].trim()
    : valueOnLine(testIdMatch)

  const platform = normalizePlatform(parsed?.platform)
    ?? normalizePlatform(parsedConfig?.platform)
    ?? normalizePlatform(platformMatch?.[1])

  const parallel = typeof parsedUse?.parallel === 'boolean'
    ? parsedUse.parallel
    : typeof parsed?.parallel === 'boolean'
      ? parsed.parallel
      : typeof parsedConfig?.parallel === 'boolean'
        ? parsedConfig.parallel
        : parallelMatch
          ? parallelMatch[1] === 'true'
          : null

  return {
    name,
    testId,
    targetName,
    platform,
    parallel,
  }
}

export class TestFileManager {
  constructor(private readonly workspace: ResolvedWorkspacePaths) {}

  // 2026-10-18 (444-33, D-65; 444-35, D-66): each list call reads the workspace itself; each file is written whole and one writer at a time.
  private readonly underLock = createPathLock()

  async list(): Promise<TestFileInfo[]> {
    const records = await discoverWorkspaceFiles({ workspace: this.workspace, kind: 'test' })
    const files: TestFileInfo[] = []

    for (const record of records) {
      try {
        const s = await stat(record.absolutePath)
        if (s.isFile()) {
          let testName = basename(record.workspaceRelativePath)
          let platform: string | null = null
          let targetName: string | null = null
          let testId: string | null = null
          const take = (metadata: TestFileMetadata): void => {
            testName = metadata.name || basename(record.workspaceRelativePath)
            targetName = metadata.targetName || null
            platform = metadata.platform
            testId = metadata.testId
          }
          try {
            const first = extractTestFileMetadata(await readFile(record.absolutePath, 'utf-8'))
            take(first)
            if (!first.testId) {
              take(await this.underLock(record.absolutePath, async () => {
                const content = await readFile(record.absolutePath, 'utf-8')
                const current = extractTestFileMetadata(content)
                if (current.testId) return current
                // 2026-10-18 (444-35, IN-20): an empty file may be an outside save mid-write; it is never minted.
                if (content.trim() === '') return current
                const minted = generateTestId()
                await replaceFileAtomic(record.absolutePath, withIdLine(content, 'test-id', minted))
                return { ...current, testId: minted }
              }))
            }
          } catch { /* fall back to filename */ }
          files.push({
            path: record.workspaceRelativePath,
            name: testName,
            testId,
            targetName,
            platform,
            modified: s.mtime.toISOString(),
          })
        }
      } catch {
        // skip inaccessible files
      }
    }

    files.sort((a, b) => b.modified.localeCompare(a.modified))
    return files
  }

  async read(relativePath: string): Promise<string> {
    const target = await this.resolveTarget(relativePath, true)
    return readFile(target.absolutePath, 'utf-8')
  }

  async findByTestId(testId: string): Promise<{ path: string; content: string } | null> {
    const files = await this.list()
    const match = files.find(f => f.testId === testId)
    if (!match) return null
    const content = await this.read(match.path)
    return { path: match.path, content }
  }

  async write(relativePath: string, content: string): Promise<void> {
    const target = await this.resolveTarget(relativePath, false)
    await mkdir(dirname(target.absolutePath), { recursive: true })
    await this.underLock(target.absolutePath, () => replaceFileAtomic(target.absolutePath, content))
  }

  async delete(relativePath: string): Promise<void> {
    const target = await this.resolveTarget(relativePath, true)
    await this.underLock(target.absolutePath, () => rm(target.absolutePath))
  }

  async validate(content: string): Promise<TestValidationResult> {
    try {
      const { parseTestFile } = await import('@vostride/agent-qa-core')
      const result = parseTestFile(content, '<editor>')

      if (result.errors.length === 0) {
        return { valid: true, errors: [] }
      }

      return {
        valid: false,
        errors: result.errors.map(e => ({
          message: e.message,
          line: e.line,
          column: e.column,
          suggestion: e.suggestion,
        })),
      }
    } catch (err) {
      return {
        valid: false,
        errors: [{ message: err instanceof Error ? err.message : 'Failed to validate' }],
      }
    }
  }

  private async resolveTarget(relativePath: string, requireExisting: boolean) {
    return resolveWorkspaceFileTarget({
      workspace: this.workspace,
      kind: 'test',
      filePath: relativePath,
      requireExisting,
    })
  }
}
