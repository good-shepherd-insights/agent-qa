import { describe, expect, it } from 'vitest'
import { AgentQaConfigSchema } from '@vostride/agent-qa-core'
import { buildDefaultConfig } from '../commands/init.js'

const SCREENSHOT_SIZE_BYTES = 256 * 1024
const EXPECTED_TIMEOUT_MS = {
  step: 1200000,
  test: 5400000,
  navigation: 120000,
}

function parseGeneratedConfig(config: Record<string, unknown>) {
  const result = AgentQaConfigSchema.safeParse(config)
  if (!result.success) {
    throw new Error(JSON.stringify(result.error.issues, null, 2))
  }
  return result.data
}

function expectCompressionDefaults(config: Record<string, unknown>): void {
  const parsed = parseGeneratedConfig(config)
  expect(parsed.registry?.llms.length).toBeGreaterThan(0)
  expect(parsed.services?.vision?.screenshotSize).toBe(SCREENSHOT_SIZE_BYTES)
  expect(parsed.services?.vision?.effectiveResolution).toBe(768)
  for (const llm of parsed.registry?.llms ?? []) {
    expect(llm).not.toHaveProperty('screenshotSize')
    expect(llm).not.toHaveProperty('effectiveResolution')
  }
}

describe('init generated config schema compatibility', () => {
  it.each(['web', 'android', 'ios', 'web+android'] as const)(
    'generates schema-valid %s config',
    (platform) => {
      const config = buildDefaultConfig(
        platform,
        'anthropic-subscription',
        'claude-sonnet-4-6',
      )

      const parsed = parseGeneratedConfig(config)
      expectCompressionDefaults(config)
      expect(parsed.services?.recording?.enabled).toBe(true)
      expect(parsed.services?.authState?.dir).toBe('.agent-qa/auth-states')
      expect(parsed.services?.memory?.enabled).toBe(true)
      expect(parsed.services?.memory?.provider).toBe('local')
      expect(parsed.services?.memory?.dir).toBe('agent-qa-memory')
      expect(parsed.use?.timeout).toEqual(EXPECTED_TIMEOUT_MS)
      expect(parsed.use?.logCapture?.console).toBe(true)
      expect(parsed.use?.logCapture?.network).toBe(true)
      expect(parsed.use?.parallel).toBe(false)
      if (platform === 'web' || platform === 'web+android') {
        expect(parsed.use?.browser?.viewport).toEqual({ width: 1280, height: 720 })
        expect(parsed.registry?.targets?.['automation-exercise']).toEqual({
          platform: 'web',
          url: 'https://automationexercise.com',
        })
      }
    },
  )

  it('generates schema-valid dual subscription config', () => {
    const config = buildDefaultConfig('web', [
      { name: 'codex', provider: 'openai-subscription', model: 'gpt-5.5' },
      { name: 'claude-subscription', provider: 'anthropic-subscription', model: 'claude-sonnet-4-6' },
    ])

    const parsed = parseGeneratedConfig(config)
    expect(parsed.use?.llm).toBe('codex')
    expect(parsed.services?.recording?.enabled).toBe(true)
    expect(parsed.services?.authState?.dir).toBe('.agent-qa/auth-states')
    expect(parsed.services?.memory?.enabled).toBe(true)
    expect(parsed.services?.memory?.provider).toBe('local')
    expect(parsed.services?.memory?.dir).toBe('agent-qa-memory')
    expect(parsed.use?.timeout).toEqual(EXPECTED_TIMEOUT_MS)
    expect(parsed.use?.browser?.viewport).toEqual({ width: 1280, height: 720 })
    expect(parsed.use?.logCapture?.console).toBe(true)
    expect(parsed.use?.logCapture?.network).toBe(true)
    expect(parsed.use?.parallel).toBe(false)
    expect(parsed.plugins?.auth).toEqual([
      { package: '@vostride/agent-qa-subscription-auth' },
    ])
    expectCompressionDefaults(config)
  })

  it('emits identical timeout defaults for subscription and compatible baseURL configs', () => {
    const subscriptionConfig = buildDefaultConfig(
      'web',
      'anthropic-subscription',
      'claude-sonnet-4-6',
    )
    const compatibleConfig = buildDefaultConfig(
      'web',
      'openai-compatible',
      'deepseek-chat',
      'https://remote.example/api/v1',
    )

    const subscriptionParsed = parseGeneratedConfig(subscriptionConfig)
    const compatibleParsed = parseGeneratedConfig(compatibleConfig)

    expect(subscriptionParsed.use?.timeout).toEqual(EXPECTED_TIMEOUT_MS)
    expect(compatibleParsed.use?.timeout).toEqual(subscriptionParsed.use?.timeout)
  })
})
