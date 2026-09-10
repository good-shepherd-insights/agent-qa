import { expect, it } from 'vitest'
import { createEvalCommand } from '../eval.js'

it('offers an explicit judge panel preview and independent minimum on the calibration verb', () => {
  const command = createEvalCommand().commands.find(child => child.name() === 'calibrate')!
  expect(command.helpInformation()).toContain('--judge-panel')
  expect(command.helpInformation()).toContain('--min-n <n>')
})
