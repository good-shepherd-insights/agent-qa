# Re-initializing a workspace from before v2

agent-qa v2 does not upgrade a workspace that an earlier version made. When a config holds keys that
v2 removed, every command that reads it stops, names those keys and points here. You re-create the
workspace with `init --force` instead, and your own tests stay as they are.

Read what re-initializing loses before you start. Then follow the steps in order, from the project
directory.

## What re-initializing loses

- **Run history.** Past runs, their evidence and the dashboard's records, all under `.agent-qa/`.
- **The cache.** The action cache under `.agent-qa/cache/`, so the first runs ask the model for
  every step again.
- **Saved web logins.** The auth states under `.agent-qa/auth-states/`.
- **Learned knowledge.** Everything in `agent-qa-knowledge/`, and the v1 memory in
  `agent-qa-memory/`.
- **Rules you wrote**, unless you copy them aside in step 2.
- **Config customizations**, such as your own targets and models and any setting you changed in
  `agent-qa.config.yaml`. Copy the file aside if you want to add them back by hand afterwards. v2
  does not read the old file as it is.
- **`init`'s generated files.** `init --force` writes the config, `hooks.yaml`,
  `agent-qa.local.yaml` and the examples again. If you added your own hooks to `hooks.yaml`, copy it
  aside as well.

## What it keeps

- **Your own tests and suites.** v2's examples live in `tests/examples/` and
  `suites/examples.suite.yaml`, and `init --force` writes nothing else under `tests/` or `suites/`.
- **`.env` and `.env.secrets.local`.** `init --force` never writes either file.

## 1. Stop agent-qa

Stop everything that is running agent-qa in this project before you delete anything. They hold files
under `.agent-qa/` and `agent-qa-knowledge/` open.

- **The dashboard:** press Ctrl+C in the terminal that runs it.
- **The daemon:**

  ```sh
  npx agent-qa daemon stop
  ```

- **An MCP server:** a coding agent that uses agent-qa starts its own `agent-qa mcp`. Close that
  agent's session. If you started `agent-qa mcp` or `agent-qa serve` in a terminal, press Ctrl+C
  there.

## 2. Copy your rules aside

Rules you wrote live in `agent-qa-knowledge/policies/*.md`, and a v1 workspace may also have the
`agent-rules.md` file that its config names in `workspace.agentRules`. Copy them out of the way:

```sh
mkdir rules-before-v2
cp agent-qa-knowledge/policies/*.md rules-before-v2/
cp agent-rules.md rules-before-v2/
```

If your config names a different rules file, copy that file instead of `agent-rules.md`.

## 3. Delete the old state and examples

Delete agent-qa's own state:

```sh
rm -rf .agent-qa/ agent-qa-knowledge/ agent-qa-memory/
```

Then delete the example files that an earlier `init` wrote, and the v1 rules file you copied aside:

```sh
rm -f tests/example-pass.yaml tests/example-fail.yaml tests/hacker-news-top-story.yaml tests/bad-a11y.yaml
rm -rf tests/automation-exercise/
rm -f suites/automation-exercise.suite.yaml scripts/fetch-hn-top-story.mjs agent-rules.md
```

If you edited one of these examples into a test of your own, keep that file: leave it out of the
`rm` line, and after step 5 point it at one of your own targets. The old examples name targets that
v2's config no longer has.

## 4. Upgrade the packages

```sh
npm install -D agent-qa@latest @vostride/agent-qa-subscription-auth@latest
```

If you use an API key and never installed the subscription plugin, run
`npm install -D agent-qa@latest` instead.

## 5. Re-initialize

```sh
npx agent-qa init --force --llm claude-code
```

Use the `--llm` value for your model: `claude-code`, `codex`, `openai-compatible`,
`anthropic-compatible` or `gemini`. [getting-started.md](getting-started.md#3-create-the-workspace)
lists the entry each one writes and its defaults.

`--force` lets `init` write over the old config. If `init` refuses because of
`agent-qa-knowledge/.gitignore`, the old knowledge root is still there: go back to step 3.

## 6. Put your rules and the example secret back

Open `agent-qa-knowledge/policies/global.md` and paste in the rules you copied to
`rules-before-v2/`. Then delete that folder.

Your `.env.secrets.local` already existed, so `init` left it as it was and printed the line the
examples need to sign in. Add this line to `.env.secrets.local`:

```text
KOMAZON_PASSWORD=komazon123
```

It is the Komazon playground's public demo password, printed on its sign-in page.

## 7. Sign in and run

v1 named the Claude subscription entry `claude-subscription`. v2 names it `claude-code`, and a
sign-in saved for `claude-subscription` is not reused, so sign in again:

```sh
npx agent-qa auth login --config claude-code
```

Use `--config codex` for a Codex subscription. With an API key, save it for the entry `init` wrote.
`auth set` asks for it at a hidden prompt:

```sh
npx agent-qa auth set --config default --type api-key
```

Add your own targets back to `agent-qa.config.yaml`, then check the workspace and run the examples:

```sh
npx agent-qa validate
npx agent-qa run suites/examples.suite.yaml
```

Expect one pass and one fail, and exit code 1, as on a new workspace. The rest is the same as
[getting-started.md](getting-started.md#7-next-steps).
