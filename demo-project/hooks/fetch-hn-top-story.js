#!/usr/bin/env node
// Per-test setup hook (D-15) — networked (hooks.yaml network: true).
// CommonJS on purpose (bare `.js` copied into the sandbox workdir, no package.json).
//
// Fetches the current Hacker News top-story id and degrades to a no-network-safe
// deterministic fallback so the hook ALWAYS exits 0 and always emits HN_TOP_STORY_ID.
// Re-runnable every milestone regardless of connectivity.
const { appendFileSync } = require('node:fs')

const ENV_FILE = '/tmp/agent-qa.env'

async function main() {
  let topStoryId = '0'
  let source = 'offline'
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (res.ok) {
      const ids = await res.json()
      if (Array.isArray(ids) && ids.length > 0 && Number.isFinite(ids[0])) {
        topStoryId = String(ids[0])
        source = 'network'
      }
    }
  } catch {
    // No-network-safe degrade: keep the deterministic fallback id.
    source = 'offline'
  }

  appendFileSync(ENV_FILE, `HN_TOP_STORY_ID=${topStoryId}\nHN_TOP_STORY_SOURCE=${source}\n`)
  console.log(`fetch-hn-top-story: HN_TOP_STORY_ID=${topStoryId} (source ${source})`)
}

main().catch((err) => {
  appendFileSync(ENV_FILE, 'HN_TOP_STORY_ID=0\nHN_TOP_STORY_SOURCE=offline\n')
  console.log(`fetch-hn-top-story: degraded (${(err && err.message) || 'unknown error'})`)
})
