import { expectTypeOf } from 'vitest'
import type { z } from 'zod'
import type { Use } from '../config/use'
import { useSchema } from '../config/use'

expectTypeOf<z.infer<typeof useSchema>>().toEqualTypeOf<Use>()

const web: Use = {
  platform: 'web',
  browser: { name: 'chromium' },
}

const invalidWeb: Use = {
  platform: 'web',
  browser: { name: 'chromium' },
  // @ts-expect-error web use configs have no `appState` field.
  appState: 'reset',
}

const android: Use = {
  platform: 'android',
  device: 'pixel',
  appState: 'reset',
}

const invalidAndroid: Use = {
  platform: 'android',
  device: 'pixel',
  // @ts-expect-error mobile use configs have no `browser` field.
  browser: { name: 'chromium' },
}

void web
void invalidWeb
void android
void invalidAndroid
