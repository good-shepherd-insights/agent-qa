declare const patchIdBrand: unique symbol

export type PatchId = string & { readonly [patchIdBrand]: 'PatchId' }

export const asPatchId = (value: string): PatchId => value as PatchId
