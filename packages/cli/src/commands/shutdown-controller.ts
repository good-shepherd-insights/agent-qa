// SESSION-04 / RUNX-02 (D1): the CLI's run-level SIGINT/SIGTERM controller. Extracted from the
// inline `handleShutdown` in run.ts so the first-vs-second-signal contract is unit-testable in
// isolation with plain injected seams (no real signals, no real timers).
//
// The FIRST signal runs the graceful path: mark exit code 130, route the abort into the active
// RunSession cancel, arm the unref'd force-exit grace-timer backstop (owned by the caller — the
// `setTimeout(() => process.exit(130), cancelGraceMs())` + `grace.unref?.()` + `clearTimeout` stay
// verbatim in run.ts so the 361-13 backstop source anchors remain intact), and best-effort
// finalize this process's own run row as `cancelled`. It NEVER force-exits synchronously — a
// clean settle exits through the verdict map.
//
// A SECOND (and any further) signal is a HARD force-exit: it calls `exit(130)` immediately,
// independent of the grace timer and of any wedged async `done`. Once the block from 364-02 is gone
// the event loop is free, so a repeated Ctrl+C is always effective the instant it is dispatched —
// the user never has to wait out the grace window on a genuinely un-settleable run.

export interface ShutdownControllerDeps {
  /** Route the abort into the active RunSession (`activeRunSession?.cancel()`). Best-effort. */
  cancel: () => void
  /** Hard force-exit (`process.exit`). Used ONLY on the second-and-further signal, immediately. */
  exit: (code: number) => void
  /** Mark the graceful exit code + shutdown-requested state on the first signal (`process.exitCode = code`). */
  setExitCode: (code: number) => void
  /**
   * Arm the unref'd force-exit grace-timer backstop. Owned by the caller (run.ts) so the literal
   * `setTimeout(() => process.exit(130), cancelGraceMs())` + `grace.unref?.()` stay in run.ts and
   * the 361-13 backstop anchors hold. Invoked once, on the first signal only.
   */
  armGrace: () => void
  /** Best-effort cancel of this process's own run row. Optional; never throws out of the handler. */
  finalizeOwnRun?: () => void
}

export interface ShutdownController {
  /** The single SIGINT/SIGTERM handler registered via `process.on` at both run sites. */
  handleSignal: () => void
  /** Detach at teardown so a late signal after `session.done` is inert (mirrors removeListener). */
  dispose: () => void
}

export function createShutdownController(deps: ShutdownControllerDeps): ShutdownController {
  let signalCount = 0
  let disposed = false

  const handleSignal = (): void => {
    if (disposed) return
    signalCount += 1

    if (signalCount >= 2) {
      // HARD second-signal force-exit: fires immediately, independent of the grace timer and of any
      // wedged async work. A repeated Ctrl+C always terminates the CLI once the event loop is free.
      deps.exit(130)
      return
    }

    // First signal — the graceful path. Never force-exits synchronously.
    deps.setExitCode(130)
    try {
      deps.cancel()
    } catch {
      /* cancel is best-effort */
    }
    deps.armGrace()
    if (deps.finalizeOwnRun) {
      try {
        deps.finalizeOwnRun()
      } catch {
        /* best-effort cleanup — a wedged DB must never break the shutdown handler */
      }
    }
  }

  const dispose = (): void => {
    disposed = true
  }

  return { handleSignal, dispose }
}
