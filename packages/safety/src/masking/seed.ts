import type { MaskCategory } from './categories'

export interface MaskingSeedSources {
  secretStore?: {
    forEachSecret(cb: (name: string, value: string) => void): void
  }
  env?: Record<string, string | undefined>
  authState?: {
    knownSensitiveStrings: readonly string[]
  }
}

export function seedMaskingContext(
  ctx: { register(value: string, category?: MaskCategory): void },
  sources: MaskingSeedSources,
): void {
  sources.secretStore?.forEachSecret((_name, value) => {
    ctx.register(value, 'SECRET')
  })

  for (const value of Object.values(sources.env ?? {})) {
    if (value !== undefined) ctx.register(value, 'SECRET')
  }

  for (const value of sources.authState?.knownSensitiveStrings ?? []) {
    ctx.register(value, 'SECRET')
  }
}
