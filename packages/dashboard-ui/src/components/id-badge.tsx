import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"

import { REVIEW_COMMAND_COPIED_TEXT, reviewCommandCopyFailedText } from "@/lib/knowledge-view"

export function IdBadge({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  const truncated = value.length > 16 ? value.slice(0, 16) + '\u2026' : value
  const handleCopy = () => {
    navigator.clipboard.writeText(value).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted/50 text-muted-foreground hover:text-foreground border border-border/50 transition-colors cursor-pointer"
    >
      <span className="opacity-60">{label}:</span>
      <span>{truncated}</span>
      {copied ? <Check className="h-2.5 w-2.5 text-emerald-400" /> : <Copy className="h-2.5 w-2.5 opacity-40" />}
    </button>
  )
}

type CopyStatus = "idle" | "copied" | "failed"

/**
 * A runnable review command, shown on the control and copied by it (423 D-19).
 *
 * A native button, so Enter and Space activate it and focus stays where it was. The command is the
 * visible text and leads nothing away from the page. The clipboard write is optional-chained and
 * awaited: outside a secure context there is no clipboard, and a rejected write is reported as a
 * failure that spells the command out rather than as a tick.
 */
export function ReviewCommandButton({
  command,
  label,
  className,
  ...attributes
}: {
  command: string
  label: string
  className?: string
} & { [attribute: `data-${string}`]: string | boolean }) {
  const [status, setStatus] = useState<CopyStatus>("idle")
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { clearTimeout(reset.current) }, [])

  const handleCopy = () => {
    clearTimeout(reset.current)
    const written = navigator.clipboard?.writeText(command)
    if (written === undefined) {
      setStatus("failed")
      return
    }
    void written.then(
      () => {
        setStatus("copied")
        reset.current = setTimeout(() => setStatus("idle"), 2000)
      },
      () => { setStatus("failed") },
    )
  }

  return (
    <>
      <button
        type="button"
        {...attributes}
        data-review-command={command}
        data-copy-status={status}
        aria-label={`${label}: ${command}`}
        title={label}
        onClick={handleCopy}
        className={`inline-flex items-center gap-1 wrap-anywhere ${className ?? ""}`}
      >
        <span>{command}</span>
        {status === "copied"
          ? <Check className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
          : <Copy className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />}
      </button>
      <span data-review-command-status role="status" aria-live="polite" className="sr-only">
        {status === "copied" ? REVIEW_COMMAND_COPIED_TEXT : status === "failed" ? reviewCommandCopyFailedText(command) : ""}
      </span>
    </>
  )
}
