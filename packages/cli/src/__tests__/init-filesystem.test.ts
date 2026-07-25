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

  // The path shapes are taken from what this scaffold actually publishes — `tests/` holding
  // `example-pass.yaml` alongside a sibling whose name extends `tests` with a hyphen — rather
  // than invented, because the defeating arrangement is one the real plan set can produce.
  describe('nested-destination guarding survives a sibling sorting between parent and child', () => {
    function preflightPaths(root: string, names: readonly string[]): void {
      preflightInitPlan(names.map(name => ({
        root,
        path: join(root, ...name.split('/')),
        content: '',
        force: false,
      })))
    }

    // The parent and child are IDENTICAL in the next two tests; only the unrelated sibling
    // differs. They are separate `it`s rather than two assertions in one so that the control
    // is independently observable: inside a single test the first failing assertion would stop
    // the control from ever running, and a control that cannot be seen passing while its
    // partner fails is not a control.
    function nestedPair(root: string): string {
      return `Init plan destination ${join(root, 'tests')} is a parent of `
        + `${join(root, 'tests', 'example-pass.yaml')}`
    }

    it('refuses a parent and its child when an unrelated sibling sorts between them', () => {
      // The exact three-path set the round-7 review and verification both drove to NO THROW.
      // `-` (0x2D) sorts below `/` (0x2F), so `tests-extra.md` lands strictly between `tests`
      // and `tests/example-pass.yaml` and an adjacent-pair comparison never sees the overlap.
      const root = tempRoot()
      expect(() => preflightPaths(root, [
        'tests',
        'tests-extra.md',
        'tests/example-pass.yaml',
      ])).toThrow(nestedPair(root))
    })

    it('refuses the same parent and child with the sibling removed', () => {
      // The paired control. The identical message proves the sibling is not what decides the
      // verdict — without it, a guard that only ever fires on two-path sets would be
      // indistinguishable from a correct one.
      const root = tempRoot()
      expect(() => preflightPaths(root, [
        'tests',
        'tests/example-pass.yaml',
      ])).toThrow(nestedPair(root))
    })

    it('names the nearest ancestor when several plans nest', () => {
      const root = tempRoot()
      const nearest = join(root, 'tests', 'suite')
      const leaf = join(root, 'tests', 'suite', 'example-pass.yaml')

      expect(() => preflightPaths(root, [
        'tests/suite',
        'tests/suite-extra.md',
        'tests/suite/example-pass.yaml',
      ])).toThrow(`Init plan destination ${nearest} is a parent of ${leaf}`)
    })

    it('admits destinations that share a leading name fragment without nesting', () => {
      const root = tempRoot()

      // The negative control. An ancestor walk that compared name PREFIXES rather than whole
      // path components would reject all of these, and would be indistinguishable from a
      // correct one without this case.
      expect(() => preflightPaths(root, [
        'tests',
        'tests-extra.md',
        'tests.backup',
        'testsuite/example-pass.yaml',
        'agent-qa.config.yaml',
      ])).not.toThrow()
    })

    it('still refuses a duplicate destination', () => {
      const root = tempRoot()
      expect(() => preflightPaths(root, [
        'agent-qa.config.yaml',
        'agent-qa.config.yaml',
      ])).toThrow(/duplicate destination/)
    })
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

  // A bad merge produces this shape: the managed end marker above its start marker. The
  // marker COUNTS still balance at one and one, so the count-based refusal does not fire —
  // which is exactly why the ordering has to be checked separately.
  it('refuses an inverted-marker target .gitignore without changing its bytes', () => {
    const root = tempRoot()
    initializeGit(root)
    const gitignorePath = join(root, '.gitignore')
    const invertedBytes = [
      '# agent-qa init:end',
      'user-rule-one',
      'user-rule-two',
      '# agent-qa init:start',
      'user-rule-three',
      '',
    ].join('\n')
    writeFileSync(gitignorePath, invertedBytes)

    expect(() => upsertManagedGitignoreBlock(gitignorePath)).toThrow(
      /Refusing malformed target \.gitignore: [\s\S]*end marker precedes its start marker/,
    )
    // The whole file, not sampled lines: a splice at an arbitrary byte duplicates the user's
    // own rules and mangles a line, and only a whole-string comparison catches both.
    expect(readFileSync(gitignorePath, 'utf8')).toBe(invertedBytes)
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

// Fragments of the two disposition sentences the module appends after every refusal reason
// (D-22). Fragments rather than whole sentences, so incidental punctuation does not churn
// these tests — but chosen so that no single message can ever match both.
const REMOVED_DISPOSITION_PATTERN = /it was unlinked[\s\S]*are not recoverable/
const RETAINED_DISPOSITION_PATTERN = /the destination was not removed or rewritten/

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

        let message = ''
        try {
          writeScaffoldFileAtomic(plan, {
            afterRetainedModeOpen: () => {
              chmodSync(plan.path, revertMode)
            },
          })
        } catch (error) {
          message = (error as Error).message
        }

        expect(message).toMatch(UNAPPLIED_MODE_REASON)
        // The retained path leaves the destination alone and the refusal now says so. The
        // opposite disposition can never appear here — that pairing is what makes a refused
        // retention distinguishable from a refused replacement, which throws the same reason.
        expect(message).toMatch(RETAINED_DISPOSITION_PATTERN)
        expect(message).not.toMatch(REMOVED_DISPOSITION_PATTERN)
        expect(existsSync(plan.path)).toBe(true)
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

        let message = ''
        try {
          writeScaffoldFileAtomic(plan, recordAllHooks(fired, {
            beforeAtomicReplacePublish: () => {
              chmodSync(findInitTemporary(root), revertMode)
            },
          }))
        } catch (error) {
          message = (error as Error).message
        }

        expect(message).toMatch(UNAPPLIED_MODE_REASON)
        expect(message).toMatch(REMOVED_DISPOSITION_PATTERN)
        expect(message).not.toMatch(RETAINED_DISPOSITION_PATTERN)
        expect(fired).toEqual([...ATOMIC_REPLACE_HOOK_NAMES])
        // Fail-closed disposition: the rename already consumed the original bytes, so the
        // unconfirmed destination is removed rather than left at an unconfirmed mode. That
        // disposition is now STATED in the thrown message and documented on the exported
        // entry point (D-22); it is unchanged, only made deliberate and legible.
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
        // The settle refusal is raised on the retained path, so it carries the retention
        // disposition alongside its own distinct reason.
        expect(message).toMatch(RETAINED_DISPOSITION_PATTERN)
        expect(message).not.toMatch(REMOVED_DISPOSITION_PATTERN)
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

function capturedRefusal(run: () => void): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('expected the invocation to refuse, but it returned without throwing')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function capturedRefusalMessage(run: () => void): string {
  return errorMessage(capturedRefusal(run))
}

// The bytes the MODULE appended, isolated from the reason it appended them to.
//
// Every disposition-bearing refusal is built as `${reason} ${disposition}` with the reason
// error kept as the `cause`, so what this module added is exactly the suffix past the deepest
// cause's message. Measuring THERE rather than over the whole message is what makes the
// measurement unforgeable: the destination path is a caller-supplied value embedded in the
// reason, and the reason is precisely the part sliced away. A message-wide scan cannot tell a
// disposition this module appended from one a directory name happens to spell — which is the
// round-7 defect restated as a measurement problem, and the reason the walk below can now be
// pointed at paths that spell the marker.
//
// An error that was never wrapped has no cause and returns '' — a refusal that escaped bare
// reads as carrying no disposition, which is what it is.
function moduleAppendedDisposition(error: unknown): string {
  const message = errorMessage(error)
  let root: unknown = error
  while (root instanceof Error && root.cause !== undefined) root = root.cause
  if (root === error) return ''
  const reason = errorMessage(root)
  if (!message.startsWith(reason)) {
    throw new Error(`refusal message does not extend its root cause: ${message}`)
  }
  return message.slice(reason.length)
}

// The disposition sentences are NOT exported — D-22 forbids new API surface, and a
// test-only export is still surface. Distinctness is therefore asserted against the two
// sentences as they appear in real refusal messages the module itself produced.
function dispositionSentence(message: string): string {
  const index = message.indexOf('Disposition:')
  if (index === -1) {
    throw new Error(`refusal message carries no disposition sentence: ${message}`)
  }
  return message.slice(index)
}

describe('refusal disposition distinctness', () => {
  it.skipIf(isWindows)(
    'never lets a removed destination and a retained one speak the same words',
    () => {
      const replacementRoot = credentialRoot()
      const replacementPlan = atomicReplacePlan(replacementRoot)
      writeFileSync(replacementPlan.path, 'USERDATA=important\n', { mode: 0o644 })
      const removedMessage = capturedRefusalMessage(() => {
        writeScaffoldFileAtomic(replacementPlan, {
          beforeAtomicReplacePublish: () => {
            chmodSync(findInitTemporary(replacementRoot), 0o644)
          },
        })
      })

      const retainedRoot = credentialRoot()
      const retainedPlan = secretsPlan(retainedRoot)
      writeFileSync(retainedPlan.path, 'API_KEY=abc\n', { mode: 0o644 })
      const retainedMessage = capturedRefusalMessage(() => {
        writeScaffoldFileAtomic(retainedPlan, {
          afterRetainedModeOpen: () => {
            chmodSync(retainedPlan.path, 0o644)
          },
        })
      })

      // Both refusals carry the SAME reason — that is the condition the verifier
      // reproduced. Only the disposition tells the two outcomes apart.
      expect(removedMessage).toMatch(UNAPPLIED_MODE_REASON)
      expect(retainedMessage).toMatch(UNAPPLIED_MODE_REASON)
      expect(removedMessage).not.toBe(retainedMessage)

      const removed = dispositionSentence(removedMessage)
      const retained = dispositionSentence(retainedMessage)

      // Structural, not incidental: neither sentence is a substring of the other, so a
      // future edit that makes them overlap fails this named test rather than silently
      // restoring the confusion.
      expect(removed).not.toBe(retained)
      expect(removed.includes(retained)).toBe(false)
      expect(retained.includes(removed)).toBe(false)

      // And a message carrying one disposition does not match the other's pattern.
      expect(removedMessage).toMatch(REMOVED_DISPOSITION_PATTERN)
      expect(removedMessage).not.toMatch(RETAINED_DISPOSITION_PATTERN)
      expect(retainedMessage).toMatch(RETAINED_DISPOSITION_PATTERN)
      expect(retainedMessage).not.toMatch(REMOVED_DISPOSITION_PATTERN)

      // The post-states the disposition sentences describe, measured on the same pair of
      // invocations that produced the messages.
      expect(existsSync(replacementPlan.path)).toBe(false)
      expect(existsSync(retainedPlan.path)).toBe(true)
      expect(readFileSync(retainedPlan.path, 'utf8')).toBe('API_KEY=abc\n')
      expect(modeBits(retainedPlan.path)).toBe(0o644)
    },
  )

  // THE CELL THE SUITE NEVER GENERATED. `afterTemporaryModeApply` reverts were exercised
  // only on the creation path and `beforeAtomicReplacePublish` reverts only on the
  // replacement path, so the replacement x pre-rename cross product was never built — and
  // that absence is exactly what let the JSDoc universal survive while being false.
  it.skipIf(isWindows)(
    'refuses a replacement whose temporary mode is reverted BEFORE the rename, and says the '
    + 'destination was retained',
    () => {
      const root = credentialRoot()
      const plan = atomicReplacePlan(root)
      const original = 'USERDATA=important\n'
      writeFileSync(plan.path, original, { mode: 0o644 })
      const inode = lstatSync(plan.path).ino

      const message = capturedRefusalMessage(() => {
        writeScaffoldFileAtomic(plan, {
          afterTemporaryModeApply: (temporary) => {
            chmodSync(temporary, 0o644)
          },
        })
      })

      // Same reason as the post-rename refusal, OPPOSITE post-state. Only the disposition
      // distinguishes them, which is why it has to be present and has to be the right one.
      expect(message).toMatch(UNAPPLIED_MODE_REASON)
      expect(message).toMatch(RETAINED_DISPOSITION_PATTERN)
      expect(message).not.toMatch(REMOVED_DISPOSITION_PATTERN)

      // Measured on the SAME invocation that produced the message.
      expect(existsSync(plan.path)).toBe(true)
      expect(readFileSync(plan.path, 'utf8')).toBe(original)
      expect(modeBits(plan.path)).toBe(0o644)
      expect(lstatSync(plan.path).ino).toBe(inode)
      expect(listInitTemporaries(root)).toEqual([])
    },
  )

  // Parameterised over the throw VALUE, not only over the arm. Every fixture in this loop used
  // to throw an `Error`, which is exactly why the primitive arm went unexercised for two
  // rounds while `markPassthrough` dropped non-objects on the floor and the retained wrap then
  // stamped a factual claim about the destination onto the consumer's own throw.
  const PASSTHROUGH_THROW_VALUES = [
    {
      label: 'an Error instance',
      make: (): unknown => new Error('caller-side bookkeeping failed'),
      message: 'caller-side bookkeeping failed',
    },
    {
      label: 'a string',
      make: (): unknown => 'caller-side bookkeeping failed',
      message: 'caller-side bookkeeping failed',
    },
    {
      label: 'a number',
      make: (): unknown => 42,
      message: '42',
    },
    {
      label: 'a symbol',
      make: (): unknown => Symbol('caller-side bookkeeping failed'),
      message: 'Symbol(caller-side bookkeeping failed)',
    },
  ] as const

  for (const [arm, hooks] of [
    ['retained', (throwing: () => never): InitFilesystemHooks => ({
      beforeRetainedModeOpen: () => throwing(),
    })],
    ['replacement', (throwing: () => never): InitFilesystemHooks => ({
      afterTemporaryModeApply: () => throwing(),
    })],
  ] as const) {
    for (const value of PASSTHROUGH_THROW_VALUES) {
      it.skipIf(isWindows)(
        `rethrows a caller hook's own throw of ${value.label} untouched on the ${arm} path`,
        () => {
          const root = credentialRoot()
          const plan = arm === 'retained' ? secretsPlan(root) : atomicReplacePlan(root)
          writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })

          const thrown = value.make()
          const error = capturedRefusal(() => {
            writeScaffoldFileAtomic(plan, hooks(() => {
              throw thrown
            }))
          })
          const message = errorMessage(error)

          // The consumer's error is not this module's refusal to restate, and it must not
          // acquire a factual claim about a destination this module did not act on.
          expect(message).toBe(value.message)
          expect(message).not.toContain('Disposition:')
          expect(message).not.toMatch(RETAINED_DISPOSITION_PATTERN)
          expect(message).not.toMatch(REMOVED_DISPOSITION_PATTERN)
          expect(moduleAppendedDisposition(error)).toBe('')

          // Nothing the consumer threw is lost. An object escapes as ITSELF; a primitive,
          // which cannot carry an identity mark, escapes as the `cause` of the wrapper that
          // carries the mark on its behalf.
          if (typeof thrown === 'object') expect(error).toBe(thrown)
          else expect((error as Error).cause).toBe(thrown)
        },
      )
    }
  }

  it.skipIf(isWindows)('preserves the original refusal as the rethrown error cause', () => {
    const root = credentialRoot()
    const plan = secretsPlan(root)
    writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })

    let caught: unknown
    try {
      writeScaffoldFileAtomic(plan, {
        afterRetainedModeOpen: () => {
          chmodSync(plan.path, 0o644)
        },
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    const cause = (caught as Error).cause
    expect(cause).toBeInstanceOf(Error)
    // The cause holds the reason WITHOUT a disposition, and the rethrown message begins
    // with it verbatim — which is why every pre-existing reason matcher still matches.
    expect((cause as Error).message).toMatch(UNAPPLIED_MODE_REASON)
    expect((cause as Error).message).not.toMatch(RETAINED_DISPOSITION_PATTERN)
    expect((cause as Error).message).not.toMatch(REMOVED_DISPOSITION_PATTERN)
    expect((caught as Error).message.startsWith((cause as Error).message)).toBe(true)
  })
})

// Counted rather than tested for presence, so a region that acquired a SECOND disposition —
// the failure mode a backstop layered over an inner wrap can introduce — fails this walk just
// as loudly as one carrying none. Applied to `moduleAppendedDisposition`'s output rather than
// to a whole message: a destination path is caller-supplied and can spell this token itself.
function dispositionSentenceCount(appended: string): number {
  return appended.split('Disposition:').length - 1
}

// The module's own disposition sentences, read back out of refusals the MODULE produced rather
// than copied from its source as literals. A fixture that hard-codes the sentence keeps
// "attacking" a string the module may no longer emit; these are the bytes an adversarial
// destination path actually has to carry today to defeat a predicate that reads the message.
let memoizedDispositions: { removed: string, retained: string } | undefined

function observedDispositionSentences(): { removed: string, retained: string } {
  if (memoizedDispositions === undefined) {
    const removedRoot = credentialRoot()
    const removedPlan = atomicReplacePlan(removedRoot)
    writeFileSync(removedPlan.path, 'USERDATA=important\n', { mode: 0o644 })
    const removed = dispositionSentence(capturedRefusalMessage(() => {
      writeScaffoldFileAtomic(removedPlan, {
        beforeAtomicReplacePublish: () => {
          chmodSync(findInitTemporary(removedRoot), 0o644)
        },
      })
    }))

    const retainedRoot = credentialRoot()
    const retainedPlan = secretsPlan(retainedRoot)
    writeFileSync(retainedPlan.path, 'API_KEY=abc\n', { mode: 0o644 })
    const retained = dispositionSentence(capturedRefusalMessage(() => {
      writeScaffoldFileAtomic(retainedPlan, {
        afterRetainedModeOpen: () => {
          chmodSync(retainedPlan.path, 0o644)
        },
      })
    }))

    memoizedDispositions = { removed, retained }
  }
  return memoizedDispositions
}

function observedDispositionLead(): string {
  const removed = observedDispositionSentences().removed
  return removed.slice(0, removed.indexOf(':') + 1)
}

// A scaffold root whose own NAME carries the given text. `mkdirSync` is deliberately not
// wrapped: if a POSIX host refuses the component the fixture fails loudly rather than quietly
// degrading to a path the host happens to accept. The colon in the lead token is legal in a
// POSIX path component and illegal on win32, so these variants — like every other cell in the
// walk — are POSIX-scoped by the `skipIf(isWindows)` guard the walk already carries.
function markerBearingRoot(component: string): string {
  const root = join(credentialRoot(), component)
  mkdirSync(root)
  return root
}

// The walk's fixture factory. Round 7's walk drew every path from the two root helpers, so no
// cell it could build was able to carry the disposition marker — the same defect class as a
// matrix generated from the vocabulary the implementation already satisfies, one layer up, and
// the reason fifteen green cells reported a universal that a caller-supplied path falsified in
// all three of its clauses. Crossing these roots with the entries below is what lets the walk
// GENERATE the inputs that break its own invariant instead of merely sampling around them.
const REFUSAL_WALK_ROOTS = [
  {
    name: 'ordinary root',
    carriesMarker: false,
    make: (): string => credentialRoot(),
  },
  {
    name: 'root directory carrying the disposition lead token',
    carriesMarker: true,
    make: (): string => markerBearingRoot(`${observedDispositionLead()} notes`),
  },
  {
    name: 'root directory named after the removal sentence',
    carriesMarker: true,
    make: (): string => markerBearingRoot(observedDispositionSentences().removed),
  },
] as const

// Every path on which `writeScaffoldFileAtomic` can refuse and that a test can actually
// reach, with the disposition each one must carry. This is the enumeration the universal
// is asserted over — the point being that it is a WALK, not three sampled cells.
//
// Deliberately EXCLUDED, and not a walk failure: `upsertManagedGitignoreBlock`'s
// pre-publication refusals, including the inverted-marker refusal. They are thrown by
// `stripManagedGitignoreBlock` BEFORE `writeScaffoldFileAtomic` is called at all, so they
// are outside the universal's scope by construction and need no disposition — nothing has
// been published, opened or unlinked when they fire.
const REFUSAL_PATH_WALK = [
  {
    name: 'path inspection: symbolic-link destination',
    disposition: 'retained',
    run: (root: string) => {
      const sentinel = join(root, 'sentinel.txt')
      writeFileSync(sentinel, 'sentinel\n')
      const path = join(root, 'scaffold.yaml')
      symlinkSync(sentinel, path)
      writeScaffoldFileAtomic({ root, path, content: 'replacement\n', force: true })
    },
  },
  {
    name: 'path inspection: FIFO destination',
    disposition: 'retained',
    run: (root: string) => {
      const path = join(root, 'scaffold.yaml')
      execFileSync('mkfifo', [path], { stdio: 'pipe' })
      writeScaffoldFileAtomic({ root, path, content: 'replacement\n', force: true })
    },
  },
  {
    name: 'parent component: symbolic-link parent',
    disposition: 'retained',
    run: (root: string) => {
      const external = join(root, 'external')
      mkdirSync(external)
      const linkedParent = join(root, 'linked-parent')
      symlinkSync(external, linkedParent, 'dir')
      writeScaffoldFileAtomic({
        root,
        path: join(linkedParent, 'nested.yaml'),
        content: 'first\n',
        force: false,
      })
    },
  },
  {
    name: 'parent component: non-directory parent',
    disposition: 'retained',
    run: (root: string) => {
      const blocker = join(root, 'blocker')
      writeFileSync(blocker, 'not a directory\n')
      writeScaffoldFileAtomic({
        root,
        path: join(blocker, 'nested.yaml'),
        content: 'first\n',
        force: false,
      })
    },
  },
  {
    name: 'plan root: destination resolves outside its declared scaffold root',
    disposition: 'retained',
    run: (root: string) => {
      writeScaffoldFileAtomic({
        root: join(root, 'inner'),
        path: join(root, 'outside.yaml'),
        content: 'first\n',
        force: false,
      })
    },
  },
  {
    name: 'retained mode: multiply linked inode',
    disposition: 'retained',
    run: (root: string) => {
      const plan = secretsPlan(root)
      writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })
      linkSync(plan.path, join(root, 'alias.env'))
      writeScaffoldFileAtomic(plan)
    },
  },
  {
    name: 'retained mode: destination disappears after the identity capture',
    disposition: 'retained',
    run: (root: string) => {
      const plan = secretsPlan(root)
      writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })
      writeScaffoldFileAtomic(plan, {
        beforeRetainedModeOpen: () => {
          rmSync(plan.path)
        },
      })
    },
  },
  {
    name: 'retained mode: requested mode not applied',
    disposition: 'retained',
    run: (root: string) => {
      const plan = secretsPlan(root)
      writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })
      writeScaffoldFileAtomic(plan, {
        afterRetainedModeOpen: () => {
          chmodSync(plan.path, 0o644)
        },
      })
    },
  },
  {
    name: 'retained mode: requested mode did not settle',
    disposition: 'retained',
    run: (root: string) => {
      const plan = secretsPlan(root)
      writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })
      writeScaffoldFileAtomic(plan, {
        afterRetainedModeConfirm: () => {
          chmodSync(plan.path, 0o644)
        },
      })
    },
  },
  {
    name: 'durable temporary: creation-path pre-publication mode revert',
    disposition: 'retained',
    run: (root: string) => {
      const plan = secretsPlan(root, { force: false, content: 'API_KEY=abc\n' })
      writeScaffoldFileAtomic(plan, {
        afterTemporaryModeApply: (temporary) => {
          chmodSync(temporary, 0o644)
        },
      })
    },
  },
  {
    // Round-6 gap 3: this is the path the verifier reproduced escaping with NO disposition.
    name: 'durable temporary: replacement-path PRE-RENAME mode revert',
    disposition: 'retained',
    run: (root: string) => {
      const plan = atomicReplacePlan(root)
      writeFileSync(plan.path, 'USERDATA=important\n', { mode: 0o644 })
      writeScaffoldFileAtomic(plan, {
        afterTemporaryModeApply: (temporary) => {
          chmodSync(temporary, 0o644)
        },
      })
    },
  },
  {
    name: 'exclusive publication: path appeared during exclusive create',
    disposition: 'retained',
    run: (root: string) => {
      const path = join(root, 'raced.yaml')
      writeScaffoldFileAtomic({ root, path, content: 'scaffold\n', force: false }, {
        beforeExclusivePublish: () => {
          writeFileSync(path, 'racer\n', { flag: 'wx' })
        },
      })
    },
  },
  {
    name: 'atomic replacement: destination vanishes before the rename',
    disposition: 'retained',
    run: (root: string) => {
      const plan = atomicReplacePlan(root)
      writeFileSync(plan.path, 'API_KEY=abc\n', { mode: 0o644 })
      writeScaffoldFileAtomic(plan, {
        afterTemporaryModeApply: () => {
          rmSync(plan.path)
        },
      })
    },
  },
  {
    name: 'post-publication confirmation: creation path',
    disposition: 'removed',
    run: (root: string) => {
      const plan = secretsPlan(root, { force: false, content: 'API_KEY=abc\n' })
      writeScaffoldFileAtomic(plan, {
        beforeExclusivePublish: () => {
          chmodSync(findInitTemporary(root), 0o644)
        },
      })
    },
  },
  {
    name: 'post-publication confirmation: replacement path',
    disposition: 'removed',
    run: (root: string) => {
      const plan = atomicReplacePlan(root)
      writeFileSync(plan.path, 'USERDATA=important\n', { mode: 0o644 })
      writeScaffoldFileAtomic(plan, {
        beforeAtomicReplacePublish: () => {
          chmodSync(findInitTemporary(root), 0o644)
        },
      })
    },
  },
] as const

describe('every refusal writeScaffoldFileAtomic can raise carries exactly one disposition', () => {
  for (const rootVariant of REFUSAL_WALK_ROOTS) {
    for (const testCase of REFUSAL_PATH_WALK) {
      it.skipIf(isWindows)(
        `${testCase.name} -> ${testCase.disposition} [${rootVariant.name}]`,
        () => {
          const error = capturedRefusal(() => {
            testCase.run(rootVariant.make())
          })
          const appended = moduleAppendedDisposition(error)

          // Exactly one — not "at least one". A backstop layered over an inner wrap that
          // double-appends fails here, and so does a path that escapes bare. Measured on the
          // region the module appended, so a root whose NAME spells the marker cannot inflate
          // the count and a correct implementation is not punished for the caller's bytes.
          expect(dispositionSentenceCount(appended)).toBe(1)

          // The mapping is pinned by name, so the walk asserts WHICH disposition each path
          // carries rather than merely that it carries some disposition.
          const expected = testCase.disposition === 'removed'
            ? REMOVED_DISPOSITION_PATTERN
            : RETAINED_DISPOSITION_PATTERN
          const opposite = testCase.disposition === 'removed'
            ? RETAINED_DISPOSITION_PATTERN
            : REMOVED_DISPOSITION_PATTERN
          expect(appended).toMatch(expected)
          expect(appended).not.toMatch(opposite)

          if (!rootVariant.carriesMarker) {
            // Under an ordinary root nothing but the module can spell a disposition, so the
            // whole message carries exactly the claim the module made. This is round 7's
            // assertion, kept beside the marker-bearing cells rather than replaced by them —
            // the comparison between the two is what makes the pin mean anything.
            const message = errorMessage(error)
            expect(dispositionSentenceCount(message)).toBe(1)
            expect(message).toMatch(expected)
            expect(message).not.toMatch(opposite)
          }
        },
      )
    }
  }

  it.skipIf(isWindows)('walks both dispositions rather than only the retained default', () => {
    // Guards the walk against becoming vacuous: if every case above drifted to the
    // backstop's default, this named assertion fails rather than the walk silently
    // degrading into a single-disposition test.
    const dispositions = new Set(REFUSAL_PATH_WALK.map(entry => entry.disposition))
    expect([...dispositions].sort()).toEqual(['removed', 'retained'])
    expect(REFUSAL_PATH_WALK.length).toBeGreaterThanOrEqual(15)
  })

  it.skipIf(isWindows)('walks marker-bearing roots as well as ordinary ones', () => {
    // Dropping a root variant DELETES cells rather than failing any, so the enumeration is
    // asserted by name — the same style the disposition enumeration above already uses.
    // Without this, the walk's ability to generate its own defeating inputs could evaporate
    // in a later edit and every remaining cell would still report green.
    expect(REFUSAL_WALK_ROOTS.map(variant => variant.name)).toEqual([
      'ordinary root',
      'root directory carrying the disposition lead token',
      'root directory named after the removal sentence',
    ])
    expect(REFUSAL_WALK_ROOTS.filter(variant => variant.carriesMarker)).toHaveLength(2)
  })

  it.skipIf(isWindows)('builds marker-bearing roots that really do spell the marker', () => {
    // Fixture integrity. A root variant that CLAIMS to carry the marker but does not would
    // make its whole column vacuous while still counting as coverage.
    const lead = observedDispositionLead()
    for (const variant of REFUSAL_WALK_ROOTS) {
      expect(variant.make().includes(lead)).toBe(variant.carriesMarker)
    }

    // And the removal-sentence root spells a WHOLE disposition rather than only its lead
    // token, which is what made the round-7 inversion — a retained refusal reading as a
    // destroyed destination — possible in the first place. Looked up by name rather than by
    // index so that dropping the variant fails this assertion instead of crashing on it.
    const removalVariant = REFUSAL_WALK_ROOTS
      .find(variant => variant.name === 'root directory named after the removal sentence')
    expect(removalVariant).toBeDefined()
    const removalRoot = removalVariant!.make()
    expect(removalRoot).toMatch(REMOVED_DISPOSITION_PATTERN)
    expect(removalRoot).not.toMatch(RETAINED_DISPOSITION_PATTERN)
  })
})

// Derived from the module's own behaviour rather than from a duplicated `win32` literal:
// publish a control file that declares a mode and observe whether the module applied it.
function moduleEnforcesModes(): boolean {
  const root = tempRoot()
  const path = join(root, 'mode-enforcement-probe')
  writeFileSync(path, 'probe\n', { mode: 0o644 })
  writeScaffoldFileAtomic({
    root,
    path,
    content: '',
    force: true,
    preserveOnForce: true,
    mode: 0o600,
  })
  return modeBits(path) === 0o600
}

describe('platform-qualified mode-enforcement contract', () => {
  // NOT skipped on any platform. The JSDoc states the mode contract conditionally, so the
  // test asserts the documented behaviour of whichever platform it is running on — the
  // win32 no-op is covered here rather than merely disabled by a `skipIf`.
  it('pins the documented mode-enforcement behaviour of the platform it runs on', () => {
    const enforces = moduleEnforcesModes()

    const root = tempRoot()
    const plan = secretsPlan(root)
    const bytes = 'API_KEY=abc\n'
    writeFileSync(plan.path, bytes, { mode: 0o644 })
    const before = modeBits(plan.path)

    let refusal = ''
    let outcome: ReturnType<typeof writeScaffoldFileAtomic> | undefined
    try {
      outcome = writeScaffoldFileAtomic(plan, {
        afterRetainedModeOpen: () => {
          chmodSync(plan.path, before)
        },
      })
    } catch (error) {
      refusal = (error as Error).message
    }

    if (enforces) {
      // Documented POSIX contract: the revert is detected and the call fails closed,
      // leaving the destination in place with its bytes intact.
      expect(refusal).toMatch(UNAPPLIED_MODE_REASON)
      expect(refusal).toMatch(RETAINED_DISPOSITION_PATTERN)
    } else {
      // Documented win32 no-op: the confirmation hook never fires, nothing is applied and
      // nothing is confirmed, so no refusal is raised and the host's mode is left alone.
      expect(refusal).toBe('')
      expect(outcome).toEqual({ path: plan.path, outcome: 'preserved' })
      expect(modeBits(plan.path)).toBe(before)
    }

    // True on both platforms: a retained credential file is never rewritten.
    expect(readFileSync(plan.path, 'utf8')).toBe(bytes)
  })
})
