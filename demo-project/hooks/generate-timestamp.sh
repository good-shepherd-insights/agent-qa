#!/usr/bin/env bash
# Suite-level setup hook (D-15). Deterministic, no network.
# Emits variables through the hook env-file contract: KEY=VALUE lines written to
# /tmp/agent-qa.env are parsed back into the run VariableStore and become
# {{env:KEY}} in later step text.
set -euo pipefail

# A monotonic run marker (proves a bash hook can export a computed value).
GENERATED_TIMESTAMP="$(date +%s)"

# A deterministic token the acceptance suite's hook-variable chain consumes. It is
# anchored to text that really appears on the wai-bad target page ("Welcome to
# CityLights"), so a step that verifies "{{env:ACCEPTANCE_TOKEN}}" grounds green on
# a real run (D-15: flaky steps are defects — keep the assertion deterministic).
ACCEPTANCE_TOKEN="CityLights"

{
  echo "GENERATED_TIMESTAMP=${GENERATED_TIMESTAMP}"
  echo "ACCEPTANCE_TOKEN=${ACCEPTANCE_TOKEN}"
} >> /tmp/agent-qa.env

echo "generate-timestamp: exported GENERATED_TIMESTAMP=${GENERATED_TIMESTAMP} ACCEPTANCE_TOKEN=${ACCEPTANCE_TOKEN}"
