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
