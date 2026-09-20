import { resolve } from 'node:path'
import type { AgentQaConfig } from '@vostride/agent-qa-core'

export interface RecordingSetting {
  enabled: boolean
  keepFailuresOnly: boolean
}

export const RECORDING_STAGING_DIRNAME = 'recording-staging'

export function resolveRecordingSetting(
  flag: boolean | undefined,
  config: NonNullable<AgentQaConfig['services']>['recording'],
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
