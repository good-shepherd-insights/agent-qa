import { z } from 'zod'

import type { Viewport } from '../primitives/viewport'
import { viewportSchema } from './browser'

export interface TimeoutConfig {
  step?: number
  test?: number
  navigation?: number
}

export interface PlatformBase {
  timeouts?: TimeoutConfig
  recording?: { enabled: boolean; videoDir: string; videoSize?: Viewport }
  verbose?: boolean
  farmSession?: { hostname: string; port: number; path: string; capabilities: Record<string, unknown> }
  logCapture?: { console?: boolean; network?: boolean }
}

export const timeoutConfigSchema = z.object({
  step: z.number().optional(),
  test: z.number().optional(),
  navigation: z.number().optional(),
}).strict()

export const platformBaseShape = {
  timeouts: timeoutConfigSchema.optional(),
  recording: z.object({
    enabled: z.boolean(),
    videoDir: z.string(),
    videoSize: viewportSchema.optional(),
  }).strict().optional(),
  verbose: z.boolean().optional(),
  farmSession: z.object({
    hostname: z.string(),
    port: z.number(),
    path: z.string(),
    capabilities: z.record(z.string(), z.unknown()),
  }).strict().optional(),
  logCapture: z.object({
    console: z.boolean().optional(),
    network: z.boolean().optional(),
  }).strict().optional(),
}

export const platformBase = z.object(platformBaseShape).strict()
