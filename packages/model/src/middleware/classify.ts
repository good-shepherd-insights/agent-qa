import { APICallError } from '@ai-sdk/provider'

const TRANSIENT_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE'])

export function isTransientError(error: unknown): boolean {
  return (
    (APICallError.isInstance(error) && error.isRetryable === true) ||
    isTransientNetworkError(error)
  )
}

export function isTransientNetworkError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const code = (error as { code?: unknown }).code
  if (typeof code === 'string' && TRANSIENT_NETWORK_CODES.has(code)) return true

  if (error instanceof TypeError) {
    return /fetch failed|network|ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE/i.test(error.message)
  }

  return false
}
