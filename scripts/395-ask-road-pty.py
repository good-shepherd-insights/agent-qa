#!/usr/bin/env python3
"""Drive the shipped `agent-qa ask` under a REAL pty and record what a person SEES (395-22 · L6).

The round-4 verification's stated bound was that it never drove `agent-qa ask` against a live
planner — it substituted a stub model. This closes that inch, k=1, on the shipped `dist/cli.js`.

WHY A PTY AND NOT A PIPE. `createTtyConfirmPort` returns a real prompt only when BOTH streams are
TTYs; under pipes the execution context resolves `local-headless`, the gate denies before any prompt
exists, and the ordering this leg is about is unmeasurable. A pipe would produce a green that
measures nothing — the exact failure class this phase keeps finding.

WHAT IT PRINTS. The whole pty stream to the transcript path given, plus one machine-readable verdict
line on stdout naming, by byte offset, where the render markers and the approval prompt fell.

usage: 395-ask-road-pty.py <cwd> <cli-entry> <utterance> <transcript-path> <timeout-seconds>
"""

import os
import pty
import re
import select
import sys
import time

ANSI = re.compile(rb'\x1b\[[0-9;]*[A-Za-z]')
PROMPT = re.compile(rb'needs your approval\. Proceed\? \[y/')


def main() -> int:
    cwd, cli_entry, utterance, transcript, timeout_s = sys.argv[1:6]
    timeout = float(timeout_s)

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.environ['NO_COLOR'] = '1'
        os.environ['TERM'] = 'dumb'
        os.execvp('node', ['node', cli_entry, 'ask', utterance])
        os._exit(127)

    buf = bytearray()
    declined = False
    deadline = time.time() + timeout
    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.5)
        if not ready:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        buf.extend(chunk)
        # DECLINE, ONCE. This leg measures what was on the terminal BEFORE the decision; answering
        # yes would apply a configuration change and turn a read into a write.
        if not declined and PROMPT.search(ANSI.sub(b'', bytes(buf))):
            time.sleep(0.2)
            os.write(fd, b'n\n')
            declined = True

    try:
        os.close(fd)
    except OSError:
        pass
    try:
        _, status = os.waitpid(pid, os.WNOHANG)
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
        [f'prompt={prompt_at}', f'declined={int(declined)}', f'status={status}',
         f'bytes={len(clean)}']
        + [f'{name}={offset}' for name, offset in markers.items()]))
    return 0


if __name__ == '__main__':
    sys.exit(main())
