import { ConfigField, type ConfigFieldTarget } from "@/components/config-manager/config-field"
import { PLANNER_FIELD_HELP, PLANNER_FIELD_LABELS } from "@/lib/config-copy"
import { REQUIRED_SIBLING_BLOCKS } from "@/lib/config-fields"

type PlannerLeaf = keyof typeof PLANNER_FIELD_LABELS

const PLANNER_DEFAULTS = REQUIRED_SIBLING_BLOCKS["use.planner"]

function plannerField(leaf: PlannerLeaf): ConfigFieldTarget {
  return { segments: ["use", "planner", leaf], tab: "models", pattern: `use.planner.${leaf}` }
}

export function PlannerSection() {
  return (
    <>
      <ConfigField
        field={plannerField("maxSubActions")}
        label={PLANNER_FIELD_LABELS.maxSubActions}
        help={PLANNER_FIELD_HELP.maxSubActions}
        kind="number"
        placeholder={String(PLANNER_DEFAULTS.maxSubActions)}
        number={{ min: 1, integer: true }}
      />
      <ConfigField
        field={plannerField("previousStepCount")}
        label={PLANNER_FIELD_LABELS.previousStepCount}
        help={PLANNER_FIELD_HELP.previousStepCount}
        kind="number"
        placeholder={String(PLANNER_DEFAULTS.previousStepCount)}
        number={{ min: 0, integer: true }}
      />
    </>
  )
}
