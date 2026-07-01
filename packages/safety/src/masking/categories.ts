export type MaskCategory = 'SECRET' | 'EMAIL'

export function formatPlaceholder(category: MaskCategory, index: number): string {
  return `<${category}_${index}>`
}
