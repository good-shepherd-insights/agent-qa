import { expect, it } from 'vitest'
import * as contracts from '../../index'

it('panel pooling modes exact', () => {
  expect(contracts.PANEL_POOLING_MODES).toEqual(['max', 'avg'])
})

it('panel abstention causes exact', () => {
  expect(contracts.JUDGE_ABSTENTION_CAUSES).toEqual([
    'unsure-verdict',
    'below-threshold',
    'swap-disagreement',
    'candidate-overflow',
    'missing-evidence',
    'residual-tie',
    'below-quorum',
    'panel-disagreement',
  ])
})
