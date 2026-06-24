import { expectTypeOf } from 'vitest'
import { IOSPlatformAdapter } from '../adapter.js'

const ios = new IOSPlatformAdapter()
void ios.execute({ type: 'tap', ref: 'e1' })

// @ts-expect-error click is a web verb, illegal on an iOS adapter.
void ios.execute({ type: 'click', ref: 'e1' })

expectTypeOf<{ type: 'tap'; ref: string }>().toMatchTypeOf<
  Parameters<IOSPlatformAdapter['execute']>[0]
>()
