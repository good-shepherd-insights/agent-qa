import { describe, expect, it, vi } from 'vitest'

import { resolveBranch, runGitSymbolicRef, slugBranch } from '../branch-resolver.js'

describe('resolveBranch', () => {
  it('reads the current branch from .git/HEAD (injected)', () => {
    const { currentBranch } = resolveBranch({
      readHead: () => 'ref: refs/heads/feature/login\n',
      runSymbolicRef: () => 'refs/remotes/origin/main\n',
    })
    expect(currentBranch).toBe('feature/login')
  })

  it('reads the remote default from git symbolic-ref (injected)', () => {
    const { defaultBranch } = resolveBranch({
      readHead: () => 'ref: refs/heads/feature/login\n',
      runSymbolicRef: () => 'refs/remotes/origin/develop\n',
    })
    expect(defaultBranch).toBe('develop')
  })

  it('falls back to the configured default when neither resolves (git-less)', () => {
    const resolved = resolveBranch({
      readHead: () => null,
      runSymbolicRef: () => null,
      configuredDefault: 'trunk',
    })
    expect(resolved).toEqual({ currentBranch: 'trunk', defaultBranch: 'trunk' })
  })

  it('falls back to main when neither resolves and no configured default', () => {
    const resolved = resolveBranch({ readHead: () => null, runSymbolicRef: () => null })
    expect(resolved).toEqual({ currentBranch: 'main', defaultBranch: 'main' })
  })

  it('treats a detached HEAD (raw sha) as the default branch', () => {
    const { currentBranch } = resolveBranch({
      readHead: () => 'a1b2c3d4e5f6\n',
      runSymbolicRef: () => 'refs/remotes/origin/main\n',
    })
    expect(currentBranch).toBe('main')
  })

  it('does not throw when the injected readers throw (git-less dir)', () => {
    expect(() =>
      resolveBranch({
        readHead: () => {
          throw new Error('ENOENT')
        },
        runSymbolicRef: () => {
          throw new Error('not a git repo')
        },
        configuredDefault: 'main',
      }),
    ).not.toThrow()
  })
})

type ExecSeam = (command: string, args: string[], options: { cwd: string; timeout: number }) => string

describe('runGitSymbolicRef', () => {
  it('passes a finite timeout (ms) to the injected exec', () => {
    const exec = vi.fn<ExecSeam>(() => 'refs/remotes/origin/main\n')
    runGitSymbolicRef('/repo', { exec })
    expect(exec).toHaveBeenCalledTimes(1)
    const [command, args, execOptions] = exec.mock.calls[0]
    expect(command).toBe('git')
    expect(args).toEqual(['symbolic-ref', 'refs/remotes/origin/HEAD'])
    expect(execOptions).toMatchObject({ cwd: '/repo' })
    expect(typeof execOptions.timeout).toBe('number')
    expect(execOptions.timeout).toBeGreaterThan(0)
    expect(Number.isFinite(execOptions.timeout)).toBe(true)
  })

  it('honours a caller-supplied timeoutMs', () => {
    const exec = vi.fn<ExecSeam>(() => 'refs/remotes/origin/main\n')
    runGitSymbolicRef('/repo', { exec, timeoutMs: 1234 })
    const [, , execOptions] = exec.mock.calls[0]
    expect(execOptions.timeout).toBe(1234)
  })

  it('returns null when the git call times out (ETIMEDOUT degrades)', () => {
    const exec = vi.fn<ExecSeam>(() => {
      throw Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' })
    })
    expect(runGitSymbolicRef('/repo', { exec })).toBeNull()
  })

  it('returns null when the git call is killed by signal', () => {
    const exec = vi.fn<ExecSeam>(() => {
      throw Object.assign(new Error('killed'), { signal: 'SIGTERM' })
    })
    expect(runGitSymbolicRef('/repo', { exec })).toBeNull()
  })

  it('returns the branch ref on success', () => {
    const exec = vi.fn<ExecSeam>(() => 'refs/remotes/origin/develop\n')
    expect(runGitSymbolicRef('/repo', { exec })).toBe('refs/remotes/origin/develop\n')
  })
})

describe('resolveBranch git timeout degradation', () => {
  it('falls back to the configured default when the git symbolic-ref times out', () => {
    const resolved = resolveBranch({
      readHead: () => null,
      runSymbolicRef: () =>
        runGitSymbolicRef('/repo', {
          exec: () => {
            throw Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })
          },
        }),
      configuredDefault: 'trunk',
    })
    expect(resolved).toEqual({ currentBranch: 'trunk', defaultBranch: 'trunk' })
  })
})

describe('slugBranch', () => {
  it('neutralizes `/` into a single safe segment', () => {
    const slug = slugBranch('feature/login')
    expect(slug).toBe('feature-login')
    expect(slug).not.toContain('/')
  })

  it('neutralizes `..` so a branch cannot escape the cache root', () => {
    const slug = slugBranch('../../etc/passwd')
    expect(slug).not.toContain('..')
    expect(slug).not.toContain('/')
    expect(slug.startsWith('.')).toBe(false)
  })

  it('strips control characters', () => {
    const slug = slugBranch('feat\u0007ure')
    expect(slug).toBe('feature')
  })

  it('preserves ordinary branch names with dots and dashes', () => {
    expect(slugBranch('release-1.2.x')).toBe('release-1.2.x')
  })

  it('never yields an empty, dot, or dot-dot segment', () => {
    for (const input of ['', '.', '..', '/', '///', '...']) {
      const slug = slugBranch(input)
      expect(slug).not.toBe('')
      expect(slug).not.toBe('.')
      expect(slug).not.toBe('..')
      expect(slug).not.toContain('/')
    }
  })
})
