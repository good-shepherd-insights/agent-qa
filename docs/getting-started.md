# Getting started

This page takes you from an empty directory to a first run of agent-qa's examples. The examples
test Komazon, a small shop at `https://playground.vostride.dev/shop/` that exists for this purpose.
One of its pages has a deliberate bug, and one example catches it.

Every command below is one you can paste. Run them in order, from the directory that will hold your
tests.

## Before you start

- Node.js 24 or newer (npm comes with it)
- Network access to `playground.vostride.dev` and to your model provider
- Docker, only for the hook sample in the next steps

## 1. Install

With a Claude or Codex subscription, install agent-qa and its subscription sign-in plugin:

```sh
npm install -D agent-qa @vostride/agent-qa-subscription-auth
```

With an API key, install agent-qa alone:

```sh
npm install -D agent-qa
```

## 2. Install the browser

The examples run in Chromium. agent-qa installs its own copy:

```sh
npx agent-qa install-browsers --chromium
```

On Linux, add `--with-deps` to install the system libraries Chromium needs as well.

## 3. Create the workspace

```sh
npx agent-qa init --llm claude-code
```

`--llm` says how agent-qa reaches a model. Each value writes one model entry into
`agent-qa.config.yaml`, and the later commands name that entry with `--config`.

| `--llm` | Entry it writes | Default `--model` | Default `--base-url` |
|---|---|---|---|
| `claude-code` (the default) | `claude-code` | `claude-sonnet-5-5` | none |
| `codex` | `codex` | `gpt-6.1-sol` | none |
| `openai-compatible` | `default` | `gpt-5.5` | `https://api.openai.com/v1` |
| `anthropic-compatible` | `default` | `claude-sonnet-4-6` | `https://api.anthropic.com/v1` |
| `gemini` | `default` | `gemini-3-flash-preview` | none |

`claude-code` and `codex` use your subscription. The other three use an API key. `--model` and
`--base-url` replace the defaults, and `--base-url` is accepted only with `openai-compatible` and
`anthropic-compatible`. In a terminal, `init` asks for the platform and for any of these values you
did not pass, and every question has a default. Without a terminal it asks nothing and uses the
defaults.

`init` writes:

- `agent-qa.config.yaml`, the config, with the two Komazon targets and your model entry;
- `tests/examples/komazon-checkout.yaml`, a journey that signs in, buys a mug and checks the order.
  It passes;
- `tests/examples/komazon-cart-total-bug.yaml`, a test that opens the shop with its cart-total bug
  switched on and checks the bag's total. It fails;
- `suites/examples.suite.yaml`, which runs those two tests in that order;
- `tests/examples/komazon-shipping-hook.yaml`, `hooks.yaml` and
  `scripts/examples/make-shipping-address.mjs`, the hook sample;
- `.env` and `.env.secrets.local`. A new `.env.secrets.local` holds the shop's public demo password
  as `KOMAZON_PASSWORD=komazon123`. The journey types it as `{{secret:KOMAZON_PASSWORD}}`, and the
  run shows it as `[secret:KOMAZON_PASSWORD]`;
- `agent-qa.local.yaml`, `.gitignore`, `package.json` and the knowledge root,
  `agent-qa-knowledge/`.

If the directory is not a git repository yet, make it one and commit what `init` wrote. The last
next step reads what a run taught agent-qa as a git diff, and this commit is what it compares
against. The `.gitignore` that `init` wrote keeps `.agent-qa/`, `node_modules/`, `.env` and
`.env.secrets.local` out.

```sh
git init
git add .
git commit -m "Add agent-qa"
```

## 4. Connect the model

With a subscription, sign in. Name the entry `init` wrote:

```sh
npx agent-qa auth login --config claude-code
```

It prints a sign-in URL and opens it in your browser. Use `--config codex` for a Codex
subscription.

With an API key, the route is the same up to here, with `anthropic-compatible` as the example:

```sh
npm install -D agent-qa
npx agent-qa install-browsers --chromium
npx agent-qa init --llm anthropic-compatible
npx agent-qa auth set --config default --type api-key
```

`auth set` asks for the key at a hidden prompt, so the key never appears on the command line or in
your shell history. agent-qa stores it in `~/.agent-qa/auth.json`, outside the project. To use your
own endpoint or model, pass them to `init`:

```sh
npx agent-qa init --llm anthropic-compatible --model <model-id> --base-url <url>
```

`openai-compatible` and `gemini` work the same way, with their own `--llm` value.

## 5. Check the workspace

```sh
npx agent-qa validate
```

It reads the config and every test and suite, and prints `All files valid` when they are.

## 6. First run

```sh
npx agent-qa run suites/examples.suite.yaml
```

Expect one pass and one fail, and exit code 1. The checkout journey passes. The cart-total test
fails because it catches the playground's deliberate bug: two mugs should cost $53.00, and the bag
shows $29.00. The summary reads `Tests:  1 of 2 passed`.

## 7. Next steps

### Run the hook sample

The hook sample needs Docker running. Its hook makes a shipping address on your machine, with no
network, and the test types that address at checkout and checks it on the review page:

```sh
npx agent-qa run tests/examples/komazon-shipping-hook.yaml
```

The first run pulls the hook runner image, so it takes longer.

### See the cache

agent-qa remembers the actions a step took and replays them on the next run, without asking the
model. It writes this cache only off your default branch (`main` when it cannot tell), so the first
of these two runs passes `--save-cache`:

```sh
npx agent-qa run tests/examples/komazon-checkout.yaml --save-cache
npx agent-qa run tests/examples/komazon-checkout.yaml
```

Only a step that acts without checking anything can be replayed. A step that the model checks, or
that types a `{{secret:…}}` value, is never saved and asks the model on every run. In this journey
that leaves one step, the one that enters the street address. The `Cache:` line in each run's
summary counts hits and misses for that kind of step only, so for this journey it counts one at
most. A saved step is replayed only when the page it starts on looks the same as when it was saved,
so the second run can still count a miss.

### Open the dashboard

```sh
npx agent-qa dashboard
```

It prints `Dashboard running at` and a URL. Open the URL it prints. Each run shows its tests, steps
and evidence. Accessibility results appear only here: agent-qa checks each page at the end of a
test, so open a test's last step and its A11y tab. On the playground's pages it reads
`No accessibility violations found`. Stop the dashboard with Ctrl+C.

### Read what the run taught agent-qa

Runs write what they learn into `agent-qa-knowledge/`. List the files that changed since your
commit, then read the changes:

```sh
git status -- agent-qa-knowledge
git add --intent-to-add agent-qa-knowledge
git diff -- agent-qa-knowledge
```

After the first runs every record is a new file under `agent-qa-knowledge/memory/`, so `git status`
lists that folder and `git diff` alone prints nothing. `git add --intent-to-add` makes `git diff`
show the new files as well as changes to files you already committed. Both example tests record
under the `komazon` product, so a record can name the cart-total test's `?bug=cart-total` address.
Commit the records you want to keep.

## When something is missing

| Situation | What agent-qa prints | Fix |
|---|---|---|
| Node.js older than 24 | `agent-qa needs Node.js 24 or newer. This is Node.js <version>.` | Install Node.js 24 or newer from https://nodejs.org/, then run the command again. |
| No browser | `agent-qa browser support is not installed for Chromium.` | `npx agent-qa install-browsers --chromium` |
| A subscription that is not signed in | `Sign in to "Anthropic subscription" for the "claude-code" config: agent-qa auth login --config claude-code` | `npx agent-qa auth login --config claude-code`, or `--config codex` |
| No subscription plugin | `Provider "<provider>" needs the subscription-auth plugin: npm install -D @vostride/agent-qa-subscription-auth, …` | `npm install -D @vostride/agent-qa-subscription-auth` |
| No Gemini key | `Save a Gemini API key for the "default" config: agent-qa auth set --config default --type api-key` | `npx agent-qa auth set --config default --type api-key` |
| No key for `openai-compatible` or `anthropic-compatible` on `api.openai.com` or `api.anthropic.com` | `Save an API key for the "default" config: agent-qa auth set --config default --type api-key`; anthropic-compatible adds `(or --type bearer-token)` | `npx agent-qa auth set --config default --type api-key` |
| No key for a local or self-hosted `--base-url` | Nothing: agent-qa runs without a saved key, and the server answers as it is set up. | `npx agent-qa auth set --config default --type api-key` if the server needs one |
| An invalid config | `Config validation failed`, the key, and `Fix or remove the key named above in <path>, then run agent-qa validate.` | Fix or remove that key, then run `npx agent-qa validate`. |
| A config from before v2 | The keys removed in v2 and the steps to re-create the workspace. | Follow [re-initialize.md](re-initialize.md). |

## Older workspaces

A workspace made by agent-qa before v2 is not upgraded in place. [re-initialize.md](re-initialize.md)
says what re-initializing loses and keeps, and lists every step.
