/** A source-version keyed sequence of one-version-at-a-time migrations (D-13). */
export type MigrationRegistry = Record<number, (doc: unknown) => unknown>

export interface VersionGuardConfig<T> {
  name: string
  current: number
  migrations: MigrationRegistry
  error?: new (found: number, supported: number) => Error
}

/** Typed rejection shared by every schema-versioned document guard (D-13). */
export class VersionGuardError extends Error {
  readonly documentName: string
  readonly foundVersion: number
  readonly supportedVersion: number

  constructor(documentName: string, found: number, supported: number) {
    super(
      `${documentName} schemaVersion ${found} is not supported (this build supports ${supported})`,
    )
    this.name = 'VersionGuardError'
    this.documentName = documentName
    this.foundVersion = found
    this.supportedVersion = supported
  }
}

/**
 * Builds the ONE parse → reject-newer → migration-walk → cast version guard flow (D-13).
 */
export function createVersionGuard<T>(config: VersionGuardConfig<T>): (value: unknown) => T {
  const versionError = (found: number): Error =>
    config.error === undefined
      ? new VersionGuardError(config.name, found, config.current)
      : new config.error(found, config.current)

  return (value: unknown): T => {
    if (value === null || typeof value !== 'object') {
      throw new TypeError(`${config.name} must be an object`)
    }

    const version = (value as { schemaVersion?: unknown }).schemaVersion
    if (typeof version !== 'number' || !Number.isFinite(version)) {
      throw new TypeError(`${config.name} requires a numeric schemaVersion`)
    }

    if (version > config.current) {
      throw versionError(version)
    }

    let migrated: unknown = value
    for (let from = version; from < config.current; from++) {
      const migrate = config.migrations[from]
      if (migrate === undefined) {
        throw versionError(version)
      }
      migrated = migrate(migrated)
    }

    return migrated as T
  }
}
