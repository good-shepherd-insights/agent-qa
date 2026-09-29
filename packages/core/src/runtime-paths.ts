import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const DEFAULT_AGENT_QA_RUNTIME_DIR = '.agent-qa'
export const DEFAULT_AGENT_QA_ARTIFACTS_DIR = '.agent-qa/artifacts'
export const DEFAULT_AGENT_QA_CACHE_DIR = '.agent-qa/cache'
export const DEFAULT_AGENT_QA_AUTH_STATES_DIR = '.agent-qa/auth-states'
export const DEFAULT_AGENT_QA_SCREENSHOTS_DIR = '.agent-qa/artifacts/screenshots'
export const DEFAULT_AGENT_QA_VIDEOS_DIR = '.agent-qa/artifacts/videos'
export const DEFAULT_AGENT_QA_RUNS_DB_PATH = '.agent-qa/runs.db'
export const LEGACY_AGENT_QA_DASHBOARD_DB_PATH = '.agent-qa/dashboard.db'

/**
 * The runs database a config names, without migrating anything: the configured path, else the
 * default, else a legacy dashboard.db nothing has renamed yet. The writer's resolver renames that
 * legacy file on top of this; the CLI reader binds only the configured or default path.
 */
export function locateRunsDbPath(configDir: string, configuredDbPath?: string): string {
  const configured = configuredDbPath?.trim()
  if (configured) return resolve(configDir, configured)
  const defaultPath = resolve(configDir, DEFAULT_AGENT_QA_RUNS_DB_PATH)
  const legacyPath = resolve(configDir, LEGACY_AGENT_QA_DASHBOARD_DB_PATH)
  return !existsSync(defaultPath) && existsSync(legacyPath) ? legacyPath : defaultPath
}
