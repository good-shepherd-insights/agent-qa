// ONE SECRET VALUE (429-19 · D-08, D-09, D-17 · UI-SPEC S8, E11).
//
// The server's masked text is shown verbatim. The eye fetches one value per click and the value
// lives only in this component's state, gone again when focus leaves the group, on unmount (a tab
// change) and when the page hides. Editing is replace-only: the input starts empty and is never
// given the masked text, so a mask can never be written back. Secrets never autosave.

import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react"
import { Eye, EyeOff, LoaderCircle } from "lucide-react"
import type { ConfigPathSegment } from "@vostride/agent-qa-schema"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useConfigAutosaveContext } from "@/hooks/use-config-autosave"
import { revealConfigValue } from "@/lib/api"
import {
  KEEP_CURRENT_VALUE_LABEL,
  REPLACE_VALUE_LABEL,
  REVEAL_FAILED_TEXT,
  SAVE_VALUE_LABEL,
  hideValueName,
  keepValueName,
  replaceValueName,
  saveValueName,
  showValueName,
} from "@/lib/config-copy"
import type { RevealState } from "@/lib/config-tabs"

export interface SecretValueTarget {
  segments: readonly ConfigPathSegment[]
  /** The leaf's schema pattern, for example registry.providers.*.* */
  pattern: string
}

export interface SecretValueProps {
  field: SecretValueTarget
  label: string
  maskedText: string
}

export function SecretValue({ field, label, maskedText }: SecretValueProps) {
  const autosave = useConfigAutosaveContext()
  const [revealState, setRevealState] = useState<RevealState>("masked")
  const [revealed, setRevealed] = useState<string | undefined>(undefined)
  const [replacing, setReplacing] = useState(false)
  const [typed, setTyped] = useState("")
  const [saving, setSaving] = useState(false)
  // Bumped on every mask, so a reveal answer that lands after it is dropped.
  const request = useRef(0)
  const mounted = useRef(false)
  const focusReplaceNext = useRef(false)
  const replaceButton = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)

  function mask() {
    request.current += 1
    setRevealed(undefined)
    setRevealState((state) => (state === "revealed" || state === "loading" ? "masked" : state))
  }

  useEffect(() => {
    mounted.current = true
    const hide = () => mask()
    const hideWhenHidden = () => {
      if (document.visibilityState === "hidden") mask()
    }
    window.addEventListener("pagehide", hide)
    document.addEventListener("visibilitychange", hideWhenHidden)
    return () => {
      mounted.current = false
      request.current += 1
      window.removeEventListener("pagehide", hide)
      document.removeEventListener("visibilitychange", hideWhenHidden)
    }
  }, [])

  useEffect(() => {
    if (replacing) {
      input.current?.focus()
    } else if (focusReplaceNext.current) {
      focusReplaceNext.current = false
      replaceButton.current?.focus()
    }
  }, [replacing])

  async function toggleReveal() {
    if (revealState === "revealed" || revealState === "loading") {
      mask()
      return
    }
    const id = ++request.current
    setRevealState("loading")
    try {
      const { value } = await revealConfigValue([...field.segments])
      if (id !== request.current) return
      setRevealed(value)
      setRevealState("revealed")
    } catch {
      if (id !== request.current) return
      setRevealState("failed")
    }
  }

  function leaveGroup(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    mask()
  }

  function startReplace() {
    request.current += 1
    setRevealed(undefined)
    setRevealState("masked")
    setTyped("")
    setReplacing(true)
  }

  function closeReplace() {
    setTyped("")
    focusReplaceNext.current = true
    setReplacing(false)
  }

  async function save() {
    if (typed === "" || saving) return
    setSaving(true)
    const landed = await autosave.runExplicit([{ op: "set", path: [...field.segments], value: typed }])
    if (!mounted.current) return
    setSaving(false)
    if (landed) closeReplace()
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault()
      void save()
    } else if (event.key === "Escape") {
      event.preventDefault()
      closeReplace()
    }
  }

  const shown = revealState === "revealed" && revealed !== undefined

  return (
    <div className="space-y-1">
      <div
        data-secret-field
        data-field-path={field.pattern}
        data-reveal-state={revealState}
        onBlur={leaveGroup}
        className="flex max-w-md items-center gap-1"
      >
        {replacing ? (
          <>
            <Input
              ref={input}
              type="password"
              autoComplete="off"
              aria-label={label}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={keyDown}
              className="h-8 min-w-0 flex-1 font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={saveValueName(label)}
              disabled={typed === "" || saving}
              onClick={() => void save()}
            >
              {SAVE_VALUE_LABEL}
            </Button>
            <Button type="button" variant="ghost" size="sm" aria-label={keepValueName(label)} onClick={closeReplace}>
              {KEEP_CURRENT_VALUE_LABEL}
            </Button>
          </>
        ) : (
          <>
            <code className="min-w-0 flex-1 font-mono text-sm wrap-anywhere">{shown ? revealed : maskedText}</code>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-pressed={shown}
              aria-label={shown ? hideValueName(label) : showValueName(label)}
              onClick={() => void toggleReveal()}
            >
              {revealState === "loading" ? (
                <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />
              ) : shown ? (
                <EyeOff className="size-3.5" aria-hidden="true" />
              ) : (
                <Eye className="size-3.5" aria-hidden="true" />
              )}
            </Button>
            <Button
              ref={replaceButton}
              type="button"
              variant="outline"
              size="xs"
              aria-label={replaceValueName(label)}
              onClick={startReplace}
            >
              {REPLACE_VALUE_LABEL}
            </Button>
          </>
        )}
      </div>
      {revealState === "failed" && !replacing ? <p className="text-xs text-destructive">{REVEAL_FAILED_TEXT}</p> : null}
    </div>
  )
}
