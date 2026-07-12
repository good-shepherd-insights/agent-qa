import path from 'node:path'

export const DEFAULT_MEMORY_DIR = 'agent-qa-memory'

// v1 memory subsystem internal defaults — the config surface was retired in v51 Phase 373
// (KDIR-03); the subsystem itself runs on these until its Phase 382 deletion.
// Plan 373-04 swaps cli readers onto this const.
export const V1_MEMORY_DEFAULTS = {
  enabled: true,
  provider: 'local',
  dir: DEFAULT_MEMORY_DIR,
  minTrust: 0.3,
  maxInjections: 3,
  curatorEnabled: true,
  curatorLockTimeout: 120_000,
  trustConfirmDelta: 0.05,
  trustContradictDelta: 0.10,
} as const

export interface MemoryRootConfig {
  services?: {
    memory?: {
      dir?: string
    }
  }
}

export function resolveMemoryRoot(config: MemoryRootConfig | undefined, configDir: string): string {
  const memoryDir = config?.services?.memory?.dir ?? DEFAULT_MEMORY_DIR
  return path.isAbsolute(memoryDir) ? path.normalize(memoryDir) : path.resolve(configDir, memoryDir)
}
