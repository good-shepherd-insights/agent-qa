#!/usr/bin/env bash
# Suite-level / per-test teardown hook (D-15). Deterministic, no network.
# A teardown hook proves the after-suite / after-test lifecycle leg runs; it records a
# recognizable line and emits a completion marker through the env-file contract.
set -euo pipefail

echo "log-cleanup: teardown complete for run ${GENERATED_TIMESTAMP:-<no-timestamp>}"

echo "CLEANUP_DONE=1" >> /tmp/agent-qa.env
