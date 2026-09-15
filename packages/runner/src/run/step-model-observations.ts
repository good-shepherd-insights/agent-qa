import type { LanguageModel } from 'ai'
import type {
  StepModelAttempt, StepModelBinding, StepModelCallReport, StepModelObservation,
  StepModelScope, StepModelScopeOptions, StepModelSnapshot,
} from './ports.js'

const invocationCapability = Symbol('step model invocation')
interface Invocation {
  model: LanguageModel
  respondingModelId(): string | undefined
  finish(): void
}
type ScopedModel = Exclude<LanguageModel, string> & { [invocationCapability]?: () => Invocation }

/** The explicit handle carries its own capability; no ambient current-step registry exists. */
export async function withStepModelCall<T>(
  model: LanguageModel,
  call: (model: LanguageModel) => Promise<T>,
): Promise<{ result: T; scoped: boolean; respondingModelId?: string }> {
  const invocation = typeof model === 'object' && model !== null
    ? (model as ScopedModel)[invocationCapability]?.() : undefined
  try {
    const result = await call(invocation?.model ?? model)
    const respondingModelId = invocation?.respondingModelId()
    return {
      result, scoped: invocation !== undefined,
      ...(respondingModelId === undefined ? {} : { respondingModelId }),
    }
  } finally {
    invocation?.finish()
  }
}

export function createStepModelScope(options: StepModelScopeOptions): StepModelScope {
  const key = { ...options.key }
  const attempts: StepModelAttempt[] = []
  let nextInvocation = 0
  let closed = false
  let finalSnapshot: StepModelSnapshot | undefined
  const safeMask = (text: string) => {
    try { return options.mask(text) } catch { return '[secret]' }
  }
  const count = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  const cleanReport = (report: StepModelCallReport): StepModelCallReport => ({
    ...(count(report.inputTokens) ? { inputTokens: report.inputTokens } : {}),
    ...(count(report.outputTokens) ? { outputTokens: report.outputTokens } : {}),
    ...(count(report.inputTokens) && count(report.cachedInputTokens)
      && report.cachedInputTokens <= report.inputTokens
      ? { cachedInputTokens: report.cachedInputTokens } : {}),
    ...(typeof report.respondingModelId === 'string' && report.respondingModelId.length > 0
      ? { respondingModelId: safeMask(report.respondingModelId) } : {}),
  })
  function modelFor(role: StepModelAttempt['role'], binding: StepModelBinding): LanguageModel {
    const open = (): Invocation => {
      if (closed) throw new Error('Step model scope is closed')
      const invocation = nextInvocation++
      let active: StepModelAttempt | undefined
      let last: StepModelAttempt | undefined
      let finished = false
      const observation: StepModelObservation = { onCall(event) {
        if (closed || finished) return
        if (event.kind === 'start') {
          active = { invocation, role, kind: 'start' }
          last = active
          attempts.push(active)
        } else if (active) {
          active.kind = event.kind
          if (event.kind === 'success') active.report = cleanReport(event.report)
          active = undefined
        }
      } }
      return {
        model: binding.bind(observation),
        respondingModelId: () => last?.kind === 'success'
          ? last.report?.respondingModelId : undefined,
        finish: () => { finished = true },
      }
    }
    // Only the capability is new. The host handle and its receiver-bound methods remain intact.
    return new Proxy(binding.model, { get(target, property) {
      return property === invocationCapability ? open : Reflect.get(target, property, target)
    } })
  }
  function snapshot(): StepModelSnapshot {
    if (finalSnapshot) return structuredClone(finalSnapshot)
    const total = (field: 'inputTokens' | 'outputTokens' | 'cachedInputTokens') => {
      if (attempts.length === 0 || attempts.some(item => item.kind !== 'success'
        || item.report?.[field] === undefined)) return undefined
      const sum = attempts.reduce((value, item) => value + item.report![field]!, 0)
      return count(sum) ? sum : undefined
    }
    const inputTokens = total('inputTokens')
    const outputTokens = total('outputTokens')
    const cachedInputTokens = inputTokens === undefined ? undefined : total('cachedInputTokens')
    const roleFacts = (role: StepModelAttempt['role']) => {
      const declared = options.profiles?.[role]
      return {
        ...(declared === undefined ? {} : { declared: {
          provider: safeMask(declared.provider), modelId: safeMask(declared.modelId),
        } }),
        respondingModelIds: [...new Set(attempts.filter(item => item.role === role)
          .flatMap(item => item.report?.respondingModelId ? [safeMask(item.report.respondingModelId)] : []))],
      }
    }
    return { ...key, attempts: attempts.map(item => ({ ...item,
      ...(item.report === undefined ? {} : { report: cleanReport(item.report) }),
    })), started: attempts.length, succeeded: attempts.filter(item => item.kind === 'success').length,
    failed: attempts.filter(item => item.kind === 'failure').length,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    roles: { planner: roleFacts('planner'), verifier: roleFacts('verifier') } }
  }
  const models = { plannerModel: modelFor('planner', options.models.planner),
    verifierModel: modelFor('verifier', options.models.verifier) }
  return { key, ...models, ...options.createConsumers(models), snapshot,
    finish: () => {
      closed = true
      finalSnapshot ??= snapshot()
      return snapshot()
    }, dispose: () => { closed = true } }
}
