import { z } from 'zod'

export interface DeviceConfig {
  name: string
  platform: 'android' | 'ios'
  transport: 'local' | 'remote'
  /**
   * Permissive provider-specific Appium/farm capability and selector bag.
   * Common keys include deviceName, osVersion, and platformVersion.
   */
  match: Record<string, unknown>
}

export const deviceConfigSchema = z.object({
  name: z.string(),
  platform: z.enum(['android', 'ios']),
  transport: z.enum(['local', 'remote']),
  match: z.record(z.string(), z.unknown()),
}).strict()
