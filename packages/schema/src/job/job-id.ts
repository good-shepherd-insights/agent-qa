declare const jobIdBrand: unique symbol

export type JobId = string & { readonly [jobIdBrand]: 'JobId' }

export const asJobId = (value: string): JobId => value as JobId
