import { mkdirSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  DEFAULT_AGENT_QA_RUNS_DB_PATH,
  LEGACY_AGENT_QA_DASHBOARD_DB_PATH,
  locateRunsDbPath,
} from '@vostride/agent-qa-core'

const RUNS_DB_PATH_FALLBACK = DEFAULT_AGENT_QA_RUNS_DB_PATH || '.agent-qa/runs.db'
const LEGACY_DB_PATH_FALLBACK = LEGACY_AGENT_QA_DASHBOARD_DB_PATH || '.agent-qa/dashboard.db'

export interface ResolveDashboardDbPathOptions {
  configDir: string
  configuredDbPath?: string
}

// The writer's resolver: the reader's `locateRunsDbPath`, plus the one-time legacy rename.
export function resolveDashboardDbPath({
  configDir,
  configuredDbPath,
}: ResolveDashboardDbPathOptions): string {
  const located = locateRunsDbPath(configDir, configuredDbPath)
  const legacyPath = resolve(configDir, LEGACY_DB_PATH_FALLBACK)
  if (configuredDbPath?.trim() || located !== legacyPath) return located

  const defaultPath = resolve(configDir, RUNS_DB_PATH_FALLBACK)
  mkdirSync(dirname(defaultPath), { recursive: true })
  renameSync(legacyPath, defaultPath)
  return defaultPath
}
