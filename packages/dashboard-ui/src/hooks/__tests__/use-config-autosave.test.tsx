// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { classifyConfigPath, type ConfigPathSegment } from "@vostride/agent-qa-schema"

import { ApiError, applyConfigChanges, fetchConfig, fetchConfigRevision, undoConfigAction } from "@/lib/api"
import { REVISION_POLL_MS, SETTLE_DELAY_MS, UNDO_WINDOW_MS, undoLine } from "@/lib/config-copy"
import {
  CONFIG_DRAFTS_STORAGE_PREFIX,
  useConfigAutosave,
  type ConfigAutosave,
  type ConfigFieldParse,
  type ConfigFieldRef,
} from "@/hooks/use-config-autosave"

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  fetchConfig: vi.fn(),
  fetchConfigRevision: vi.fn(),
  applyConfigChanges: vi.fn(),
  undoConfigAction: vi.fn(),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CONFIG_PATH = "/work/agent-qa.config.yaml"
const STORAGE_KEY = `${CONFIG_DRAFTS_STORAGE_PREFIX}${CONFIG_PATH}`

function answer(config: Record<string, unknown>, revision = "rev-1") {
  return { config, provider: null, revision, file: { path: CONFIG_PATH, lines: [] } }
}

const baseConfig = {
  workspace: { envFile: ".env.local" },
  use: { timeout: { step: "30s", test: "10m" }, browser: { headless: true } },
  registry: {
    llms: [{ name: "primary", provider: "openai-compatible", model: "gpt-4.1" }],
    providers: { farm: { accessKey: "••••••••" } },
  },
}

const headless: ConfigFieldRef = { segments: ["use", "browser", "headless"], tab: "execution" }
const step: ConfigFieldRef = { segments: ["use", "timeout", "step"], tab: "execution" }
const envFile: ConfigFieldRef = { segments: ["workspace", "envFile"], tab: "project" }
const testTimeout: ConfigFieldRef = { segments: ["use", "timeout", "test"], tab: "execution" }
const farmKey: ConfigFieldRef = { segments: ["registry", "providers", "farm", "accessKey"], tab: "targets" }
const modelHeader: ConfigFieldRef = {
  segments: ["registry", "llms", { name: "primary" }, "providerHeaders", "Authorization"],
  tab: "models",
}

const DURATION = /^\d+(ms|s|m|h)$/
function durationParse(raw: string): ConfigFieldParse {
  return DURATION.test(raw) ? { valid: true, value: raw } : { valid: false, error: "Use a duration like 30s or 2m." }
}
function textParse(raw: string): ConfigFieldParse {
  return { valid: true, value: raw }
}

let hook: ConfigAutosave | undefined
function Harness() {
  hook = useConfigAutosave()
  return null
}

let container: HTMLDivElement | null = null
let root: Root | null = null

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

async function mount() {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<Harness />)
  })
  await flush()
  return hook!
}

async function unmount() {
  if (root) {
    await act(async () => root!.unmount())
  }
  root = null
  container?.remove()
  container = null
  hook = undefined
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function run(action: (h: ConfigAutosave) => void) {
  await act(async () => {
    action(hook!)
  })
  await flush()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function writeCalls() {
  return vi.mocked(applyConfigChanges).mock.calls.map((call) => call[0])
}

function storedText(): string {
  const parts: string[] = []
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index)!
    parts.push(key, localStorage.getItem(key) ?? "")
  }
  return parts.join("\n")
}

function classOf(segments: readonly ConfigPathSegment[]) {
  return classifyConfigPath(segments.map((segment) => (typeof segment === "object" ? 0 : segment)))
}

let visibility: DocumentVisibilityState = "visible"

function setVisibility(next: DocumentVisibilityState) {
  visibility = next
}

beforeEach(() => {
  visibility = "visible"
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility })
  vi.useFakeTimers()
  localStorage.clear()
  vi.mocked(fetchConfig).mockResolvedValue(answer(baseConfig) as never)
  // One fake server: the revision route answers whatever the last write landed.
  let serverRevision = "rev-1"
  vi.mocked(fetchConfigRevision).mockImplementation(async () => ({ revision: serverRevision }))
  vi.mocked(applyConfigChanges).mockImplementation(async () => {
    serverRevision = "rev-2"
    return { revision: serverRevision }
  })
})

afterEach(async () => {
  await unmount()
  vi.clearAllMocks()
  vi.useRealTimers()
  localStorage.clear()
})

describe("useConfigAutosave settle, write, drafts and retry (429-16 Task 1)", () => {
  it("ONE-WRITE-PER-SETTLE: a toggle writes at once, typing writes once after the pause, a blur writes at once", async () => {
    await mount()
    expect(hook!.load.kind).toBe("ready")

    await run((h) => {
      h.edit(headless, false, { valid: true, value: false })
      h.settle(headless)
    })
    expect(writeCalls()).toEqual([[{ op: "set", path: ["use", "browser", "headless"], value: false }]])

    for (const raw of [".e", ".en", ".env"]) {
      await run((h) => h.edit(envFile, raw, textParse(raw)))
      await advance(SETTLE_DELAY_MS / 4)
    }
    await advance(SETTLE_DELAY_MS - SETTLE_DELAY_MS / 4 - 1)
    expect(writeCalls()).toHaveLength(1)
    await advance(1)
    expect(writeCalls()).toHaveLength(2)
    expect(writeCalls()[1]).toEqual([{ op: "set", path: ["workspace", "envFile"], value: ".env" }])

    await run((h) => {
      h.edit(step, "45s", durationParse("45s"))
      h.settle(step)
    })
    expect(writeCalls()).toHaveLength(3)
    expect(writeCalls()[2]).toEqual([{ op: "set", path: ["use", "timeout", "step"], value: "45s" }])

    await advance(SETTLE_DELAY_MS * 3)
    expect(writeCalls()).toHaveLength(3)
    expect(hook!.valueOf(step)).toBe("45s")
  })

  it("ONE-WRITE-PER-SETTLE: an unset edit sends one unset change for that leaf", async () => {
    await mount()
    await run((h) => {
      h.edit(envFile, "", { valid: true, unset: true })
      h.settle(envFile)
    })
    expect(writeCalls()).toEqual([[{ op: "unset", path: ["workspace", "envFile"] }]])
  })

  it("INVALID-STAYS-DRAFT-NO-WRITE: an unparseable duration writes nothing, reads Not saved, and survives a reload", async () => {
    await mount()
    await run((h) => h.edit(step, "30 seconds", durationParse("30 seconds")))
    await run((h) => h.settle(step))
    await advance(SETTLE_DELAY_MS * 3)

    expect(applyConfigChanges).not.toHaveBeenCalled()
    expect(hook!.status.state).toBe("draft")
    expect(hook!.stateOf(step)).toBe("draft")
    expect(hook!.errorOf(step)).toBe("Use a duration like 30s or 2m.")
    expect(hook!.valueOf(step)).toBe("30 seconds")
    expect([...hook!.draftTabs]).toEqual(["execution"])
    expect(localStorage.getItem(STORAGE_KEY)).toContain("30 seconds")

    await unmount()
    await mount()

    expect(hook!.load.kind).toBe("ready")
    expect(hook!.valueOf(step)).toBe("30 seconds")
    expect(hook!.stateOf(step)).toBe("draft")
    expect(hook!.status.state).toBe("draft")
    expect([...hook!.draftTabs]).toEqual(["execution"])
    expect(hook!.valueOf(headless)).toBe(true)
    expect(applyConfigChanges).not.toHaveBeenCalled()
  })

  it("INVALID-STAYS-DRAFT-NO-WRITE: a stored draft equal to the file's value, or off-shape, is dropped on load", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [JSON.stringify(step.segments)]: { segments: step.segments, tab: "execution", raw: "30s" },
        [JSON.stringify(envFile.segments)]: { segments: envFile.segments, tab: "nowhere", raw: ".x" },
        junk: 42,
      }),
    )
    await mount()
    expect(hook!.stateOf(step)).toBe("clean")
    expect(hook!.stateOf(envFile)).toBe("clean")
    expect(hook!.valueOf(envFile)).toBe(".env.local")
    expect(hook!.status.state).toBe("idle")
  })

  it("FORCED-FAILURE-KEEPS-DRAFT: a refused write reads Couldn't save, keeps the value with its reason, and Retry re-sends once", async () => {
    vi.mocked(applyConfigChanges).mockRejectedValueOnce(
      new ApiError(422, "Unprocessable Entity", {
        error: "validation_failed",
        issues: [{ path: ["use", "timeout", "step"], message: "Step timeout must be at least 1s." }],
      }),
    )
    await mount()
    await run((h) => {
      h.edit(step, "0s", durationParse("0s"))
      h.settle(step)
    })

    expect(writeCalls()).toHaveLength(1)
    expect(hook!.status.state).toBe("failed")
    expect(hook!.status.failingFieldKeys).toEqual([JSON.stringify(step.segments)])
    expect(hook!.stateOf(step)).toBe("failed")
    expect(hook!.errorOf(step)).toBe("Step timeout must be at least 1s.")
    expect(hook!.valueOf(step)).toBe("0s")
    expect(localStorage.getItem(STORAGE_KEY)).toContain("0s")

    await advance(SETTLE_DELAY_MS * 5)
    expect(hook!.status.state).toBe("failed")
    expect(writeCalls()).toHaveLength(1)

    await run((h) => h.retry())
    expect(writeCalls()).toHaveLength(2)
    expect(writeCalls()[1]).toEqual([{ op: "set", path: ["use", "timeout", "step"], value: "0s" }])
    expect(hook!.status.state).toBe("saved")
    expect(hook!.stateOf(step)).toBe("clean")
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it("FORCED-FAILURE-KEEPS-DRAFT: a network failure keeps every carried value as a draft", async () => {
    vi.mocked(applyConfigChanges).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await mount()
    await run((h) => {
      h.edit(headless, false, { valid: true, value: false })
      h.settle(headless)
    })
    expect(hook!.status.state).toBe("failed")
    expect(hook!.stateOf(headless)).toBe("draft")
    expect(hook!.valueOf(headless)).toBe(false)
  })

  it("SECRET-NEVER-IN-STORAGE: drafts on secret-class paths never reach browser storage", async () => {
    vi.mocked(applyConfigChanges).mockRejectedValueOnce(new TypeError("Failed to fetch"))
    await mount()
    await run((h) => {
      h.edit(modelHeader, "Bearer sk-live-999", { valid: true, value: "Bearer sk-live-999" })
      h.settle(modelHeader)
    })
    await run((h) => h.edit(farmKey, "AKIA-SECRET-123", { valid: false, error: "Too short." }))
    await run((h) => h.edit(step, "soon", durationParse("soon")))

    expect(hook!.stateOf(modelHeader)).toBe("draft")
    expect(hook!.stateOf(farmKey)).toBe("draft")
    expect(hook!.stateOf(step)).toBe("draft")

    const text = storedText()
    expect(text).toContain("soon")
    expect(text).not.toContain("sk-live-999")
    expect(text).not.toContain("AKIA-SECRET-123")
    expect(text).not.toContain("accessKey")
    expect(text).not.toContain("providerHeaders")
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<string, { segments: ConfigPathSegment[] }>
    for (const entry of Object.values(stored)) {
      expect(classOf(entry.segments)).not.toBe("secret")
    }
  })

  it("SECRET-NEVER-IN-STORAGE: a secret draft planted in storage is dropped on load", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [JSON.stringify(farmKey.segments)]: { segments: farmKey.segments, tab: "targets", raw: "AKIA-PLANTED" },
      }),
    )
    await mount()
    expect(hook!.stateOf(farmKey)).toBe("clean")
    expect(hook!.valueOf(farmKey)).toBe("••••••••")
    expect(storedText()).not.toContain("AKIA-PLANTED")
  })

  it("RETRY-WHILE-SAVING-NO-DOUBLE-WRITE: Retry during a write starts nothing; later settles join the next write", async () => {
    vi.mocked(applyConfigChanges).mockRejectedValueOnce(
      new ApiError(422, "Unprocessable Entity", {
        error: "validation_failed",
        issues: [{ path: ["use", "timeout", "step"], message: "Step timeout must be at least 1s." }],
      }),
    )
    await mount()
    await run((h) => {
      h.edit(step, "0s", durationParse("0s"))
      h.settle(step)
    })
    expect(hook!.status.state).toBe("failed")

    const flight = deferred<{ revision: string }>()
    vi.mocked(applyConfigChanges).mockReturnValueOnce(flight.promise)
    await run((h) => {
      h.edit(headless, false, { valid: true, value: false })
      h.settle(headless)
    })
    expect(writeCalls()).toHaveLength(2)
    expect(writeCalls()[1]).toEqual([{ op: "set", path: ["use", "browser", "headless"], value: false }])
    expect(hook!.stateOf(headless)).toBe("saving")

    await run((h) => h.retry())
    await run((h) => h.retry())
    await run((h) => {
      h.edit(envFile, ".env", textParse(".env"))
      h.settle(envFile)
    })
    await advance(SETTLE_DELAY_MS * 2)
    expect(writeCalls()).toHaveLength(2)

    await act(async () => {
      flight.resolve({ revision: "rev-2" })
    })
    await flush()

    expect(writeCalls()).toHaveLength(3)
    expect(writeCalls()[2]).toEqual(
      expect.arrayContaining([
        { op: "set", path: ["use", "timeout", "step"], value: "0s" },
        { op: "set", path: ["workspace", "envFile"], value: ".env" },
      ]),
    )
    expect(writeCalls()[2]).toHaveLength(2)
    await advance(SETTLE_DELAY_MS * 2)
    expect(writeCalls()).toHaveLength(3)
  })
})

const editedOutside = {
  ...baseConfig,
  use: { timeout: { step: "2m", test: "20m" }, browser: { headless: false } },
}

describe("useConfigAutosave outside edits, explicit actions and Undo (429-16 Task 2)", () => {
  it("OUTSIDE-EDIT-MERGES-QUIETLY: a revision the page did not write re-reads the config and shows the new value", async () => {
    await mount()
    vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: "rev-9" })
    vi.mocked(fetchConfig).mockResolvedValue(answer(editedOutside, "rev-9") as never)

    await advance(REVISION_POLL_MS)

    expect(fetchConfig).toHaveBeenCalledTimes(2)
    expect(hook!.valueOf(headless)).toBe(false)
    expect(hook!.valueOf(step)).toBe("2m")
    expect(hook!.status.state).toBe("idle")
    expect(hook!.load.kind).toBe("ready")

    await advance(REVISION_POLL_MS * 3)
    expect(fetchConfig).toHaveBeenCalledTimes(2)
  })

  it("OWN-WRITE-NO-REFETCH: a poll answering the revision this page just wrote re-reads nothing", async () => {
    await mount()
    await run((h) => {
      h.edit(headless, false, { valid: true, value: false })
      h.settle(headless)
    })
    vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: "rev-2" })

    await advance(REVISION_POLL_MS * 3)

    expect(vi.mocked(fetchConfigRevision).mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(fetchConfig).toHaveBeenCalledTimes(1)
    expect(hook!.valueOf(headless)).toBe(false)
  })

  it("POLL-ONLY-WHEN-VISIBLE: a hidden page never polls; becoming visible or focused polls at once", async () => {
    setVisibility("hidden")
    await mount()
    await advance(REVISION_POLL_MS * 4)
    expect(fetchConfigRevision).not.toHaveBeenCalled()

    setVisibility("visible")
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await flush()
    expect(fetchConfigRevision).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })
    await flush()
    expect(fetchConfigRevision).toHaveBeenCalledTimes(2)

    await advance(REVISION_POLL_MS)
    expect(fetchConfigRevision).toHaveBeenCalledTimes(3)

    setVisibility("hidden")
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await advance(REVISION_POLL_MS * 4)
    expect(fetchConfigRevision).toHaveBeenCalledTimes(3)

    await unmount()
    setVisibility("visible")
    await advance(REVISION_POLL_MS * 4)
    expect(fetchConfigRevision).toHaveBeenCalledTimes(3)
  })

  it("REFRESH-NEVER-CLOBBERS-FOCUSED: an outside re-read keeps the focused field and every draft", async () => {
    await mount()
    await run((h) => h.setFocusedField(testTimeout))
    await run((h) => h.edit(step, "soon", durationParse("soon")))
    vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: "rev-9" })
    vi.mocked(fetchConfig).mockResolvedValue(answer(editedOutside, "rev-9") as never)

    await advance(REVISION_POLL_MS)

    expect(fetchConfig).toHaveBeenCalledTimes(2)
    expect(hook!.valueOf(headless)).toBe(false)
    expect(hook!.valueOf(testTimeout)).toBe("10m")
    expect(hook!.valueOf(step)).toBe("soon")
    expect(hook!.stateOf(step)).toBe("draft")

    await run((h) => h.setFocusedField(undefined))
    expect(hook!.valueOf(testTimeout)).toBe("20m")
    expect(hook!.valueOf(step)).toBe("soon")
  })

  it("REFRESH-NEVER-CLOBBERS-FOCUSED: a focused field's settled value survives a re-read until focus leaves", async () => {
    await mount()
    await run((h) => h.setFocusedField(envFile))
    await run((h) => {
      h.edit(envFile, ".env.ci", textParse(".env.ci"))
      h.settle(envFile)
    })
    vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: "rev-9" })
    vi.mocked(fetchConfig).mockResolvedValue(
      answer({ ...editedOutside, workspace: { envFile: ".env.other" } }, "rev-9") as never,
    )
    await advance(REVISION_POLL_MS)

    expect(hook!.valueOf(envFile)).toBe(".env.ci")
    await run((h) => h.setFocusedField(undefined))
    expect(hook!.valueOf(envFile)).toBe(".env.other")
  })

  it("UNDO-CALLS-SERVER: an explicit action writes undoable, offers Undo, and Undo restores through the server", async () => {
    vi.mocked(applyConfigChanges).mockResolvedValueOnce({
      revision: "rev-2",
      undo: { token: "tok-1", expiresAt: Date.now() + 30_000 },
    })
    vi.mocked(undoConfigAction).mockResolvedValue({ restored: true, revision: "rev-3" })
    await mount()
    const changes = [{ op: "unset" as const, path: ["registry", "llms", { name: "primary" }] }]

    await act(async () => {
      await hook!.runExplicit(changes, { kind: "delete-model", name: "primary" })
    })
    await flush()

    expect(applyConfigChanges).toHaveBeenCalledWith(changes, { undoable: true })
    expect(hook!.status.state).toBe("undo")
    expect(hook!.status.undo).toEqual({ line: undoLine("delete-model", "primary"), name: "primary", token: "tok-1" })

    vi.mocked(fetchConfig).mockResolvedValue(answer(baseConfig, "rev-3") as never)
    await act(async () => {
      await hook!.undo()
    })
    await flush()

    expect(undoConfigAction).toHaveBeenCalledWith("tok-1")
    expect(fetchConfig).toHaveBeenCalledTimes(2)
    expect(hook!.status.state).not.toBe("undo")
    expect(hook!.status.state).not.toBe("failed")
  })

  it("UNDO-CALLS-SERVER: the Undo line leaves after its window, and a refused Undo reads Couldn't save", async () => {
    vi.mocked(applyConfigChanges).mockResolvedValue({
      revision: "rev-2",
      undo: { token: "tok-2", expiresAt: Date.now() + 30_000 },
    })
    await mount()
    const changes = [{ op: "unset" as const, path: ["registry", "targets", "staging"] }]

    await act(async () => {
      await hook!.runExplicit(changes, { kind: "delete-target", name: "staging" })
    })
    expect(hook!.status.state).toBe("undo")
    await advance(UNDO_WINDOW_MS)
    expect(hook!.status.state).not.toBe("undo")

    await act(async () => {
      await hook!.runExplicit(changes, { kind: "delete-target", name: "staging" })
    })
    vi.mocked(undoConfigAction).mockRejectedValueOnce(new ApiError(409, "Conflict", { error: "undo_conflict" }))
    await act(async () => {
      await hook!.undo()
    })
    await flush()
    expect(undoConfigAction).toHaveBeenCalledWith("tok-2")
    expect(hook!.status.state).toBe("failed")
  })

  it("NOT-SAVED-GOES-TO-FIRST-DRAFT: the first draft by tab order is where Not saved goes", async () => {
    await mount()
    expect(hook!.goToFirstDraft()).toBeUndefined()

    await run((h) => h.edit(envFile, "  ", { valid: false, error: "Use a file path." }))
    await run((h) => h.edit(step, "soon", durationParse("soon")))

    expect(hook!.goToFirstDraft()).toEqual({ tab: "execution", fieldKey: JSON.stringify(step.segments) })
  })

  it("FILE-ISSUES-RECOVER-WITHOUT-RELOAD: a file that stops parsing shows the load error, and a fixed file returns by itself", async () => {
    await mount()
    vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: "rev-bad" })
    vi.mocked(fetchConfig).mockRejectedValue(
      new ApiError(409, "Conflict", { error: "file_invalid", message: "agent-qa.config.yaml line 3: bad indentation." }),
    )

    await advance(REVISION_POLL_MS)
    expect(hook!.load).toEqual({ kind: "error", reason: "agent-qa.config.yaml line 3: bad indentation" })
    expect(fetchConfig).toHaveBeenCalledTimes(2)

    await advance(REVISION_POLL_MS * 2)
    expect(fetchConfig).toHaveBeenCalledTimes(2)

    vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: "rev-good" })
    vi.mocked(fetchConfig).mockResolvedValue(answer(editedOutside, "rev-good") as never)
    await advance(REVISION_POLL_MS)

    expect(hook!.load.kind).toBe("ready")
    expect(hook!.valueOf(step)).toBe("2m")
  })
})
