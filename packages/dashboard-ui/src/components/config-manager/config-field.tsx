import type { ConfigPathSegment } from "@vostride/agent-qa-schema"

import type { ConfigFieldParse } from "@/hooks/use-config-autosave"
import type { ConfigTab } from "@/lib/config-tabs"

export type ConfigFieldKind = "text" | "number" | "duration" | "switch" | "select" | "list"

export interface ConfigFieldTarget {
  segments: readonly ConfigPathSegment[]
  tab: ConfigTab
  pattern: string
}

export interface ConfigFieldOption {
  value: string
  label: string
}

export interface ConfigNumberRules {
  min?: number
  max?: number
  integer?: boolean
}

export interface ConfigFieldProps {
  field: ConfigFieldTarget
  label: string
  kind: ConfigFieldKind
  help?: string
  placeholder?: string
  defaultChecked?: boolean
  options?: readonly ConfigFieldOption[]
  number?: ConfigNumberRules
  parse?: (raw: string) => ConfigFieldParse
}

export function ConfigField(_props: ConfigFieldProps) {
  return null
}
