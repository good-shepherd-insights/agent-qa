import { describe, expect, it } from 'vitest'

import { matchLexicon } from '../lexicon'

describe('matchLexicon', () => {
  it.each([
    ['web_navigate', undefined, undefined],
    ['delete_account', undefined, 'soft'],
    ['git_push', 'git push --force', undefined],
    ['run_shell', 'rm -rf /tmp/x', 'hard'],
    ['exec', 'sudo reboot', 'hard'],
    ['deploy_service', undefined, 'soft'],
    ['undelete_item', undefined, undefined],
    ['status', 'deployment-status ok', undefined],
    ['kill', undefined, 'hard'],
  ] as const)('classifies %s with command %s as %s', (name, command, expected) => {
    expect(matchLexicon(name, command)).toBe(expected)
  })
})
