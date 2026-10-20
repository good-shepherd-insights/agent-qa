# Use agent-qa from Claude Code or Codex

This page connects agent-qa to Claude Code or to Codex, so the coding agent can write a test, run
it and read the result. It starts where [getting-started.md](getting-started.md) ends: agent-qa is
installed in the project and `npx agent-qa init` has created the workspace. Run every command below
from the folder that holds `agent-qa.config.yaml`.

## The skills

agent-qa ships four skills. `agent-qa-authoring` writes and runs tests, `agent-qa-result-triage`
sorts a failed run by its evidence, `agent-qa-debug-fix` fixes the cause of a failed run, and
`agent-qa-knowledge` reads runs, evidence and what agent-qa has learned. Each host's section below
copies them from `node_modules/agent-qa/skills/` into the folder that host reads.

The copies are plain files from the package. Whether you commit them is your choice. After you
upgrade agent-qa, delete the old `agent-qa-*` folders and copy again, so no file from the older
version stays behind.

Each example prompt below names the skill to use. The host may also pick a skill on its own when
your request fits one.

## Claude Code

```sh
mkdir -p .claude/skills
cp -R node_modules/agent-qa/skills/agent-qa-* .claude/skills/
claude mcp add-json --scope project agent-qa '{"type":"stdio","command":"npx","args":["agent-qa","mcp"],"timeout":6000000}'
```

The last line writes the agent-qa server into `.mcp.json` in the project. Claude Code starts and
stops the server itself, over stdio, so there is no port to choose and no second terminal. The
server finds `agent-qa.config.yaml` from the folder Claude Code runs in, so start `claude` from the
folder that holds `agent-qa.config.yaml`.

Then ask, for example:

`/agent-qa-authoring Write an agent-qa test for the komazon target: add one Everyday Ceramic Mug to the bag, open the shopping bag and check that the bag total is $29.00. Then run it.`

To read the run afterwards:

`/agent-qa-knowledge What did run <runId> do? Give its verdict and the evidence for the bag total.`

The first time, Claude Code asks about the project's agent-qa server and then about the agent-qa
tools: choose "Use this MCP server", then "Yes, and don't ask again".

## Codex

```sh
mkdir -p .agents/skills
cp -R node_modules/agent-qa/skills/agent-qa-* .agents/skills/
codex mcp add agent-qa --url http://127.0.0.1:3471/mcp
```

`codex mcp add` writes the server into `~/.codex/config.toml`. Add the `tool_timeout_sec` line under
it there, so the block reads:

```toml
[mcp_servers.agent-qa]
url = "http://127.0.0.1:3471/mcp"
tool_timeout_sec = 6000
```

Codex connects to a server that is already running. Start it in its own terminal, from the folder
that holds `agent-qa.config.yaml`, and leave it running while you use Codex:

```sh
npx agent-qa mcp --http
```

`npx agent-qa mcp --http` is the one process that listens on port 3471, at
`http://127.0.0.1:3471/mcp`, the address each skill's `agents/openai.yaml` names.

Then ask, for example:

`$agent-qa-authoring Write an agent-qa test for the komazon target: add one Everyday Ceramic Mug to the bag, open the shopping bag and check that the bag total is $29.00. Then run it.`

To read the run afterwards:

`$agent-qa-knowledge What did run <runId> do? Give its verdict and the evidence for the bag total.`

The first time Codex calls an agent-qa tool, choose "Allow and don't ask me again".

## Why the timeouts are 100 minutes

`agent_qa_start_run` answers when the run has its verdict, not when the run starts, and
`agent_qa_write_test` runs its checks before it answers. A new workspace's `use.timeout.test` is
`90m`, so agent-qa ends a test that hangs after 90 minutes. Both hosts wait 100 minutes, just above
that limit, so agent-qa ends a stuck test before the host stops waiting: Claude Code's
`"timeout":6000000` is in milliseconds, and Codex's `tool_timeout_sec = 6000` is in seconds.
Codex waits 60 seconds without the line. A suite runs its tests one after another, so for a suite
allow 90 minutes per test in both values.

## See the run in the dashboard

The host's runs land in the workspace's run store, so the dashboard shows them. Start it in another
terminal, from the same folder:

```sh
npx agent-qa dashboard
```

It prints `Dashboard running at` and a URL. Open `<URL it prints>/runs/<runId>`, with the run id
from the host's run result. A new workspace's dashboard does not use port 3471, so it runs beside
`npx agent-qa mcp --http`.

## AGENTS.md

Neither host needs an AGENTS.md or CLAUDE.md step. The agent-qa MCP server sends both hosts a short
pointer to agent-qa's commands and knowledge when they connect, and the skills carry the workflows.
If you want the pointer in the project's AGENTS.md as well, paste this block into it. It is the
block init printed under "Coding agents: add this block to AGENTS.md at the project root" when it
created the workspace:

```md
<!-- agent-qa init:start -->
## agent-qa
This project is tested with agent-qa. Read its data through
agent-qa's commands (CLI with --json, or the agent_qa_* MCP
tools), never through .agent-qa/ files, SQLite or index files.
- Runs: `npx agent-qa runs list`, then `npx agent-qa runs overview <runId>`
- Knowledge: read agent-qa-knowledge/AGENTS.md first
- Skills: `npx agent-qa skills` lists them; host setup: https://github.com/vostride/agent-qa/blob/main/docs/coding-agents.md
- Secrets: only the values in `workspace.secretsFile` are masked,
  shown as `[secret:<name>]`; use temporary, limited test credentials
<!-- agent-qa init:end -->
```

## Limits

- Checked on 2026-10-21 with Claude Code 2.1.305 and the agent-qa 0.2.0 packages: Claude Code found
  the four skills and the agent-qa server with all 20 of its tools, wrote and ran the example test
  above, read the run's evidence and quoted its $29.00 bag total, and the dashboard showed the same
  result. The run ended `passed`.
- Checked on 2026-10-21 with Codex CLI 0.163.0 and the agent-qa 0.2.0 packages: Codex listed the
  four skills and loaded each one the request named with `$`, wrote and ran the example test above
  through `npx agent-qa mcp --http`, read the run's evidence and quoted its $29.00 bag total, and
  the dashboard showed the same result while `npx agent-qa mcp --http` kept port 3471. The run ended
  `passed`.
- `agent_qa_start_run` answers only when the run has its verdict, and `agent_qa_write_test` runs its
  checks before it answers, so either call can take as long as the tests it runs.
- `agent_qa_start_run` answers with the run id, not the verdict. `agent_qa_get_run_overview` reads
  the verdict, and the skills call it.
- `agent_qa_start_run` lists a `scope` argument that the agent-qa server refuses. Name the tests with
  `patterns` instead, as the skills say; Claude Code and Codex both did so.
- `agent_qa_list_runs` answers no runs when it is given a `target`, because agent-qa records no
  targets for a run. List runs without `target`, or read the run by its id, as Codex did.
- A run can end `healed` rather than `passed`: every step passed, but agent-qa had to recover on
  the way. A healed run counts as a pass.
- `agent_qa_write_test` can add steps the request did not name, such as opening the product page
  first. Read the test file it writes.
- When the model provider refuses a call, the tool's error can carry only the HTTP status text, such
  as `Bad Request`, and not the provider's reason.
- Without the `"timeout"` above, Claude Code stops waiting after 30 minutes in which a stdio server
  sends nothing, and agent-qa sends nothing until it answers.
- With Codex, agent-qa's browser runs in the `npx agent-qa mcp --http` process you started, outside
  Codex's sandbox.
- `codex exec` cancels an agent-qa tool call that Codex would first have to ask you about
  ([openai/codex#24135](https://github.com/openai/codex/issues/24135)).
- A host that stops waiting does not stop the run. The run goes on to its verdict, and the dashboard
  shows it at `<URL it prints>/runs/<runId>`.
- Results from `npx agent-qa mcp` carry no dashboard link unless `services.dashboard.baseUrl` is set
  in `agent-qa.config.yaml`.
- A workspace that declares `services.mcp` in `agent-qa.config.yaml` has the dashboard serve MCP on
  that port too, so the dashboard and `npx agent-qa mcp --http` cannot both have port 3471. Remove
  the `services.mcp` block to leave 3471 to `npx agent-qa mcp --http`.
