# Running agent-qa in CI

`agent-qa run` works the same in CI as at a terminal. When `CI` is set and there is no terminal, it
prints no colour codes, spinners or prompts, and it never waits on stdin. It exits with the run's
verdict. After the verdict it spends a bounded tail on post-run analysis and curation.

This page covers what to keep from a CI job, what never to upload, how unfinished work shows, and
what resuming that work needs. It ends with one GitHub Actions job you can copy.

## What to upload, and when

Upload two things, before the workspace is torn down, even when the job fails:

- **Each run's directory under `.agent-qa/runs/`.** A run directory holds the run's event log
  (`events.jsonl`), its handoff (`handoff.json`), its evidence and its `run-config.json`.
  `run-config.json` records the absolute path of the config file the run used. That path is low
  sensitivity, but it does name a directory on the runner.
- **The JUnit report** that `--junit-output <path>` writes, for example `junit.xml`.

Upload them in a step that runs whatever the earlier steps did (`if: always()` on GitHub Actions). A
failed job is the one whose evidence you most need.

## What never to upload

- **`.agent-qa/` wholesale.** Upload `.agent-qa/runs/` and nothing else under `.agent-qa/`.
- **`runs.db` and `agent-jobs.db`** (with their `-wal` and `-shm` files). A `runs.db` row carries the
  run's config snapshot, including `.env` content. Only declared secrets are masked in it.
- **Saved auth state**, under `.agent-qa/auth-states/`.
- **The secrets file** that `workspace.secretsFile` names (for example `.env.secrets.local`), and
  `.env`.
- **The knowledge root's writer files**: `.lease`, `.epoch`, `.writer-authority.sqlite` and
  `memory/queue/`. They belong to the process that holds the knowledge root's writer lease.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The run passed or healed. |
| `1` | The run failed or timed out. A file the run needs that is missing or unreadable (a test file, `.env`, the hooks file or the secrets file) also exits 1, with an `Error:` line and no verdict. |
| `130` | The run was cancelled, for example by Ctrl+C or a signal from the CI runner. |
| `2` | The harness could not run the test. A test that could not start (no browser, a setup error) exits 2, and so does a run that was refused, a pattern that matched nothing, or a CLI that failed to load or threw before a run started (`Framework error: …`, followed by the error's stack on stderr). |

A hang-up (SIGHUP, for example when the terminal or SSH session that started the run closes) cancels
the run like Ctrl+C: it ends with the `cancelled` verdict and exits 130. Closing a terminal can
deliver the hang-up twice (interactive zsh, the macOS default shell, delivers it twice about 1 ms
apart), and the run still ends once, as `cancelled`, with exit 130. So `nohup agent-qa run` does not
survive a hang-up. Node.js puts the hang-up signal back to its default when it starts, and
`agent-qa run` listens for it, so `nohup`'s ignore never takes effect. Measured with
`nohup agent-qa run` sent SIGHUP during a step: the run was cancelled and exited 130 in about 0.2
seconds. In earlier versions the same signal closed the browser and the run hung until it was
killed. To keep a run going after its terminal closes, start it with `setsid` or run it under a
process manager. `--detach` only shortens the window: it skips the post-run tail, so the process
exits as soon as the run has its verdict and queues the post-run work for a later process. A second
Ctrl+C, or a SIGTERM, after the first signal still stops the run at once, with exit 130, even before
the run reaches its verdict.

Analysis and curation never change the exit code. A run whose curation is still pending exits with
its verdict's code, exactly as one whose curation finished.

## How unfinished stages show

After the verdict, `agent-qa run` prints one line naming its post-run stages, on stderr. Each stage
reads one of `pending`, `running`, `complete` or `failed`, or `skipped (reason)`.

- **`complete`** and **`failed`** are final. A finished chain prints its own line, for example
  `post-processing complete for <run id> — verdicts 0 · analysis: complete · curation: complete (added 1, …)`.
- **`pending`** means the work is queued and not done. In CI a pending stage says what resuming it
  needs, chosen by who can pick that stage up:

  ```
  post-processing — analysis: pending (resumes only if this workspace's .agent-qa/ is kept and a later run or the daemon picks it up) · curation: pending (resumes only if this workspace's .agent-qa/ is kept and a later local run picks it up) · …
  ```

  A run started with `--detach` always prints this, because it queues the work and leaves the tail
  to a later process.
- **`skipped (gate run)`**, **`skipped (outcome-excluded)`** and **`skipped (no verdict)`** mean the
  stage will never run for this run. A `--gate-run` or `--excluded-from-outcomes` run prints
  `post-processing — analysis: skipped (gate run) · curation: skipped (gate run)` (or
  `skipped (outcome-excluded)`) on its exit line. A run that ended without a verdict reads
  `skipped (no verdict)` in its digest and on the dashboard.
- **`running`** shows while a stage's job is being worked on, in the digest
  (`agent-qa digest <run id>`) and on the dashboard.

Other lines that name unfinished work say the same in CI. For example, a tail that stopped early
reads `… queued work resumes only if this workspace's .agent-qa/ is kept and a later run or the daemon picks it up.`

## What resuming pending work needs

Pending work resumes only if this workspace's local state survives and a later run, or
`agent-qa daemon`, in the same workspace picks it up. The queue, its intents and its checkpoints live
in `.agent-qa/` and the knowledge root on this machine. They are not a distributed queue. Tearing the
workspace down discards pending work, and uploaded evidence cannot be resumed on another machine or
in another job.

So in CI, read a `pending` stage as "not done, and not going to be done unless you keep this
workspace". The verdict and the exit code are final either way.

## What curation does in CI

Automatic curation in CI is propose-only. A CI run records what it learns as candidates and never
promotes them. A correction to existing knowledge becomes a separate proposed candidate, and the
record it would replace is left untouched. A later local run or a review promotes or rejects it.

The run's curation line says so:

```
curation: 1 learned change(s) recorded, 0 kept proposed (ci runs never promote learned knowledge)
```

A run that proposes a correction reads `curation: 0 learned change(s) recorded, 1 kept proposed (ci runs never promote learned knowledge)`,
and its counts line reads `superseded 0` and `proposed 1`.

## How long the post-run work takes

The post-run work has a 60-second budget, and it bounds only the work after the verdict. A model
request still in flight when the budget ends is cancelled, and its job stays queued. In CI that job
resumes only if this workspace's .agent-qa/ is kept and a later run or the daemon picks it up.
A CI workspace is usually thrown away, so work left queued in it is not finished later. The verdict
and the exit code are unaffected.

## The job

One GitHub Actions job. It installs the project, installs Chromium with its system dependencies, runs
every test your config's `workspace.testMatch` patterns match, headless, with a JUnit report, and
uploads the run directories and the report whatever the run's outcome. To run one file instead, name
it after `run`, for example `npx agent-qa run tests/login.yaml --junit-output junit.xml`. Add the environment variables your `agent-qa.config.yaml` reads, such as a model API
key, from your repository's secrets.

```yaml
name: agent-qa
on: [push, pull_request]
jobs:
  agent-qa:
    timeout-minutes: 30
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npx agent-qa install-browsers --chromium --with-deps
      - run: npx agent-qa run --junit-output junit.xml
        env:
          CI: 'true'
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: agent-qa-evidence
          path: |
            .agent-qa/runs/
            junit.xml
```

The job timeout is ordinary CI hygiene, because a web step whose frame answers its liveness check
and then hangs is held only by a step or test timeout, and neither has a default; it is not a
workaround for the post-run work, which its 60-second budget bounds.

## After upgrading

A long-lived host, such as a dashboard or `agent-qa daemon`, that was started by a build using
runs.db v5 must be restarted after you upgrade agent-qa.
