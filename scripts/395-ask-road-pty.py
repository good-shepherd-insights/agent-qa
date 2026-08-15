#!/usr/bin/env python3
"""Drive the shipped `agent-qa ask` under a REAL pty and record what a person SEES (395-22 · L6).

The round-4 verification's stated bound was that it never drove `agent-qa ask` against a live
planner — it substituted a stub model. This closes that inch, k=1, on the shipped `dist/cli.js`.

WHY A PTY AND NOT A PIPE. `createTtyConfirmPort` returns a real prompt only when BOTH streams are
TTYs; under pipes the execution context resolves `local-headless`, the gate denies before any prompt
exists, and the ordering this leg is about is unmeasurable. A pipe would produce a green that
measures nothing — the exact failure class this phase keeps finding.

WHAT IT PRINTS. The whole pty stream to the transcript path given, plus one machine-readable verdict
line on stdout naming, by byte offset, where the render markers and the approval prompt fell, plus
`timedout`, the child's REAL exit code, and the child's pid so a caller can assert nothing survived.

A HANG IS A FAILED MEASUREMENT, NOT AN ABSENT ONE (395-28 · CR-04). Until this round the wait was
non-blocking — `os.waitpid` with the don't-hang flag, which returns `(0, 0)` for a child that has
NOT exited, and the flag's own name does not appear in this file any more so a grep can tell the
two revisions apart. A wedged drive therefore
printed `status=0`, a clean-exit verdict, for a process still running. The shell read the
absent prompt as SKIP, SKIP does not set the lane's return code, and the lane went green having
measured nothing. Measured pre-fix on a child that never exits: `status=0`, no timeout field at all,
and — for a child that ignores SIGHUP, so the pty master's close does not take it down — the process
still alive and reparented to init after the driver returned. Three things change below: the loop
records WHETHER it fell out on the deadline, a timed-out child is SIGKILLed (not merely hung up on)
and then reaped with a BLOCKING wait, and the raw wait status is converted into a real exit code.

usage: 395-ask-road-pty.py <cwd> <cli-entry> <utterance> <transcript-path> <timeout-seconds>
"""

import os
import pty
import re
import select
import signal
import sys
import time

ANSI = re.compile(rb'\x1b\[[0-9;]*[A-Za-z]')
PROMPT = re.compile(rb'needs your approval\. Proceed\? \[y/')

# THE CHILD COULD NOT BE LAUNCHED AT ALL — distinct from any exit code `agent-qa` itself produces.
# Pre-fix, an `execvp` that raised unwound through the interpreter's own traceback path INSIDE the
# forked child: the traceback landed in the transcript where the CLI's output should be, the child
# died with raw status 256, and the child then re-entered `main`'s own `print`, so a launch failure
# could emit a SECOND verdict line. Guarded below with `os._exit`, which runs no handlers.
LAUNCH_FAILED = 126


def main() -> int:
    cwd, cli_entry, utterance, transcript, timeout_s = sys.argv[1:6]
    timeout = float(timeout_s)

    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.chdir(cwd)
            os.environ['NO_COLOR'] = '1'
            os.environ['TERM'] = 'dumb'
            os.execvp('node', ['node', cli_entry, 'ask', utterance])
        except BaseException:  # noqa: BLE001 — a forked child must never unwind into the parent's code
            os._exit(LAUNCH_FAILED)
        os._exit(LAUNCH_FAILED)

    buf = bytearray()
    declined = False
    # TRACKED, NOT INFERRED. `time.time() >= deadline` after the loop would also be true for a child
    # that exited during the final `select`, which would report a healthy drive as a hang. This flag
    # is cleared only on the two ways the loop ends because the CHILD ended.
    timed_out = True
    deadline = time.time() + timeout
    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.5)
        if not ready:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            timed_out = False
            break
        if not chunk:
            timed_out = False
            break
        buf.extend(chunk)
        # DECLINE, ONCE. This leg measures what was on the terminal BEFORE the decision; answering
        # yes would apply a configuration change and turn a read into a write.
        if not declined and PROMPT.search(ANSI.sub(b'', bytes(buf))):
            time.sleep(0.2)
            os.write(fd, b'n\n')
            declined = True

    # KILL BEFORE CLOSING, AND KILL RATHER THAN HANG UP. Closing the pty master delivers SIGHUP to
    # the child's foreground process group, which is enough for a child with default handlers and is
    # NOT enough for one that installs its own — and "enough on this platform, for this child" is not
    # a property an instrument may rely on. SIGKILL cannot be handled.
    if timed_out:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    try:
        os.close(fd)
    except OSError:
        pass
    # BLOCKING, so the child is genuinely reaped rather than asked about and abandoned.
    try:
        _, raw = os.waitpid(pid, 0)
        status = os.WEXITSTATUS(raw) if os.WIFEXITED(raw) else -os.WTERMSIG(raw)
    except OSError:
        status = -1

    clean = ANSI.sub(b'', bytes(buf))
    with open(transcript, 'wb') as handle:
        handle.write(clean)

    prompt_match = PROMPT.search(clean)
    prompt_at = prompt_match.start() if prompt_match else -1
    # THE RENDER MARKERS, each named so a partial render is legible rather than a boolean. The
    # summary line the scaffold op emits always carries "configure this project for"; the file list
    # always carries the config file; the true unified diff always carries a hunk header.
    markers = {
        'summary': clean.find(b'configure this project for'),
        'files': clean.find(b'agent-qa.config.yaml'),
        'diff': clean.find(b'@@'),
    }
    print('L6-VERDICT ' + ' '.join(
        [f'prompt={prompt_at}', f'declined={int(declined)}', f'timedout={int(timed_out)}',
         f'status={status}', f'pid={pid}', f'bytes={len(clean)}']
        + [f'{name}={offset}' for name, offset in markers.items()]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
