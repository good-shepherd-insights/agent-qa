declare const runIdBrand: unique symbol

export type RunId = string & { readonly [runIdBrand]: 'RunId' }

export const asRunId = (value: string): RunId => value as RunId
