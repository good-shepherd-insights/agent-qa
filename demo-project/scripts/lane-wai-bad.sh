#!/usr/bin/env bash
#
# LANE demo-project-wai-bad — the demo-project leg that drives `wai-bad`, the W3C BAD accessibility
# demo page.
#
# `wai-bad` is declared `environment: shared` in demo-project/agent-qa.config.yaml, and that
# declaration is TRUE: https://www.w3.org/WAI/demos/bad/before/home.html is a real host on the
# public internet. A shared target fails closed in every non-interactive context, so driven without
# trust this lane is DENIED before it navigates anywhere — measured, phase 401 plan 21:
#   run:start outcome fail-closed-denied, riskTier mutating-shared, exit 2.
#
# The owner ruled this lane `trust-the-lane` (401-21 Task 3): a demo walkthrough must not fail
# closed. `--trust-session` is therefore presented HERE, at this lane's own invocation, and is
# session-scoped — it grants nothing to any other lane and nothing beyond this process.
#
# The declaration does NOT change. w3.org stays `shared` because it is shared; reclassifying it to
# silence the gate would make the config untrue.
set -euo pipefail

cd "$(dirname "$0")/.."

CLI="${AGENT_QA_CLI:-../packages/cli/dist/cli.js}"
if [ ! -f "$CLI" ]; then
  echo "agent-qa CLI not found at: $CLI" >&2
  echo "Build it first:  (cd .. && pnpm build)" >&2
  echo "Or point AGENT_QA_CLI at an installed cli.js." >&2
  exit 1
fi

exec node "$CLI" run tests/web/bad-a11y.yaml --trust-session "$@"
