import { CURRENT_HANDOFF_SCHEMA_VERSION } from './completed-run-handoff'
import type { CompletedRunHandoff } from './completed-run-handoff'

/**
 * Thrown when a stored handoff declares a `schemaVersion` this build cannot consume:
 * either newer than {@link CURRENT_HANDOFF_SCHEMA_VERSION} (forward-incompatible) or an
 * older version with no registered migration (D-19, §A8 version discipline).
 */
export class HandoffVersionError extends Error {
  readonly foundVersion: number
  readonly supportedVersion: number

  constructor(found: number, supported: number) {
    super(`CompletedRunHandoff schemaVersion ${found} is not supported (this build supports ${supported})`)
    this.name = 'HandoffVersionError'
    this.foundVersion = found
    this.supportedVersion = supported
  }
}

/**
 * The older-version migration seam (D-19). Maps a source `schemaVersion` to a function
 * that upgrades a document of that version to the next. Empty at v1 — the first schema
 * version has no older versions to migrate — but the seam exists so every future consumer
 * imports the ONE guard instead of re-implementing the version rule.
 */
export const HANDOFF_MIGRATIONS: Record<number, (doc: unknown) => unknown> = {}

/**
 * The read side of the handoff version discipline (D-19): parse → version check →
 * reject-newer-than-known with a typed {@link HandoffVersionError} → migrate-older through
 * {@link HANDOFF_MIGRATIONS}. Pure — no fs (the runner-local fs leg lands in Plan 07 and
 * delegates here). Every future handoff consumer routes through this one guard.
 */
export function guardCompletedRunHandoff(value: unknown): CompletedRunHandoff {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('CompletedRunHandoff must be an object')
  }

  const version = (value as { schemaVersion?: unknown }).schemaVersion
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new TypeError('CompletedRunHandoff requires a numeric schemaVersion')
  }

  if (version > CURRENT_HANDOFF_SCHEMA_VERSION) {
    throw new HandoffVersionError(version, CURRENT_HANDOFF_SCHEMA_VERSION)
  }

  let migrated: unknown = value
  for (let from = version; from < CURRENT_HANDOFF_SCHEMA_VERSION; from++) {
    const migrate = HANDOFF_MIGRATIONS[from]
    if (migrate === undefined) {
      throw new HandoffVersionError(version, CURRENT_HANDOFF_SCHEMA_VERSION)
    }
    migrated = migrate(migrated)
  }

  return migrated as CompletedRunHandoff
}
