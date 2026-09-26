// THE CONFIG PAGE'S AUTOSAVE (429 D-19/D-20/D-21/D-22/D-24 · PXH-CONF-04/05).
//
// One hook the whole page shares, because Radix unmounts inactive tab panels: a draft kept in a
// section component would vanish on a tab change. The pure machine in lib/config-autosave.ts
// decides what the status may say; this hook owns the effects: settle timers, the one write in
// flight, browser-storage drafts (never a secret) and the loaded config.

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react"
import { classifyConfigPath, type ConfigChange, type ConfigPathSegment } from "@vostride/agent-qa-schema"

import { ApiError, applyConfigChanges, fetchConfig, type ConfigReadAnswer } from "@/lib/api"
import {
  createInitialConfigAutosave,
  deriveSaveStatus,
  draftFieldKeys,
  reduceConfigAutosave,
  type ConfigAutosaveEvent,
  type ConfigAutosaveIssue,
  type ConfigAutosaveState,
  type ConfigSaveStatus,
  type RestoredDraft,
} from "@/lib/config-autosave"
import { SAVED_VISIBLE_MS, SETTLE_DELAY_MS } from "@/lib/config-copy"
import { CONFIG_TABS, type ConfigTab, type ExplicitActionKind, type FieldState } from "@/lib/config-tabs"

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

interface FieldLocation {
  segments: readonly ConfigPathSegment[]
  tab: ConfigTab
}

interface HookState {
  machine: ConfigAutosaveState
  locations: Readonly<Record<string, FieldLocation>>
}

interface HookAction {
  event: ConfigAutosaveEvent
  now: number
  locations?: Readonly<Record<string, FieldLocation>>
}

function reduceHook(state: HookState, action: HookAction): HookState {
  const machine = reduceConfigAutosave(state.machine, action.event, action.now)
  const locations = action.locations ? { ...state.locations, ...action.locations } : state.locations
  return machine === state.machine && locations === state.locations ? state : { machine, locations }
}

function initialHookState(): HookState {
  return { machine: createInitialConfigAutosave(), locations: {} }
}

/** The same key the machine uses: the JSON of the field's segments. */
export function configFieldKeyOf(segments: readonly ConfigPathSegment[]): string {
  return JSON.stringify(segments)
}

/** The DOM id of a field's control, so Not saved can focus it. */
export function configFieldControlId(fieldKey: string): string {
  return `config-field-${encodeURIComponent(fieldKey).replace(/%/g, "_")}`
}

function isSecretPath(segments: readonly ConfigPathSegment[]): boolean {
  return classifyConfigPath(segments.map((segment) => (typeof segment === "object" ? 0 : segment))) === "secret"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function childAt(node: unknown, segment: ConfigPathSegment): { found: boolean; value: unknown; index?: number } {
  if (typeof segment === "object") {
    if (!Array.isArray(node)) return { found: false, value: undefined }
    const index = node.findIndex((item) => isRecord(item) && item.name === segment.name)
    return index < 0 ? { found: false, value: undefined } : { found: true, value: node[index], index }
  }
  if (typeof segment === "number") {
    return Array.isArray(node) && segment < node.length
      ? { found: true, value: node[segment], index: segment }
      : { found: false, value: undefined }
  }
  return isRecord(node) && segment in node ? { found: true, value: node[segment] } : { found: false, value: undefined }
}

function valueAt(config: unknown, segments: readonly ConfigPathSegment[]): unknown {
  let node = config
  for (const segment of segments) {
    const next = childAt(node, segment)
    if (!next.found) return undefined
    node = next.value
  }
  return node
}

/** The index path the server names in its issues, with each `{ name }` resolved on the loaded config. */
function indexPathOf(config: unknown, segments: readonly ConfigPathSegment[]): (string | number)[] | undefined {
  const path: (string | number)[] = []
  let node = config
  for (const segment of segments) {
    const next = childAt(node, segment)
    if (typeof segment === "object") {
      if (next.index === undefined) return undefined
      path.push(next.index)
    } else {
      path.push(segment)
    }
    node = next.value
  }
  return path
}

function sameAsFile(raw: unknown, fileValue: unknown): boolean {
  if (raw === fileValue) return true
  if (fileValue === undefined || fileValue === null) return raw === ""
  if (typeof raw !== "string") return false
  if (typeof fileValue === "string" || typeof fileValue === "number" || typeof fileValue === "boolean") {
    return String(fileValue) === raw
  }
  return Array.isArray(fileValue) && fileValue.every((item) => typeof item === "string") && fileValue.join("\n") === raw
}

interface StoredDraft {
  segments: ConfigPathSegment[]
  tab: ConfigTab
  raw: string | number | boolean
  error?: string
}

function isSegment(value: unknown): value is ConfigPathSegment {
  if (typeof value === "string") return value.length > 0
  if (typeof value === "number") return Number.isInteger(value) && value >= 0
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value.name === "string" &&
    value.name.length > 0
  )
}

function isStorableRaw(raw: unknown): raw is StoredDraft["raw"] {
  return typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean"
}

/** The normalizeProductTourState idiom: anything off-shape, secret or equal to the file is dropped. */
function normalizeStoredDraft(key: string, value: unknown, config: unknown): StoredDraft | undefined {
  if (!isRecord(value)) return undefined
  const { segments, tab, raw, error } = value
  if (!Array.isArray(segments) || segments.length === 0 || !segments.every(isSegment)) return undefined
  if (configFieldKeyOf(segments) !== key) return undefined
  if (typeof tab !== "string" || !(CONFIG_TABS as readonly string[]).includes(tab)) return undefined
  if (!isStorableRaw(raw)) return undefined
  if (error !== undefined && typeof error !== "string") return undefined
  if (isSecretPath(segments)) return undefined
  if (sameAsFile(raw, valueAt(config, segments))) return undefined
  return { segments, tab: tab as ConfigTab, raw, ...(error === undefined ? {} : { error }) }
}

function readStoredDrafts(storageKey: string, config: unknown): Record<string, StoredDraft> {
  try {
    const text = globalThis.localStorage?.getItem(storageKey)
    if (!text) return {}
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) return {}
    const drafts: Record<string, StoredDraft> = {}
    for (const [key, value] of Object.entries(parsed)) {
      const draft = normalizeStoredDraft(key, value, config)
      if (draft) drafts[key] = draft
    }
    return drafts
  } catch {
    return {}
  }
}

function writeStoredDrafts(storageKey: string, state: HookState): void {
  const drafts: Record<string, StoredDraft> = {}
  for (const key of draftFieldKeys(state.machine)) {
    const location = state.locations[key]
    const field = state.machine.fields[key]
    if (!location || !field || isSecretPath(location.segments) || !isStorableRaw(field.raw)) continue
    drafts[key] = {
      segments: [...location.segments],
      tab: location.tab,
      raw: field.raw,
      ...(field.error === undefined ? {} : { error: field.error }),
    }
  }
  try {
    if (Object.keys(drafts).length === 0) globalThis.localStorage?.removeItem(storageKey)
    else globalThis.localStorage?.setItem(storageKey, JSON.stringify(drafts))
  } catch {
    // Storage can be full or blocked; the drafts still live in memory.
  }
}

function loadFailureReason(error: unknown): string {
  const payloadMessage =
    error instanceof ApiError && typeof error.payload?.message === "string" ? error.payload.message : undefined
  const text = payloadMessage ?? (error instanceof Error ? error.message : String(error))
  return text.trim().replace(/[.\s]+$/, "")
}

interface OutboxEntry {
  change?: ConfigChange
  /** A valid change no write has carried yet. */
  dirty: boolean
  /** A change a refused write carried; only Retry or a new edit sends it again. */
  held: boolean
}

interface EngineHost {
  dispatch: Dispatch<HookAction>
  setLoad: (load: ConfigLoadState) => void
  setStorageKey: (key: string) => void
}

function createEngine(host: EngineHost) {
  const outbox = new Map<string, OutboxEntry>()
  const locations = new Map<string, FieldLocation>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let attached = false
  let flying = false
  let writeSeq = 0
  let answer: ConfigReadAnswer | undefined
  let restored = false

  function emit(event: ConfigAutosaveEvent, newLocations?: Record<string, FieldLocation>) {
    host.dispatch({ event, now: Date.now(), ...(newLocations ? { locations: newLocations } : {}) })
  }

  function clearTimer(key: string) {
    const timer = timers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(key)
  }

  function issuesFrom(error: unknown, keys: readonly string[]): { issues: ConfigAutosaveIssue[]; message?: string } {
    if (!(error instanceof ApiError)) {
      return { issues: [], message: error instanceof Error ? error.message : String(error) }
    }
    const listed = Array.isArray(error.payload?.issues) ? error.payload.issues : []
    const issues: ConfigAutosaveIssue[] = []
    const unmatched: string[] = []
    for (const item of listed) {
      if (!isRecord(item) || !Array.isArray(item.path) || typeof item.message !== "string") continue
      const named = JSON.stringify(item.path)
      const fieldKey = keys.find((key) => {
        const location = locations.get(key)
        if (!location) return key === named
        const indexed = indexPathOf(answer?.config, location.segments)
        return key === named || (indexed !== undefined && JSON.stringify(indexed) === named)
      })
      if (fieldKey === undefined) unmatched.push(item.message)
      else issues.push({ fieldKey, message: item.message })
    }
    const message = unmatched[0] ?? (issues.length === 0 ? error.message : undefined)
    return message === undefined ? { issues } : { issues, message }
  }

  async function send(keys: readonly string[]): Promise<void> {
    const changes: ConfigChange[] = []
    for (const key of keys) {
      const entry = outbox.get(key)
      if (entry?.change) changes.push(entry.change)
      if (entry) {
        entry.dirty = false
        entry.held = false
      }
      clearTimer(key)
    }
    const id = `config-write-${++writeSeq}`
    flying = true
    emit({ type: "write-started", id, fieldKeys: keys })
    try {
      await applyConfigChanges(changes)
      if (!attached) return
      for (const key of keys) {
        const entry = outbox.get(key)
        if (entry && !entry.dirty) outbox.delete(key)
      }
      emit({ type: "write-succeeded", id })
    } catch (error) {
      if (!attached) return
      for (const key of keys) {
        const entry = outbox.get(key)
        if (entry && !entry.dirty && entry.change) entry.held = true
      }
      const { issues, message } = issuesFrom(error, keys)
      emit(message === undefined ? { type: "write-failed", id, issues } : { type: "write-failed", id, issues, message })
    } finally {
      flying = false
      if (attached) flush()
    }
  }

  function flush() {
    if (flying) return
    const keys = [...outbox.entries()].filter(([, entry]) => entry.dirty && entry.change).map(([key]) => key)
    if (keys.length > 0) void send(keys)
  }

  function edit(field: ConfigFieldRef, raw: unknown, parsed: ConfigFieldParse) {
    const key = configFieldKeyOf(field.segments)
    const location: FieldLocation = { segments: [...field.segments], tab: field.tab }
    locations.set(key, location)
    clearTimer(key)
    const entry = outbox.get(key) ?? { dirty: false, held: false }
    if (parsed.valid) {
      const path = [...field.segments]
      entry.change = "unset" in parsed ? { op: "unset", path } : { op: "set", path, value: parsed.value }
      entry.dirty = true
      entry.held = false
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key)
          flush()
        }, SETTLE_DELAY_MS),
      )
    } else {
      delete entry.change
      entry.dirty = false
      entry.held = false
    }
    outbox.set(key, entry)
    emit(
      parsed.valid
        ? { type: "edit", fieldKey: key, raw, valid: true }
        : { type: "edit", fieldKey: key, raw, valid: false, error: parsed.error },
      { [key]: location },
    )
  }

  function settle(field: ConfigFieldRef) {
    clearTimer(configFieldKeyOf(field.segments))
    flush()
  }

  function retry() {
    for (const entry of outbox.values()) {
      if (entry.held) {
        entry.held = false
        entry.dirty = true
      }
    }
    flush()
  }

  function restoreDrafts(next: ConfigReadAnswer) {
    const storageKey = `${CONFIG_DRAFTS_STORAGE_PREFIX}${next.file?.path ?? ""}`
    const drafts = readStoredDrafts(storageKey, next.config)
    const entries: RestoredDraft[] = []
    const restoredLocations: Record<string, FieldLocation> = {}
    for (const [key, draft] of Object.entries(drafts)) {
      const location = { segments: draft.segments, tab: draft.tab }
      locations.set(key, location)
      restoredLocations[key] = location
      entries.push(draft.error === undefined ? { fieldKey: key, raw: draft.raw } : { fieldKey: key, raw: draft.raw, error: draft.error })
    }
    if (entries.length > 0) emit({ type: "drafts-restored", entries }, restoredLocations)
    host.setStorageKey(storageKey)
  }

  async function read(): Promise<void> {
    try {
      const next = await fetchConfig()
      if (!attached) return
      answer = next
      if (!restored) {
        restored = true
        restoreDrafts(next)
      }
      host.setLoad({ kind: "ready", answer: next })
    } catch (error) {
      if (!attached) return
      host.setLoad({ kind: "error", reason: loadFailureReason(error) })
    }
  }

  function reload() {
    host.setLoad({ kind: "loading" })
    void read()
  }

  function attach() {
    attached = true
    void read()
  }

  function detach() {
    attached = false
    for (const key of [...timers.keys()]) clearTimer(key)
  }

  return { attach, detach, edit, settle, retry, reload }
}

type Engine = ReturnType<typeof createEngine>

export function useConfigAutosave(): ConfigAutosave {
  const [state, dispatch] = useReducer(reduceHook, undefined, initialHookState)
  const [load, setLoad] = useState<ConfigLoadState>({ kind: "loading" })
  const [storageKey, setStorageKey] = useState<string | undefined>(undefined)
  const [, setTick] = useState(0)
  const engineRef = useRef<Engine | null>(null)
  if (engineRef.current === null) engineRef.current = createEngine({ dispatch, setLoad, setStorageKey })
  const engine = engineRef.current

  useEffect(() => {
    engine.attach()
    return () => engine.detach()
  }, [engine])

  useEffect(() => {
    if (storageKey !== undefined) writeStoredDrafts(storageKey, state)
  }, [state, storageKey])

  const now = Date.now()
  const status = deriveSaveStatus(state.machine, now)
  const savedAt = state.machine.savedAt

  useEffect(() => {
    if (status.state !== "saved" || savedAt === undefined) return
    const timer = setTimeout(() => setTick((tick) => tick + 1), Math.max(0, savedAt + SAVED_VISIBLE_MS - Date.now()))
    return () => clearTimeout(timer)
  }, [status.state, savedAt])

  const draftTabs = useMemo(() => {
    const tabs = new Set<ConfigTab>()
    for (const key of draftFieldKeys(state.machine)) {
      const location = state.locations[key]
      if (location) tabs.add(location.tab)
    }
    return tabs
  }, [state])

  const config = load.kind === "ready" ? load.answer.config : undefined

  return {
    load,
    status,
    draftTabs,
    edit: engine.edit,
    settle: engine.settle,
    retry: engine.retry,
    valueOf: (field) => {
      const entry = state.machine.fields[configFieldKeyOf(field.segments)]
      return entry ? entry.raw : valueAt(config, field.segments)
    },
    stateOf: (field) => state.machine.fields[configFieldKeyOf(field.segments)]?.fieldState ?? "clean",
    errorOf: (field) => state.machine.fields[configFieldKeyOf(field.segments)]?.error,
    setFocusedField: () => {},
    runExplicit: async () => {},
    undo: async () => {},
    goToFirstDraft: () => undefined,
    reload: engine.reload,
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
