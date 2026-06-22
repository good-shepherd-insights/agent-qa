import { describe, expect, it } from 'vitest'

import { deviceConfigSchema } from '../config/device'
import { remoteDeviceSchema } from '../config/remote-device'

describe('remoteDeviceSchema', () => {
  it('rejects remote device configs without a connection URL using a custom issue', () => {
    const result = remoteDeviceSchema.safeParse({ app: 'ref' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(issue => issue.code === 'custom')).toBe(true)
    }
  })

  it('accepts remote device configs with an Appium or WebDriverAgent URL', () => {
    expect(remoteDeviceSchema.safeParse({ appiumUrl: 'http://x' }).success).toBe(true)
    expect(remoteDeviceSchema.safeParse({ webDriverAgentUrl: 'http://x' }).success).toBe(true)
  })

  it('rejects unknown remote device keys', () => {
    expect(remoteDeviceSchema.safeParse({ appiumUrl: 'http://x', unknownKey: 1 }).success).toBe(false)
  })
})

describe('deviceConfigSchema', () => {
  it('accepts local and remote mobile device configs', () => {
    expect(deviceConfigSchema.safeParse({
      name: 'pixel',
      platform: 'android',
      transport: 'local',
      match: {},
    }).success).toBe(true)

    expect(deviceConfigSchema.safeParse({
      name: 'pixel',
      platform: 'android',
      transport: 'remote',
      match: {},
    }).success).toBe(true)
  })

  it('rejects provider-specific transport and web platform values', () => {
    expect(deviceConfigSchema.safeParse({
      name: 'pixel',
      platform: 'android',
      transport: 'browserstack',
      match: {},
    }).success).toBe(false)

    expect(deviceConfigSchema.safeParse({
      name: 'pixel',
      platform: 'web',
      transport: 'local',
      match: {},
    }).success).toBe(false)
  })
})
