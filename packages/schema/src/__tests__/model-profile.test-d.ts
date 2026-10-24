import { expectTypeOf } from 'vitest'
import type { ModelProfile, ModelProviderId } from '../model-profile/index'

const ok: ModelProfile = {
  provider: 'openai-compatible',
  model: 'gpt-4o',
  baseURL: 'http://localhost:11434/v1',
  auth: { mode: 'none' },
}

const pluginProvider: ModelProfile = {
  provider: 'gateway',
  model: 'x',
  auth: { mode: 'none' },
}

const builtInProvider: ModelProviderId = 'openai-compatible'
// @ts-expect-error ModelProviderId stays closed to the five built-in ids.
const badBuiltInProvider: ModelProviderId = 'gateway'

expectTypeOf<ModelProfile>().not.toHaveProperty('fetch')

void ok
void pluginProvider
void builtInProvider
void badBuiltInProvider
