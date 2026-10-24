import type { Platform } from '../action/index'
import { sha256hex16 } from './sha256'

declare const cacheKeyBrand: unique symbol

export type CacheKey = string & { readonly [cacheKeyBrand]: 'CacheKey' }

export interface CacheableStepInput {
  platform: Platform
  suiteConfigDigest: string
  testConfigDigest: string
  stepText: string
  stepIndex: number
  testIndex: number
  relevantEnvDigest: string
  screenIdentityHash: string
}

export interface NonCacheableStepInput {
  cacheable: false
  reason: string
}

function text(input: string): string {
  return `${input.length}:${input}`
}

export function computeCacheKey(input: CacheableStepInput): CacheKey {
  const preimage = [
    input.platform,
    input.suiteConfigDigest,
    input.testConfigDigest,
    input.stepText,
    String(input.stepIndex),
    String(input.testIndex),
    input.relevantEnvDigest,
    input.screenIdentityHash,
  ].map(text).join('')

  return sha256hex16(preimage) as CacheKey
}
