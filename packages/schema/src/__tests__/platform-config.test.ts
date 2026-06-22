import { describe, expect, it } from 'vitest'
import { platformConfigSchema } from '../config/platform-config'

describe('platformConfigSchema', () => {
  it('accepts valid web config', () => {
    const result = platformConfigSchema.safeParse({
      platform: 'web',
      browser: { name: 'chromium' },
      model: { vision: true },
    })

    expect(result.success).toBe(true)
  })

  it('rejects web config with mobile-only bundleId', () => {
    const result = platformConfigSchema.safeParse({
      platform: 'web',
      browser: { name: 'chromium' },
      model: { vision: true },
      bundleId: 'com.x',
    })

    expect(result.success).toBe(false)
  })

  it('accepts valid android config with remoteDevice URL', () => {
    const result = platformConfigSchema.safeParse({
      platform: 'android',
      device: { name: 'pixel', platform: 'android', transport: 'remote', match: {} },
      model: { vision: true },
      bundleId: 'com.x',
      remoteDevice: { appiumUrl: 'http://x' },
    })

    expect(result.success).toBe(true)
  })

  it('rejects android config with web-only browser key', () => {
    const result = platformConfigSchema.safeParse({
      platform: 'android',
      device: { name: 'pixel', platform: 'android', transport: 'remote', match: {} },
      model: { vision: true },
      browser: { name: 'chromium' },
    })

    expect(result.success).toBe(false)
  })

  it('rejects remoteDevice without a connection URL', () => {
    const result = platformConfigSchema.safeParse({
      platform: 'android',
      device: { name: 'pixel', platform: 'android', transport: 'remote', match: {} },
      model: { vision: true },
      remoteDevice: { app: 'ref' },
    })

    expect(result.success).toBe(false)
  })

  it('rejects unknown platform discriminants', () => {
    const result = platformConfigSchema.safeParse({
      platform: 'desktop',
      browser: { name: 'chromium' },
      model: { vision: true },
    })

    expect(result.success).toBe(false)
  })
})
