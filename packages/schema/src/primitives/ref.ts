declare const refBrand: unique symbol

export type Ref = string & { readonly [refBrand]: 'Ref' }

export const asRef = (value: string): Ref => value as Ref
