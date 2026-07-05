import { describe, expect, it } from 'vitest'

import { resolveBranch, slugBranch } from '../branch-resolver.js'

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
