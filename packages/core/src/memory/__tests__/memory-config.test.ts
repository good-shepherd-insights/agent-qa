import { describe, it, expect } from 'vitest'
import { DEFAULT_MEMORY_DIR, V1_MEMORY_DEFAULTS, resolveMemoryRoot } from '../config.js'

// The MemoryConfigSchema config surface was retired in Phase 373 (KDIR-03) — the v1 memory
// subsystem itself runs on V1_MEMORY_DEFAULTS until its Phase 382 deletion.

describe('V1_MEMORY_DEFAULTS', () => {
  it('carries the nine former schema defaults for the v1 subsystem', () => {
    expect(V1_MEMORY_DEFAULTS).toEqual({
      enabled: true,
      provider: 'local',
      dir: DEFAULT_MEMORY_DIR,
      minTrust: 0.3,
      maxInjections: 3,
      curatorEnabled: true,
      curatorLockTimeout: 120_000,
      trustConfirmDelta: 0.05,
      trustContradictDelta: 0.10,
    })
  })
})

describe('resolveMemoryRoot', () => {
  it('resolves the default memory root from the config directory', () => {
    expect(resolveMemoryRoot({}, '/workspace/project')).toBe('/workspace/project/agent-qa-memory')
  })

  it('resolves a relative custom memory root from the config directory', () => {
    expect(
      resolveMemoryRoot({ services: { memory: { dir: '.agent-qa/custom-memory' } } }, '/workspace/project'),
    ).toBe('/workspace/project/.agent-qa/custom-memory')
  })

  it('preserves an absolute custom memory root', () => {
    expect(
      resolveMemoryRoot({ services: { memory: { dir: '/var/tmp/agent-qa-memory' } } }, '/workspace/project'),
    ).toBe('/var/tmp/agent-qa-memory')
  })
})
