import { resolve } from 'node:path'

export interface RecordingSetting {
  enabled: boolean
  keepFailuresOnly: boolean
}

export const RECORDING_STAGING_DIRNAME = 'recording-staging'

export function resolveRecordingSetting(
  flag: boolean | undefined,
  config: Partial<RecordingSetting> | undefined,
  meta?: boolean,
): RecordingSetting {
  return {
    enabled: meta ?? flag ?? config?.enabled ?? true,
    keepFailuresOnly: config?.keepFailuresOnly ?? false,
  }
}

export function resolveRecordingStagingDir(configDir: string): string {
  return resolve(configDir, '.agent-qa', RECORDING_STAGING_DIRNAME)
}
