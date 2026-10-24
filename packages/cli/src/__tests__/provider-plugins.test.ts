import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearLoadedProviderPluginModules } from '@vostride/agent-qa-core'
import { clearProviderRegistry, getProvider } from '@vostride/agent-qa-model'
import { loadProviderPluginsForRawConfig } from '../provider-plugins.js'

async function withTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-qa-cli-provider-plugin-'))
}

describe('loadProviderPluginsForRawConfig', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const tempDirs: string[] = []

  afterEach(async () => {
    clearProviderRegistry()
    clearLoadedProviderPluginModules()
    warnSpy.mockClear()
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('loads a provider plugin descriptor and registers it in the model registry', async () => {
    const tempDir = await withTempDir()
    tempDirs.push(tempDir)
    const pluginPath = join(tempDir, 'test-gateway.mjs')
    await writeFile(pluginPath, `
      export default {
        id: 'test-gateway',
        label: 'Test Gateway',
        needsBaseURL: true,
        authModes: ['api-key'],
        adapter(transport, modelId) {
          return { transport, modelId, source: 'test-gateway' }
        },
      }
    `)

    await loadProviderPluginsForRawConfig(
      { plugins: { providers: [{ path: pluginPath }] } },
      join(tempDir, 'agent-qa.config.yaml'),
    )

    const registered = getProvider('test-gateway')
    expect(registered).toEqual(expect.objectContaining({
      id: 'test-gateway',
      label: 'Test Gateway',
      needsBaseURL: true,
      authModes: ['api-key'],
    }))
    expect(registered?.adapter({ baseURL: 'https://gateway.example' }, 'demo-model')).toEqual({
      transport: { baseURL: 'https://gateway.example' },
      modelId: 'demo-model',
      source: 'test-gateway',
    })
  })

  it('registers descriptors in declaration order so later providers win', async () => {
    const tempDir = await withTempDir()
    tempDirs.push(tempDir)
    const firstPath = join(tempDir, 'first-gateway.mjs')
    const secondPath = join(tempDir, 'second-gateway.mjs')
    await writeFile(firstPath, `
      export default {
        id: 'test-gateway',
        label: 'First Gateway',
        needsBaseURL: true,
        authModes: ['api-key'],
        adapter() { return { source: 'first' } },
      }
    `)
    await writeFile(secondPath, `
      export default {
        id: 'test-gateway',
        label: 'Second Gateway',
        needsBaseURL: false,
        authModes: ['none'],
        adapter() { return { source: 'second' } },
      }
    `)

    await loadProviderPluginsForRawConfig(
      { plugins: { providers: [{ path: firstPath }, { path: secondPath }] } },
      join(tempDir, 'agent-qa.config.yaml'),
    )

    const registered = getProvider('test-gateway')
    expect(registered).toEqual(expect.objectContaining({
      id: 'test-gateway',
      label: 'Second Gateway',
      needsBaseURL: false,
      authModes: ['none'],
    }))
    expect(registered?.adapter({}, 'demo-model')).toEqual({ source: 'second' })
  })
})
