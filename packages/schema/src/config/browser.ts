import { z } from 'zod'

import type { Viewport } from '../primitives/viewport'

export interface BrowserConfig {
  name: 'chromium' | 'firefox' | 'webkit'
  headless?: boolean
  viewport?: Viewport
}

export const viewportSchema = z.object({
  width: z.number(),
  height: z.number(),
}).strict()

export const appStateSchema = z.enum(['preserve', 'reset'])

export const browserConfigSchema = z.object({
  name: z.enum(['chromium', 'firefox', 'webkit']),
  headless: z.boolean().optional(),
  viewport: viewportSchema.optional(),
}).strict()
