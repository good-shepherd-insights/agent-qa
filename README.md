<div align="center">
  <img src="https://raw.githubusercontent.com/vostride/agent-qa/main/docs/assets/readme-banner.png" alt="agent-qa banner"/>

  [![npm](https://img.shields.io/npm/dm/agent-qa?style=flat&colorA=13110f&colorB=196872)](https://npm.chart.dev/agent-qa?primary=neutral&gray=neutral&theme=dark)
  [![npm version](https://img.shields.io/npm/v/agent-qa.svg?style=flat&colorA=13110f&colorB=196872)](https://www.npmjs.com/package/agent-qa)
  [![GitHub stars](https://img.shields.io/github/stars/vostride/agent-qa?style=flat&colorA=13110f&colorB=196872)](https://github.com/vostride/agent-qa/stargazers)

  <p>
    <a href="https://vostride.com/docs/agent-qa">Docs</a>
    ·
    <a href="https://github.com/vostride/agent-qa/tree/main/demo-project">Demo</a>
    ·
    <a href="https://github.com/vostride/agent-qa/issues">Issues</a>
  </p>
</div>

## agent-qa
The self-improving Agentic QA harness with Memory

Write tests in natural language for web and mobile. agent-qa learns from past runs, adapts to UI changes, and catches regressions before you ship.

[Docs](https://vostride.com/docs/agent-qa) | [Quickstart](https://vostride.com/docs/agent-qa/quickstart)

## Features

- **Write tests in natural language for web and mobile**: Define actions and assertions in human language while agents work from visible roles, labels, and screen state.
- **Self-healing test execution**: When any sub-action, such as click, fill, or select, fails, agent-qa re-observes the UI and tries a different path in the same run. Tests recover from UI drift and flaky interactions instead of failing on the first broken action.
- **Self-improves with Memory**: With every test run, agent-qa builds execution memory from product, suite, and test observations, then adds that context to future runs. agent-qa also curates memory from steps that were healed during execution, helping future runs avoid the same mistake.
- **Built for humans and machines**: A polished dashboard and CLI for developers, plus MCP and skills for coding agents.
- **Accelerate runs with smart Cache**: The action cache reuses validated plans across similar subsequent test runs, reducing planner work, token usage, and runtime overhead.
- **Run sandboxed hooks during tests**: Run Node, Bun, Python, or Bash hooks in isolated Docker containers to set up environments, call APIs, seed fixtures, tear down state, or pass structured outputs back into the active test run.
- **Open source, reviewable QA**: The harness is open source, and tests, configs, hooks, memory, and suite logic all live as version-controlled code, so every change can be diffed, reviewed, reused, and shared across teams.
- **Bring your own LLM**: Run tests with the model of your choice via OpenAI- and Anthropic-compatible endpoints, Gemini, local or open-source models, and subscriptions like Codex and Claude Code.

## Quickstart

Install the package:

```sh
npm install -D agent-qa
```

For Codex or Claude Code subscription auth, also install:

```sh
npm install -D @vostride/agent-qa-subscription-auth
```

Install Docker before using hooks. agent-qa runs hooks in a sandboxed runtime, and Docker is required for the Node, Bun, Python, and Bash hook containers.

Initialize agent-qa and install the runtime support you need:

```sh
npx agent-qa init
npx agent-qa install-browsers --chromium
# Mobile projects:
npx agent-qa install-mobile-drivers --all
```

Start the dashboard, complete auth, and run tests from the UI:

```sh
npx agent-qa dashboard --open
```

For the full setup flow, use the [quickstart](https://vostride.com/docs/agent-qa/quickstart).

## CLI

Run tests from the CLI:

```sh
npx agent-qa run tests/hacker-news-top-story.yaml
```

## Live events on stdout (opt-in)

Set `AGENT_QA_LIVE_EVENTS=true` and a run prints a machine-readable line-oriented event stream to
**stdout**, alongside the usual human-readable output. It is **off by default**, and nothing in
agent-qa turns it on for you: no command, no config key and no child process sets the variable, so a
process that sees these lines is one whose operator asked for them deliberately.

```sh
AGENT_QA_LIVE_EVENTS=true npx agent-qa run tests/hacker-news-top-story.yaml
```

Every line has the same shape — the 15-character prefix `AGENT_QA_EVENT:` immediately followed by
one compact JSON object, then a newline. Nothing else is inserted between the prefix and the JSON,
so a consumer can split on newlines, drop lines that do not start with the prefix, and `JSON.parse`
the remainder of each one that does.

```text
AGENT_QA_EVENT:{"type":"...", ...}
```

**There are two writers on that prefix, and a consumer will see both interleaved.**

| Writer | Source | What it emits |
| --- | --- | --- |
| Run-event reporter | `packages/cli/src/reporters/wire-reporter.ts` | One line per run-event envelope — the same envelopes the dashboard and the console reporter subscribe to (run/test/step lifecycle, verdicts, artifacts). The JSON is the envelope itself. |
| Log NDJSON emitter | `packages/core/src/logging/log-manager.ts` | One line per log entry, as `{"type":"log", ...}` — the entry's `runId`, `testId`, `stepId`, `level`, `source`, `message`, `data` and `timestamp`. |

Both are armed by the same variable and neither can be enabled without the other: the reporter is
attached to every run session and checks the variable itself on each envelope, and the log manager
is constructed with NDJSON on when the variable is `true`. Treat the two as one channel with two
record shapes, discriminated by the JSON.

**Payloads are printed verbatim, and they are already masked.** Masking happens at the sink that
produces each record — envelope payloads are masked before the reporter sees them, and log entries
pass through the same secret redactor that the human-readable output uses. This channel performs no
second redaction and never restores an original value, so what a consumer reads is exactly what the
run decided to disclose. Note that the human-readable log display goes to **stderr**, so redirecting
stdout gives you the event stream on its own.

The channel is supported and stable in this shape. If you consume it, pin on the prefix and on the
JSON fields you actually read, not on line ordering between the two writers.

## Docs

- [Full docs](https://vostride.com/docs/agent-qa)
- [Quickstart](https://vostride.com/docs/agent-qa/quickstart)
- [CLI reference](https://vostride.com/docs/agent-qa/cli)
- [Dashboard](https://vostride.com/docs/agent-qa/dashboard)
- [Configuration](https://vostride.com/docs/agent-qa/configuration)
- [The three queues](docs/queues.md) — run queue, curation queue, agent job queue
- [License](LICENSE.md)
- [Notice](NOTICE.md)
