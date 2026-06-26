import { expectTypeOf } from 'vitest'
import type { ModelProfile } from '../model-profile/index'

const ok: ModelProfile = {
  provider: 'openai-compatible',
  model: 'gpt-4o',
  baseURL: 'http://localhost:11434/v1',
  auth: { mode: 'none' },
}

const badProvider: ModelProfile = {
  provider: 'gateway',
  model: 'x',
  auth: { mode: 'none' },
}

expectTypeOf<ModelProfile>().not.toHaveProperty('fetch')

void ok
void badProvider
