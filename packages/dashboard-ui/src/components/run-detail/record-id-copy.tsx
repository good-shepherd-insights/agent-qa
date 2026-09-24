// 427 · D-19 / E8 — the copy button beside every record id in Retrieval details.
//
// The status logic is ReviewCommandButton's, not IdBadge's: the check shows only after a write
// resolved, and a missing clipboard or a rejected write is announced as a failure that spells the
// id out, so it can still be selected by hand. Only the id string the view holds is written.

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"

import { Button } from "@/components/ui/button"
import { RECORD_ID_COPIED_TEXT, copyRecordIdLabel, recordIdCopyFailedText } from "@/lib/knowledge-view"

type CopyStatus = "idle" | "copied" | "failed"

export function RecordIdCopy({ id, className }: { id: string; className?: string }) {
  const [status, setStatus] = useState<CopyStatus>("idle")
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { clearTimeout(reset.current) }, [])

  const handleCopy = () => {
    clearTimeout(reset.current)
    const written = navigator.clipboard?.writeText(id)
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
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        data-record-id-copy
        data-copy-status={status}
        aria-label={copyRecordIdLabel(id)}
        onClick={handleCopy}
        className={`shrink-0 align-middle ${className ?? ""}`}
      >
        {status === "copied"
          ? <Check className="size-3.5 text-emerald-500" aria-hidden="true" />
          : <Copy className="size-3.5" aria-hidden="true" />}
      </Button>
      <span data-record-id-copy-status role="status" aria-live="polite" className="sr-only">
        {status === "copied" ? RECORD_ID_COPIED_TEXT : status === "failed" ? recordIdCopyFailedText(id) : ""}
      </span>
    </>
  )
}
