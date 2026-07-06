import { expectTypeOf } from 'vitest'
import { asRef } from '@vostride/agent-qa-schema'
import type { Ref } from '@vostride/agent-qa-schema'
import { IOSPlatformAdapter } from '../adapter.js'

const ios = new IOSPlatformAdapter()
void ios.execute({ type: 'tap', ref: asRef('e1') })

// @ts-expect-error click is a web verb, illegal on an iOS adapter.
void ios.execute({ type: 'click', ref: asRef('e1') })

expectTypeOf<{ type: 'tap'; ref: Ref }>().toMatchTypeOf<
  Parameters<IOSPlatformAdapter['execute']>[0]
>()
