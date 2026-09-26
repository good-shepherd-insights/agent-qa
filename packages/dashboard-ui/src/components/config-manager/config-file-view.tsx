// THE CONFIG FILE, READ-ONLY (429-28 · D-05, D-09 · UI-SPEC S7 "Config file", S8, E10).
//
// The whole file exactly as the server masked it, one numbered line per item; the page never
// decides masking. Nothing here is editable: the file is edited in the owner's editor and arrives
// as an outside edit. A secret line carries its own eye, which fetches that one value per click and
// masks it again when focus leaves the line, on unmount (a tab change) and when the page hides.

import { useEffect, useRef, useState, type FocusEvent } from "react"
import { Check, Copy, Eye, EyeOff, LoaderCircle } from "lucide-react"
import { CONFIG_MASK_PLACEHOLDER } from "@vostride/agent-qa-schema"

import { Button } from "@/components/ui/button"
import { useConfigAutosaveContext } from "@/hooks/use-config-autosave"
import { revealConfigValue, type ConfigFileLine } from "@/lib/api"
import {
  CONFIG_FILE_NOTE,
  COPY_PATH_LABEL,
  COPY_STATUS_WORDS,
  REVEAL_FAILED_TEXT,
  hideValueName,
  showValueName,
} from "@/lib/config-copy"
import type { RevealState } from "@/lib/config-tabs"

type CopyStatus = "idle" | "copied" | "failed"

const COPIED_VISIBLE_MS = 2_000

function CopyPathButton({ path }: { path: string }) {
  const [status, setStatus] = useState<CopyStatus>("idle")
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(reset.current), [])

  function copy() {
    clearTimeout(reset.current)
    setStatus("idle")
    const written = navigator.clipboard?.writeText(path)
    if (written === undefined) {
      setStatus("failed")
      return
    }
    void written.then(
      () => {
        setStatus("copied")
        reset.current = setTimeout(() => setStatus("idle"), COPIED_VISIBLE_MS)
      },
      () => setStatus("failed"),
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={COPY_PATH_LABEL}
        data-copy-status={status}
        onClick={copy}
      >
        {status === "copied" ? (
          <Check data-copy-icon="check" className="size-3.5" aria-hidden="true" />
        ) : (
          <Copy data-copy-icon="copy" className="size-3.5" aria-hidden="true" />
        )}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {status === "idle" ? "" : COPY_STATUS_WORDS[status]}
      </span>
    </>
  )
}

function lineLabel(line: ConfigFileLine): string {
  const key = [...(line.path ?? [])].reverse().find((segment): segment is string => typeof segment === "string")
  return key ?? `line ${line.n}`
}

function withValue(text: string, value: string): string {
  const at = text.lastIndexOf(CONFIG_MASK_PLACEHOLDER)
  if (at === -1) return `${text} ${value}`
  return text.slice(0, at) + value + text.slice(at + CONFIG_MASK_PLACEHOLDER.length)
}

function SecretLine({ line }: { line: ConfigFileLine & { path: NonNullable<ConfigFileLine["path"]> } }) {
  const [revealState, setRevealState] = useState<RevealState>("masked")
  const [revealed, setRevealed] = useState<string | undefined>(undefined)
  // Bumped on every mask, so a reveal answer that lands after it is dropped.
  const request = useRef(0)

  function mask() {
    request.current += 1
    setRevealed(undefined)
    setRevealState((state) => (state === "revealed" || state === "loading" ? "masked" : state))
  }

  useEffect(() => {
    const hide = () => mask()
    const hideWhenHidden = () => {
      if (document.visibilityState === "hidden") mask()
    }
    window.addEventListener("pagehide", hide)
    document.addEventListener("visibilitychange", hideWhenHidden)
    return () => {
      request.current += 1
      window.removeEventListener("pagehide", hide)
      document.removeEventListener("visibilitychange", hideWhenHidden)
    }
  }, [])

  async function toggle() {
    if (revealState === "revealed" || revealState === "loading") {
      mask()
      return
    }
    const id = ++request.current
    setRevealState("loading")
    try {
      const { value } = await revealConfigValue([...line.path])
      if (id !== request.current) return
      setRevealed(value)
      setRevealState("revealed")
    } catch {
      if (id !== request.current) return
      setRevealState("failed")
    }
  }

  function leaveLine(event: FocusEvent<HTMLLIElement>) {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    mask()
  }

  const shown = revealState === "revealed" && revealed !== undefined
  const label = lineLabel(line)

  return (
    <li data-line={line.n} data-masking-class="secret" data-reveal-state={revealState} onBlur={leaveLine}>
      {shown ? withValue(line.text, revealed) : line.text}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="ml-1 align-middle"
        aria-pressed={shown}
        aria-label={shown ? hideValueName(label) : showValueName(label)}
        onClick={() => void toggle()}
      >
        {revealState === "loading" ? (
          <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
        ) : shown ? (
          <EyeOff className="size-3.5" aria-hidden="true" />
        ) : (
          <Eye className="size-3.5" aria-hidden="true" />
        )}
      </Button>
      {revealState === "failed" ? <span className="ml-2 font-sans text-destructive">{REVEAL_FAILED_TEXT}</span> : null}
    </li>
  )
}

export function ConfigFileView() {
  const autosave = useConfigAutosaveContext()
  if (autosave.load.kind !== "ready") return null
  const { path, lines } = autosave.load.answer.file

  return (
    <>
      {path === null ? null : (
        <div className="flex items-center gap-1">
          <code data-config-file-path className="min-w-0 font-mono text-xs wrap-anywhere">
            {path}
          </code>
          <CopyPathButton path={path} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">{CONFIG_FILE_NOTE}</p>
      <div data-config-file-view className="overflow-x-auto rounded-md border border-border bg-muted/40 p-4">
        <ol className="font-mono text-xs whitespace-pre">
          {lines.map((line) =>
            line.class === "secret" && line.path !== undefined ? (
              // Keyed by its content too, so a line an outside edit changed starts masked again.
              <SecretLine key={`${line.n}:${JSON.stringify(line.path)}:${line.text}`} line={{ ...line, path: line.path }} />
            ) : (
              <li key={line.n} data-line={line.n} data-masking-class={line.class ?? "plain"}>
                {line.text}
              </li>
            ),
          )}
        </ol>
      </div>
    </>
  )
}
