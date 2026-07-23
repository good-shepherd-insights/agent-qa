import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  KNOWLEDGE_GITIGNORE_PROBES,
  TARGET_GITIGNORE_PROBES,
  preflightInitPlan,
  upsertManagedGitignoreBlock,
  verifyEffectiveGitignore,
  writeScaffoldFileAtomic,
  type InitPathPlan,
} from '../commands/init-filesystem.js'

const roots: string[] = []

function tempRoot(prefix = 'agent-qa-init-filesystem-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function initializeGit(root: string): void {
  execFileSync('git', ['init', '--quiet'], { cwd: root, stdio: 'pipe' })
}

function materializeProbePaths(
  root: string,
  probes: readonly { path: string }[],
): void {
  for (const probe of probes) {
    const absolutePath = join(root, probe.path)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, 'fixture\n')
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('safe init filesystem primitives', () => {
  it(
    'creates absent files exclusively, preserves regular files, and atomically force-updates',
    () => {
      const root = tempRoot()
      const path = join(root, 'nested', 'scaffold.yaml')
      const initial: InitPathPlan = {
        root,
        path,
        content: 'first\n',
        force: false,
      }

      expect(preflightInitPlan([initial])).toEqual([
        expect.objectContaining({ path, classification: 'missing' }),
      ])
      expect(writeScaffoldFileAtomic(initial)).toEqual({ path, outcome: 'created' })
      expect(readFileSync(path, 'utf8')).toBe('first\n')

      const preserved = writeScaffoldFileAtomic({
        root,
        path,
        content: 'must-not-replace\n',
        force: false,
      })
      expect(preserved).toEqual({ path, outcome: 'preserved' })
      expect(readFileSync(path, 'utf8')).toBe('first\n')

      const updated = writeScaffoldFileAtomic({
        root,
        path,
        content: 'forced\n',
        force: true,
      })
      expect(updated).toEqual({ path, outcome: 'updated' })
      expect(readFileSync(path, 'utf8')).toBe('forced\n')
    },
  )

  it('refuses symlink, directory, FIFO, and symlinked-parent collisions before clobbering', () => {
    const root = tempRoot()
    const sentinel = join(root, 'sentinel.txt')
    writeFileSync(sentinel, 'sentinel\n')

    const symlink = join(root, 'symlink.yaml')
    symlinkSync(sentinel, symlink)

    const directory = join(root, 'directory.yaml')
    mkdirSync(directory)

    const fifo = join(root, 'fifo.yaml')
    execFileSync('mkfifo', [fifo], { stdio: 'pipe' })

    const external = join(root, 'external')
    mkdirSync(external)
    const parentSymlink = join(root, 'linked-parent')
    symlinkSync(external, parentSymlink, 'dir')

    for (const [path, expectedKind] of [
      [symlink, 'symbolic link'],
      [directory, 'directory'],
      [fifo, 'FIFO'],
      [join(parentSymlink, 'nested.yaml'), 'symbolic link parent'],
    ] as const) {
      expect(() => preflightInitPlan([{
        root,
        path,
        content: 'replacement\n',
        force: true,
      }]))
        .toThrow(expectedKind)
    }

    expect(readFileSync(sentinel, 'utf8')).toBe('sentinel\n')
  })

  it('loses an exclusive-create race without replacing the raced-in regular file', () => {
    const root = tempRoot()
    const path = join(root, 'raced.yaml')

    expect(() => writeScaffoldFileAtomic(
      { root, path, content: 'scaffold\n', force: false },
      {
        beforeExclusivePublish: () => {
          writeFileSync(path, 'racer\n', { flag: 'wx' })
        },
      },
    )).toThrow(/appeared during exclusive create/)

    expect(readFileSync(path, 'utf8')).toBe('racer\n')
  })

  it('places one managed target .gitignore block at EOF after prior negations', () => {
    const root = tempRoot()
    initializeGit(root)
    const gitignorePath = join(root, '.gitignore')
    writeFileSync(gitignorePath, [
      '# project rules',
      '.agent-qa/',
      '.env',
      '!.agent-qa/',
      '!.agent-qa/**',
      '!.env',
      '!.env.secrets.local',
      '',
    ].join('\n'))

    const first = upsertManagedGitignoreBlock(gitignorePath)
    expect(first).toEqual({ path: gitignorePath, outcome: 'updated' })
    const firstBytes = readFileSync(gitignorePath, 'utf8')
    expect(firstBytes).toMatch(/# agent-qa init:start[\s\S]*# agent-qa init:end\n$/)
    expect(firstBytes.match(/# agent-qa init:start/g)).toHaveLength(1)
    expect(firstBytes.indexOf('!.env')).toBeLessThan(firstBytes.indexOf('# agent-qa init:start'))

    materializeProbePaths(root, TARGET_GITIGNORE_PROBES)
    expect(verifyEffectiveGitignore({
      cwd: root,
      label: 'target .gitignore',
      probes: TARGET_GITIGNORE_PROBES,
    })).toEqual({ checked: true })

    expect(upsertManagedGitignoreBlock(gitignorePath)).toEqual({
      path: gitignorePath,
      outcome: 'preserved',
    })
    expect(readFileSync(gitignorePath, 'utf8')).toBe(firstBytes)
  })

  it('rejects an ineffective sovereign knowledge .gitignore without changing bytes', () => {
    const root = tempRoot()
    initializeGit(root)
    const gitignorePath = join(root, '.gitignore')
    const unsafeBytes = [
      '# customized sovereign rules',
      'memory/index/',
      'memory/queue/',
      '.lease',
      '.epoch',
      '**/artifacts/',
      'skills/.staging/',
      '!memory/index/',
      '!memory/index/**',
      '',
    ].join('\n')
    writeFileSync(gitignorePath, unsafeBytes)
    materializeProbePaths(root, KNOWLEDGE_GITIGNORE_PROBES)

    expect(() => verifyEffectiveGitignore({
      cwd: root,
      label: 'existing agent-qa-knowledge/.gitignore',
      probes: KNOWLEDGE_GITIGNORE_PROBES,
    })).toThrow(
      'existing agent-qa-knowledge/.gitignore is unsafe: '
      + '"memory/index/knowledge.sqlite" must be ignored. '
      + 'Move "memory/index/" after any negation, then rerun agent-qa init; no files were changed.',
    )
    expect(readFileSync(gitignorePath, 'utf8')).toBe(unsafeBytes)
  })
})
