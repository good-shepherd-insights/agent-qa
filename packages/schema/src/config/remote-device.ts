import { z } from 'zod'

export interface RemoteDeviceConfig {
  appiumUrl?: string
  webDriverAgentUrl?: string
  app?: string
  capabilities?: Record<string, unknown>
}

export const remoteDeviceSchema = z.object({
  appiumUrl: z.string().optional(),
  webDriverAgentUrl: z.string().optional(),
  app: z.string().optional(),
  capabilities: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((val, ctx) => {
  if (!val.appiumUrl && !val.webDriverAgentUrl) {
    ctx.addIssue({
      code: 'custom',
      message: 'remoteDevice requires at least one of appiumUrl or webDriverAgentUrl',
    })
  }
})
