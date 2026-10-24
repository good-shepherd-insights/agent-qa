export const overrideStore = new Map<string, number>()

export function capabilityKey(provider: string, model: string): string {
  return `${provider}:${model.toLowerCase().trim()}`
}

export function getObservedWindow(key: string): number | undefined {
  return overrideStore.get(key)
}
