import type { MaskingContext } from '@vostride/agent-qa-schema'

export function unmaskForHumanOutput(ctx: MaskingContext, text: string): string {
  // D-04: only human output restores originals; prompt/cache/durable paths must stay masked.
  return ctx.unmask(text)
}
