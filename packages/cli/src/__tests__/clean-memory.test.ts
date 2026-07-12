import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCleanMemoryCommand } from '../commands/clean-memory.js'

const tempDirs: string[] = []

async function runCleanMemory(configPath: string): Promise<void> {
  const program = new Command()
  program.exitOverride()
  program.option('--config <path>', 'config file path', configPath)
  program.addCommand(createCleanMemoryCommand())
  await program.parseAsync(['node', 'agent-qa', '--config', configPath, 'clean-memory', '--yes'])
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('clean-memory command', () => {
  it('cleans orphaned directories from the internal default memory root — the config dir surface is retired (Phase 373, KDIR-03)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-qa-clean-memory-'))
    tempDirs.push(root)
    const configPath = join(root, 'agent-qa.config.yaml')
    await writeFile(configPath, [
      'workspace:',
      '  testMatch: ["tests/**/*.yaml"]',
      '  suiteMatch: ["suites/**/*.suite.yaml"]',
      '  hooksFile: hooks.yaml',
      '  envFile: .env',
      '  secretsFile: .env.secrets.local',
      'use:',
      '  mobile:',
      '    appState: preserve',
      'registry:',
      '  targets:',
      '    app:',
      '      platform: web',
      '      url: https://example.com',
      '      product: expected-product',
      '',
    ].join('\n'))
    await Promise.all([
      writeFile(join(root, 'hooks.yaml'), 'hooks: []\n'),
      writeFile(join(root, '.env'), ''),
      writeFile(join(root, '.env.secrets.local'), ''),
      mkdir(join(root, 'agent-qa-memory/products/stale-default'), { recursive: true }),
      mkdir(join(root, '.agent-qa/custom-memory/products/stale-stray'), { recursive: true }),
    ])
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await runCleanMemory(configPath)

    expect(existsSync(join(root, 'agent-qa-memory/products/stale-default'))).toBe(false)
    expect(existsSync(join(root, '.agent-qa/custom-memory/products/stale-stray'))).toBe(true)
  })
})
