import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  chownSync,
  closeSync,
  existsSync,
  fchmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
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
  type InitFilesystemHooks,
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

function modeBits(path: string): number {
  return lstatSync(path).mode & 0o7777
}

function octal(mode: number): string {
  return mode.toString(8).padStart(4, '0')
}

const UNAPPLIED_MODE_REASON = /requested mode \d{4} was not applied/

const REVERT_MODES = [
  0o644,
  0o666,
  0o640,
  0o604,
  0o400,
  0o700,
  0o4600,
  0o2600,
  0o1600,
] as const

// Files inherit their group from the containing directory. When TMPDIR is unset the
// system temporary root belongs to a group this process is not in, and the kernel then
// silently drops setgid and sticky bits from chmod, so an adversarial high-bit revert
// would never actually land. Bind the fixture root to the process group instead.
function credentialRoot(): string {
  const root = tempRoot()
  chownSync(root, -1, process.getgid?.() ?? -1)
  return root
}

describe('credential-file mode confirmation fails closed', () => {
  for (const revertMode of REVERT_MODES) {
    it.skipIf(isWindows)(
      `refuses a retained secrets file reverted to ${octal(revertMode)} on the same inode`,
      () => {
        const root = credentialRoot()
        const plan = secretsPlan(root)
        const bytes = 'API_KEY=abc\n'
        writeFileSync(plan.path, bytes, { mode: 0o644 })
        const inode = lstatSync(plan.path).ino

        expect(() => writeScaffoldFileAtomic(plan, {
          afterRetainedModeOpen: () => {
            chmodSync(plan.path, revertMode)
          },
        })).toThrow(UNAPPLIED_MODE_REASON)

        expect(modeBits(plan.path)).toBe(revertMode)
        expect(readFileSync(plan.path, 'utf8')).toBe(bytes)
        expect(lstatSync(plan.path).ino).toBe(inode)
      },
    )
  }

  it.skipIf(isWindows)('refuses a reverted zero-byte retained secrets file', () => {
    const root = credentialRoot()
    const plan = secretsPlan(root)
    writeFileSync(plan.path, '', { mode: 0o644 })
    const inode = lstatSync(plan.path).ino

    expect(() => writeScaffoldFileAtomic(plan, {
      afterRetainedModeOpen: () => {
        chmodSync(plan.path, 0o644)
      },
    })).toThrow(UNAPPLIED_MODE_REASON)

    expect(modeBits(plan.path)).toBe(0o644)
    expect(readFileSync(plan.path, 'utf8')).toBe('')
    expect(lstatSync(plan.path).ino).toBe(inode)
  })

  it.skipIf(isWindows)(
    'refuses a revert on a destination that already carried the requested mode',
    () => {
      const root = credentialRoot()
      const plan = secretsPlan(root)
      const bytes = 'API_KEY=abc\n'
      writeFileSync(plan.path, bytes, { mode: 0o600 })
      const inode = lstatSync(plan.path).ino

      expect(() => writeScaffoldFileAtomic(plan, {
        afterRetainedModeOpen: () => {
          chmodSync(plan.path, 0o644)
        },
      })).toThrow(UNAPPLIED_MODE_REASON)

      expect(modeBits(plan.path)).toBe(0o644)
      expect(readFileSync(plan.path, 'utf8')).toBe(bytes)
      expect(lstatSync(plan.path).ino).toBe(inode)
    },
  )

  it.skipIf(isWindows)('refuses a revert applied through a second descriptor', () => {
    const root = credentialRoot()
    const plan = secretsPlan(root)
    const bytes = 'API_KEY=abc\n'
    writeFileSync(plan.path, bytes, { mode: 0o644 })
    const inode = lstatSync(plan.path).ino

    expect(() => writeScaffoldFileAtomic(plan, {
      afterRetainedModeOpen: () => {
        const fd = openSync(plan.path, 'r')
        try {
          fchmodSync(fd, 0o644)
        } finally {
          closeSync(fd)
        }
      },
    })).toThrow(UNAPPLIED_MODE_REASON)

    expect(modeBits(plan.path)).toBe(0o644)
    expect(readFileSync(plan.path, 'utf8')).toBe(bytes)
    expect(lstatSync(plan.path).ino).toBe(inode)
  })

  it.skipIf(isWindows)(
    'names the destination, both octal modes, and a remedy when the mode does not land',
    () => {
      const root = credentialRoot()
      const plan = secretsPlan(root)
      writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })

      let message = ''
      try {
        writeScaffoldFileAtomic(plan, {
          afterRetainedModeOpen: () => {
            chmodSync(plan.path, 0o644)
          },
        })
      } catch (error) {
        message = (error as Error).message
      }

      expect(message).not.toBe('')
      expect(message).toContain(plan.path)
      expect(message).toContain('0600')
      expect(message).toContain('0644')
      expect(message).toContain('store POSIX permissions')
    },
  )

  it.skipIf(isWindows)('never confirms a retained plan that declares no mode', () => {
    const root = credentialRoot()
    const path = join(root, '.env')
    writeFileSync(path, 'EXISTING=1\n', { mode: 0o640 })

    expect(writeScaffoldFileAtomic({
      root,
      path,
      content: '',
      force: true,
      preserveOnForce: true,
    }, {
      afterRetainedModeOpen: () => {
        throw new Error('retained mode confirmation must not run without a declared mode')
      },
    })).toEqual({ path, outcome: 'preserved' })
    expect(readFileSync(path, 'utf8')).toBe('EXISTING=1\n')
    expect(modeBits(path)).toBe(0o640)
  })

  function initTemporaries(directory: string): string[] {
    return readdirSync(directory).filter(entry => entry.includes('.agent-qa-init-'))
  }

  function locateTemporary(directory: string): string {
    const entries = initTemporaries(directory)
    if (entries.length !== 1) {
      throw new Error(
        `expected exactly one init temporary in ${directory}, found ${entries.length}`,
      )
    }
    return join(directory, entries[0]!)
  }

  for (const revertMode of [0o644, 0o666, 0o2600] as const) {
    it.skipIf(isWindows)(
      `refuses a created secrets file whose temporary is reverted to ${octal(revertMode)} `
      + 'before any content is written',
      () => {
        const root = credentialRoot()
        const plan = secretsPlan(root, { force: false, content: 'API_KEY=abc\n' })

        expect(() => writeScaffoldFileAtomic(plan, {
          afterTemporaryModeApply: (temporary) => {
            chmodSync(temporary, revertMode)
          },
        })).toThrow(UNAPPLIED_MODE_REASON)

        expect(existsSync(plan.path)).toBe(false)
        expect(initTemporaries(root)).toEqual([])
      },
    )
  }

  it.skipIf(isWindows)(
    'refuses a pre-content revert before any content byte is written or published',
    () => {
      const root = credentialRoot()
      const plan = secretsPlan(root, { force: false, content: 'API_KEY=abc\n' })
      let observedAtPublish: { mode: number, size: number } | undefined

      expect(() => writeScaffoldFileAtomic(plan, {
        afterTemporaryModeApply: (temporary) => {
          chmodSync(temporary, 0o644)
        },
        beforeExclusivePublish: () => {
          const temporary = locateTemporary(root)
          observedAtPublish = { mode: modeBits(temporary), size: lstatSync(temporary).size }
        },
      })).toThrow(UNAPPLIED_MODE_REASON)

      expect(observedAtPublish).toBeUndefined()
      expect(existsSync(plan.path)).toBe(false)
      expect(initTemporaries(root)).toEqual([])
    },
  )

  for (const revertMode of [0o644, 0o666] as const) {
    it.skipIf(isWindows)(
      `refuses a temporary reverted to ${octal(revertMode)} inside the publish window`,
      () => {
        const root = credentialRoot()
        const plan = secretsPlan(root, { force: false, content: 'API_KEY=abc\n' })

        expect(() => writeScaffoldFileAtomic(plan, {
          beforeExclusivePublish: () => {
            chmodSync(locateTemporary(root), revertMode)
          },
        })).toThrow(UNAPPLIED_MODE_REASON)

        expect(existsSync(plan.path)).toBe(false)
        expect(initTemporaries(root)).toEqual([])
      },
    )
  }

  it.skipIf(isWindows)(
    'refuses a publish-window temporary substitution whose mode is exactly 0600',
    () => {
      const root = credentialRoot()
      const plan = secretsPlan(root, { force: false, content: 'API_KEY=abc\n' })

      expect(() => writeScaffoldFileAtomic(plan, {
        beforeExclusivePublish: () => {
          const temporary = locateTemporary(root)
          unlinkSync(temporary)
          writeFileSync(temporary, 'substitute\n')
          chmodSync(temporary, 0o600)
        },
      })).toThrow(/destination changed at publication/)

      expect(existsSync(plan.path)).toBe(false)
      expect(initTemporaries(root)).toEqual([])
    },
  )

  it.skipIf(isWindows)('never confirms a creation plan that declares no mode', () => {
    const root = credentialRoot()
    const path = join(root, 'scaffold.yaml')

    expect(writeScaffoldFileAtomic({ root, path, content: 'first\n', force: false }, {
      afterTemporaryModeApply: () => {
        throw new Error('creation mode confirmation must not run without a declared mode')
      },
    })).toEqual({ path, outcome: 'created' })
    expect(readFileSync(path, 'utf8')).toBe('first\n')
    expect(initTemporaries(root)).toEqual([])
  })
})

// Every hook member the module may ever fire, including the two this wave adds. The
// recorder below installs all of them so a path that silently drops its caller's hooks
// records an empty list rather than passing vacuously over an unexercised branch.
const ALL_INIT_HOOK_NAMES = [
  'beforeExclusivePublish',
  'beforeRetainedModeOpen',
  'afterRetainedModeOpen',
  'afterTemporaryModeApply',
  'beforeAtomicReplacePublish',
  'afterRetainedModeConfirm',
] as const

// The ordered hook names a force-replace invocation carrying a declared mode must fire
// once the atomic-replacement path forwards its caller's hooks.
const ATOMIC_REPLACE_HOOK_NAMES = [
  'afterTemporaryModeApply',
  'beforeAtomicReplacePublish',
] as const

// Hooks that exist only because a mode was declared; a plan declaring no mode must fire
// none of them on any publication path.
const CONFIRMATION_DEPENDENT_HOOK_NAMES = [
  'afterTemporaryModeApply',
  'afterRetainedModeOpen',
  'afterRetainedModeConfirm',
] as const

const SETTLE_REVERT_MODES = [0o644, 0o666, 0o640, 0o604, 0o400, 0o2600] as const

const REPLACEMENT_PUBLISH_REVERT_MODES = [0o644, 0o666, 0o2600] as const

const UNSETTLED_MODE_REASON = /requested mode \d{4} did not settle/

function initHooks(members: Record<string, (path: string) => void>): InitFilesystemHooks {
  return members as InitFilesystemHooks
}

function recordAllHooks(
  fired: string[],
  overrides: Record<string, (path: string) => void> = {},
): InitFilesystemHooks {
  const members: Record<string, (path: string) => void> = {}
  for (const name of ALL_INIT_HOOK_NAMES) {
    members[name] = (path) => {
      fired.push(name)
      overrides[name]?.(path)
    }
  }
  return initHooks(members)
}

// The shape production never constructs: an existing regular destination, force enabled,
// preserve-on-force absent, and a declared owner-only mode.
function atomicReplacePlan(root: string, overrides: Partial<InitPathPlan> = {}): InitPathPlan {
  return {
    root,
    path: join(root, '.env.secrets.local'),
    content: 'REPLACED=1\n',
    force: true,
    mode: 0o600,
    ...overrides,
  }
}

function listInitTemporaries(directory: string): string[] {
  return readdirSync(directory).filter(entry => entry.includes('.agent-qa-init-'))
}

function findInitTemporary(directory: string): string {
  const entries = listInitTemporaries(directory)
  if (entries.length !== 1) {
    throw new Error(
      `expected exactly one init temporary in ${directory}, found ${entries.length}`,
    )
  }
  return join(directory, entries[0]!)
}

describe('atomic-replacement publication confirmation', () => {
  it.skipIf(isWindows)(
    'forwards its caller\'s hooks for a force-replace invocation carrying a declared mode',
    () => {
      const root = credentialRoot()
      const plan = atomicReplacePlan(root)
      writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })
      const fired: string[] = []

      expect(writeScaffoldFileAtomic(plan, recordAllHooks(fired))).toEqual({
        path: plan.path,
        outcome: 'updated',
      })

      expect(fired).toEqual([...ATOMIC_REPLACE_HOOK_NAMES])
    },
  )

  it.skipIf(isWindows)(
    'publishes a mode-bearing replacement and confirms the destination it renamed',
    () => {
      const root = credentialRoot()
      const plan = atomicReplacePlan(root)
      writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })
      const fired: string[] = []

      expect(writeScaffoldFileAtomic(plan, recordAllHooks(fired))).toEqual({
        path: plan.path,
        outcome: 'updated',
      })

      expect(fired).toEqual([...ATOMIC_REPLACE_HOOK_NAMES])
      expect(readFileSync(plan.path, 'utf8')).toBe('REPLACED=1\n')
      expect(modeBits(plan.path)).toBe(0o600)
      expect(listInitTemporaries(root)).toEqual([])
    },
  )

  for (const revertMode of REPLACEMENT_PUBLISH_REVERT_MODES) {
    it.skipIf(isWindows)(
      `refuses a replacement whose temporary is reverted to ${octal(revertMode)} inside the `
      + 'publication window',
      () => {
        const root = credentialRoot()
        const plan = atomicReplacePlan(root)
        writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })
        const fired: string[] = []

        expect(() => writeScaffoldFileAtomic(plan, recordAllHooks(fired, {
          beforeAtomicReplacePublish: () => {
            chmodSync(findInitTemporary(root), revertMode)
          },
        }))).toThrow(UNAPPLIED_MODE_REASON)

        expect(fired).toEqual([...ATOMIC_REPLACE_HOOK_NAMES])
        // Fail-closed disposition: the rename already consumed the original bytes, so the
        // unconfirmed destination is removed rather than left at an unconfirmed mode.
        expect(existsSync(plan.path)).toBe(false)
        expect(listInitTemporaries(root)).toEqual([])
      },
    )
  }

  it.skipIf(isWindows)(
    'refuses a replacement destination substituted at exactly the requested mode inside '
    + 'the publication window',
    () => {
      const root = credentialRoot()
      const plan = atomicReplacePlan(root)
      writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })

      expect(() => writeScaffoldFileAtomic(plan, {
        beforeAtomicReplacePublish: () => {
          const temporary = findInitTemporary(root)
          unlinkSync(temporary)
          writeFileSync(temporary, 'substitute\n')
          chmodSync(temporary, 0o600)
        },
      })).toThrow(/destination changed at publication/)

      expect(existsSync(plan.path)).toBe(false)
      expect(listInitTemporaries(root)).toEqual([])
    },
  )

  it.skipIf(isWindows)('publishes an empty-content replacement at the declared mode', () => {
    const root = credentialRoot()
    const plan = atomicReplacePlan(root, { content: '' })
    writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })

    expect(writeScaffoldFileAtomic(plan)).toEqual({ path: plan.path, outcome: 'updated' })
    expect(readFileSync(plan.path, 'utf8')).toBe('')
    expect(modeBits(plan.path)).toBe(0o600)
    expect(listInitTemporaries(root)).toEqual([])
  })

  it.skipIf(isWindows)(
    'never fires a confirmation-dependent hook for a plan that declares no mode, '
    + 'on any of the three publication paths',
    () => {
      const root = credentialRoot()

      const created = join(root, 'scaffold.yaml')
      const createdFired: string[] = []
      expect(writeScaffoldFileAtomic(
        { root, path: created, content: 'first\n', force: false },
        recordAllHooks(createdFired),
      )).toEqual({ path: created, outcome: 'created' })

      const retained = join(root, '.env')
      writeFileSync(retained, 'EXISTING=1\n', { mode: 0o640 })
      const retainedFired: string[] = []
      expect(writeScaffoldFileAtomic(
        { root, path: retained, content: '', force: true, preserveOnForce: true },
        recordAllHooks(retainedFired),
      )).toEqual({ path: retained, outcome: 'preserved' })

      const replaced = join(root, 'replaced.yaml')
      writeFileSync(replaced, 'before\n', { mode: 0o644 })
      const replacedFired: string[] = []
      expect(writeScaffoldFileAtomic(
        { root, path: replaced, content: 'after\n', force: true },
        recordAllHooks(replacedFired),
      )).toEqual({ path: replaced, outcome: 'updated' })

      for (const fired of [createdFired, retainedFired, replacedFired]) {
        for (const name of CONFIRMATION_DEPENDENT_HOOK_NAMES) {
          expect(fired).not.toContain(name)
        }
      }
      // The replacement's pre-publication seam is not confirmation-dependent: it fires
      // whether or not a mode was declared, and it is the only hook that does here.
      expect(replacedFired).toEqual(['beforeAtomicReplacePublish'])
      expect(modeBits(retained)).toBe(0o640)
      expect(readFileSync(retained, 'utf8')).toBe('EXISTING=1\n')
      expect(readFileSync(replaced, 'utf8')).toBe('after\n')
      expect(listInitTemporaries(root)).toEqual([])
    },
  )
})

describe('retained-path settle window', () => {
  for (const revertMode of SETTLE_REVERT_MODES) {
    it.skipIf(isWindows)(
      `refuses a retained secrets file reverted to ${octal(revertMode)} after the descriptor `
      + 'confirmation and before the settle observation',
      () => {
        const root = credentialRoot()
        const plan = secretsPlan(root)
        const bytes = 'API_KEY=abc\n'
        writeFileSync(plan.path, bytes, { mode: 0o644 })
        const inode = lstatSync(plan.path).ino
        const fired: string[] = []
        let message = ''

        try {
          writeScaffoldFileAtomic(plan, recordAllHooks(fired, {
            afterRetainedModeConfirm: () => {
              chmodSync(plan.path, revertMode)
            },
          }))
        } catch (error) {
          message = (error as Error).message
        }

        expect(message).toMatch(UNSETTLED_MODE_REASON)
        expect(message).not.toMatch(UNAPPLIED_MODE_REASON)
        expect(fired.at(-1)).toBe('afterRetainedModeConfirm')
        expect(modeBits(plan.path)).toBe(revertMode)
        expect(readFileSync(plan.path, 'utf8')).toBe(bytes)
        expect(lstatSync(plan.path).ino).toBe(inode)
      },
    )
  }

  it.skipIf(isWindows)(
    'keeps the settle-time refusal reason distinct from the unapplied-mode reason',
    () => {
      const root = credentialRoot()
      const plan = secretsPlan(root)
      writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })

      let message = ''
      try {
        writeScaffoldFileAtomic(plan, {
          afterRetainedModeOpen: () => {
            chmodSync(plan.path, 0o644)
          },
        })
      } catch (error) {
        message = (error as Error).message
      }

      expect(message).toMatch(UNAPPLIED_MODE_REASON)
      expect(message).not.toMatch(UNSETTLED_MODE_REASON)
    },
  )

  it.skipIf(isWindows)(
    'retains, hardens, and confirms a zero-byte credential file on the same inode',
    () => {
      const root = credentialRoot()
      const plan = secretsPlan(root)
      writeFileSync(plan.path, '', { mode: 0o644 })
      const before = lstatSync(plan.path)
      const fired: string[] = []

      expect(writeScaffoldFileAtomic(plan, recordAllHooks(fired))).toEqual({
        path: plan.path,
        outcome: 'preserved',
      })

      expect(lstatSync(plan.path).size).toBe(0)
      expect(lstatSync(plan.path).ino).toBe(before.ino)
      expect(modeBits(plan.path)).toBe(0o600)
      expect(fired).toContain('afterRetainedModeOpen')
      expect(fired).toContain('afterRetainedModeConfirm')
    },
  )

  it.skipIf(isWindows)(
    'takes the skip branch without a chmod when the requested mode already matches, '
    + 'and still confirms',
    () => {
      const root = credentialRoot()
      const plan = secretsPlan(root)
      writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o600 })
      const before = lstatSync(plan.path, { bigint: true }).ctimeNs
      const fired: string[] = []

      expect(writeScaffoldFileAtomic(plan, recordAllHooks(fired))).toEqual({
        path: plan.path,
        outcome: 'preserved',
      })

      expect(lstatSync(plan.path, { bigint: true }).ctimeNs).toBe(before)
      expect(fired).toContain('afterRetainedModeOpen')
      expect(fired).toContain('afterRetainedModeConfirm')
      expect(modeBits(plan.path)).toBe(0o600)

      // Control: the ctime probe above is sensitive rather than vacuous — a mode that
      // must actually be applied moves ctime on the very same filesystem.
      const controlRoot = credentialRoot()
      const controlPlan = secretsPlan(controlRoot)
      writeFileSync(controlPlan.path, 'API_KEY=abc\n', { mode: 0o644 })
      const controlBefore = lstatSync(controlPlan.path, { bigint: true }).ctimeNs

      expect(writeScaffoldFileAtomic(controlPlan)).toEqual({
        path: controlPlan.path,
        outcome: 'preserved',
      })

      expect(lstatSync(controlPlan.path, { bigint: true }).ctimeNs).not.toBe(controlBefore)
      expect(modeBits(controlPlan.path)).toBe(0o600)
    },
  )
})
