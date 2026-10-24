// Frozen core source-level host/storage debt. These are not general allowances:
// memory/* clears in M2, while parser/*, suite/*, hooks/*, and reporter/* clear in M1.
export const HOST_EXTERNALS = new Set(['glob', 'posthog-node']) as ReadonlySet<string>

export function matchesDenylistEntry(pkgName: string, entry: string): boolean {
  return (
    pkgName === entry ||
    pkgName.startsWith(`${entry}-`) ||
    pkgName.startsWith(`@${entry}/`)
  )
}
