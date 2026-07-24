import { execFileSync } from 'node:child_process'
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
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

const isWindows = process.platform === 'win32'

function permissionBits(path: string): number {
  return lstatSync(path).mode & 0o777
}

function secretsPlan(root: string, overrides: Partial<InitPathPlan> = {}): InitPathPlan {
  return {
    root,
    path: join(root, '.env.secrets.local'),
    content: 'must-never-be-written\n',
    force: true,
    preserveOnForce: true,
    mode: 0o600,
    ...overrides,
  }
}

describe('credential-file permission and byte preservation', () => {
  it.skipIf(isWindows)('creates a planned 0600 file exactly under an all-masking umask', () => {
    const root = tempRoot()
    const path = join(root, '.env.secrets.local')
    const previousUmask = process.umask(0o777)
    try {
      expect(writeScaffoldFileAtomic({
        root,
        path,
        content: '',
        force: false,
        mode: 0o600,
      })).toEqual({ path, outcome: 'created' })
    } finally {
      process.umask(previousUmask)
    }

    expect(readFileSync(path, 'utf8')).toBe('')
    expect(permissionBits(path)).toBe(0o600)
  })

  it.skipIf(isWindows)('creates a planned 0600 file exactly under an ordinary umask', () => {
    const root = tempRoot()
    const path = join(root, '.env.secrets.local')

    expect(writeScaffoldFileAtomic({
      root,
      path,
      content: 'API_KEY=abc\n',
      force: false,
      mode: 0o600,
    })).toEqual({ path, outcome: 'created' })
    expect(readFileSync(path, 'utf8')).toBe('API_KEY=abc\n')
    expect(permissionBits(path)).toBe(0o600)
  })

  for (const [label, bytes] of [['empty', ''], ['populated', 'API_KEY=abc\n']] as const) {
    it.skipIf(isWindows)(
      `tightens a retained ${label} 0644 secrets file to 0600 without rewriting bytes`,
      () => {
        const root = tempRoot()
        const plan = secretsPlan(root)
        writeFileSync(plan.path, bytes, { mode: 0o644 })
        expect(permissionBits(plan.path)).toBe(0o644)

        expect(writeScaffoldFileAtomic(plan)).toEqual({
          path: plan.path,
          outcome: 'preserved',
        })
        expect(readFileSync(plan.path, 'utf8')).toBe(bytes)
        expect(permissionBits(plan.path)).toBe(0o600)
      },
    )
  }

  it.skipIf(isWindows)('leaves an already-0600 retained secrets file untouched', () => {
    const root = tempRoot()
    const plan = secretsPlan(root)
    writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o600 })
    const before = lstatSync(plan.path)

    expect(writeScaffoldFileAtomic(plan)).toEqual({
      path: plan.path,
      outcome: 'preserved',
    })
    const after = lstatSync(plan.path)
    expect(readFileSync(plan.path, 'utf8')).toBe('API_KEY=abc\n')
    expect(permissionBits(plan.path)).toBe(0o600)
    expect(after.ino).toBe(before.ino)
  })

  it.skipIf(isWindows)('leaves permissions alone for a preserved plan without a mode', () => {
    const root = tempRoot()
    const path = join(root, '.env')
    writeFileSync(path, 'EXISTING=1\n', { mode: 0o640 })

    expect(writeScaffoldFileAtomic({
      root,
      path,
      content: '',
      force: true,
      preserveOnForce: true,
    })).toEqual({ path, outcome: 'preserved' })
    expect(readFileSync(path, 'utf8')).toBe('EXISTING=1\n')
    expect(permissionBits(path)).toBe(0o640)
  })

  it('preserves both credential files byte-for-byte under force', () => {
    const root = tempRoot()
    const envPath = join(root, '.env')
    const secretsPath = join(root, '.env.secrets.local')
    writeFileSync(envPath, 'BASE_URL=https://example.test\n')
    writeFileSync(secretsPath, 'API_KEY=abc\n')

    const outcomes = [
      writeScaffoldFileAtomic({
        root,
        path: envPath,
        content: '',
        force: true,
        preserveOnForce: true,
      }),
      writeScaffoldFileAtomic(secretsPlan(root)),
    ]

    expect(outcomes).toEqual([
      { path: envPath, outcome: 'preserved' },
      { path: secretsPath, outcome: 'preserved' },
    ])
    expect(readFileSync(envPath, 'utf8')).toBe('BASE_URL=https://example.test\n')
    expect(readFileSync(secretsPath, 'utf8')).toBe('API_KEY=abc\n')
  })

  it.skipIf(isWindows)('refuses a symbolic-link or FIFO destination for a mode-bearing plan', () => {
    const root = tempRoot()
    const sentinel = join(root, 'sentinel.env')
    writeFileSync(sentinel, 'API_KEY=abc\n', { mode: 0o644 })

    const symlink = join(root, '.env.secrets.local')
    symlinkSync(sentinel, symlink)
    expect(() => writeScaffoldFileAtomic(secretsPlan(root)))
      .toThrow('symbolic link')

    const fifoRoot = tempRoot()
    const fifo = join(fifoRoot, '.env.secrets.local')
    execFileSync('mkfifo', [fifo], { stdio: 'pipe' })
    expect(() => writeScaffoldFileAtomic(secretsPlan(fifoRoot))).toThrow('FIFO')

    expect(readFileSync(sentinel, 'utf8')).toBe('API_KEY=abc\n')
    expect(permissionBits(sentinel)).toBe(0o644)
  })

  it.skipIf(isWindows)('refuses a pre-existing multiply linked secrets inode', () => {
    const root = tempRoot()
    const plan = secretsPlan(root)
    writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })
    const alias = join(root, 'alias.env')
    linkSync(plan.path, alias)

    expect(() => writeScaffoldFileAtomic(plan)).toThrow(/multiple hard links/)
    expect(readFileSync(plan.path, 'utf8')).toBe('API_KEY=abc\n')
    expect(permissionBits(plan.path)).toBe(0o644)
    expect(permissionBits(alias)).toBe(0o644)
  })

  it.skipIf(isWindows)('refuses a same-type replacement raced in before the hardening open', () => {
    const root = tempRoot()
    const plan = secretsPlan(root)
    writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })
    const decoy = join(root, 'decoy.env')
    writeFileSync(decoy, 'RACER=1\n', { mode: 0o644 })

    expect(() => writeScaffoldFileAtomic(plan, {
      beforeRetainedModeOpen: () => {
        renameSync(decoy, plan.path)
      },
    })).toThrow(/destination changed/)
    expect(readFileSync(plan.path, 'utf8')).toBe('RACER=1\n')
    expect(permissionBits(plan.path)).toBe(0o644)
  })

  it.skipIf(isWindows)('refuses a hard link created after the identity capture', () => {
    const root = tempRoot()
    const plan = secretsPlan(root)
    writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })

    expect(() => writeScaffoldFileAtomic(plan, {
      beforeRetainedModeOpen: () => {
        linkSync(plan.path, join(root, 'alias.env'))
      },
    })).toThrow(/multiple hard links/)
    expect(readFileSync(plan.path, 'utf8')).toBe('API_KEY=abc\n')
    expect(permissionBits(plan.path)).toBe(0o644)
  })

  it.skipIf(isWindows)('refuses a path swap performed after the hardening open', () => {
    const root = tempRoot()
    const plan = secretsPlan(root)
    writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })
    const decoy = join(root, 'decoy.env')
    writeFileSync(decoy, 'SWAPPED=1\n', { mode: 0o644 })

    expect(() => writeScaffoldFileAtomic(plan, {
      afterRetainedModeOpen: () => {
        renameSync(decoy, plan.path)
      },
    })).toThrow(/destination changed/)
    expect(readFileSync(plan.path, 'utf8')).toBe('SWAPPED=1\n')
    expect(permissionBits(plan.path)).toBe(0o644)
  })

  it.skipIf(isWindows)('refuses a destination that disappears after the identity capture', () => {
    const root = tempRoot()
    const plan = secretsPlan(root)
    writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })

    expect(() => writeScaffoldFileAtomic(plan, {
      beforeRetainedModeOpen: () => {
        rmSync(plan.path)
      },
    })).toThrow(/destination disappeared/)
  })
})
