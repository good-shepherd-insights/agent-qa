import { describe, expect, it } from 'vitest'

import * as lexicon from '../lexicon'
import { matchLexicon } from '../lexicon'

// RE-SPELLED 2026-10-01 (432-19, D-16): `matchLexicon` reads the action NAME only. The rows that
// classified a command (`git push --force`, `rm -rf /tmp/x`, `sudo reboot`, `deployment-status ok`)
// now pin that the command-pattern list is gone; every name row is unchanged.
describe('matchLexicon', () => {
  it.each([
    ['web_navigate', undefined],
    ['delete_account', 'soft'],
    ['deploy_service', 'soft'],
    ['undelete_item', undefined],
    ['kill', 'hard'],
    ['sudo_reboot', 'hard'],
    ['git_push', undefined],
    ['run_shell', undefined],
    ['exec', undefined],
    ['status', undefined],
  ] as const)('classifies %s as %s', (name, expected) => {
    expect(matchLexicon(name)).toBe(expected)
  })

  it('has no command-pattern list and takes no command argument (D-16)', () => {
    expect(Object.keys(lexicon).sort()).toEqual(['HARD_NAME_VERBS', 'SOFT_DESTRUCTIVE_VERBS', 'matchLexicon'])
    expect(matchLexicon.length).toBe(1)
  })
})
