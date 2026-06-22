import { z } from 'zod'

import type { BrowserConfig } from './browser'
import { appStateSchema, browserConfigSchema } from './browser'
import type { RemoteDeviceConfig } from './remote-device'
import { remoteDeviceSchema } from './remote-device'

/**
 * useSchema validates authored test/suite overrides and intentionally requires
 * platform so web/android/ios arms can reject wrong-platform keys structurally.
 * The residual rule that disallows use.platform at the global config tier
 * belongs on the future global-config wrapper; Phase 312 has no such wrapper,
 * so that tier rule is deferred to the consumer-migration milestone.
 */

export type UseWebAuthState = string | {
  name: string
  load?: boolean
  capture?: boolean
}

export interface UseWeb {
  platform: 'web'
  browser?: BrowserConfig
  authState?: UseWebAuthState
}

export interface UseAndroid {
  platform: 'android'
  device?: string
  appState?: 'preserve' | 'reset'
  remoteDevice?: RemoteDeviceConfig
}

export interface UseIos {
  platform: 'ios'
  device?: string
  appState?: 'preserve' | 'reset'
  remoteDevice?: RemoteDeviceConfig
}

export type Use = UseWeb | UseAndroid | UseIos

const useWebAuthStateSchema = z.union([
  z.string(),
  z.object({
    name: z.string(),
    load: z.boolean().optional(),
    capture: z.boolean().optional(),
  }).strict(),
])

const useWebArm = z.object({
  platform: z.literal('web'),
  browser: browserConfigSchema.optional(),
  authState: useWebAuthStateSchema.optional(),
}).strict()

const useAndroidArm = z.object({
  platform: z.literal('android'),
  device: z.string().optional(),
  appState: appStateSchema.optional(),
  remoteDevice: remoteDeviceSchema.optional(),
}).strict()

const useIosArm = z.object({
  platform: z.literal('ios'),
  device: z.string().optional(),
  appState: appStateSchema.optional(),
  remoteDevice: remoteDeviceSchema.optional(),
}).strict()

export const useSchema = z.discriminatedUnion('platform', [useWebArm, useAndroidArm, useIosArm])
