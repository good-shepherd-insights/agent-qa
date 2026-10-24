import type { RiskActionDescriptor, Surface } from '@vostride/agent-qa-schema'
import { ACTION_DEFINITIONS } from './actions/index.js'

// D-08: the runner owns the Action→RiskActionDescriptor projection because the tool registry
// owns the advisory readOnly?/destructive? metadata the descriptor carries. The projection is
// PURE and reads ONLY the static verb identity + that registry metadata — never an action-payload
// field (T-362-11: no LLM-influenced value feeds a classifier signal). The classifier decides the
// tier from the descriptor; there is deliberately no loop-side pre-filter that could drift.

// Internal loop dispatch verbs that may run via a callback rather than the adapter and could
// therefore be absent from the exposed tool registry. `setVariable` IS currently registered
// (actions/index.ts), so the registry already recognizes it — this set is the belt-and-suspenders
// floor guaranteeing every known internal dispatch target still projects recognized:true
// (mutating-local floor) even if it were ever dropped from the registry.
const INTERNAL_VERBS: readonly string[] = ['setVariable']

interface MergedMeta {
  surfaces: Set<Surface>
  // readOnly holds only when ALL matching definitions are readOnly (Test 6).
  readOnlyAll: boolean
  // destructive holds when ANY matching definition is destructive (Test 6).
  destructiveAny: boolean
}

// One module-level index built from the SAME ACTION_DEFINITIONS table registerAllActions()
// registers, so the projection and the registry can never fork (Test 5 roll-call pins this).
function buildVerbIndex(): Map<string, MergedMeta> {
  const index = new Map<string, MergedMeta>()
  for (const def of ACTION_DEFINITIONS) {
    const existing = index.get(def.type)
    if (existing) {
      existing.surfaces.add(def.surface)
      existing.readOnlyAll = existing.readOnlyAll && def.readOnly === true
      existing.destructiveAny = existing.destructiveAny || def.destructive === true
    } else {
      index.set(def.type, {
        surfaces: new Set<Surface>([def.surface]),
        readOnlyAll: def.readOnly === true,
        destructiveAny: def.destructive === true,
      })
    }
  }
  for (const verb of INTERNAL_VERBS) {
    if (!index.has(verb)) {
      index.set(verb, { surfaces: new Set<Surface>(), readOnlyAll: false, destructiveAny: false })
    }
  }
  return index
}

const VERB_INDEX: ReadonlyMap<string, MergedMeta> = buildVerbIndex()

/**
 * Project a resolved Action onto the schema-owned {@link RiskActionDescriptor} (D-08). An
 * unrecognized verb projects `recognized: false` — the classifier's fail-safe floor maps it to
 * `restricted` → deny. `command`/`declaredTier` are deliberately omitted: no shell-wrapper actions
 * exist in-test and `declaredTier` stays the registry's future channel.
 */
export function projectRiskAction(action: { type: string }): RiskActionDescriptor {
  const verb = action.type
  const meta = VERB_INDEX.get(verb)
  if (!meta) {
    return { name: verb, recognized: false }
  }
  const descriptor: RiskActionDescriptor = { name: verb, recognized: true }
  if (meta.surfaces.size === 1) {
    const [surface] = meta.surfaces
    descriptor.surface = surface
  }
  if (meta.destructiveAny) descriptor.destructive = true
  if (meta.readOnlyAll) descriptor.readOnly = true
  return descriptor
}
