import { createContext, createElement, useContext, type ReactNode } from "react"
import type { ConfigChange, ConfigPathSegment } from "@vostride/agent-qa-schema"

import type { ConfigReadAnswer } from "@/lib/api"
import type { ConfigSaveStatus } from "@/lib/config-autosave"
import type { ConfigTab, ExplicitActionKind, FieldState } from "@/lib/config-tabs"

export const CONFIG_DRAFTS_STORAGE_PREFIX = "agent-qa:config-drafts:"

export interface ConfigFieldRef {
  segments: readonly ConfigPathSegment[]
  tab: ConfigTab
}

export type ConfigFieldParse =
  | { valid: true; value: unknown }
  | { valid: true; unset: true }
  | { valid: false; error: string }

export type ConfigLoadState =
  | { kind: "loading" }
  | { kind: "error"; reason: string }
  | { kind: "ready"; answer: ConfigReadAnswer }

export interface ConfigUndoMeta {
  kind: ExplicitActionKind
  name: string
  judge?: boolean
}

export interface ConfigDraftTarget {
  tab: ConfigTab
  fieldKey: string
}

export interface ConfigAutosave {
  load: ConfigLoadState
  status: ConfigSaveStatus
  draftTabs: ReadonlySet<ConfigTab>
  edit: (field: ConfigFieldRef, raw: unknown, parsed: ConfigFieldParse) => void
  settle: (field: ConfigFieldRef) => void
  retry: () => void
  valueOf: (field: ConfigFieldRef) => unknown
  stateOf: (field: ConfigFieldRef) => FieldState
  errorOf: (field: ConfigFieldRef) => string | undefined
  setFocusedField: (field: ConfigFieldRef | undefined) => void
  runExplicit: (changes: ConfigChange[], undoMeta: ConfigUndoMeta) => Promise<void>
  undo: () => Promise<void>
  goToFirstDraft: () => ConfigDraftTarget | undefined
  reload: () => void
}

// RED stub (429-16): every name exists, nothing works yet.
export function useConfigAutosave(): ConfigAutosave {
  return {
    load: { kind: "loading" },
    status: { state: "idle", failingFieldKeys: [] },
    draftTabs: new Set(),
    edit: () => {},
    settle: () => {},
    retry: () => {},
    valueOf: () => undefined,
    stateOf: () => "clean",
    errorOf: () => undefined,
    setFocusedField: () => {},
    runExplicit: async () => {},
    undo: async () => {},
    goToFirstDraft: () => undefined,
    reload: () => {},
  }
}

const ConfigAutosaveContext = createContext<ConfigAutosave | null>(null)

export function ConfigAutosaveProvider({ value, children }: { value: ConfigAutosave; children: ReactNode }) {
  return createElement(ConfigAutosaveContext.Provider, { value }, children)
}

export function useConfigAutosaveContext(): ConfigAutosave {
  const value = useContext(ConfigAutosaveContext)
  if (value === null) throw new Error("useConfigAutosaveContext needs a ConfigAutosaveProvider")
  return value
}
