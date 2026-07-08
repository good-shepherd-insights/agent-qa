#!/usr/bin/env node
// Suite-level setup hook (D-15) — the networked one (hooks.yaml network: true).
// Performs a trivially reliable fetch and degrades to a no-network-safe result so
// the hook is deterministic and re-runnable every milestone: it ALWAYS exits 0 and
// always emits API_DATA_STATUS, whether the network is reachable or not.
//
// CommonJS on purpose: the sandbox copies only this file into the container workdir
// (no package.json), so `require` is the safe module system for a bare `.js` hook.
//
// Emits via the hook env-file contract: KEY=VALUE lines appended to /tmp/agent-qa.env
// become {{env:KEY}} in the run VariableStore.
const { appendFileSync } = require('node:fs')

const ENV_FILE = '/tmp/agent-qa.env'

async function main() {
  let status = 'offline'
  let httpStatus = '0'
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    // example.com is a stable, low-dependency endpoint (IANA reserved demo domain).
    const res = await fetch('https://example.com/', { signal: controller.signal })
    clearTimeout(timer)
    httpStatus = String(res.status)
    status = res.ok ? 'ok' : 'degraded'
  } catch {
    // No-network-safe degrade: still a successful hook, just a different status value.
    status = 'offline'
  }

  appendFileSync(ENV_FILE, `API_DATA_STATUS=${status}\nAPI_DATA_HTTP_STATUS=${httpStatus}\n`)
  console.log(`fetch-api-data: API_DATA_STATUS=${status} (http ${httpStatus})`)
}

main().catch((err) => {
  // Even an unexpected error degrades gracefully rather than failing the suite bootstrap.
  appendFileSync(ENV_FILE, 'API_DATA_STATUS=offline\nAPI_DATA_HTTP_STATUS=0\n')
  console.log(`fetch-api-data: degraded (${(err && err.message) || 'unknown error'})`)
})
