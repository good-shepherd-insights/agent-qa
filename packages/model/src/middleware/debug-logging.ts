import type { LanguageModelMiddleware } from 'ai'
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
} from '@ai-sdk/provider'

// RUNX-04. A PERMANENT, flag-gated request/response debug surface — the clean version of the
// throwaway APICallError.responseBody capture that revealed RUNX-01's live 400
// (`{"detail":"Unsupported parameter: max_output_tokens"}`). When enabled it logs, per model
// call: (a) the outgoing request SHAPE (model id, message roles/count, tool count, param keys
// incl. `maxOutputTokens`) — never raw message content — and (b) on a provider failure, the
// duck-typed `@ai-sdk/provider` APICallError fields (`statusCode`, `url`, `responseBody`, a
// compact `requestBodyValues` shape) — then RE-THROWS the original error unchanged. A success
// is logged shape-only (no response body). When disabled (the default) it is a pure passthrough:
// no wrapGenerate/wrapStream, zero sink calls, byte-identical behavior. Every emitted line runs
// through a secret redactor (T-365-02) so an apiKey / bearer / `sk-` token can never leak.

export interface DebugLoggingOptions {
  /** Force enable/disable. When omitted, resolves from the `AGENT_QA_DEBUG_LLM` env flag. */
  enabled?: boolean
  /** Line sink. Defaults to stderr. Injected by tests as a spy. */
  sink?: (line: string) => void
}

const REQUEST_PREFIX = '[agent-qa:llm] request'
const ERROR_PREFIX = '[agent-qa:llm] provider-error'

// Secret redaction (defense-in-depth). The shape line never prints message content or param
// VALUES, but every emitted line — including a provider `responseBody`/`requestBodyValues` that
// may echo a secret — is run through these patterns before it reaches the sink.
const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{6,}/g, // OpenAI-style keys (incl. sk-proj-…)
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, // bearer tokens
  /\b(api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret|password)\b(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
]

const REDACTED = '[redacted]'

function redact(value: string): string {
  let out = value
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, key: string | undefined, sep: string | undefined) =>
      key !== undefined && sep !== undefined ? `${key}${sep}${REDACTED}` : REDACTED,
    )
  }
  return out
}

function isEnvEnabled(): boolean {
  const raw = typeof process !== 'undefined' ? process.env?.AGENT_QA_DEBUG_LLM : undefined
  if (typeof raw !== 'string') return false
  const value = raw.trim().toLowerCase()
  return value !== '' && value !== '0' && value !== 'false' && value !== 'off' && value !== 'no'
}

function modelIdOf(model: LanguageModelV3 | undefined): string {
  if (model && typeof model === 'object' && 'modelId' in model) {
    const id = (model as { modelId?: unknown }).modelId
    if (typeof id === 'string' && id.length > 0) return id
  }
  return 'unknown'
}

function requestShapeLine(params: LanguageModelV3CallOptions, model: LanguageModelV3 | undefined): string {
  const record = params as unknown as Record<string, unknown>
  const prompt = record.prompt as LanguageModelV3Prompt | undefined
  const messages = Array.isArray(prompt) ? prompt : []
  const roles = messages.map((message) => (message as { role?: unknown }).role ?? '?').join(',')
  const toolCount = Array.isArray(record.tools) ? record.tools.length : 0
  // Param KEYS only (never values) — so `maxOutputTokens`/`temperature`/`toolChoice` are visible
  // but a secret carried in a param value never is.
  const paramKeys = Object.keys(record)
    .filter((key) => key !== 'prompt' && key !== 'tools')
    .join(',')
  return `${REQUEST_PREFIX} model=${modelIdOf(model)} messages=${messages.length} roles=[${roles}] tools=${toolCount} params=[${paramKeys}]`
}

// Compact, non-sensitive projection of the provider's requestBodyValues: model id + message
// roles only, so the emitted tool-call shape context is visible without dumping the body.
function compactRequestBodyValues(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const model = typeof record.model === 'string' ? record.model : undefined
  const items = Array.isArray(record.input)
    ? record.input
    : Array.isArray(record.messages)
      ? record.messages
      : undefined
  const roles = items?.map((item) =>
    item && typeof item === 'object' && 'role' in item ? String((item as { role: unknown }).role) : '?',
  )
  const parts: string[] = []
  if (model) parts.push(`model=${model}`)
  if (roles) parts.push(`roles=[${roles.join(',')}]`)
  return parts.length > 0 ? `{${parts.join(',')}}` : undefined
}

function providerErrorLine(err: unknown): string {
  const e = err as {
    statusCode?: unknown
    url?: unknown
    responseBody?: unknown
    requestBodyValues?: unknown
    message?: unknown
  }
  const statusCode = typeof e?.statusCode === 'number' ? e.statusCode : undefined
  const url = typeof e?.url === 'string' ? e.url : undefined
  const responseBody = typeof e?.responseBody === 'string' ? e.responseBody : undefined
  const request = compactRequestBodyValues(e?.requestBodyValues)

  const parts = [ERROR_PREFIX]
  if (statusCode !== undefined) parts.push(`statusCode=${statusCode}`)
  if (url !== undefined) parts.push(`url=${url}`)
  if (responseBody !== undefined) parts.push(`responseBody=${responseBody}`)
  if (request !== undefined) parts.push(`request=${request}`)
  // A non-provider error (no duck-typed fields) still gets its message surfaced.
  if (statusCode === undefined && responseBody === undefined) {
    const message = e?.message !== undefined ? String(e.message) : String(err)
    parts.push(`message=${message}`)
  }
  return parts.join(' ')
}

export function debugLoggingMiddleware(options: DebugLoggingOptions = {}): LanguageModelMiddleware {
  const enabled = options.enabled ?? isEnvEnabled()

  // Disabled ⇒ a pure passthrough: no wrap hooks at all, so behavior + performance are byte-
  // identical and the sink is never touched.
  if (!enabled) {
    return { specificationVersion: 'v3' }
  }

  const sink = options.sink ?? ((line: string) => { process.stderr.write(`${line}\n`) })
  const emit = (line: string): void => { sink(redact(line)) }

  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate, params, model }) => {
      emit(requestShapeLine(params, model))
      try {
        return await doGenerate()
      } catch (err) {
        emit(providerErrorLine(err))
        throw err
      }
    },

    wrapStream: async ({ doStream, params, model }) => {
      emit(requestShapeLine(params, model))
      try {
        return await doStream()
      } catch (err) {
        emit(providerErrorLine(err))
        throw err
      }
    },
  }
}
