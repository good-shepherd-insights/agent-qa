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
import {
  CONFIG_MASK_PLACEHOLDER,
  classifyConfigPath,
  type ConfigChange,
  type ConfigPathSegment,
} from "@vostride/agent-qa-schema"

import {
  applyConfigChanges,
  fetchConfig,
  fetchConfigRevision,
  undoConfigAction,
  type ConfigReadAnswer,
} from "@/lib/api"
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
import { REVISION_POLL_MS, SAVED_VISIBLE_MS, SETTLE_DELAY_MS, UNDO_WINDOW_MS } from "@/lib/config-copy"
import { completeRequiredSiblings } from "@/lib/config-fields"
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
  /** One explicit write; with undo metadata it offers Undo. Resolves true once the write landed. */
  runExplicit: (changes: ConfigChange[], undoMeta?: ConfigUndoMeta) => Promise<boolean>
  undo: () => Promise<void>
  goToFirstDraft: () => ConfigDraftTarget | undefined
  /** Re-reads with the loading state shown (the Reload config button). */
  reload: () => void
  /** Re-reads quietly, for sections still saving through their own routes. */
  refresh: () => void
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

function classifiedPath(segments: readonly ConfigPathSegment[]): (string | number)[] {
  return segments.map((segment) => (typeof segment === "object" ? 0 : segment))
}

function isSecretPath(segments: readonly ConfigPathSegment[]): boolean {
  return classifyConfigPath(classifiedPath(segments)) === "secret"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** A written value as the server would serve it back: every secret leaf is the mask, never the typed text. */
function maskedLikeServer(value: unknown, path: (string | number)[]): unknown {
  if (Array.isArray(value)) return value.map((item, index) => maskedLikeServer(item, [...path, index]))
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, maskedLikeServer(item, [...path, key])]))
  }
  if (value === null || value === undefined) return value
  return classifyConfigPath(path) === "secret" ? CONFIG_MASK_PLACEHOLDER : value
}

function mirroredChange(change: ConfigChange): ConfigChange {
  if (change.op === "unset") return change
  const path = classifiedPath(change.path)
  return { ...change, value: maskedLikeServer(change.value, change.op === "append" ? [...path, 0] : path) }
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

/** The structured body an ApiError carries, read by shape so any thrown answer is handled alike. */
function errorPayload(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Error) || !("payload" in error)) return undefined
  return isRecord(error.payload) ? error.payload : undefined
}

function loadFailureReason(error: unknown): string {
  const message = errorPayload(error)?.message
  const payloadMessage = typeof message === "string" ? message : undefined
  const text = payloadMessage ?? (error instanceof Error ? error.message : String(error))
  return text.trim().replace(/[.\s]+$/, "")
}

/** The loaded config with a landed write applied, so nothing waits on a re-read; undefined when a path is not there. */
function patchConfig(
  config: Record<string, unknown>,
  changes: readonly ConfigChange[],
): Record<string, unknown> | undefined {
  const next = JSON.parse(JSON.stringify(config)) as Record<string, unknown>
  for (const change of changes) {
    const parentPath = change.path.slice(0, -1)
    const last = change.path[change.path.length - 1]!
    let parent: unknown = next
    for (const segment of parentPath) {
      const child = childAt(parent, segment)
      if (child.found && (isRecord(child.value) || Array.isArray(child.value))) {
        parent = child.value
      } else if (change.op !== "unset" && typeof segment === "string" && isRecord(parent)) {
        parent = parent[segment] = {}
      } else {
        return change.op === "unset" ? next : undefined
      }
    }
    const target = childAt(parent, last)
    if (change.op === "append") {
      if (typeof last !== "string" || !isRecord(parent)) return undefined
      const list = target.found ? target.value : (parent[last] = [])
      if (!Array.isArray(list)) return undefined
      list.push(change.value)
    } else if (Array.isArray(parent)) {
      if (target.index === undefined) {
        if (change.op === "unset") continue
        return undefined
      }
      if (change.op === "unset") parent.splice(target.index, 1)
      else parent[target.index] = change.value
    } else if (isRecord(parent) && typeof last === "string") {
      if (change.op === "unset") delete parent[last]
      else parent[last] = change.value
    } else {
      return undefined
    }
  }
  return next
}

interface OutboxEntry {
  change?: ConfigChange
  /** A valid change no write has carried yet. */
  dirty: boolean
  /** A change a refused write carried; only Retry or a new edit sends it again. */
  held: boolean
}

interface Pin {
  fieldKey: string
  value: unknown
}

interface EngineHost {
  dispatch: Dispatch<HookAction>
  getState: () => HookState
  setLoad: (load: ConfigLoadState) => void
  setStorageKey: (key: string) => void
  setPin: (pin: Pin | undefined) => void
}

function createEngine(host: EngineHost) {
  const outbox = new Map<string, OutboxEntry>()
  const locations = new Map<string, FieldLocation>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  let attached = false
  let flight: Promise<void> | undefined
  let polling = false
  let writeSeq = 0
  let answer: ConfigReadAnswer | undefined
  let loaded = false
  let revision: string | undefined
  let restored = false
  let focusedKey: string | undefined
  let pin: Pin | undefined

  function emit(event: ConfigAutosaveEvent, newLocations?: Record<string, FieldLocation>) {
    host.dispatch({ event, now: Date.now(), ...(newLocations ? { locations: newLocations } : {}) })
  }

  function setPin(next: Pin | undefined) {
    pin = next
    host.setPin(next)
  }

  function clearTimer(key: string) {
    const timer = timers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    timers.delete(key)
  }

  /** A clean entry only mirrors what was typed; once nothing is pending on it, the file's value takes over. */
  function releaseClean(key: string) {
    if (key === focusedKey || outbox.get(key)?.dirty) return
    if (host.getState().machine.fields[key]?.fieldState !== "clean") return
    outbox.delete(key)
    emit({ type: "draft-cleared", fieldKey: key })
  }

  function issuesFrom(error: unknown, keys: readonly string[]): { issues: ConfigAutosaveIssue[]; message?: string } {
    const text = error instanceof Error ? error.message : String(error)
    const payload = errorPayload(error)
    if (payload === undefined) return { issues: [], message: text }
    const listed = Array.isArray(payload.issues) ? payload.issues : []
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
    const message = unmatched[0] ?? (issues.length === 0 ? text : undefined)
    return message === undefined ? { issues } : { issues, message }
  }

  function applyLanded(changes: readonly ConfigChange[]): boolean {
    if (!answer) return false
    const config = patchConfig(answer.config, changes.map(mirroredChange))
    if (!config) {
      // The landed write could not be mirrored here, so the next poll re-reads it.
      revision = undefined
      return false
    }
    answer = { ...answer, config, ...(revision === undefined ? {} : { revision }) }
    if (loaded) host.setLoad({ kind: "ready", answer })
    return true
  }

  async function write(
    keys: readonly string[],
    changes: ConfigChange[],
    explicit?: ConfigUndoMeta,
  ): Promise<boolean> {
    const id = `config-write-${++writeSeq}`
    let landed!: () => void
    flight = new Promise<void>((resolve) => {
      landed = resolve
    })
    emit({ type: "write-started", id, fieldKeys: keys })
    try {
      const result = explicit
        ? await applyConfigChanges(changes, { undoable: true })
        : await applyConfigChanges(changes)
      if (!attached) return false
      revision = result.revision
      const mirrored = applyLanded(changes)
      const written = keys.filter((key) => {
        const entry = outbox.get(key)
        if (!entry || entry.dirty) return false
        outbox.delete(key)
        return true
      })
      emit({ type: "write-succeeded", id })
      if (mirrored) {
        for (const key of written) releaseClean(key)
      }
      if (explicit && result.undo) {
        emit({
          type: "undo-offered",
          kind: explicit.kind,
          name: explicit.name,
          token: result.undo.token,
          expiresAt: Date.now() + UNDO_WINDOW_MS,
          ...(explicit.judge === undefined ? {} : { judge: explicit.judge }),
        })
      }
      return true
    } catch (error) {
      if (!attached) return false
      for (const key of keys) {
        const entry = outbox.get(key)
        if (entry && !entry.dirty && entry.change) entry.held = true
      }
      const { issues, message } = issuesFrom(error, keys)
      emit(message === undefined ? { type: "write-failed", id, issues } : { type: "write-failed", id, issues, message })
      return false
    } finally {
      flight = undefined
      landed()
      if (attached) flush()
    }
  }

  function flush() {
    if (flight) return
    const keys = [...outbox.entries()].filter(([, entry]) => entry.dirty && entry.change).map(([key]) => key)
    if (keys.length === 0) return
    const changes: ConfigChange[] = []
    for (const key of keys) {
      const entry = outbox.get(key)!
      changes.push(entry.change!)
      entry.dirty = false
      entry.held = false
      clearTimer(key)
    }
    void write(keys, answer ? completeRequiredSiblings(changes, answer.config) : changes)
  }

  function edit(field: ConfigFieldRef, raw: unknown, parsed: ConfigFieldParse) {
    const key = configFieldKeyOf(field.segments)
    const location: FieldLocation = { segments: [...field.segments], tab: field.tab }
    locations.set(key, location)
    clearTimer(key)
    if (pin?.fieldKey === key) setPin(undefined)
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
    let resend = false
    for (const entry of outbox.values()) {
      if (entry.held) {
        entry.held = false
        entry.dirty = true
      }
      if (entry.dirty) resend = true
    }
    if (resend || flight) {
      flush()
      return
    }
    // A refused explicit action or Undo leaves nothing to re-send: clear the failure (it stays
    // while any draft remains) and show the file as it is.
    emit({ type: "draft-cleared", fieldKey: "" })
    void read()
  }

  function setFocusedField(field: ConfigFieldRef | undefined) {
    const key = field ? configFieldKeyOf(field.segments) : undefined
    if (field && key !== undefined) locations.set(key, { segments: [...field.segments], tab: field.tab })
    if (key === focusedKey) return
    const previous = focusedKey
    focusedKey = key
    if (previous === undefined) return
    if (pin?.fieldKey === previous) setPin(undefined)
    releaseClean(previous)
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

  /** An outside re-read replaces the loaded answer; drafts and the focused field keep what they show. */
  function mergeQuietly(previous: ConfigReadAnswer) {
    const fields = host.getState().machine.fields
    if (focusedKey !== undefined && fields[focusedKey] === undefined && pin?.fieldKey !== focusedKey) {
      const location = locations.get(focusedKey)
      if (location) setPin({ fieldKey: focusedKey, value: valueAt(previous.config, location.segments) })
    }
    for (const key of Object.keys(fields)) releaseClean(key)
  }

  async function read(polledRevision?: string): Promise<void> {
    try {
      const next = await fetchConfig()
      if (!attached) return
      const previous = answer
      answer = next
      revision = next.revision ?? polledRevision
      if (!restored) {
        restored = true
        restoreDrafts(next)
      }
      if (previous) mergeQuietly(previous)
      loaded = true
      host.setLoad({ kind: "ready", answer: next })
    } catch (error) {
      if (!attached) return
      if (polledRevision !== undefined) revision = polledRevision
      loaded = false
      host.setLoad({ kind: "error", reason: loadFailureReason(error) })
    }
  }

  async function poll(): Promise<void> {
    if (polling || flight || !attached) return
    polling = true
    try {
      const { revision: current } = await fetchConfigRevision()
      if (attached && !flight && current !== revision) await read(current)
    } catch {
      // A missed poll is retried on the next tick.
    } finally {
      polling = false
    }
  }

  async function runExplicit(changes: ConfigChange[], undoMeta?: ConfigUndoMeta): Promise<boolean> {
    while (flight) await flight
    if (!attached) return false
    return write([], changes, undoMeta)
  }

  async function undo(): Promise<void> {
    const pending = host.getState().machine.undo
    if (!pending || Date.now() >= pending.expiresAt) return
    try {
      await undoConfigAction(pending.token)
      if (!attached) return
      emit({ type: "undo-finished" })
      await read()
    } catch (error) {
      if (!attached) return
      emit({ type: "undo-finished" })
      const { message } = issuesFrom(error, [])
      emit(message === undefined ? { type: "write-failed", id: "undo", issues: [] } : { type: "write-failed", id: "undo", issues: [], message })
    }
  }

  function refresh() {
    void read()
  }

  function reload() {
    loaded = false
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

  return {
    attach,
    detach,
    edit,
    settle,
    retry,
    reload,
    refresh,
    poll,
    runExplicit,
    undo,
    setFocusedField,
  }
}

type Engine = ReturnType<typeof createEngine>

function firstDraft(state: HookState): ConfigDraftTarget | undefined {
  let best: ConfigDraftTarget | undefined
  let bestRank = Number.POSITIVE_INFINITY
  for (const fieldKey of draftFieldKeys(state.machine)) {
    const location = state.locations[fieldKey]
    if (!location) continue
    const rank = CONFIG_TABS.indexOf(location.tab)
    if (rank < bestRank) {
      best = { tab: location.tab, fieldKey }
      bestRank = rank
    }
  }
  return best
}

export function useConfigAutosave(): ConfigAutosave {
  const [state, dispatch] = useReducer(reduceHook, undefined, initialHookState)
  const [load, setLoad] = useState<ConfigLoadState>({ kind: "loading" })
  const [storageKey, setStorageKey] = useState<string | undefined>(undefined)
  const [pin, setPin] = useState<Pin | undefined>(undefined)
  const [, setTick] = useState(0)
  const stateRef = useRef(state)
  stateRef.current = state
  const engineRef = useRef<Engine | null>(null)
  if (engineRef.current === null) {
    engineRef.current = createEngine({
      dispatch,
      getState: () => stateRef.current,
      setLoad,
      setStorageKey,
      setPin,
    })
  }
  const engine = engineRef.current

  useEffect(() => {
    engine.attach()
    return () => engine.detach()
  }, [engine])

  useEffect(() => {
    const pollIfVisible = () => {
      if (document.visibilityState === "visible") void engine.poll()
    }
    const timer = setInterval(pollIfVisible, REVISION_POLL_MS)
    document.addEventListener("visibilitychange", pollIfVisible)
    window.addEventListener("focus", pollIfVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", pollIfVisible)
      window.removeEventListener("focus", pollIfVisible)
    }
  }, [engine])

  useEffect(() => {
    if (storageKey !== undefined) writeStoredDrafts(storageKey, state)
  }, [state, storageKey])

  const status = deriveSaveStatus(state.machine, Date.now())
  const savedAt = state.machine.savedAt
  const undoExpiresAt = state.machine.undo?.expiresAt

  useEffect(() => {
    const deadlines: number[] = []
    if (status.state === "saved" && savedAt !== undefined) deadlines.push(savedAt + SAVED_VISIBLE_MS)
    if (undoExpiresAt !== undefined) deadlines.push(undoExpiresAt)
    if (deadlines.length === 0) return
    const timer = setTimeout(() => setTick((tick) => tick + 1), Math.max(0, Math.min(...deadlines) - Date.now()))
    return () => clearTimeout(timer)
  }, [status.state, savedAt, undoExpiresAt])

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
      const key = configFieldKeyOf(field.segments)
      const entry = state.machine.fields[key]
      if (entry) return entry.raw
      if (pin?.fieldKey === key) return pin.value
      return valueAt(config, field.segments)
    },
    stateOf: (field) => state.machine.fields[configFieldKeyOf(field.segments)]?.fieldState ?? "clean",
    errorOf: (field) => state.machine.fields[configFieldKeyOf(field.segments)]?.error,
    setFocusedField: engine.setFocusedField,
    runExplicit: engine.runExplicit,
    undo: engine.undo,
    goToFirstDraft: () => firstDraft(state),
    reload: engine.reload,
    refresh: engine.refresh,
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
