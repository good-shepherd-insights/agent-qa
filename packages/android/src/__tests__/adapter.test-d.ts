import { expectTypeOf } from 'vitest'
import { AndroidPlatformAdapter } from '../adapter.js'

const droid = new AndroidPlatformAdapter()
void droid.execute({ type: 'tap', ref: 'e1' })

// @ts-expect-error click is a web verb, illegal on an Android adapter.
void droid.execute({ type: 'click', ref: 'e1' })

expectTypeOf<{ type: 'tap'; ref: string }>().toMatchTypeOf<
  Parameters<AndroidPlatformAdapter['execute']>[0]
>()
