/**
 * CR-03 credential provenance law.
 *
 * A capture receipt masks an element region, but the sensitive datum is the value
 * supplied to that element. Only the action field carrying that value inherits
 * receipt sensitivity. Behavioral replay options such as clearMode, submit,
 * delays, and desiredState must remain literal procedure semantics.
 */
export const CREDENTIAL_VALUE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  fill: ['text'],
  paste: ['value'],
  select: ['value'],
  nativeSelect: ['value'],
  pickerSelect: ['value'],
}

/** Return whether an action field can carry a credential value into a target. */
export function isCredentialValueField(actionType: string, field: string): boolean {
  return CREDENTIAL_VALUE_FIELDS[actionType]?.includes(field) ?? false
}
