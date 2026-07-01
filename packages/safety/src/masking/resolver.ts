import type { MaskingContext } from '@vostride/agent-qa-schema'

export type MaskingContextResolver = () => MaskingContext | undefined

let active: MaskingContextResolver = () => undefined

export function setActiveMaskingContextResolver(resolve: MaskingContextResolver): void {
  active = resolve
}

export function getActiveMaskingContext(): MaskingContext | undefined {
  return active()
}
