![agent-qa banner](https://raw.githubusercontent.com/vostride/agent-qa/main/docs/assets/readme-banner.png)

<!-- # agent-qa -->

The self-improving Agentic QA harness with Memory

Write tests in natural language for web and mobile. agent-qa learns from past runs, adapts to UI changes, and catches regressions before you ship.

[Docs](https://vostride.com/docs/agent-qa) | [Quickstart](https://github.com/vostride/agent-qa/blob/main/docs/getting-started.md)

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

Node.js 24 or newer (npm comes with it).

```sh
npm install -D agent-qa @vostride/agent-qa-subscription-auth
npx agent-qa install-browsers --chromium
npx agent-qa init --llm claude-code
```

With an API key, install `agent-qa` alone and pass another `--llm` value. The rest of the route,
from signing in to a first run of the examples, is in
[getting-started.md](https://github.com/vostride/agent-qa/blob/main/docs/getting-started.md).

## Secrets

Put test credentials in the secrets file that `workspace.secretsFile` names (`init` sets it to
`.env.secrets.local`). Only the values in that file are secrets: agent-qa shows each one as
`[secret:<name>]` and never restores it, and a test types one with `{{secret:<name>}}`. Nothing else
is masked, and screenshots and recordings are not masked, so use temporary, limited test
credentials. The one exception: the dashboard's model connection check keeps the key or header
value it is testing out of the provider's error message.

## CLI

Run tests from the CLI:

```sh
npx agent-qa run suites/examples.suite.yaml
```

## Docs

- [Full docs](https://vostride.com/docs/agent-qa)
- [Quickstart](https://github.com/vostride/agent-qa/blob/main/docs/getting-started.md) — from an empty directory to a first run
- [Re-initializing a workspace from before v2](https://github.com/vostride/agent-qa/blob/main/docs/re-initialize.md)
- [Claude Code and Codex](https://github.com/vostride/agent-qa/blob/main/docs/coding-agents.md) — the skills and the MCP server in each coding agent
- [CLI reference](https://vostride.com/docs/agent-qa/cli)
- [Dashboard](https://vostride.com/docs/agent-qa/dashboard)
- [Configuration](https://vostride.com/docs/agent-qa/configuration)
- [License](LICENSE.md)
- [Notice](NOTICE.md)
