#!/usr/bin/env node
// Per-test setup + inline-step hook (D-15). Deterministic, no network.
// CommonJS on purpose (bare `.js` copied into the sandbox workdir, no package.json).
//
// Exports RUNTIME_ENV_VALUE, the variable the acceptance hook-variable chain consumes:
// a later step verifies the page contains "{{env:RUNTIME_ENV_VALUE}}". The value is
// anchored to text that really appears on the wai-bad target page ("Welcome to
// CityLights") so the consuming step grounds green on a real run.
const { appendFileSync } = require('node:fs')

const ENV_FILE = '/tmp/agent-qa.env'

// Prefer an operator-provided value if one was injected into the hook env, else fall
// back to the deterministic default so the hook never depends on external state.
const value = process.env.RUNTIME_ENV_SEED || 'CityLights'

appendFileSync(ENV_FILE, `RUNTIME_ENV_VALUE=${value}\n`)
console.log(`set-runtime-env: exported RUNTIME_ENV_VALUE=${value}`)
