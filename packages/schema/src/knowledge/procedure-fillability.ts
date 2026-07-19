import type { ProcedureSourceBinding } from './procedure-binding-coercion'
import type { ProcedureBodyPayload, ProcedureParameterSpec } from './procedure-steps'

/**
 * Source-tagged binding capability available to procedure matching and replay binding.
 *
 * D-08 firewall: values never cross this contract in any form. Variables and memory carry
 * capability entries — a NAME plus per-type capability bits computed loop-side by
 * procedureSourceBinding over the same coercion the binder uses — and secrets carry names
 * only (the secret store binds solely as a string template). Keeping the three source sets
 * distinct lets the shared matcher apply the same source rules as the loop binder without
 * exposing a secret, test-variable value, or working-memory value to the knowledge layer.
 */
export interface ProcedureBindingAvailability {
  variables: readonly ProcedureSourceBinding[]
  memory: readonly ProcedureSourceBinding[]
  secrets: readonly string[]
}

/** Empty availability for screenless and absent-caller paths. */
export const EMPTY_PROCEDURE_BINDING_AVAILABILITY = {
  variables: [],
  memory: [],
  secrets: [],
} as const satisfies ProcedureBindingAvailability

function bindingsByName(
  entries: readonly ProcedureSourceBinding[],
): ReadonlyMap<string, ProcedureSourceBinding> {
  const byName = new Map<string, ProcedureSourceBinding>()
  for (const entry of entries) {
    if (!byName.has(entry.name)) byName.set(entry.name, entry)
  }
  return byName
}

function isParameterAvailable(
  parameter: ProcedureParameterSpec,
  sources: {
    variables: ReadonlyMap<string, ProcedureSourceBinding>
    memory: ReadonlyMap<string, ProcedureSourceBinding>
    secrets: ReadonlySet<string>
  },
): boolean {
  if (parameter.type === 'secret') return sources.secrets.has(parameter.name)

  // WR-01's authoritative source law, completed to value-typed capability: the matrix is
  // source x declared type x VALUE capability. Secret parameters use secrets only; strings
  // use variables, memory, then secrets (entry presence means a non-nullish value exists,
  // which is exactly string-bindability); numbers and booleans use a variables or memory
  // entry whose capability bit is true, per-source OR. The bits are computed loop-side by
  // procedureSourceBinding over the SAME coercion the binder uses
  // (coerceProcedureBindingValue), so admitting a source here is exactly binder success.
  // Name matching is exact code-unit Map-key equality — no trim, case fold, or unicode
  // normalization. Any binder coercion change must update coerceProcedureBindingValue
  // (one function, both sides), never this helper alone.
  const variable = sources.variables.get(parameter.name)
  const memory = sources.memory.get(parameter.name)
  if (parameter.type === 'string') {
    return variable !== undefined || memory !== undefined || sources.secrets.has(parameter.name)
  }
  if (parameter.type === 'number') {
    return variable?.canBindNumber === true || memory?.canBindNumber === true
  }
  return variable?.canBindBoolean === true || memory?.canBindBoolean === true
}

/**
 * The ONE fillability contract consumed by both procedure matching and the replay binder.
 *
 * Only referenced `{ param }` slots participate. A reference without a unique committed
 * declaration fails closed. `required` does not alter this verdict: once a slot references a
 * parameter it needs a binding because schema version 1 has no typed default. A future typed
 * `default` field on ProcedureParameterSpec would exempt that parameter here.
 */
export function procedureParameterFillability(
  payload: ProcedureBodyPayload,
  availability: ProcedureBindingAvailability,
): { fillable: boolean; unfillable: readonly string[] } {
  const declarations = new Map(payload.parameters.map((parameter) => [parameter.name, parameter]))
  const referenced = new Set<string>()

  for (const step of payload.steps) {
    for (const slot of Object.values(step.action.values)) {
      if (typeof slot === 'object' && slot !== null && 'param' in slot) {
        referenced.add(slot.param)
      }
    }
  }

  const sources = {
    variables: bindingsByName(availability.variables),
    memory: bindingsByName(availability.memory),
    secrets: new Set(availability.secrets),
  }
  const unfillable = [...referenced]
    .filter((name) => {
      const declaration = declarations.get(name)
      return declaration === undefined || !isParameterAvailable(declaration, sources)
    })
    .sort()

  return { fillable: unfillable.length === 0, unfillable }
}
