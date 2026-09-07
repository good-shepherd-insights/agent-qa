import { describe, expect, it } from 'vitest'
import * as evalLocal from '../index.js'

describe('gate-1 fixture and the profile-keyed baseline cache', () => {
  it('exports the cache resolution and root discovery operations', () => {
    expect(Reflect.get(evalLocal, 'resolveBaselineCache')).toBeTypeOf('function')
    expect(Reflect.get(evalLocal, 'listBaselineRunRoots')).toBeTypeOf('function')
  })
})
