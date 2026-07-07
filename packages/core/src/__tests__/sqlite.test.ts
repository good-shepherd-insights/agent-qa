import { describe, expect, it, vi } from 'vitest'
import {
  BetterSqlite3AbiMismatchError,
  createBetterSqlite3Database,
  isBetterSqlite3AbiMismatch,
  isBetterSqlite3NativeModuleError,
  isBetterSqlite3NodeGypSymlinkConflict,
  resolveBetterSqliteRebuildCommand,
} from '../sqlite.js'

describe('isBetterSqlite3AbiMismatch', () => {
  it('returns true for ABI mismatch errors', () => {
    const error = new Error(`The module 'better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127.`)
    expect(isBetterSqlite3AbiMismatch(error)).toBe(true)
  })

  it('returns false for unrelated errors', () => {
    expect(isBetterSqlite3AbiMismatch(new Error('Cannot find module better-sqlite3'))).toBe(false)
  })
})

describe('isBetterSqlite3NativeModuleError', () => {
  it('returns true for missing bindings errors', () => {
    const error = new Error('Could not locate the bindings file. Tried:\n -> /tmp/better_sqlite3.node')
    expect(isBetterSqlite3NativeModuleError(error)).toBe(true)
  })

  it('returns true for missing bindings errors with node-v137 binding paths', () => {
    const error = new Error(
      'Could not locate the bindings file. Tried:\n' +
      ' -> /tmp/sqlite3/lib/binding/node-v137-darwin-arm64/better_sqlite3.node',
    )
    expect(isBetterSqlite3NativeModuleError(error)).toBe(true)
  })

  it('returns true for dlopen missing file errors after a stale partial build', () => {
    const error = new Error(
      'dlopen(/tmp/build/Release/better_sqlite3.node, 0x0001): tried: ' +
      "'/tmp/build/Release/better_sqlite3.node' (no such file)",
    )
    expect(isBetterSqlite3NativeModuleError(error)).toBe(true)
  })

  it('returns true for ABI mismatch errors', () => {
    const error = new Error(`The module 'better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127.`)
    expect(isBetterSqlite3NativeModuleError(error)).toBe(true)
  })

  it('returns false for unrelated missing module errors', () => {
    expect(isBetterSqlite3NativeModuleError(new Error('Cannot find module better-sqlite3'))).toBe(false)
  })
})

describe('isBetterSqlite3NodeGypSymlinkConflict', () => {
  it('returns true for node-gyp python symlink conflicts during rebuild', () => {
    const error = new Error("gyp ERR! stack Error: EEXIST: file already exists, symlink '/opt/homebrew/bin/python3' -> '/tmp/better-sqlite3/build/node_gyp_bins/python3'")
    expect(isBetterSqlite3NodeGypSymlinkConflict(error)).toBe(true)
  })

  it('returns false for unrelated rebuild failures', () => {
    expect(isBetterSqlite3NodeGypSymlinkConflict(new Error('gyp ERR! build error'))).toBe(false)
  })
})

describe('resolveBetterSqliteRebuildCommand', () => {
  it('runs the installed package build script in place with the active Node runtime', () => {
    const command = resolveBetterSqliteRebuildCommand()
    expect(command.command).toBeTypeOf('string')
    expect(command.command.length).toBeGreaterThan(0)
    expect(command.args.slice(-2)).toEqual(['run', 'build-release'])
  })
})

describe('createBetterSqlite3Database fail-fast on ABI/bindings mismatch', () => {
  const ABI_MISMATCH_MESSAGE =
    "The module 'better_sqlite3.node' was compiled against a different Node.js version using NODE_MODULE_VERSION 127."
  const MISSING_BINDINGS_MESSAGE =
    'Could not locate the bindings file. Tried:\n -> /tmp/better_sqlite3.node'

  it('throws a typed, actionable error on an ABI mismatch WITHOUT invoking any rebuild', () => {
    const rebuild = vi.fn()
    const open = vi.fn(() => {
      throw new Error(ABI_MISMATCH_MESSAGE)
    })

    const start = Date.now()
    let caught: unknown
    try {
      createBetterSqlite3Database(':memory:', { open, rebuild })
    } catch (error) {
      caught = error
    }
    const elapsed = Date.now() - start

    expect(caught).toBeInstanceOf(BetterSqlite3AbiMismatchError)
    expect((caught as Error).message).toContain('pnpm rebuild better-sqlite3')
    // rebuild seam is NEVER reached from the run open path
    expect(rebuild).not.toHaveBeenCalled()
    // the open seam is not retried after the typed throw
    expect(open).toHaveBeenCalledTimes(1)
    // the throw is effectively immediate — no Atomics.wait lock spin
    expect(elapsed).toBeLessThan(1000)
  })

  it('throws a typed, actionable error on a missing-bindings error WITHOUT invoking any rebuild', () => {
    const rebuild = vi.fn()
    const open = vi.fn(() => {
      throw new Error(MISSING_BINDINGS_MESSAGE)
    })

    let caught: unknown
    try {
      createBetterSqlite3Database(':memory:', { open, rebuild })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(BetterSqlite3AbiMismatchError)
    expect((caught as Error).message).toContain('pnpm rebuild better-sqlite3')
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('rethrows an unrelated open error unchanged (no typed remap, no rebuild)', () => {
    const rebuild = vi.fn()
    const unrelated = new Error('SQLITE_CANTOPEN: unable to open database file')
    const open = vi.fn(() => {
      throw unrelated
    })

    let caught: unknown
    try {
      createBetterSqlite3Database('/nope/db.sqlite', { open, rebuild })
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(unrelated)
    expect(caught).not.toBeInstanceOf(BetterSqlite3AbiMismatchError)
    expect(rebuild).not.toHaveBeenCalled()
  })

  it('returns the database handle on the happy path', () => {
    const handle = { closed: false } as unknown as ReturnType<typeof createBetterSqlite3Database>
    const rebuild = vi.fn()
    const open = vi.fn(() => handle)

    const result = createBetterSqlite3Database(':memory:', { open, rebuild })

    expect(result).toBe(handle)
    expect(rebuild).not.toHaveBeenCalled()
  })
})
