import { describe, expect, it, vi } from 'vitest'

import {
  createVersionGuard,
  VersionGuardError,
} from '../create-version-guard'
import {
  guardCompletedRunHandoff,
  HandoffVersionError,
} from '../../handoff/load-completed-run-handoff'

interface TestDocument {
  schemaVersion: number
  value: string
}

class CustomVersionError extends Error {
  readonly foundVersion: number
  readonly supportedVersion: number

  constructor(found: number, supported: number) {
    super(`custom ${found}/${supported}`)
    this.name = 'CustomVersionError'
    this.foundVersion = found
    this.supportedVersion = supported
  }
}

describe('createVersionGuard (D-13)', () => {
  it.each([null, undefined, 'document', 1])(
    'rejects non-object input %j with a document-naming TypeError',
    (value) => {
      const guard = createVersionGuard<TestDocument>({
        name: 'Doc',
        current: 2,
        migrations: {},
      })

      expect(() => guard(value)).toThrowError(TypeError)
      expect(() => guard(value)).toThrow('Doc must be an object')
    },
  )

  it.each([
    {},
    { schemaVersion: '1' },
    { schemaVersion: Number.NaN },
    { schemaVersion: Number.POSITIVE_INFINITY },
  ])('requires a finite numeric schemaVersion for %j', (value) => {
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
    })

    expect(() => guard(value)).toThrowError(TypeError)
    expect(() => guard(value)).toThrow('Doc requires a numeric schemaVersion')
  })

  it('rejects newer documents with a typed VersionGuardError', () => {
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
    })

    let thrown: unknown
    try {
      guard({ schemaVersion: 3, value: 'future' })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(VersionGuardError)
    const error = thrown as VersionGuardError
    expect(error.name).toBe('VersionGuardError')
    expect(error.message).toBe(
      'Doc schemaVersion 3 is not supported (this build supports 2)',
    )
    expect(error.documentName).toBe('Doc')
    expect(error.foundVersion).toBe(3)
    expect(error.supportedVersion).toBe(2)
  })

  it('walks a registered migration and passes it the original document', () => {
    const original = { schemaVersion: 1, value: 'before' }
    const migrated: TestDocument = { schemaVersion: 2, value: 'after' }
    const migration = vi.fn(() => migrated)
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: { 1: migration },
    })

    expect(guard(original)).toBe(migrated)
    expect(migration).toHaveBeenCalledOnce()
    expect(migration).toHaveBeenCalledWith(original)
  })

  it('rejects an older document when a migration step is missing', () => {
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
    })

    expect(() => guard({ schemaVersion: 1, value: 'old' })).toThrowError(
      VersionGuardError,
    )

    try {
      guard({ schemaVersion: 1, value: 'old' })
    } catch (error) {
      expect(error).toMatchObject({
        documentName: 'Doc',
        foundVersion: 1,
        supportedVersion: 2,
      })
    }
  })

  it('casts a current-version document through unchanged', () => {
    const current: TestDocument = { schemaVersion: 2, value: 'current' }
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
    })

    expect(guard(current)).toBe(current)
  })

  it('uses the configured error constructor for version failures', () => {
    const guard = createVersionGuard<TestDocument>({
      name: 'Doc',
      current: 2,
      migrations: {},
      error: CustomVersionError,
    })

    expect(() => guard({ schemaVersion: 3, value: 'future' })).toThrowError(
      CustomVersionError,
    )
    expect(() => guard({ schemaVersion: 1, value: 'old' })).toThrowError(
      CustomVersionError,
    )
  })
})

describe('guardCompletedRunHandoff factory instance compatibility', () => {
  it('preserves the HandoffVersionError name, message, and version fields', () => {
    let thrown: unknown
    try {
      guardCompletedRunHandoff({ schemaVersion: 3 })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(HandoffVersionError)
    expect(thrown).toBeInstanceOf(VersionGuardError)
    expect(thrown).toMatchObject({
      name: 'HandoffVersionError',
      message:
        'CompletedRunHandoff schemaVersion 3 is not supported (this build supports 2)',
      foundVersion: 3,
      supportedVersion: 2,
    })
  })
})
