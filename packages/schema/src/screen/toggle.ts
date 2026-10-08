export const TOGGLE_ROLES: ReadonlySet<string> = new Set(['switch', 'checkbox', 'radio'])

export function isToggleElement(el: {
  role: string
  attributes?: Readonly<Record<string, string>>
}): boolean {
  return el.attributes?.['checkable'] === 'true' || TOGGLE_ROLES.has(el.role)
}
