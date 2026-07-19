import type { ProcedureBodyPayload, ProcedureParameterSpec } from './procedure-steps'

/**
 * Source-tagged binding NAMES available to procedure matching and replay binding.
 *
 * D-08 firewall: values never cross this contract in any form. Keeping the three name sets
 * distinct lets the shared matcher apply the same source rules as the loop binder without
 * exposing a secret, test-variable value, or working-memory value to the knowledge layer.
 */
export interface ProcedureBindingAvailability {
  variables: readonly string[]
  memory: readonly string[]
  secrets: readonly string[]
}

/** Names-only availability for screenless and absent-caller paths. */
export const EMPTY_PROCEDURE_BINDING_AVAILABILITY = {
  variables: [],
  memory: [],
  secrets: [],
} as const satisfies ProcedureBindingAvailability

function isParameterAvailable(
  parameter: ProcedureParameterSpec,
  sources: {
    variables: ReadonlySet<string>
    memory: ReadonlySet<string>
    secrets: ReadonlySet<string>
  },
): boolean {
  if (parameter.type === 'secret') return sources.secrets.has(parameter.name)

  // WR-01's authoritative names-only source law mirrors bindProcedureParam: secret parameters
  // use secrets only; strings use variables, memory, then secrets; numbers and booleans use
  // variables or memory only. The secret store binds as a `{{secret:name}}` string template,
  // which cannot satisfy a number/boolean slot. Admitting that source would recommend a replay
  // the loop must abort as parameter-unbound. Any binder source-policy change must update this
  // helper and its type x source matrix in the same commit.
  if (sources.variables.has(parameter.name)) return true
  if (sources.memory.has(parameter.name)) return true
  return parameter.type === 'string' && sources.secrets.has(parameter.name)
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
    variables: new Set(availability.variables),
    memory: new Set(availability.memory),
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
