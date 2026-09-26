import type { ConfigPathSegment } from "@vostride/agent-qa-schema"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { configFieldControlId, configFieldKeyOf, useConfigAutosaveContext } from "@/hooks/use-config-autosave"
import type { DataPathKey } from "@/lib/config-copy"
import type { ConfigTab, ExplicitActionKind } from "@/lib/config-tabs"

export interface DataPathTarget {
  segments: readonly ConfigPathSegment[]
  tab: ConfigTab
  pattern: DataPathKey
}

export interface DataPathFieldProps {
  field: DataPathTarget
  label: string
  explicitKind: Extract<ExplicitActionKind, `change-${string}`>
  help?: string
  placeholder?: string
}

export function DataPathField({ field, label }: DataPathFieldProps) {
  const autosave = useConfigAutosaveContext()
  const controlId = configFieldControlId(configFieldKeyOf(field.segments))
  const value = autosave.valueOf({ segments: field.segments, tab: field.tab })
  return (
    <div data-config-field data-field-path={field.pattern} data-apply-state="clean" className="space-y-2">
      <Label htmlFor={controlId}>{label}</Label>
      <Input id={controlId} readOnly value={typeof value === "string" ? value : ""} />
    </div>
  )
}
