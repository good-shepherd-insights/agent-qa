#!/usr/bin/env bash
# CR-03: a duration observation must not replay an already consumed seek command.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec node --input-type=commonjs - <<'NODE'
const path = require('node:path')
const { runGate, cell } = require(path.join(process.cwd(), 'scripts/423-mutation-engine.cjs'))
const file = 'src/components/run-detail/__tests__/player.test.tsx'
const test = name => cell('player', file, name)
runGate({ slug: '424-seek-consumption-mutation', envPrefix: 'AGENT_QA_424_SEEK_CONSUMPTION_MUTATION', idPrefix: 'S',
  expectedLegs: 1, banner: 'SEEK_CONSUMPTION_MUTATION_OK', instruments: {
    player: { pkg: 'packages/dashboard-ui', files: [file], typecheck: false, count: 33 },
  }, legs: [{ subject: 'packages/dashboard-ui/src/components/run-detail/player.tsx', instrument: 'player',
    claim: 'duration observations do not replay consumed seek commands',
    operation: 'remove the consumed-command guard while retaining readiness and source lifecycle handling',
    edits: [{ from: '    if (consumedSeek.current?.fraction === seekFraction && consumedSeek.current.revision === seekRevision) return\n', to: '' }],
    reds: [test('PLAYER-CONSUMED-SEEK ignores late duration publication (revision undefined)'),
      test('PLAYER-CONSUMED-SEEK ignores late duration publication (revision 1)')],
    greens: [test('PLAYER-PENDING-SEEK waits for metadata and a timed model without consuming intent'),
      test('PLAYER-SEEK-IDENTITY reapplies on source changes and retry only after metadata'),
      test('PLAYER-REPEATED-SEEK and member continuation preserve explicit offsets and speed')],
    allowed: [],
  }],
})
NODE
