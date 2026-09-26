// @vitest-environment jsdom

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { classifyConfigPath, type ConfigPathSegment } from "@vostride/agent-qa-schema"

import { ApiError, applyConfigChanges, fetchConfig, fetchConfigRevision } from "@/lib/api"
import { SETTLE_DELAY_MS } from "@/lib/config-copy"
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

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  vi.mocked(fetchConfig).mockResolvedValue(answer(baseConfig) as never)
  vi.mocked(fetchConfigRevision).mockResolvedValue({ revision: "rev-1" })
  vi.mocked(applyConfigChanges).mockResolvedValue({ revision: "rev-2" })
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
