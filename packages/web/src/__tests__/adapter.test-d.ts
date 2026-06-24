import { expectTypeOf } from 'vitest'
import { WebPlatformAdapter } from '../adapter.js'

const web = new WebPlatformAdapter()

void web.execute({ type: 'click', ref: 'e1' })

// @ts-expect-error tap is a mobile verb and is illegal on the web adapter.
void web.execute({ type: 'tap', ref: 'e1' })

expectTypeOf<{ type: 'click'; ref: string }>().toMatchTypeOf<
  Parameters<WebPlatformAdapter['execute']>[0]
>()
