// RED stub for 429-15 Task 1: every name exists so the cells fail on their assertions.

import type { ExplicitActionKind, FieldState, SaveState } from './config-tabs'

export interface ConfigFieldEntry {
  raw: unknown
  fieldState: FieldState
  error?: string
}

export interface ConfigWriteInFlight {
  id: string
  fieldKeys: readonly string[]
}

export interface ConfigAutosaveIssue {
  fieldKey: string
  message: string
}

export interface ConfigWriteFailure {
  fieldKeys: readonly string[]
  message?: string
  issues: readonly ConfigAutosaveIssue[]
}

export interface PendingUndo {
  kind: ExplicitActionKind
  name: string
  token: string
  expiresAt: number
  judge?: boolean
}

export interface ConfigAutosaveState {
  fields: Readonly<Record<string, ConfigFieldEntry>>
  write?: ConfigWriteInFlight
  failure?: ConfigWriteFailure
  undo?: PendingUndo
  savedAt?: number
}

export interface RestoredDraft {
  fieldKey: string
  raw: unknown
  error?: string
}

export type ConfigAutosaveEvent = { type: string } & Record<string, unknown>

export interface ConfigSaveStatus {
  state: SaveState
  undo?: { line: string; name: string; token: string }
  failingFieldKeys: readonly string[]
  message?: string
}

export function configFieldKey(segments: readonly (string | number)[]): string {
  return JSON.stringify(segments)
}

export function createInitialConfigAutosave(): ConfigAutosaveState {
  return { fields: {} }
}

export function reduceConfigAutosave(
  state: ConfigAutosaveState,
  _event: ConfigAutosaveEvent,
  _now: number,
): ConfigAutosaveState {
  return state
}

export function deriveSaveStatus(_state: ConfigAutosaveState, _now: number): ConfigSaveStatus {
  return { state: 'idle', failingFieldKeys: [] }
}

export function draftFieldKeys(_state: ConfigAutosaveState): string[] {
  return []
}
