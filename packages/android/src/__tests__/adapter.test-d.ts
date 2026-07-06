import { expectTypeOf } from 'vitest'
import { asRef } from '@vostride/agent-qa-schema'
import type { Ref } from '@vostride/agent-qa-schema'
import { AndroidPlatformAdapter } from '../adapter.js'

const droid = new AndroidPlatformAdapter()
void droid.execute({ type: 'tap', ref: asRef('e1') })

// @ts-expect-error click is a web verb, illegal on an Android adapter.
void droid.execute({ type: 'click', ref: asRef('e1') })

expectTypeOf<{ type: 'tap'; ref: Ref }>().toMatchTypeOf<
  Parameters<AndroidPlatformAdapter['execute']>[0]
>()
