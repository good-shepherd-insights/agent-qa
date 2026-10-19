// C445-NO-MIGRATION (445-09, D-24, D-37): no migration, upgrade command, managed-block refresh or compatibility shim ships
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Command } from 'commander'
import { describe, expect, it } from 'vitest'

import { createAgentQaProgram } from '../program.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGES_DIR = join(HERE, '..', '..', '..')
const REPO_ROOT = join(PACKAGES_DIR, '..')

const REMOVED_NO_OP_FLAG = '--skip-install'
const FORBIDDEN_NAME = /migrat|upgrade/i
const FORBIDDEN_TEXT = /migrat|upgrade|deprecated no-op/i
const LEGACY_MEMORY_DIR = 'agent-qa-memory'
const GITIGNORE_WRITER = 'upsertManagedGitignoreBlock'

const DOCTOR = 'packages/cli/src/commands/doctor.ts'
const HARD_CUT = 'packages/cli/src/hard-cut.ts'
const INIT = 'packages/cli/src/commands/init.ts'

interface KeptItem {
  file: string
  mustContain: string
  reason: string
}

const KEPT: Record<string, KeptItem> = {
  'init --agent name map': {
    file: INIT,
    mustContain: 'v1 name map',
    reason: 'a catalog of v1 names and where each went; it writes nothing',
  },
  'dashboard store version refusal': {
    file: 'packages/dashboard-server/src/db/database.ts',
    mustContain: 'this build performs no migration for that version',
    reason: 'refuses a database stamped at another schema version',
  },
  'job store version refusal': {
    file: 'packages/agent-local/src/store/store-errors.ts',
    mustContain: 'There is no migration machinery by',
    reason: 'refuses a job store stamped at another schema version',
  },
  'derived-index profile rebuild': {
    file: 'packages/knowledge-local/src/profile-migration.ts',
    mustContain: 'export async function setActiveEmbeddingProfile(',
    reason: 'rebuilds the derived index for an embedding profile; no user file is read or written',
  },
  'removed CLI surface refusal': {
    file: 'packages/cli/src/removed-cli-surface.ts',
    mustContain: "error: unknown command '",
    reason: 'refuses connect and --env-file as unknown; no alias',
  },
  'retired-key refusals': {
    file: 'packages/core/src/schema/retired-keys.ts',
    mustContain: 'params: { retired: true }',
    reason: 'a removed config key is an error that names its replacement; nothing is rewritten',
  },
  'doctor legacy-memory row': {
    file: DOCTOR,
    mustContain: "name: 'Legacy v1 memory data'",
    reason: 'detects the v1 memory directory and warns; it never reads, moves or deletes it',
  },
}

const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.turbo', 'coverage', '__tests__'])

function walkFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(path, out)
    else if (entry.isFile()) out.push(path)
  }
}

function productionSources(): string[] {
  const files: string[] = []
  for (const name of readdirSync(PACKAGES_DIR)) {
    const src = join(PACKAGES_DIR, name, 'src')
    if (existsSync(src)) walkFiles(src, files)
  }
  return files
    .map((path) => relative(REPO_ROOT, path).split(sep).join('/'))
    .filter(
      (file) =>
        /\.tsx?$/.test(file) &&
        !file.endsWith('.d.ts') &&
        !file.includes('.test.') &&
        !file.split('/').includes('__tests__') &&
        !file.split('/').includes('dist'),
    )
    .sort()
}

const read = (file: string) => readFileSync(join(REPO_ROOT, file), 'utf8')
const SOURCES = productionSources()

function functionBody(text: string, header: string): string {
  const start = text.indexOf(header)
  if (start < 0) return ''
  const end = text.indexOf('\n}\n', start)
  return text.slice(start, end < 0 ? undefined : end)
}

describe('C445-NO-MIGRATION', () => {
  it('no shipped command or option offers a migration, an upgrade or a compatibility no-op', () => {
    const offences: string[] = []
    const visited: string[] = []
    let options = 0
    const visit = (cmd: Command, trail: string): void => {
      visited.push(trail)
      const names = [cmd.name(), ...cmd.aliases()]
      if (names.some((name) => FORBIDDEN_NAME.test(name))) {
        offences.push(`${trail}: command named ${names.join('|')}`)
      }
      if (FORBIDDEN_TEXT.test(cmd.description())) {
        offences.push(`${trail}: description ${JSON.stringify(cmd.description())}`)
      }
      for (const argument of cmd.registeredArguments) {
        if (FORBIDDEN_TEXT.test(argument.description)) {
          offences.push(`${trail} <${argument.name()}>: ${JSON.stringify(argument.description)}`)
        }
      }
      for (const option of cmd.options) {
        options++
        visited.push(`${trail} ${option.long ?? option.flags}`)
        if (option.long === REMOVED_NO_OP_FLAG) {
          offences.push(`${trail} ${option.long}: the removed no-op install flag`)
        }
        if (FORBIDDEN_NAME.test(option.long ?? option.flags)) {
          offences.push(`${trail} ${option.flags}: option named like a migration`)
        }
        if (FORBIDDEN_TEXT.test(option.description)) {
          offences.push(`${trail} ${option.flags}: ${JSON.stringify(option.description)}`)
        }
      }
      for (const sub of cmd.commands) visit(sub, `${trail} ${sub.name()}`)
    }
    const program = createAgentQaProgram()
    visit(program, program.name())
    const commands = visited.length - options
    console.info(`C445-NO-MIGRATION scene: ${JSON.stringify({ commands, options, offences })}`)

    // 2026-10-19 (445-09, D-24): the whole tree is 75 commands and 213 options at this phase.
    expect(commands, 'the walk reached too few commands to prove an absence').toBeGreaterThan(50)
    expect(options, 'the walk reached too few options to prove an absence').toBeGreaterThan(150)
    expect(visited).toEqual(
      expect.arrayContaining(['agent-qa init --agent', 'agent-qa knowledge rebuild-index']),
    )
    expect(offences).toEqual([])
  })

  it('only doctor reads the legacy memory directory, and only to warn', () => {
    const naming = SOURCES.filter((file) => read(file).includes(LEGACY_MEMORY_DIR))
    expect(naming).toEqual([DOCTOR, HARD_CUT])

    const doctor = read(DOCTOR)
    const row = functionBody(doctor, 'function checkLegacyV1MemoryData(')
    expect(doctor.split(LEGACY_MEMORY_DIR).length - 1).toBe(1)
    expect(row).toContain(LEGACY_MEMORY_DIR)
    expect(row).toContain("status: 'warn'")
    expect(row).not.toMatch(
      /status: 'fail'|rmSync|\brm\(|rename|writeFile|cpSync|copyFile|mkdir|unlink/,
    )

    // hard-cut.ts only prints the documented step that tells the user to delete it.
    const lines = read(HARD_CUT)
      .split('\n')
      .filter((line) => line.includes(LEGACY_MEMORY_DIR))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toMatch(/^\s*'\s+\d\. Delete /)
  })

  it('only init writes the managed gitignore block', () => {
    const definers = SOURCES.filter((file) =>
      read(file).includes(`export function ${GITIGNORE_WRITER}(`),
    )
    const callers = SOURCES.filter((file) =>
      read(file)
        .split('\n')
        .some((line) => line.includes(`${GITIGNORE_WRITER}(`) && !line.includes('function ')),
    )
    expect(definers).toEqual(['packages/cli/src/commands/init-filesystem.ts'])
    expect(callers).toEqual([INIT])
  })

  it('every kept item is still what it was classified as', () => {
    expect(Object.keys(KEPT).length).toBe(7)
    const drifted = Object.entries(KEPT)
      .filter(
        ([, kept]) =>
          !existsSync(join(REPO_ROOT, kept.file)) || !read(kept.file).includes(kept.mustContain),
      )
      .map(
        ([item, kept]) =>
          `${item}: ${kept.file} lacks ${JSON.stringify(kept.mustContain)} (${kept.reason})`,
      )
    expect(drifted).toEqual([])
  })

  it('core exports no workspace migration', async () => {
    const names = Object.keys(await import('@vostride/agent-qa-core'))
    expect(names.length, 'core exported nothing, so this census would range nothing')
      .toBeGreaterThan(0)
    expect(names.filter((name) => /Migration/.test(name))).toEqual([])
  })
})
