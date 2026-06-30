export interface MaskingContext {
  mask(text: string): string
  unmask(text: string): string
}
