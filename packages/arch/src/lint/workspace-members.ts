import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function workspaceMemberDirs(repoRoot: string): string[] {
  const workspaceYaml = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
  const workspaceGlobs = workspaceYaml
    .split(/\r?\n/u)
    .map(line => line.trim())
    .map(line => line.match(/^-\s*["']?(packages\/\*)["']?\s*$/u)?.[1])
    .filter((glob): glob is 'packages/*' => glob === 'packages/*')

  if (workspaceGlobs.length === 0) {
    throw new Error('pnpm-workspace.yaml must declare the packages/* workspace member glob')
  }

  const packagesRoot = join(repoRoot, 'packages')
  const workspaceMembers = new Set<string>()
  for (const glob of workspaceGlobs) {
    if (glob !== 'packages/*') {
      continue
    }

    for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const packageDir = join(packagesRoot, entry.name)
      if (existsSync(join(packageDir, 'package.json'))) {
        workspaceMembers.add(`packages/${entry.name}`)
      }
    }
  }

  return [...workspaceMembers].sort()
}

export function contractBearingDirs(repoRoot: string): string[] {
  const packagesRoot = join(repoRoot, 'packages')
  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => {
      const packageDir = join(packagesRoot, name)
      return (
        existsSync(join(packageDir, 'package.json')) &&
        existsSync(join(packageDir, 'src', 'ownership-contract.ts'))
      )
    })
    .map(name => `packages/${name}`)
    .sort()
}

export function findContractlessWorkspaceOffenders(
  memberDirs: readonly string[],
  contractDirs: readonly string[],
): string[] {
  const contractDirSet = new Set(contractDirs)
  return memberDirs
    .filter(memberDir => !contractDirSet.has(memberDir))
    .map(memberDir => `${memberDir}: workspace package missing src/ownership-contract.ts`)
    .sort()
}

/**
 * The manifest and the filesystem agree, in BOTH directions.
 *
 * 2026-08-17 (Phase 398 plan 03). Found by mutation while registering `packages/analytics`:
 * deleting the new contract from `ARCH_MANIFEST` left `validate:arch` fully green, 41 of 41. The
 * reason is that the rule above reads the FILESYSTEM — a `src/ownership-contract.ts` that exists
 * satisfies it whether or not anything imports the file. So the package with the contract nobody
 * registered is the package whose class rules, dependency reconciliation and cycle position are
 * never checked, and the suite says so by staying quiet. Writing a contract was enforced; putting
 * it where the validator ranges was not.
 *
 * Both directions, because either alone is satisfiable by a wrong tree: a contract absent from the
 * manifest is an unchecked package, and a manifest entry whose contract file is gone is a rule set
 * being applied to a directory that no longer declares it.
 */
export function findUnregisteredContractOffenders(
  contractDirs: readonly string[],
  manifestDirs: readonly string[],
): string[] {
  const manifestDirSet = new Set(manifestDirs)
  const contractDirSet = new Set(contractDirs)

  return [
    ...contractDirs
      .filter(contractDir => !manifestDirSet.has(contractDir))
      .map(contractDir => `${contractDir}: ownership contract not registered in ARCH_MANIFEST`),
    ...manifestDirs
      .filter(manifestDir => !contractDirSet.has(manifestDir))
      .map(manifestDir => `${manifestDir}: ARCH_MANIFEST entry has no src/ownership-contract.ts`),
  ].sort()
}
