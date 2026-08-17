import assert from 'node:assert/strict'
import test from 'node:test'
import { derivePublishOrder, publicPackageNames } from '../release/packages.mjs'

test('derives dependency-first individual package publish order', () => {
  const shuffled = [...publicPackageNames].reverse().map(name => ({ name, pkg: { name, private: false } }))
  const ordered = derivePublishOrder(shuffled).map(record => record.pkg.name)

  // 2026-08-17 (Phase 398 plan 11): re-pinned to 22. This pin had already drifted before this
  // phase — it was missing `-safety` and `-safety-local`, and nothing noticed because
  // scripts/__tests__ sits outside the turbo `test` task set. Plan 11 adds `-analytics`,
  // `-eval`, `-eval-local` and `-runner-local`, all four of which are `workspace:*` deps of
  // packages/cli that the publish order omitted. Each of the six restored names sits after
  // every internal dependency it declares. The 4 known order violations among
  // `agent-local`/`knowledge-local` predate this phase and are deliberately left alone.
  assert.deepEqual(ordered, [
    '@vostride/agent-qa-ids',
    '@vostride/agent-qa-schema',
    '@vostride/agent-qa-safety',
    '@vostride/agent-qa-runner',
    '@vostride/agent-qa-runner-local',
    '@vostride/agent-qa-eval',
    '@vostride/agent-qa-agent',
    '@vostride/agent-qa-model',
    '@vostride/agent-qa-agent-local',
    '@vostride/agent-qa-knowledge-local',
    '@vostride/agent-qa-tools-local',
    '@vostride/agent-qa-safety-local',
    '@vostride/agent-qa-eval-local',
    '@vostride/agent-qa-core',
    '@vostride/agent-qa-web',
    '@vostride/agent-qa-android',
    '@vostride/agent-qa-ios',
    '@vostride/agent-qa-mcp',
    '@vostride/agent-qa-analytics',
    '@vostride/agent-qa-dashboard-ui',
    '@vostride/agent-qa-dashboard',
    'agent-qa',
  ])
})

test('rejects missing, duplicate, private, or extra public package records', () => {
  assert.throws(() => derivePublishOrder([]), /missing public package/)
  assert.throws(
    () => derivePublishOrder([
      ...publicPackageNames.map(name => ({ pkg: { name, private: false } })),
      { pkg: { name: 'agent-qa', private: false } },
    ]),
    /duplicate public package/,
  )
  assert.throws(
    () => derivePublishOrder(publicPackageNames.map(name => ({ pkg: { name, private: name === 'agent-qa' } }))),
    /private public package/,
  )
  assert.throws(
    () => derivePublishOrder([
      ...publicPackageNames.map(name => ({ pkg: { name, private: false } })),
      { pkg: { name: '@vostride/agent-qa-extra', private: false } },
    ]),
    /extra public package/,
  )
})
