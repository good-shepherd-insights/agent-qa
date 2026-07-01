import { AsyncLocalStorage } from 'node:async_hooks'

import { setActiveMaskingContextResolver } from '@vostride/agent-qa-safety'
import type { MaskingContext } from '@vostride/agent-qa-schema'

const als = new AsyncLocalStorage<MaskingContext>()

setActiveMaskingContextResolver(() => als.getStore())

export function runMaskingScope<T>(ctx: MaskingContext, fn: () => T): T {
  return als.run(ctx, fn)
}
