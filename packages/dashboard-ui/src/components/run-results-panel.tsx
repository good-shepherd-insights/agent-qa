import { useState, useEffect, useRef, useMemo } from "react"
import { X, CheckCircle2, XCircle, CircleDashed, Clock, RefreshCw, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { openRunStream } from "@/lib/api"
import {
  createInitialRunStreamState,
  reduceRunStream,
  type RunStreamState,
} from "@/lib/run-stream-reducer"
import { finalStepStatusForRun, getRunStatusDescriptor, normalizeStepStatus } from "@/lib/status"
import { formatDuration } from "@/lib/utils"
import { cn } from "@/lib/utils"

// THE ONE LIVE WIRE (405-03 · D-19). This panel used to read the legacy `/api/execution/events`
// projection through `subscribeToExecutionEvents`; that feed's UI half is retired. It now folds the
// SAME frozen envelopes `pages/live-run.tsx` folds, through the SAME pure reducer, so the editor's
// panel and the live page cannot drift into two accounts of one run.
//
// A PANEL OPENED AFTER THE RUN ENDED IS SERVED BY REPLAY, not by a second durable read. The local
// run-stream door replays the log from the beginning and then closes at `runFinished`, so the
// reducer reaches the same terminal state either way — which is why there is no `fetchRunDetail`
// fallback here for a finished run.

interface StepInfo {
  name: string
  status: string
  duration?: number
}

interface RunResultsPanelProps {
  runId: string | null
  onClose: () => void
}

export function RunResultsPanel({ runId, onClose }: RunResultsPanelProps) {
  const [state, setState] = useState<RunStreamState>(createInitialRunStreamState)
  const [runStatus, setRunStatus] = useState<
    "connecting" | "running" | "complete" | "error"
  >("connecting")
  const [streamError, setStreamError] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!runId) return

    let cancelled = false
    setState(createInitialRunStreamState())
    setRunStatus("connecting")
    setStreamError(false)
    setElapsed(0)

    // Start elapsed timer
    const startTime = Date.now()
    timerRef.current = setInterval(() => {
      if (!cancelled) setElapsed(Date.now() - startTime)
    }, 200)

    const stopTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    const source = openRunStream(runId, {
      onEvent: (envelope) => {
        if (cancelled) return
        setStreamError(false)
        setRunStatus("running")
        setState((previous) => reduceRunStream(previous, envelope, Date.now()))
      },
      onFinished: () => {
        if (cancelled) return
        stopTimer()
      },
      onError: () => {
        if (cancelled) return
        setStreamError(true)
        stopTimer()
      },
    })

    return () => {
      cancelled = true
      stopTimer()
      source.close()
    }
  }, [runId])

  // The run's own word for how it ended, as the reducer recorded it. `verdict` is first-verdict-wins
  // there, so this cannot flip once the run has answered.
  const finalStatus = state.verdict
  const terminalDescriptor = finalStatus ? getRunStatusDescriptor(finalStatus) : null

  // The timer stops when the run answers — `runFinished` may never arrive on a stream the browser
  // dropped, but a verdict is an ending either way.
  useEffect(() => {
    if (finalStatus === undefined) return
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [finalStatus])

  const steps = useMemo<StepInfo[]>(() => {
    // The reducer keeps rows in bus seq order — the run's own total order, never arrival order.
    return state.steps.map((row) => ({
      name: row.text,
      // A row still running when the run ended takes the run's ending, so a stream that stopped
      // mid-step never leaves a spinner claiming work is still happening.
      status: row.status === "running" && finalStatus !== undefined
        ? finalStepStatusForRun(finalStatus)
        : normalizeStepStatus(row.status),
      duration: row.durationMs,
    }))
  }, [state.steps, finalStatus])

  if (!runId) return null

  const posture: "connecting" | "running" | "complete" | "error" = terminalDescriptor
    ? (terminalDescriptor.normalized === "passed" ? "complete" : "error")
    : streamError
    ? "error"
    : runStatus

  const inFlight = posture === "running" || posture === "connecting"
  const headerLabel = posture === "connecting"
    ? "Connecting..."
    : posture === "running"
    ? "Running"
    : terminalDescriptor?.label ?? (posture === "complete" ? "Passed" : "Failed")

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {inFlight ? (
            <CircleDashed className="size-4 text-primary" />
          ) : terminalDescriptor?.normalized === "passed" || posture === "complete" ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : terminalDescriptor?.normalized === "cancelled" ? (
            <Square className="size-4 text-muted-foreground" />
          ) : terminalDescriptor?.normalized === "flaky" || terminalDescriptor?.normalized === "healed" ? (
            <RefreshCw className="size-4 text-amber-500" />
          ) : (
            <XCircle className="size-4 text-red-500" />
          )}
          <span className="text-sm font-medium">{headerLabel}</span>
          {inFlight && (
            <Badge variant="outline" className="text-xs gap-1">
              <Clock className="size-3" />
              {formatDuration(elapsed)}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Steps list */}
      <ScrollArea className="flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
        <div className="p-3 space-y-1.5">
          {steps.map((step, i) => (
            <div
              key={`${step.name}-${i}`}
              data-step-status={step.status}
              className={cn(
                "relative overflow-hidden flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
                step.status === "running" && "live-running-surface border-border/60 bg-primary/5",
                step.status === "passed" && "border-emerald-500/20 bg-emerald-500/5",
                step.status === "failed" && "border-destructive/20 bg-destructive/5",
                step.status === "cancelled" && "border-border/60 bg-muted/30",
                step.status === "flaky" && "border-amber-500/20 bg-amber-500/5",
                step.status !== "running"
                  && step.status !== "passed"
                  && step.status !== "failed"
                  && step.status !== "cancelled"
                  && step.status !== "flaky"
                  && "border-border/60 bg-card/40",
              )}
            >
              {step.status === "running" ? (
                <CircleDashed className="size-3.5 mt-0.5 shrink-0 text-primary" />
              ) : step.status === "passed" || step.status === "completed" ? (
                <CheckCircle2 className="size-3.5 mt-0.5 text-emerald-500 shrink-0" />
              ) : step.status === "cancelled" ? (
                <Square className="size-3.5 mt-0.5 text-muted-foreground shrink-0" />
              ) : step.status === "flaky" || step.status === "healed" ? (
                <RefreshCw className="size-3.5 mt-0.5 text-amber-500 shrink-0" />
              ) : (
                <XCircle className="size-3.5 mt-0.5 text-red-500 shrink-0" />
              )}
              <span className="flex-1 min-w-0 break-words">{step.name}</span>
              {step.duration !== undefined && (
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDuration(step.duration)}
                </span>
              )}
            </div>
          ))}
          {steps.length === 0 && posture === "connecting" && (
            <div className="text-sm text-muted-foreground text-center py-8">
              Waiting for events...
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
